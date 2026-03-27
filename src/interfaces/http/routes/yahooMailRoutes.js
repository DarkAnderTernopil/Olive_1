const { Router } = require('express');
const YahooMailController = require('../controllers/YahooMailController');
const OAuthService = require('../../../application/services/OAuthService');

function createYahooMailRouter({ userRepository, oauthClient, enqueueSyncJob }) {
  const router = Router();

  const oauthService = new OAuthService(userRepository, oauthClient);
  const controller = new YahooMailController(oauthService, { enqueueSyncJob });

  router.post('/connect', controller.connect);
  router.get('/callback', controller.callback);
  router.post('/sync/:userId', controller.sync);

  return router;
}

module.exports = createYahooMailRouter;
