const { Worker } = require('bullmq');
const { getRedis } = require('../database/redis');
const { connectMongo } = require('../database/mongodb');
const MongoUserRepository = require('../persistence/MongoUserRepository');
const MongoEmailMatchRepository = require('../persistence/MongoEmailMatchRepository');
const YahooOAuthClient = require('../oauth/YahooOAuthClient');
const ImapMailClient = require('../mail/ImapMailClient');
const MailSyncService = require('../../application/services/MailSyncService');
const TokenService = require('../../application/services/TokenService');
const { QUEUE_NAME } = require('./SyncQueueProducer');

async function startWorker() {
  await connectMongo();

  const userRepo = new MongoUserRepository();
  const emailMatchRepo = new MongoEmailMatchRepository();
  const oauthClient = new YahooOAuthClient();
  const imapClient = new ImapMailClient();
  const tokenService = new TokenService(userRepo, oauthClient);
  const mailSyncService = new MailSyncService(userRepo, emailMatchRepo, imapClient, tokenService);

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { userId, triggeredBy } = job.data;
      console.log(`[worker] processing sync for user=${userId} triggeredBy=${triggeredBy}`);

      const result = await mailSyncService.syncUser(userId);
      console.log(`[worker] user=${userId} done — ${result.matched} matches found, ${result.scanned} scanned`);
      return result;
    },
    {
      connection: getRedis(),
      concurrency: 10,
      limiter: {
        max: 50,
        duration: 60_000, // global: max 50 jobs/min across all users
      },
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[worker] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
  });

  worker.on('error', (err) => {
    console.error('[worker] error:', err.message);
  });

  console.log(`[worker] listening on queue "${QUEUE_NAME}" with concurrency=10`);
  return worker;
}

// Allow running standalone: `node src/infrastructure/queue/SyncQueueWorker.js`
if (require.main === module) {
  startWorker().catch((err) => {
    console.error('[worker] failed to start:', err);
    process.exit(1);
  });
}

module.exports = { startWorker };
