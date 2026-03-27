# Repriced — Yahoo Mail Integration Microservice

Prototype microservice that monitors Yahoo Mail inboxes for flight booking confirmation emails from top US airlines. Part of Repriced's automatic flight rebooking pipeline — Yahoo Mail counterpart to the existing Gmail integration.

## Quick Start

```bash
cp .env.example .env
# Fill in YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET from https://developer.yahoo.com/apps/
npm install
npm run dev       # Express + BullMQ worker in one process (dev mode)
npm test          # Run test suite
```

Requires MongoDB and Redis running locally (or use Docker Compose below).

### Docker Compose (one-command stack)

```bash
cp .env.example .env    # set YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET
docker compose up --build
```

Starts four containers:
- **api** — Express server on `http://localhost:3000`
- **worker** — BullMQ consumer (separate process, horizontally scalable)
- **mongo** — MongoDB 7 on `localhost:27017`
- **redis** — Redis 7 on `localhost:6379`

## API Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/yahoo/connect` | Initiates Yahoo OAuth 2.0 flow, returns authorization URL |
| `GET` | `/api/yahoo/callback` | OAuth callback — exchanges code for tokens, upserts user |
| `POST` | `/api/yahoo/sync/:userId` | Manually triggers a high-priority mail sync job |
| `GET` | `/health` | Health check |

### End-to-End Flow

1. Client calls **POST /connect** → receives `authorizationUrl` + `state`
2. User authorizes in browser → Yahoo redirects to **GET /callback?code=...&state=...**
3. Service exchanges authorization code for access/refresh tokens, fetches Yahoo user profile, upserts user in MongoDB
4. Client (or a future scheduler) calls **POST /sync/:userId** → job enqueued in BullMQ with priority 1 (highest)
5. Worker picks up the job → refreshes token if expired → opens IMAP connection to Yahoo → scans INBOX subjects → persists airline matches → marks user as synced

## Architecture

```
src/
├── config/              # Centralized env-based configuration
├── domain/              # Pure business logic — no framework dependencies
│   ├── user/            # User entity + UserRepository interface (port)
│   ├── email/           # EmailMatch entity + EmailMatchRepository interface + airline keyword regex
│   └── sync/            # SyncJob value object with priority levels
├── application/         # Use-case orchestration (services)
│   └── services/
│       ├── OAuthService.js       # OAuth connect + callback orchestration
│       ├── MailSyncService.js    # IMAP fetch → subject filter → persist matches
│       └── TokenService.js       # Transparent token refresh with 5-min buffer
├── infrastructure/      # Adapters (outbound)
│   ├── persistence/     # Mongoose implementations of domain repository ports
│   │   └── schemas/     # Mongoose schema definitions
│   ├── mail/            # IMAP client adapter (imapflow)
│   ├── oauth/           # Yahoo OAuth 2.0 HTTP client (axios)
│   ├── queue/           # BullMQ producer + worker
│   └── database/        # MongoDB & Redis connection managers
├── interfaces/          # Inbound adapters
│   ├── http/            # Express routes + controllers
│   └── middleware/      # Global error handler
└── app.js               # Composition root + bootstrap
```

The project follows a **DDD-lite / Ports & Adapters** layout. Domain layer defines entities (`User`, `EmailMatch`) and repository interfaces. Infrastructure layer provides concrete implementations (MongoDB repos, IMAP client, OAuth client). Application services orchestrate use cases without knowing about Express or Mongoose.

**Why this matters:** swapping infrastructure doesn't touch business logic. If Yahoo launches a new REST API tomorrow, only `ImapMailClient` changes. If we migrate from BullMQ to Redis Streams, only `SyncQueueProducer`/`SyncQueueWorker` change. The domain and application layers remain untouched.

The composition root (`app.js`) wires everything together via constructor injection, which also makes testing straightforward — tests inject mocks at the same injection points.

## Key Design Decisions

### IMAP over Yahoo Mail REST API

Yahoo's proprietary Mail REST API has been deprecated/unreliable for years. IMAP is the only stable path:

- **Officially supported** — Yahoo fully supports IMAP with OAuth 2.0 (XOAUTH2 mechanism)
- **Standard protocol** — no proprietary API quirks, well-documented RFC
- **`imapflow`** — modern Node.js IMAP library with streaming, IDLE support, and proper async/await API

**Trade-off:** IMAP connections are heavier than REST calls — each sync opens a full TCP+TLS connection. For 10k+ accounts this means connection management becomes a first-class concern (see Scalability). A REST API (if one existed and was reliable) would be stateless and simpler to scale.

### BullMQ over raw Redis Streams

BullMQ is built on Redis Streams internally but provides critical primitives out of the box:

| Feature | Implementation |
| ------- | -------------- |
| Job prioritization | `priority` field — API-triggered syncs = 1 (highest), scheduled = 5, backfill = 10 |
| Retry with backoff | 3 attempts, exponential backoff starting at 5s (5s → 10s → 20s) |
| Global rate limiting | 50 jobs/min across all workers — stays within Yahoo's IMAP rate limits |
| Per-user deduplication | `jobId = sync-{userId}` prevents double-queuing the same user |
| Job lifecycle | Auto-cleanup: keep last 1000 completed, last 5000 failed |

**Trade-off:** adds a dependency vs raw Streams. For this prototype, BullMQ's built-in retry/priority/rate-limiting saved significant development time. In production at extreme scale (100k+ accounts), raw Redis Streams with custom consumer groups would give finer control over memory and backpressure.

### Token Refresh Strategy

`TokenService.ensureValidToken()` checks token expiry with a **5-minute buffer** before each IMAP connection. If expired, it refreshes transparently via Yahoo's token endpoint and persists the new tokens — all within the sync job execution path.

**Trade-off:** refresh-on-demand is simpler than a background refresh scheduler, but the first sync after expiry pays ~200-500ms extra latency for the refresh round-trip. At scale, a background sweep that pre-refreshes tokens approaching expiry would eliminate this latency and reduce thundering herd risk when many tokens expire simultaneously.

### Email Subject Filtering

Pre-compiled case-insensitive regex matching against the top 5 US airlines:

```
Delta | United | American Airlines | Southwest | Alaska Airlines
```

`matchAirline(subject)` is a pure function in the domain layer — no side effects, trivially testable, easy to extend. Special regex characters in airline names are escaped. Only the first match is returned (sufficient since we only need to detect presence).

No email body parsing — the task spec explicitly scopes this to subject-line matching only.

## Scalability Approach (10k+ Accounts)

### What's Implemented

- **BullMQ job queue** — decouples sync triggering from sync execution
- **Concurrency = 10** — worker processes 10 IMAP syncs in parallel
- **Global rate limiter** — 50 jobs/min to respect Yahoo's IMAP connection limits
- **Per-user deduplication** — `jobId = sync-{userId}` prevents re-queuing a user who's already in the queue
- **Priority levels** — manual API syncs (priority 1) jump ahead of scheduled syncs (priority 5)
- **Exponential retry** — transient IMAP/OAuth failures retry 3x with 5s/10s/20s backoff
- **Separate worker process** — `docker-compose.yml` runs API and worker as independent containers; workers can be scaled horizontally by increasing `replicas`

### What Production Would Need

| Concern | Approach |
| ------- | -------- |
| **IMAP connection pooling** | Reuse TLS connections across syncs for the same user. `imapflow` supports IDLE; a pool manager would keep hot connections for frequently-syncing users and evict idle ones via LRU. |
| **Horizontal worker scaling** | Run N worker replicas — BullMQ handles job distribution natively via Redis. Each worker competes for the next job. |
| **Partitioned queues** | Shard users across multiple BullMQ queues by `userId` hash to reduce Redis key contention at extreme scale. |
| **Scheduled sync cron** | A lightweight scheduler that periodically calls `findAllConnected()` and enqueues sync jobs. Could use `node-cron`, BullMQ's repeatable jobs, or an external scheduler (Kubernetes CronJob). |
| **IMAP IDLE (push)** | Instead of polling, maintain persistent IMAP IDLE connections for real-time email notifications. Dramatically reduces sync latency but requires one persistent connection per user (~10k connections = dedicated infra + connection managers). |
| **Token encryption at rest** | Currently tokens are stored as plaintext in MongoDB. Production must encrypt with AES-256-GCM or use a secrets manager (AWS Secrets Manager, HashiCorp Vault). |
| **Circuit breaker** | If Yahoo's IMAP/OAuth endpoints are degraded, fail fast with a circuit breaker (`opossum` or similar) instead of burning through retries. |
| **Observability** | Structured logging (pino), Prometheus metrics (queue depth, sync latency, error rates), distributed tracing (OpenTelemetry). BullMQ exposes job lifecycle events for metrics collection. |
| **Graceful shutdown** | SIGTERM handler that stops accepting new jobs, waits for in-flight syncs to complete, then closes MongoDB/Redis connections. |

## Failure Scenarios

| Scenario | Current Handling |
| -------- | ---------------- |
| OAuth token expired | `TokenService` auto-refreshes with 5-min pre-expiry buffer before IMAP connection |
| Yahoo IMAP temporarily unavailable | BullMQ retries 3x with exponential backoff (5s → 10s → 20s) |
| Duplicate emails across syncs | `existsByMessageId()` check + unique compound index on `(userId, messageId)` |
| User revokes Yahoo OAuth consent | Refresh token call fails → job exhausts retries → user needs to re-authorize via `/connect` |
| Redis down | BullMQ queue stalls; API still responds for non-queue operations; jobs resume when Redis recovers |
| MongoDB down | All DB operations fail → Express returns 500; needs health checks + alerting |
| Worker crash mid-sync | BullMQ's stalled job detection picks it up and re-dispatches to another worker |
| Yahoo rate-limits us | Global limiter (50/min) prevents this proactively; if hit anyway, backoff retries handle it |

## Testing

```bash
npm test
```

Tests use **Jest** + **Supertest** + **mongodb-memory-server** (in-memory MongoDB). The Express app's `createApp()` accepts dependency injection, so tests swap in mock OAuth client and mock queue producer — no real Yahoo API calls or Redis needed.

### Coverage

- Health endpoint
- `POST /connect` — returns authorization URL, generates unique state per call
- `GET /callback` — validates `code` param, creates new user, updates existing user on re-auth, handles Yahoo API errors
- `POST /sync/:userId` — enqueues job with correct priority, handles queue unavailability
- Full flow integration test (connect → callback → sync)

### What's Not Tested (and should be in production)

- Domain logic unit tests (`matchAirline`, `User.isTokenExpired`) — trivially testable, should be added
- `MailSyncService` with mocked IMAP — integration test for the full sync pipeline
- `TokenService` refresh logic
- Worker error handling and retry behavior
- Edge cases: malformed emails, empty subjects, concurrent syncs for the same user

## TODOs

- [ ] **CSRF state validation** — `POST /connect` generates a random `state` but the callback doesn't validate it against a server-side store. Needs Redis or session-backed state verification to prevent CSRF.
- [ ] **Token encryption** — access/refresh tokens stored as plaintext in MongoDB. Must encrypt at rest for production.
- [ ] **Input validation** — no schema validation (Joi/Zod) on API inputs. `userId` in `/sync/:userId` should be validated as a valid MongoDB ObjectId.
- [ ] **Graceful shutdown** — no `SIGTERM`/`SIGINT` handler. Worker should drain in-flight jobs, close IMAP connections, and disconnect from MongoDB/Redis on shutdown.
- [ ] **IMAP fetch pagination** — current implementation fetches all messages since `lastSyncAt` (or last 7 days) with no upper bound. Production needs batch-size limits to prevent memory issues on large mailboxes.
- [ ] **Monitoring dashboard** — BullMQ supports `bull-board` for real-time job monitoring UI. Not wired up yet.
- [ ] **Auth middleware** — API endpoints are unprotected. Production needs JWT or API key authentication.
- [ ] **Scheduled sync** — no automatic periodic sync. Currently relies on manual `POST /sync/:userId` calls.
- [x] **Docker Compose** — full local stack with API, worker, MongoDB, and Redis.
- [x] **API tests** — endpoint tests with mocked dependencies and in-memory MongoDB.

## What I Would Do Differently in Production

1. **TypeScript** — this prototype is plain JS for speed. Production benefits from type safety across domain boundaries, especially for the OAuth token structures and IMAP message envelopes.

2. **Encrypted token storage** — AES-256-GCM encryption on tokens before persisting to MongoDB, with keys managed via environment variables or a secrets manager. This is the most critical security gap in the current prototype.

3. **IMAP connection pool** — the current approach creates and destroys a connection per sync. A pool manager (keyed by user email) that maintains warm connections and uses IMAP IDLE for push notifications would drastically reduce latency and connection overhead.

4. **Structured logging** — replace `console.log` with `pino` for JSON-structured logs. Add correlation IDs (userId, jobId) to every log line for traceability across the API → queue → worker → IMAP pipeline.

5. **Background token refresh** — instead of refresh-on-demand, run a periodic sweep that pre-refreshes tokens within 10 minutes of expiry. Eliminates latency spikes and prevents thundering herd when many tokens expire around the same time.

6. **Dead letter queue** — after exhausting retries, move failed jobs to a DLQ for manual inspection rather than just incrementing a failure counter. Alert on DLQ depth.

7. **Health checks with depth** — current `/health` is a shallow ping. Production should check MongoDB connectivity, Redis connectivity, and queue health (stalled job count, queue depth).

## Tech Stack

| Component | Choice | Version |
| --------- | ------ | ------- |
| Runtime | Node.js | ≥18 |
| HTTP Framework | Express | 5.x |
| Database | MongoDB (Mongoose) | 9.x |
| Cache / Queue Backend | Redis (ioredis) | 5.x |
| Job Queue | BullMQ | 5.x |
| IMAP Client | imapflow | 1.x |
| HTTP Client | axios | 1.x |
| Testing | Jest + Supertest + mongodb-memory-server | — |
| Containerization | Docker + Docker Compose | — |
