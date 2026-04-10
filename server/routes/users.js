const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');
const authenticate = require('../middleware/auth');

const router = express.Router();

// Escape special regex characters to prevent ReDoS injection
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPreferenceEntry(user, contactId) {
  return user.chatPreferences.find(pref => pref.contact.toString() === contactId.toString());
}

async function buildContactSummary(currentUserId, contact, preference) {
  const [lastMessage, unreadCount] = await Promise.all([
    Message.findOne({
      $or: [
        { sender: currentUserId, receiver: contact._id },
        { sender: contact._id, receiver: currentUserId }
      ]
    }).sort({ createdAt: -1 }).lean(),
    Message.countDocuments({
      sender: contact._id,
      receiver: currentUserId,
      read: false,
      deletedForEveryone: false
    })
  ]);

  const preview = lastMessage
    ? lastMessage.deletedForEveryone
      ? 'Message deleted'
      : lastMessage.type === 'text'
        ? lastMessage.content
        : lastMessage.type === 'image'
          ? '📷 Photo'
          : lastMessage.type === 'video'
            ? '🎥 Video'
            : lastMessage.type === 'audio'
              ? '🎙️ Voice message'
              : lastMessage.type === 'location'
                ? '📍 Location'
                : lastMessage.type === 'contact'
                  ? '👤 Contact card'
                  : `📎 ${lastMessage.fileName || 'Attachment'}`
    : '';

  return {
    ...contact.toObject(),
    unreadCount,
    lastMessagePreview: preview,
    lastMessageAt: lastMessage?.createdAt || null,
    isPinned: preference?.pinned || false,
    isArchived: preference?.archived || false,
    isMuted: preference?.muted || false
  };
}

router.get('/', authenticate, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } })
      .select('username avatar status lastSeen bio theme wallpaper privacy')
      .sort({ status: -1, username: 1 });

    res.json({ users });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch users.' });
  }
});

router.get('/profile', authenticate, async (req, res) => {
  res.json({ user: req.user.toJSON() });
});

router.patch('/profile', authenticate, async (req, res) => {
  try {
    const allowed = ['username', 'avatar', 'bio', 'theme', 'wallpaper', 'privacy'];
    const updates = {};

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    if (updates.username && updates.username !== req.user.username) {
      const existing = await User.findOne({ username: updates.username, _id: { $ne: req.user._id } });
      if (existing) {
        return res.status(409).json({ message: 'Username is already taken.' });
      }
    }

    const user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true, runValidators: true });
    res.json({ user: user.toJSON() });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update profile.' });
  }
});

router.get('/contacts', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate(
      'contacts',
      'username avatar status lastSeen bio theme wallpaper privacy'
    );

    const contacts = await Promise.all(
      (user.contacts || []).map(contact => buildContactSummary(req.user._id, contact, getPreferenceEntry(user, contact._id)))
    );

    contacts.sort((a, b) => {
      if (a.isPinned !== b.isPinned) {
        return a.isPinned ? -1 : 1;
      }
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      return a.username.localeCompare(b.username);
    });

    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch contacts.' });
  }
});

router.post('/contacts/:id', authenticate, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ message: 'Invalid user ID.' });
    }
    if (targetUserId === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot add yourself.' });
    }

    const user = await User.findById(req.user._id);
    const isContact = user.contacts.some(contactId => contactId.toString() === targetUserId);

    if (isContact) {
      user.contacts.pull(targetUserId);
      user.chatPreferences = user.chatPreferences.filter(pref => pref.contact.toString() !== targetUserId);
    } else {
      user.contacts.push(targetUserId);
      user.chatPreferences.push({ contact: targetUserId });
    }

    await user.save();
    res.json({ message: isContact ? 'Contact removed.' : 'Contact added.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to modify contact list.' });
  }
});

router.patch('/contacts/:id/preferences', authenticate, async (req, res) => {
  try {
    const { muted, archived, pinned } = req.body;
    const targetUserId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ message: 'Invalid user ID.' });
    }
    const user = await User.findById(req.user._id);

    let preference = user.chatPreferences.find(pref => pref.contact.toString() === targetUserId);
    if (!preference) {
      preference = { contact: targetUserId, muted: false, archived: false, pinned: false };
      user.chatPreferences.push(preference);
    }

    if (muted !== undefined) preference.muted = !!muted;
    if (archived !== undefined) preference.archived = !!archived;
    if (pinned !== undefined) preference.pinned = !!pinned;

    await user.save();
    res.json({ message: 'Preferences updated.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update chat preferences.' });
  }
});

router.get('/search', authenticate, async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ message: 'Search query is required.' });
    }

    const users = await User.find({
      _id: { $ne: req.user._id },
      username: { $regex: escapeRegex(query), $options: 'i' }
    }).select('username avatar status lastSeen bio');

    res.json({ users });
  } catch (err) {
    res.status(500).json({ message: 'Search failed.' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID.' });
    }
    const user = await User.findById(req.params.id)
      .select('username avatar status lastSeen bio theme wallpaper privacy');

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch user.' });
  }
});

module.exports = router;
