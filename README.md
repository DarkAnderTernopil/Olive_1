# Repriced — Yahoo Mail Integration Microservice

Monitors Yahoo Mail inboxes for flight booking confirmation emails from top US airlines, supporting Repriced's automatic rebooking flow.

## Quick Start

```bash
cp .env.example .env
# Fill in YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET from https://developer.yahoo.com/apps/
npm install
npm run dev       # Express server + BullMQ worker (dev mode)
# OR run separately:
npm start         # Express server only
npm run worker    # BullMQ worker only
```

Requires running MongoDB and Redis instances.

### Docker Compose

```bash
cp .env.example .env
# set YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET in .env
docker compose up --build
```

This starts:
- `api` on `http://localhost:3000`
- `worker` for BullMQ processing
- `mongo` on `localhost:27017`
- `redis` on `localhost:6379`

## API Endpoints

| Method | Path                | Description                        |
| ------ | ------------------- | ---------------------------------- |
| POST   | `/api/yahoo/connect`       | Returns Yahoo OAuth authorization URL |
| GET    | `/api/yahoo/callback`      | Handles OAuth callback, stores tokens |
| POST   | `/api/yahoo/sync/:userId`  | Enqueues a high-priority mail sync job |
| GET    | `/health`                  | Health check                       |

### Flow

1. Client calls `POST /connect` → gets `authorizationUrl`
2. User authorizes in browser → Yahoo redirects to `GET /callback?code=...`
3. Service exchanges code for tokens, fetches user profile, upserts user in MongoDB
4. Client (or scheduler) calls `POST /sync/:userId` → job enqueued in BullMQ
5. Worker picks up job → refreshes token if expired → connects to IMAP → scans subjects → logs matches

## Architecture (DDD)

```
src/
├── domain/              # Pure business logic, zero dependencies on frameworks
│   ├── user/            # User entity + repository interface (port)
│   ├── email/           # EmailMatch entity + repository interface + airline keywords
│   └── sync/            # SyncJob value object (priority model)
├── application/         # Use cases / orchestration
│   └── services/
│       ├── OAuthService.js       # OAuth flow orchestration
│       ├── MailSyncService.js    # Core sync logic: IMAP → filter → persist
│       └── TokenService.js       # Token refresh logic
├── infrastructure/      # Adapters for external systems
│   ├── persistence/     # MongoDB implementations of repository ports
│   ├── mail/            # IMAP client (imapflow)
│   ├── oauth/           # Yahoo OAuth HTTP client
│   ├── queue/           # BullMQ producer + worker
│   └── database/        # MongoDB & Redis connection managers
├── interfaces/          # Inbound adapters
│   ├── http/            # Express routes + controllers
│   └── middleware/       # Error handler
└── config/              # Environment config
```

**Why DDD?** Clean separation lets us swap infrastructure (e.g. replace IMAP with a future Yahoo REST API, or switch from BullMQ to Redis Streams) without touching domain/application logic. Repository interfaces in the domain layer act as ports; Mongo implementations are adapters.

## Key Design Decisions

### IMAP over Yahoo Mail API

Yahoo's REST Mail API has been deprecated and is unreliable. IMAP via `imapflow` is:
- **Stable** — Yahoo fully supports IMAP with OAuth 2.0 XOAUTH2
- **Well-documented** — standard IMAP protocol, not a proprietary API
- **Battle-tested** — `imapflow` handles connection pooling, IDLE, and streaming natively

**Trade-off:** IMAP connections are heavier than REST calls. Each sync opens a TCP+TLS connection. For 10k+ accounts, connection reuse and pooling become critical (see Scalability).

### BullMQ over raw Redis Streams

BullMQ is built on Redis Streams under the hood, but provides:
- **Job prioritization** — `priority` field, lower = higher priority. API-triggered syncs get priority 1, scheduled syncs get 5.
- **Exponential backoff retries** — 3 attempts with 5s base delay, handles transient IMAP/OAuth failures
- **Rate limiting** — global limiter (50 jobs/min) prevents Yahoo from throttling us; per-job deduplication prevents double-syncing
- **Built-in metrics** — completed/failed counts, job lifecycle events

**Trade-off:** BullMQ adds a dependency vs raw Streams. Acceptable for a prototype; in production with extreme scale, raw Streams give more control over memory and consumer groups.

### Token Refresh Strategy

`TokenService.ensureValidToken()` checks expiry with a 5-minute buffer before each IMAP connection. If expired, it refreshes transparently and persists new tokens. This is called inside the sync flow, not as a separate scheduled job.

**Trade-off:** Refresh-on-demand is simpler than a background refresh scheduler, but means the first sync after expiry has added latency (~200-500ms for the token refresh round-trip). At 10k accounts, a background refresh sweep would be more efficient.

### Email Filtering

Subject-line matching uses a pre-compiled regex against 5 airline keywords. Case-insensitive, no body parsing required. The `matchAirline()` function is a pure domain function — easy to test and extend.

Matched keywords: `Delta`, `United`, `American Airlines`, `Southwest`, `Alaska Airlines`

## Scalability Approach (10k+ accounts)

### Implemented
- **BullMQ job queue** with configurable concurrency (default: 10 concurrent workers)
- **Global rate limiter** — 50 syncs/minute to stay within Yahoo's IMAP rate limits
- **Per-user dedup** — jobId = `sync-{userId}` prevents duplicate sync jobs
- **Priority levels** — API-triggered syncs jump the queue (priority 1 vs 5)
- **Exponential retry** — 3 attempts with 5s/10s/20s backoff on failure
- **Separate worker process** — `npm run worker` can be scaled horizontally

### What Production Needs

- **IMAP connection pooling** — reuse connections across syncs for the same user. `imapflow` supports IDLE; a pool manager could keep hot connections for active users.
- **Horizontal worker scaling** — run N worker instances behind a load balancer. BullMQ handles this natively via Redis — each worker competes for jobs.
- **Partitioned queues** — shard users across multiple queues by userId hash to reduce Redis hotspot contention.
- **Scheduled sync cron** — a lightweight scheduler that enqueues all connected users every N minutes (using `findAllConnected()`). Possibly using `bull-board` or a simple `setInterval`.
- **Webhook/IDLE push** — instead of polling, use IMAP IDLE to get push notifications for new emails. Dramatically reduces load but requires persistent connections (one per user = 10k connections = needs dedicated infra).
- **Token encryption at rest** — currently stored plaintext in MongoDB. Production must encrypt `accessToken`/`refreshToken` with AES-256 or use a secrets manager.
- **Circuit breaker** — if Yahoo's IMAP is down, stop hammering it. Use a circuit breaker pattern (e.g. `opossum`) to fail fast and retry later.
- **Observability** — structured logging (pino/winston), Prometheus metrics for queue depth/latency/error rates, distributed tracing (OpenTelemetry).

## Failure Scenarios Considered

| Scenario | Handling |
| --- | --- |
| Yahoo OAuth token expired | Auto-refresh in `TokenService` before IMAP connect |
| Yahoo IMAP temporarily down | BullMQ retries 3x with exponential backoff |
| Duplicate emails across syncs | `existsByMessageId()` check + unique compound index `(userId, messageId)` |
| User revokes OAuth access | Refresh token call fails → job fails after retries → needs manual re-auth |
| Redis goes down | BullMQ queue stalls; API still responds, jobs resume when Redis returns |
| MongoDB goes down | All operations fail; Express returns 500s. Needs health checks + alerts |
| Worker crash mid-sync | BullMQ auto-retries stalled jobs (configurable `stalledInterval`) |

## TODO (Honest)

- [ ] **CSRF state validation** — `POST /connect` generates a `state` param but the callback doesn't validate it against a stored value. Needs Redis/session-backed state verification.
- [ ] **Token encryption** — access/refresh tokens stored in plaintext. Unacceptable for production.
- [ ] **Input validation** — no Joi/Zod schemas on API inputs. `userId` should be validated as a valid ObjectId.
- [ ] **Tests** — zero test coverage. Domain logic (`matchAirline`, `User.isTokenExpired`) is trivially testable. Integration tests need IMAP/OAuth mocks.
- [ ] **Graceful shutdown** — no `SIGTERM` handler to drain the BullMQ worker or close MongoDB/Redis connections.
- [ ] **Pagination** — IMAP fetch has no upper bound on messages. Production needs `since` cursor + batch size limits.
- [ ] **Monitoring dashboard** — BullMQ supports `bull-board` for job monitoring UI. Not wired up.
- [x] **Docker Compose** — added `Dockerfile` + `docker-compose.yml` for one-command local stack startup.
- [ ] **Auth middleware** — API endpoints are completely unprotected. Production needs JWT/API key auth.

## Tech Stack

| Component | Choice | Version |
| --- | --- | --- |
| Runtime | Node.js | ≥18 |
| HTTP | Express | 4.x |
| Database | MongoDB (Mongoose) | 8.x |
| Cache/Queue | Redis (ioredis) | 5.x |
| Job Queue | BullMQ | 5.x |
| IMAP | imapflow | 1.x |
| OAuth HTTP | axios | 1.x |
