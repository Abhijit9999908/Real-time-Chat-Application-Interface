const express = require('express');
const multer = require('multer');
const path = require('path');
const Message = require('../models/Message');
const authenticate = require('../middleware/auth');

const router = express.Router();

// Escape special regex characters to prevent ReDoS injection
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp',
    'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
    'application/gzip', 'application/x-tar', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm',
    'audio/x-m4a', 'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'application/vnd.android.package-archive',
    'application/json', 'application/xml'
  ];

  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not supported'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 }
});

const messagePopulate = [
  { path: 'sender', select: 'username avatar bio' },
  { path: 'receiver', select: 'username avatar bio' },
  { path: 'replyTo', populate: { path: 'sender', select: 'username avatar' } },
  { path: 'reactions.user', select: 'username avatar' },
  { path: 'sharedContact.user', select: 'username avatar bio' }
];

router.get('/search/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const query = (req.query.q || '').trim();

    if (!query) {
      return res.status(400).json({ message: 'Search query is required.' });
    }

    const messages = await Message.find({
      $or: [
        { sender: req.user._id, receiver: userId },
        { sender: userId, receiver: req.user._id }
      ],
      content: { $regex: escapeRegex(query), $options: 'i' },
      deletedForEveryone: false
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate(messagePopulate);

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ message: 'Search failed.' });
  }
});

router.get('/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const filter = {
      $or: [
        { sender: req.user._id, receiver: userId },
        { sender: userId, receiver: req.user._id }
      ]
    };

    const [messages, total] = await Promise.all([
      Message.find(filter)
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .populate(messagePopulate),
      Message.countDocuments(filter)
    ]);

    await Message.updateMany(
      { sender: userId, receiver: req.user._id, read: false },
      { $set: { read: true, delivered: true, readAt: new Date(), deliveredAt: new Date() } }
    );

    res.json({
      messages,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch messages.' });
  }
});

router.post('/upload', authenticate, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      // Forward multer errors to the global error handler
      return next(err);
    }

    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
      }

      const fileUrl = `/uploads/${req.file.filename}`;
      const mime = req.file.mimetype;
      const type = mime.startsWith('image/')
        ? 'image'
        : mime.startsWith('video/')
          ? 'video'
          : mime.startsWith('audio/')
            ? 'audio'
            : 'file';

      res.json({
        fileUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: mime,
        type
      });
    } catch (uploadErr) {
      res.status(500).json({ message: 'File upload failed.' });
    }
  });
});

module.exports = router;

