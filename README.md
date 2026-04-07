# ChitChat — Real-time Chat Application

A full-stack real-time messaging application built with Angular, Node.js, Express, Socket.IO, and MongoDB. Features instant messaging, user presence tracking, file sharing, and a modern dark-themed UI.

## Features

- **Real-time Messaging** — Instant message delivery via Socket.IO
- **User Presence** — See who's online/offline in real-time
- **File Sharing** — Upload and send images, PDFs, and documents
- **Typing Indicators** — Know when someone is typing
- **Read Receipts** — Visual confirmation when messages are read
- **JWT Authentication** — Secure login and registration with hashed passwords
- **Responsive Design** — Works on desktop and mobile devices
- **Dark Theme** — Modern, eye-friendly interface

## Tech Stack

| Layer          | Technology            |
|----------------|-----------------------|
| Frontend       | Angular, TypeScript   |
| Backend        | Node.js, Express      |
| Real-time      | Socket.IO             |
| Database       | MongoDB, Mongoose     |
| Auth           | JWT, bcrypt           |
| File Uploads   | Multer                |

## Project Structure

```
├── client/                   # Angular frontend
│   └── src/
│       ├── app/
│       │   ├── guards/       # Auth & guest route guards
│       │   ├── interceptors/ # HTTP auth interceptor
│       │   ├── models/       # TypeScript interfaces
│       │   ├── pages/        # Login, Register, Chat pages
│       │   └── services/     # Auth, Socket, Chat services
│       ├── environments/     # Dev & prod configs
│       └── styles.css        # Global design tokens
│
├── server/                   # Node.js backend
│   ├── middleware/           # JWT auth middleware
│   ├── models/               # Mongoose schemas (User, Message)
│   ├── routes/               # REST API endpoints
│   ├── socket/               # Socket.IO event handler
│   ├── uploads/              # Uploaded files directory
│   └── index.js              # Server entry point
│
└── README.md
```

## Prerequisites

- **Node.js** v18 or higher
- **MongoDB** running locally on `mongodb://localhost:27017` (or a MongoDB Atlas URI)
- **Angular CLI** (installed globally or via npx)

## Setup & Run

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd "Real-time Chat Application Interface"
```

### 2. Start the backend

```bash
cd server
npm install
```

Create a `.env` file in the `server/` directory (one is provided with defaults):

```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/chitchat
JWT_SECRET=ch1tch4t_s3cr3t_k3y_2024_r34lt1m3
JWT_EXPIRES_IN=7d
```

Start the server:

```bash
npm start
# or for development with auto-reload:
npm run dev
```

### 3. Start the frontend

```bash
cd client
npm install
npx ng serve
```

Open **http://localhost:4200** in your browser.

### 4. Test the app

1. Open two browser tabs at `http://localhost:4200`
2. Register two different accounts
3. Both users should appear in each other's contact list
4. Start chatting in real-time

## API Endpoints

| Method | Endpoint                | Description              |
|--------|-------------------------|--------------------------|
| POST   | `/api/auth/register`    | Register a new user      |
| POST   | `/api/auth/login`       | Login and get JWT        |
| GET    | `/api/auth/me`          | Get current user         |
| GET    | `/api/users`            | List all users           |
| GET    | `/api/users/search?q=`  | Search users by name     |
| GET    | `/api/users/:id`        | Get user profile         |
| GET    | `/api/messages/:userId` | Get message history      |
| POST   | `/api/messages/upload`  | Upload a file            |

## Socket.IO Events

| Event              | Direction     | Description                |
|--------------------|---------------|----------------------------|
| `sendMessage`      | Client → Server | Send a message           |
| `newMessage`       | Server → Client | Receive a message        |
| `typing`           | Client → Server | Notify typing start      |
| `userTyping`       | Server → Client | Receive typing indicator |
| `onlineUsers`      | Server → Client | Updated online user list |
| `userStatusChanged`| Server → Client | User went online/offline |
| `markAsRead`       | Client → Server | Mark messages as read    |

## Deployment

### Backend
1. Set up a MongoDB Atlas cluster and update `MONGODB_URI`
2. Deploy to any Node.js host (Render, Railway, DigitalOcean, etc.)
3. Set environment variables on your hosting platform

### Frontend
```bash
cd client
npx ng build --configuration production
```
The build output in `dist/client/` can be served by any static host (Vercel, Netlify, etc.) or from the Express server itself.

## License

MIT
