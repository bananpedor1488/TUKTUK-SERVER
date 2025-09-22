const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  caller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  callee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  chat:   { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
  type:   { type: String, enum: ['audio', 'video'], default: 'audio' },
  status: { type: String, enum: ['pending', 'accepted', 'declined', 'ended', 'missed'], default: 'pending' },
  startedAt: { type: Date },
  endedAt: { type: Date },
  duration: { type: Number, default: 0 } // seconds
}, { timestamps: true });

// Indexes
callSchema.index({ caller: 1, createdAt: -1 });
callSchema.index({ callee: 1, createdAt: -1 });
callSchema.index({ chat: 1, createdAt: -1 });
callSchema.index({ status: 1 });

module.exports = mongoose.model('Call', callSchema);
