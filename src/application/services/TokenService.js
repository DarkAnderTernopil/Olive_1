class TokenService {
  constructor(userRepository, oauthClient) {
    this.userRepository = userRepository;
    this.oauthClient = oauthClient;
  }

  /**
   * Ensure the user has a valid (non-expired) access token.
   * Refreshes transparently if needed and persists the new tokens.
   * Returns the user with a valid accessToken.
   */
  async ensureValidToken(user) {
    if (!user.isTokenExpired()) return user;

    console.log(`[token] refreshing token for user=${user.id}`);

    const tokens = await this.oauthClient.refreshAccessToken(user.refreshToken);
    user.updateTokens(tokens);
    return this.userRepository.save(user);
  }
}

module.exports = TokenService;
