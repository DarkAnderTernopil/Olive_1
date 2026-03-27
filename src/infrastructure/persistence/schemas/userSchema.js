const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    yahooId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    tokenExpiresAt: { type: Date, required: true },
    connectedAt: { type: Date, default: Date.now },
    lastSyncAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model('User', userSchema);
