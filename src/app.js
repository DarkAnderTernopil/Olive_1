const express = require('express');
const config = require('./config');
const { connectMongo } = require('./infrastructure/database/mongodb');
const { getRedis } = require('./infrastructure/database/redis');
const createYahooMailRouter = require('./interfaces/http/routes/yahooMailRoutes');
const errorHandler = require('./interfaces/middleware/errorHandler');
const MongoUserRepository = require('./infrastructure/persistence/MongoUserRepository');
const YahooOAuthClient = require('./infrastructure/oauth/YahooOAuthClient');
const { enqueueSyncJob } = require('./infrastructure/queue/SyncQueueProducer');
const { startWorker } = require('./infrastructure/queue/SyncQueueWorker');

/**
 * Build an Express app with injected dependencies.
 * If no deps provided, uses real production implementations.
 */
function createApp(deps = {}) {
  const userRepository = deps.userRepository || new MongoUserRepository();
  const oauthClient = deps.oauthClient || new YahooOAuthClient();
  const enqueue = deps.enqueueSyncJob || enqueueSyncJob;

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/yahoo', createYahooMailRouter({ userRepository, oauthClient, enqueueSyncJob: enqueue }));
  app.use(errorHandler);

  return app;
}

async function bootstrap() {
  await connectMongo();
  getRedis();

  const app = createApp();

  if (config.env === 'development') {
    await startWorker();
  }

  app.listen(config.port, () => {
    console.log(`[app] listening on :${config.port} (${config.env})`);
  });
}

// Only auto-bootstrap when run directly
if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('[app] fatal:', err);
    process.exit(1);
  });
}

module.exports = { createApp };
