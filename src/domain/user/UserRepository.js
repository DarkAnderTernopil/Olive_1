/**
 * @interface UserRepository
 * Port — infrastructure must implement this.
 */
class UserRepository {
  async findById(_id) { throw new Error('Not implemented'); }
  async findByYahooId(_yahooId) { throw new Error('Not implemented'); }
  async save(_user) { throw new Error('Not implemented'); }
  async findAllConnected() { throw new Error('Not implemented'); }
}

module.exports = UserRepository;
