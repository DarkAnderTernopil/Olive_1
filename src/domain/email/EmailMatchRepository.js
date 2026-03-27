/**
 * @interface EmailMatchRepository
 * Port — infrastructure must implement this.
 */
class EmailMatchRepository {
  async save(_emailMatch) { throw new Error('Not implemented'); }
  async findByUserId(_userId) { throw new Error('Not implemented'); }
  async existsByMessageId(_userId, _messageId) { throw new Error('Not implemented'); }
}

module.exports = EmailMatchRepository;
