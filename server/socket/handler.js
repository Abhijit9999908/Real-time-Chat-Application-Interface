const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');

// Track connected users: userId -> Set of socketIds (handles multiple tabs/reconnects)
const onlineUsers = new Map();

// Helper: get all socket IDs for a user
function getUserSockets(userId) {
  return onlineUsers.get(userId) || new Set();
}

// Helper: check if user has any active connections
function isUserOnline(userId) {
  const sockets = onlineUsers.get(userId);
  return sockets && sockets.size > 0;
}

// Helper: get list of all online user IDs
function getOnlineUserIds() {
  const ids = [];
  for (const [userId, sockets] of onlineUsers.entries()) {
    if (sockets.size > 0) ids.push(userId);
  }
  return ids;
}

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

    // Register this socket for the user
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    const wasPreviouslyOnline = onlineUsers.get(userId).size > 0;
    onlineUsers.get(userId).add(socket.id);

    // Only broadcast status change if this is the user's FIRST connection
    if (!wasPreviouslyOnline) {
      await User.findByIdAndUpdate(userId, { status: 'online' });
      io.emit('userStatusChanged', { userId, status: 'online', lastSeen: null });
    }

    // Always send the current online users list to the newly connected socket
    socket.emit('onlineUsers', getOnlineUserIds());
    // Broadcast updated list to everyone
    io.emit('onlineUsers', getOnlineUserIds());

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

        // Send to ALL of receiver's connected sockets
        const receiverSockets = getUserSockets(receiverId);
        for (const sid of receiverSockets) {
          io.to(sid).emit('newMessage', populated);
        }

        // Confirm delivery to ALL of sender's connected sockets
        const senderSockets = getUserSockets(userId);
        for (const sid of senderSockets) {
          io.to(sid).emit('messageSent', populated);
        }

        if (callback) callback({ success: true, message: populated });
      } catch (err) {
        console.error('Send message error:', err.message);
        if (callback) callback({ success: false, error: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('typing', (data) => {
      const receiverSockets = getUserSockets(data.receiverId);
      for (const sid of receiverSockets) {
        io.to(sid).emit('userTyping', {
          userId,
          username: socket.username
        });
      }
    });

    socket.on('stopTyping', (data) => {
      const receiverSockets = getUserSockets(data.receiverId);
      for (const sid of receiverSockets) {
        io.to(sid).emit('userStoppedTyping', { userId });
      }
    });

    // Mark messages as read
    socket.on('markAsRead', async (data) => {
      try {
        await Message.updateMany(
          { sender: data.senderId, receiver: userId, read: false },
          { $set: { read: true } }
        );

        const senderSockets = getUserSockets(data.senderId);
        for (const sid of senderSockets) {
          io.to(sid).emit('messagesRead', { readBy: userId });
        }
      } catch (err) {
        console.error('Mark read error:', err.message);
      }
    });

    // Heartbeat: client pings, server pongs
    socket.on('heartbeat', () => {
      socket.emit('heartbeatAck');
    });

    // Disconnect
    socket.on('disconnect', async () => {
      console.log(`✗ ${socket.username} disconnected (${socket.id})`);

      // Remove THIS specific socket from the user's set
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);

        // Only mark offline if ALL sockets are gone
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          const lastSeen = new Date();
          await User.findByIdAndUpdate(userId, {
            status: 'offline',
            lastSeen
          });

          io.emit('userStatusChanged', { userId, status: 'offline', lastSeen: lastSeen.toISOString() });
          io.emit('onlineUsers', getOnlineUserIds());
        }
        // If user still has other connections, do NOT broadcast offline
      }
    });
  });
};
