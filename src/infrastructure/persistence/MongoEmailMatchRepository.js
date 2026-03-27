const EmailMatchRepository = require('../../domain/email/EmailMatchRepository');
const EmailMatch = require('../../domain/email/EmailMatch');
const EmailMatchModel = require('./schemas/emailMatchSchema');

class MongoEmailMatchRepository extends EmailMatchRepository {
  _toDomain(doc) {
    if (!doc) return null;
    return new EmailMatch({
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      messageId: doc.messageId,
      subject: doc.subject,
      matchedKeyword: doc.matchedKeyword,
      detectedAt: doc.detectedAt,
    });
  }

  async save(emailMatch) {
    const doc = await EmailMatchModel.create({
      userId: emailMatch.userId,
      messageId: emailMatch.messageId,
      subject: emailMatch.subject,
      matchedKeyword: emailMatch.matchedKeyword,
      detectedAt: emailMatch.detectedAt,
    });
    return this._toDomain(doc);
  }

  async findByUserId(userId) {
    const docs = await EmailMatchModel.find({ userId }).lean();
    return docs.map((d) => this._toDomain(d));
  }

  async existsByMessageId(userId, messageId) {
    const count = await EmailMatchModel.countDocuments({ userId, messageId });
    return count > 0;
  }
}

module.exports = MongoEmailMatchRepository;
