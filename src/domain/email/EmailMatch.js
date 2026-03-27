class EmailMatch {
  constructor({ id, userId, messageId, subject, matchedKeyword, detectedAt }) {
    this.id = id;
    this.userId = userId;
    this.messageId = messageId;
    this.subject = subject;
    this.matchedKeyword = matchedKeyword;
    this.detectedAt = detectedAt || new Date();
  }
}

module.exports = EmailMatch;
