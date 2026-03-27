class User {
  constructor({ id, yahooId, email, accessToken, refreshToken, tokenExpiresAt, connectedAt, lastSyncAt }) {
    this.id = id;
    this.yahooId = yahooId;
    this.email = email;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.tokenExpiresAt = tokenExpiresAt;
    this.connectedAt = connectedAt || new Date();
    this.lastSyncAt = lastSyncAt || null;
  }

  isTokenExpired() {
    if (!this.tokenExpiresAt) return true;
    // 5-min buffer before actual expiry
    return Date.now() >= this.tokenExpiresAt.getTime() - 5 * 60 * 1000;
  }

  updateTokens({ accessToken, refreshToken, expiresIn }) {
    this.accessToken = accessToken;
    if (refreshToken) this.refreshToken = refreshToken;
    this.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
  }

  markSynced() {
    this.lastSyncAt = new Date();
  }
}

module.exports = User;
