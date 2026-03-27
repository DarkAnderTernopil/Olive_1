/** Value object representing a queued sync task */
class SyncJob {
  static PRIORITY = {
    HIGH: 1,    // manual trigger via API
    NORMAL: 5,  // scheduled periodic sync
    LOW: 10,    // backfill / catch-up
  };

  constructor({ userId, priority = SyncJob.PRIORITY.NORMAL, triggeredBy = 'system' }) {
    this.userId = userId;
    this.priority = priority;
    this.triggeredBy = triggeredBy;
    this.createdAt = new Date();
  }
}

module.exports = SyncJob;
