const mongoose = require('mongoose');

const promoCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true },
  type: { type: String, enum: ['premium', 'coins'], required: true },
  amount: { type: Number, default: 0 }, // for coins only
  isActive: { type: Boolean, default: true },
  expiresAt: { type: Date, default: null },
  maxUses: { type: Number, default: 1, min: 1 },
  usedCount: { type: Number, default: 0, min: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

promoCodeSchema.methods.canBeUsed = function() {
  if (!this.isActive) return false;
  if (this.expiresAt && new Date() > this.expiresAt) return false;
  if (this.usedCount >= this.maxUses) return false;
  return true;
};

module.exports = mongoose.model('PromoCode', promoCodeSchema);
