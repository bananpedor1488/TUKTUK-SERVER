const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: function() {
      return !this.telegramId; // Email required only if not Telegram user
    },
    unique: true,
    sparse: true, // Allow multiple null values
    lowercase: true,
    trim: true
  },
  telegramId: {
    type: String,
    unique: true,
    sparse: true, // Allow multiple null values
    trim: true
  },
  password: {
    type: String,
    required: function() {
      return !this.telegramId; // Password required only if not Telegram user
    },
    minlength: 6
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 20
  },
  displayName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  avatar: {
    type: String,
    default: null
  },
  avatarUpdatedAt: {
    type: Date,
    default: null
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  socketId: {
    type: String,
    default: null
  },
  bio: {
    type: String,
    maxlength: 200,
    default: ''
  },
  previousUsernames: [{
    username: {
      type: String,
      required: true
    },
    changedAt: {
      type: Date,
      default: Date.now
    }
  }],
  interests: {
    type: String,
    maxlength: 500,
    default: ''
  },
  about: {
    type: String,
    maxlength: 1000,
    default: ''
  },
  referralCode: {
    type: String,
    maxlength: 20,
    default: ''
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  // Skip password hashing for Telegram users or if password is not modified
  if (!this.isModified('password') || (this.telegramId && this.password === 'telegram_auth')) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  // For Telegram users without password, always return false
  if (this.telegramId && !this.password) {
    return false;
  }
  return bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  return user;
};

module.exports = mongoose.model('User', userSchema);

