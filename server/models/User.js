const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const chatPreferenceSchema = new mongoose.Schema({
  contact: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  muted: {
    type: Boolean,
    default: false
  },
  archived: {
    type: Boolean,
    default: false
  },
  pinned: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const privacySchema = new mongoose.Schema({
  lastSeen: {
    type: String,
    enum: ['everyone', 'contacts', 'nobody'],
    default: 'everyone'
  },
  profilePhoto: {
    type: String,
    enum: ['everyone', 'contacts', 'nobody'],
    default: 'everyone'
  },
  onlineStatus: {
    type: String,
    enum: ['everyone', 'contacts', 'nobody'],
    default: 'everyone'
  }
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [30, 'Username cannot exceed 30 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  avatar: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'away'],
    default: 'offline'
  },
  contacts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  chatPreferences: {
    type: [chatPreferenceSchema],
    default: []
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  bio: {
    type: String,
    default: 'Available to chat',
    maxlength: [150, 'Bio cannot exceed 150 characters']
  },
  theme: {
    type: String,
    enum: ['dark', 'light'],
    default: 'dark'
  },
  wallpaper: {
    type: String,
    default: ''
  },
  privacy: {
    type: privacySchema,
    default: () => ({})
  }
}, {
  timestamps: true
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
