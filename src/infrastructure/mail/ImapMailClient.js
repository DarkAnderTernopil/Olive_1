const { ImapFlow } = require('imapflow');
const config = require('../../config');

class ImapMailClient {
  /**
   * Build an XOAUTH2 token string for Yahoo IMAP.
   * Format: base64("user=<email>\x01auth=Bearer <token>\x01\x01")
   */
  _buildXOAuth2Token(email, accessToken) {
    const authString = `user=${email}\x01auth=Bearer ${accessToken}\x01\x01`;
    return Buffer.from(authString).toString('base64');
  }

  /**
   * Fetch recent emails from INBOX.
   * Returns array of { uid, messageId, subject }.
   *
   * @param {string} email — user's Yahoo email
   * @param {string} accessToken — valid OAuth access token
   * @param {Date|null} since — only fetch emails after this date (null = last 7 days)
   */
  async fetchRecentEmails(email, accessToken, since = null) {
    const client = new ImapFlow({
      host: config.yahoo.imap.host,
      port: config.yahoo.imap.port,
      secure: true,
      auth: {
        user: email,
        accessToken,
      },
      logger: false,
    });

    const sinceDate = since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const results = [];

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        const messages = client.fetch(
          { since: sinceDate },
          { uid: true, envelope: true },
        );

        for await (const msg of messages) {
          results.push({
            uid: msg.uid,
            messageId: msg.envelope.messageId,
            subject: msg.envelope.subject || '',
          });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }

    return results;
  }
}

module.exports = ImapMailClient;
