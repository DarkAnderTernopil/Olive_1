const { Queue } = require('bullmq');
const { getRedis } = require('../database/redis');

const QUEUE_NAME = 'yahoo-mail-sync';

let queue = null;

function getSyncQueue() {
  if (queue) return queue;

  queue = new Queue(QUEUE_NAME, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });

  return queue;
}

/**
 * Enqueue a mail sync job.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {number} opts.priority — lower = higher priority (BullMQ convention)
 * @param {string} opts.triggeredBy — 'api' | 'scheduler' | 'system'
 */
async function enqueueSyncJob({ userId, priority = 5, triggeredBy = 'system' }) {
  const q = getSyncQueue();

  // Deduplicate: use a jobId derived from userId so we don't double-queue
  const jobId = `sync-${userId}`;

  await q.add(
    'sync-mailbox',
    { userId, triggeredBy },
    {
      priority,
      jobId,
      rateLimiter: {
        max: 1,
        duration: 60_000, // at most 1 sync per user per minute
      },
    },
  );

  return jobId;
}

module.exports = { getSyncQueue, enqueueSyncJob, QUEUE_NAME };
