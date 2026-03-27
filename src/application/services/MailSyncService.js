const { matchAirline } = require('../../domain/email/airlineKeywords');
const EmailMatch = require('../../domain/email/EmailMatch');

class MailSyncService {
  constructor(userRepository, emailMatchRepository, imapMailClient, tokenService) {
    this.userRepository = userRepository;
    this.emailMatchRepository = emailMatchRepository;
    this.imapMailClient = imapMailClient;
    this.tokenService = tokenService;
  }

  /**
   * Sync a single user's mailbox:
   * 1. Ensure valid token
   * 2. Fetch recent emails via IMAP
   * 3. Match subjects against airline keywords
   * 4. Persist matches, skip duplicates
   */
  async syncUser(userId) {
    let user = await this.userRepository.findById(userId);
    if (!user) throw new Error(`User ${userId} not found`);

    user = await this.tokenService.ensureValidToken(user);

    const since = user.lastSyncAt || undefined;
    const emails = await this.imapMailClient.fetchRecentEmails(user.email, user.accessToken, since);

    let matched = 0;

    for (const email of emails) {
      const keyword = matchAirline(email.subject);
      if (!keyword) continue;

      const exists = await this.emailMatchRepository.existsByMessageId(user.id, email.messageId);
      if (exists) continue;

      const match = new EmailMatch({
        userId: user.id,
        messageId: email.messageId,
        subject: email.subject,
        matchedKeyword: keyword,
      });

      await this.emailMatchRepository.save(match);
      console.log(`[sync] match: user=${user.id} messageId=${email.messageId} keyword="${keyword}" subject="${email.subject}"`);
      matched++;
    }

    user.markSynced();
    await this.userRepository.save(user);

    return { scanned: emails.length, matched };
  }
}

module.exports = MailSyncService;
