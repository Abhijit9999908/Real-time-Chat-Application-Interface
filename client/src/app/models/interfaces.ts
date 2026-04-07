export interface User {
  _id: string;
  username: string;
  email: string;
  avatar: string;
  status: 'online' | 'offline' | 'away';
  lastSeen?: string;
  bio?: string;
}

export interface Message {
  _id: string;
  sender: User | string;
  receiver: User | string;
  content: string;
  type: 'text' | 'image' | 'file';
  fileName: string;
  fileUrl: string;
  fileSize: number;
  read: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface MessagePagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface MessagesResponse {
  messages: Message[];
  pagination: MessagePagination;
}
