const UserRepository = require('../../domain/user/UserRepository');
const User = require('../../domain/user/User');
const UserModel = require('./schemas/userSchema');

class MongoUserRepository extends UserRepository {
  _toDomain(doc) {
    if (!doc) return null;
    return new User({
      id: doc._id.toString(),
      yahooId: doc.yahooId,
      email: doc.email,
      accessToken: doc.accessToken,
      refreshToken: doc.refreshToken,
      tokenExpiresAt: doc.tokenExpiresAt,
      connectedAt: doc.connectedAt,
      lastSyncAt: doc.lastSyncAt,
    });
  }

  async findById(id) {
    const doc = await UserModel.findById(id).lean();
    return this._toDomain(doc);
  }

  async findByYahooId(yahooId) {
    const doc = await UserModel.findOne({ yahooId }).lean();
    return this._toDomain(doc);
  }

  async save(user) {
    if (user.id) {
      const doc = await UserModel.findByIdAndUpdate(
        user.id,
        {
          yahooId: user.yahooId,
          email: user.email,
          accessToken: user.accessToken,
          refreshToken: user.refreshToken,
          tokenExpiresAt: user.tokenExpiresAt,
          connectedAt: user.connectedAt,
          lastSyncAt: user.lastSyncAt,
        },
        { returnDocument: 'after', upsert: true },
      );
      return this._toDomain(doc);
    }

    const doc = await UserModel.create({
      yahooId: user.yahooId,
      email: user.email,
      accessToken: user.accessToken,
      refreshToken: user.refreshToken,
      tokenExpiresAt: user.tokenExpiresAt,
      connectedAt: user.connectedAt,
      lastSyncAt: user.lastSyncAt,
    });
    return this._toDomain(doc);
  }

  async findAllConnected() {
    const docs = await UserModel.find({}).lean();
    return docs.map((d) => this._toDomain(d));
  }
}

module.exports = MongoUserRepository;
