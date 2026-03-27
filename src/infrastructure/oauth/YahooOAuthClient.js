const axios = require('axios');
const config = require('../../config');

class YahooOAuthClient {
  /**
   * Build the Yahoo authorization URL to redirect users to.
   * @param {string} state — CSRF token / opaque state value
   */
  getAuthorizationUrl(state) {
    const params = new URLSearchParams({
      client_id: config.yahoo.clientId,
      redirect_uri: config.yahoo.redirectUri,
      response_type: 'code',
      scope: 'openid mail-r',  // mail-r grants read access to Yahoo Mail (IMAP)
      state,
    });
    return `${config.yahoo.authUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens.
   */
  async exchangeCode(code) {
    const basicAuth = Buffer.from(
      `${config.yahoo.clientId}:${config.yahoo.clientSecret}`,
    ).toString('base64');

    const { data } = await axios.post(
      config.yahoo.tokenUrl,
      new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: config.yahoo.redirectUri,
        code,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuth}`,
        },
      },
    );

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      idToken: data.id_token,
      xoauth_yahoo_guid: data.xoauth_yahoo_guid,
    };
  }

  /**
   * Refresh an expired access token.
   */
  async refreshAccessToken(refreshToken) {
    const basicAuth = Buffer.from(
      `${config.yahoo.clientId}:${config.yahoo.clientSecret}`,
    ).toString('base64');

    const { data } = await axios.post(
      config.yahoo.tokenUrl,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuth}`,
        },
      },
    );

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Fetch user profile via Yahoo's OpenID userinfo endpoint.
   */
  async getUserProfile(accessToken) {
    const { data } = await axios.get('https://api.login.yahoo.com/openid/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return {
      yahooId: data.sub,
      email: data.email,
    };
  }
}

module.exports = YahooOAuthClient;
