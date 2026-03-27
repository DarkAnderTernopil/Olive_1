const crypto = require('crypto');
const User = require('../../domain/user/User');

class OAuthService {
  constructor(userRepository, oauthClient) {
    this.userRepository = userRepository;
    this.oauthClient = oauthClient;
  }

  /**
   * Initiate the OAuth flow — returns an authorization URL.
   */
  initiateConnect() {
    const state = crypto.randomBytes(16).toString('hex');
    const url = this.oauthClient.getAuthorizationUrl(state);
    return { url, state };
  }

  /**
   * Handle the OAuth callback — exchange code, upsert user, return user.
   */
  async handleCallback(code) {
    const tokens = await this.oauthClient.exchangeCode(code);
    const profile = await this.oauthClient.getUserProfile(tokens.accessToken);

    let user = await this.userRepository.findByYahooId(profile.yahooId);

    if (user) {
      user.updateTokens(tokens);
      user.email = profile.email;
    } else {
      user = new User({
        yahooId: profile.yahooId,
        email: profile.email,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      });
    }

    return this.userRepository.save(user);
  }
}

module.exports = OAuthService;
