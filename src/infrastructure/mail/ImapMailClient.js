const { ImapFlow } = require('imapflow');

/**
 * IMAP reader using OAuth2 bearer (XOAUTH2-style) auth — wired for Yahoo Mail
 * in this service. Host/port are injected so this class stays a generic IMAP
 * adapter; the composition root supplies Yahoo's imap.mail.yahoo.com.
 */
class ImapMailClient {
  constructor({ host, port }) {
    this._imapHost = host;
    this._imapPort = port;
  }

  /**
   * Fetch recent emails from INBOX.
   * Returns array of { uid, messageId, subject }.
   *
   * @param {string} email — mailbox user (Yahoo address)
   * @param {string} accessToken — valid OAuth access token
   * @param {Date|null} since — only fetch emails after this date (null = last 7 days)
   */
  async fetchRecentEmails(email, accessToken, since = null) {
    const client = new ImapFlow({
      host: this._imapHost,
      port: this._imapPort,
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
