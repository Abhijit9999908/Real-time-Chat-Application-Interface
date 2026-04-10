const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');

const onlineUsers = new Map();

function getUserSockets(userId) {
  return onlineUsers.get(userId) || new Set();
}

function getOnlineUserIds() {
  const ids = [];
  for (const [userId, sockets] of onlineUsers.entries()) {
    if (sockets.size > 0) ids.push(userId);
  }
  return ids;
}

async function populateMessage(messageId) {
  return Message.findById(messageId)
    .populate('sender', 'username avatar bio')
    .populate('receiver', 'username avatar bio')
    .populate({ path: 'replyTo', populate: { path: 'sender', select: 'username avatar' } })
    .populate('reactions.user', 'username avatar')
    .populate('sharedContact.user', 'username avatar email bio');
}

function emitToParticipants(io, message, eventName, payload) {
  const senderId = typeof message.sender === 'object' ? message.sender._id.toString() : message.sender.toString();
  const receiverId = typeof message.receiver === 'object' ? message.receiver._id.toString() : message.receiver.toString();

  for (const sid of getUserSockets(senderId)) {
    io.to(sid).emit(eventName, payload);
  }
  for (const sid of getUserSockets(receiverId)) {
    io.to(sid).emit(eventName, payload);
  }
}

function isValidObjectId(id) {
  return id && mongoose.Types.ObjectId.isValid(id);
}

module.exports = function setupSocket(io) {
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

    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }

    const wasPreviouslyOnline = onlineUsers.get(userId).size > 0;
    onlineUsers.get(userId).add(socket.id);

    if (!wasPreviouslyOnline) {
      await User.findByIdAndUpdate(userId, { status: 'online' });
      io.emit('userStatusChanged', { userId, status: 'online', lastSeen: null });
    }

    socket.emit('onlineUsers', getOnlineUserIds());
    io.emit('onlineUsers', getOnlineUserIds());

    socket.on('sendMessage', async (data, callback) => {
      try {
        if (!data || !isValidObjectId(data.receiverId)) {
          return callback?.({ success: false, error: 'Invalid receiver.' });
        }

        const receiverSockets = getUserSockets(data.receiverId);
        const delivered = receiverSockets.size > 0;
        const now = delivered ? new Date() : null;

        const message = await Message.create({
          sender: userId,
          receiver: data.receiverId,
          content: data.content || '',
          type: data.type || 'text',
          fileName: data.fileName || '',
          fileUrl: data.fileUrl || '',
          fileSize: data.fileSize || 0,
          mimeType: data.mimeType || '',
          duration: data.duration || 0,
          location: data.location || null,
          sharedContact: data.sharedContact || null,
          replyTo: data.replyToId || null,
          delivered,
          deliveredAt: now
        });

        const populated = await populateMessage(message._id);

        for (const sid of receiverSockets) {
          io.to(sid).emit('newMessage', populated);
        }
        for (const sid of getUserSockets(userId)) {
          io.to(sid).emit('messageSent', populated);
          if (delivered) {
            io.to(sid).emit('messageDelivered', { messageId: message._id.toString(), deliveredAt: now?.toISOString() || null });
          }
        }

        callback?.({ success: true, message: populated });
      } catch (err) {
        callback?.({ success: false, error: 'Failed to send message' });
      }
    });

    socket.on('typing', (data) => {
      if (!data || !isValidObjectId(data.receiverId)) return;
      for (const sid of getUserSockets(data.receiverId)) {
        io.to(sid).emit('userTyping', { userId, username: socket.username });
      }
    });

    socket.on('stopTyping', (data) => {
      if (!data || !isValidObjectId(data.receiverId)) return;
      for (const sid of getUserSockets(data.receiverId)) {
        io.to(sid).emit('userStoppedTyping', { userId });
      }
    });

    socket.on('markAsRead', async (data) => {
      try {
        if (!data || !isValidObjectId(data.senderId)) return;
        const now = new Date();
        await Message.updateMany(
          { sender: data.senderId, receiver: userId, read: false },
          { $set: { read: true, delivered: true, deliveredAt: now, readAt: now } }
        );

        for (const sid of getUserSockets(data.senderId)) {
          io.to(sid).emit('messagesRead', { readBy: userId, readAt: now.toISOString() });
        }
      } catch (err) {
        console.error('Mark read error:', err.message);
      }
    });

    socket.on('editMessage', async (data, callback) => {
      try {
        if (!data || !isValidObjectId(data.messageId) || typeof data.content !== 'string') {
          return callback?.({ success: false, error: 'Invalid data.' });
        }

        const message = await Message.findById(data.messageId);
        if (!message || message.sender.toString() !== userId || message.deletedForEveryone) {
          return callback?.({ success: false, error: 'Message not editable.' });
        }

        const createdAt = new Date(message.createdAt).getTime();
        if (Date.now() - createdAt > 15 * 60 * 1000) {
          return callback?.({ success: false, error: 'Editing window expired.' });
        }

        message.content = data.content;
        message.editedAt = new Date();
        await message.save();

        const populated = await populateMessage(message._id);
        emitToParticipants(io, populated, 'messageUpdated', populated);
        callback?.({ success: true, message: populated });
      } catch (err) {
        callback?.({ success: false, error: 'Failed to edit message.' });
      }
    });

    socket.on('deleteMessage', async (data, callback) => {
      try {
        if (!data || !isValidObjectId(data.messageId)) {
          return callback?.({ success: false, error: 'Invalid message ID.' });
        }

        const message = await Message.findById(data.messageId);
        if (!message || message.sender.toString() !== userId) {
          return callback?.({ success: false, error: 'Message not found.' });
        }

        message.deletedForEveryone = true;
        message.deletedAt = new Date();
        message.content = '';
        message.fileName = '';
        message.fileUrl = '';
        message.fileSize = 0;
        message.mimeType = '';
        message.location = null;
        message.sharedContact = null;
        message.reactions = [];
        await message.save();

        const populated = await populateMessage(message._id);
        emitToParticipants(io, populated, 'messageUpdated', populated);
        callback?.({ success: true, message: populated });
      } catch (err) {
        callback?.({ success: false, error: 'Failed to delete message.' });
      }
    });

    socket.on('toggleReaction', async (data, callback) => {
      try {
        if (!data || !isValidObjectId(data.messageId) || !data.emoji) {
          return callback?.({ success: false, error: 'Invalid data.' });
        }

        const message = await Message.findById(data.messageId);
        if (!message || message.deletedForEveryone) {
          return callback?.({ success: false, error: 'Message not found.' });
        }

        const existingIndex = message.reactions.findIndex(reaction => reaction.user.toString() === userId);
        if (existingIndex >= 0 && message.reactions[existingIndex].emoji === data.emoji) {
          message.reactions.splice(existingIndex, 1);
        } else if (existingIndex >= 0) {
          message.reactions[existingIndex].emoji = data.emoji;
        } else {
          message.reactions.push({ user: userId, emoji: data.emoji });
        }

        await message.save();
        const populated = await populateMessage(message._id);
        emitToParticipants(io, populated, 'messageUpdated', populated);
        callback?.({ success: true, message: populated });
      } catch (err) {
        callback?.({ success: false, error: 'Failed to react to message.' });
      }
    });

    socket.on('togglePinMessage', async (data, callback) => {
      try {
        if (!data || !isValidObjectId(data.messageId)) {
          return callback?.({ success: false, error: 'Invalid message ID.' });
        }

        const message = await Message.findById(data.messageId);
        if (!message) {
          return callback?.({ success: false, error: 'Message not found.' });
        }

        message.pinned = !message.pinned;
        await message.save();

        const populated = await populateMessage(message._id);
        emitToParticipants(io, populated, 'messageUpdated', populated);
        callback?.({ success: true, message: populated });
      } catch (err) {
        callback?.({ success: false, error: 'Failed to pin message.' });
      }
    });

    socket.on('heartbeat', () => {
      socket.emit('heartbeatAck');
    });

    socket.on('disconnect', async () => {
      try {
        const sockets = onlineUsers.get(userId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            onlineUsers.delete(userId);
            const lastSeen = new Date();
            await User.findByIdAndUpdate(userId, { status: 'offline', lastSeen });
            io.emit('userStatusChanged', { userId, status: 'offline', lastSeen: lastSeen.toISOString() });
            io.emit('onlineUsers', getOnlineUserIds());
          }
        }
      } catch (err) {
        console.error('Disconnect handler error:', err.message);
      }
    });
  });
};

