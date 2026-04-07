const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');

// Track connected users: userId -> socketId
const onlineUsers = new Map();

module.exports = function setupSocket(io) {

  // Authenticate socket connections
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (!user) return next(new Error('User not found'));

      socket.userId = user._id.toString();
      socket.username = user.username;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    console.log(`✓ ${socket.username} connected (${socket.id})`);

    // Mark user online
    onlineUsers.set(userId, socket.id);
    await User.findByIdAndUpdate(userId, { status: 'online' });

    // Broadcast online users list to everyone
    io.emit('onlineUsers', Array.from(onlineUsers.keys()));
    io.emit('userStatusChanged', { userId, status: 'online' });

    // Handle sending a message
    socket.on('sendMessage', async (data, callback) => {
      try {
        const { receiverId, content, type, fileName, fileUrl, fileSize } = data;

        const message = await Message.create({
          sender: userId,
          receiver: receiverId,
          content: content || '',
          type: type || 'text',
          fileName: fileName || '',
          fileUrl: fileUrl || '',
          fileSize: fileSize || 0
        });

        const populated = await Message.findById(message._id)
          .populate('sender', 'username avatar')
          .populate('receiver', 'username avatar');

        // Send to receiver if online
        const receiverSocket = onlineUsers.get(receiverId);
        if (receiverSocket) {
          io.to(receiverSocket).emit('newMessage', populated);
        }

        // Confirm delivery to sender
        if (callback) callback({ success: true, message: populated });
        socket.emit('messageSent', populated);
      } catch (err) {
        console.error('Send message error:', err.message);
        if (callback) callback({ success: false, error: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('typing', (data) => {
      const receiverSocket = onlineUsers.get(data.receiverId);
      if (receiverSocket) {
        io.to(receiverSocket).emit('userTyping', {
          userId,
          username: socket.username
        });
      }
    });

    socket.on('stopTyping', (data) => {
      const receiverSocket = onlineUsers.get(data.receiverId);
      if (receiverSocket) {
        io.to(receiverSocket).emit('userStoppedTyping', {
          userId
        });
      }
    });

    // Mark messages as read
    socket.on('markAsRead', async (data) => {
      try {
        await Message.updateMany(
          { sender: data.senderId, receiver: userId, read: false },
          { $set: { read: true } }
        );

        const senderSocket = onlineUsers.get(data.senderId);
        if (senderSocket) {
          io.to(senderSocket).emit('messagesRead', { readBy: userId });
        }
      } catch (err) {
        console.error('Mark read error:', err.message);
      }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      console.log(`✗ ${socket.username} disconnected`);
      onlineUsers.delete(userId);

      await User.findByIdAndUpdate(userId, {
        status: 'offline',
        lastSeen: new Date()
      });

      io.emit('onlineUsers', Array.from(onlineUsers.keys()));
      io.emit('userStatusChanged', { userId, status: 'offline' });
    });
  });
};
