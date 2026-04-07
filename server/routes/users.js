const express = require('express');
const User = require('../models/User');
const authenticate = require('../middleware/auth');

const router = express.Router();

// Get all users except the current one
router.get('/', authenticate, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } })
      .select('username email avatar status lastSeen bio')
      .sort({ status: -1, username: 1 });

    res.json({ users });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch users.' });
  }
});

// Search users by username
router.get('/search', authenticate, async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ message: 'Search query is required.' });
    }

    const users = await User.find({
      _id: { $ne: req.user._id },
      username: { $regex: query, $options: 'i' }
    }).select('username email avatar status lastSeen');

    res.json({ users });
  } catch (err) {
    res.status(500).json({ message: 'Search failed.' });
  }
});

// Get user by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('username email avatar status lastSeen bio');

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch user.' });
  }
});

module.exports = router;
