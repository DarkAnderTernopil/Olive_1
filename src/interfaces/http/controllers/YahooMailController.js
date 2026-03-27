const SyncJob = require('../../../domain/sync/SyncJob');

class YahooMailController {
  constructor(oauthService, { enqueueSyncJob }) {
    this.oauthService = oauthService;
    this.enqueueSyncJob = enqueueSyncJob;
  }

  /**
   * POST /connect — initiate Yahoo OAuth flow
   */
  connect = (_req, res) => {
    const { url, state } = this.oauthService.initiateConnect();
    res.json({ authorizationUrl: url, state });
  };

  /**
   * GET /callback — handle Yahoo OAuth callback
   */
  callback = async (req, res, next) => {
    try {
      const { code } = req.query;
      if (!code) return res.status(400).json({ error: 'Missing authorization code' });

      const user = await this.oauthService.handleCallback(code);

      res.json({
        message: 'Yahoo Mail connected successfully',
        userId: user.id,
        email: user.email,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /sync/:userId — manually trigger mail sync via queue
   */
  sync = async (req, res, next) => {
    try {
      const { userId } = req.params;

      const jobId = await this.enqueueSyncJob({
        userId,
        priority: SyncJob.PRIORITY.HIGH,
        triggeredBy: 'api',
      });

      res.json({ message: 'Sync job enqueued', jobId, userId });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = YahooMailController;
