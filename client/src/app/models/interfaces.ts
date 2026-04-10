export interface PrivacySettings {
  lastSeen: 'everyone' | 'contacts' | 'nobody';
  profilePhoto: 'everyone' | 'contacts' | 'nobody';
  onlineStatus: 'everyone' | 'contacts' | 'nobody';
}

export interface User {
  _id: string;
  username: string;
  email: string;
  avatar: string;
  status: 'online' | 'offline' | 'away';
  lastSeen?: string;
  bio?: string;
  theme?: 'dark' | 'light';
  wallpaper?: string;
  privacy?: PrivacySettings;
  unreadCount?: number;
  lastMessagePreview?: string;
  lastMessageAt?: string | null;
  isPinned?: boolean;
  isArchived?: boolean;
  isMuted?: boolean;
}

export interface MessageReaction {
  user: User | string;
  emoji: string;
}

export interface SharedLocation {
  latitude: number;
  longitude: number;
  label?: string;
}

export interface SharedContact {
  user?: User | string;
  username: string;
  email?: string;
  avatar?: string;
  bio?: string;
}

export interface Message {
  _id: string;
  sender: User | string;
  receiver: User | string;
  content: string;
  type: 'text' | 'image' | 'file' | 'audio' | 'video' | 'location' | 'contact';
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType?: string;
  duration?: number;
  location?: SharedLocation | null;
  sharedContact?: SharedContact | null;
  replyTo?: Message | null;
  reactions?: MessageReaction[];
  pinned?: boolean;
  delivered?: boolean;
  deliveredAt?: string | null;
  read: boolean;
  readAt?: string | null;
  editedAt?: string | null;
  deletedForEveryone?: boolean;
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
