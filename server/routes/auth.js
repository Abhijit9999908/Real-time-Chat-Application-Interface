const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

function signFor(user) {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN
  });
}

router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      const field = existingUser.email === email ? 'Email' : 'Username';
      return res.status(409).json({ message: `${field} is already taken.` });
    }

    const user = await User.create({ username, email, password });
    res.status(201).json({ token: signFor(user), user: user.toJSON() });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Account already exists.' });
    }
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ message: 'No account found with this email.' });
    }

    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Incorrect password.' });
    }

    user.status = 'online';
    await user.save();

    res.json({ token: signFor(user), user: user.toJSON() });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

router.get('/me', require('../middleware/auth'), async (req, res) => {
  res.json({ user: req.user.toJSON() });
});

module.exports = router;
