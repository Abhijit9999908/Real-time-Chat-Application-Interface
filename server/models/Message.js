const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  emoji: {
    type: String,
    required: true,
    maxlength: 8
  }
}, {
  _id: false,
  timestamps: true
});

const locationSchema = new mongoose.Schema({
  latitude: Number,
  longitude: Number,
  label: String
}, { _id: false });

const sharedContactSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  username: String,
  email: String,
  avatar: String,
  bio: String
}, { _id: false });

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'audio', 'video', 'location', 'contact'],
    default: 'text'
  },
  fileName: {
    type: String,
    default: ''
  },
  fileUrl: {
    type: String,
    default: ''
  },
  fileSize: {
    type: Number,
    default: 0
  },
  mimeType: {
    type: String,
    default: ''
  },
  duration: {
    type: Number,
    default: 0
  },
  location: {
    type: locationSchema,
    default: null
  },
  sharedContact: {
    type: sharedContactSchema,
    default: null
  },
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  reactions: {
    type: [reactionSchema],
    default: []
  },
  pinned: {
    type: Boolean,
    default: false
  },
  delivered: {
    type: Boolean,
    default: false
  },
  deliveredAt: {
    type: Date,
    default: null
  },
  read: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date,
    default: null
  },
  editedAt: {
    type: Date,
    default: null
  },
  deletedForEveryone: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, read: 1 });

module.exports = mongoose.model('Message', messageSchema);
