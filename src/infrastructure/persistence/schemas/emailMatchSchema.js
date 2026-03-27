const mongoose = require('mongoose');

const emailMatchSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    messageId: { type: String, required: true },
    subject: { type: String, required: true },
    matchedKeyword: { type: String, required: true },
    detectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

emailMatchSchema.index({ userId: 1, messageId: 1 }, { unique: true });

module.exports = mongoose.model('EmailMatch', emailMatchSchema);
