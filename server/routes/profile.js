const express = require('express');
const User = require('../models/User');
const authenticate = require('../middleware/auth');
const router = express.Router();

router.put('/', authenticate, async (req, res) => {
  try {
    const { username, bio } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (username) user.username = username;
    if (bio !== undefined) user.bio = bio;

    await user.save();
    res.json({ message: 'Profile updated', user });
  } catch (err) {
    res.status(500).json({ message: 'Update failed' });
  }
});

module.exports = router;
