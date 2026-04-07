import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { Message } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket | null = null;
  private onlineUsersSubject = new BehaviorSubject<string[]>([]);
  private newMessageSubject = new BehaviorSubject<Message | null>(null);
  private typingSubject = new BehaviorSubject<{ userId: string; username: string } | null>(null);
  private stoppedTypingSubject = new BehaviorSubject<string | null>(null);
  private userStatusSubject = new BehaviorSubject<{ userId: string; status: string } | null>(null);
  private messagesReadSubject = new BehaviorSubject<string | null>(null);

  onlineUsers$ = this.onlineUsersSubject.asObservable();
  newMessage$ = this.newMessageSubject.asObservable();
  typing$ = this.typingSubject.asObservable();
  stoppedTyping$ = this.stoppedTypingSubject.asObservable();
  userStatus$ = this.userStatusSubject.asObservable();
  messagesRead$ = this.messagesReadSubject.asObservable();

  constructor(private authService: AuthService) {}

  connect(): void {
    if (this.socket?.connected) return;

    const token = this.authService.token;
    if (!token) return;

    this.socket = io(environment.socketUrl, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
    });

    this.socket.on('onlineUsers', (users: string[]) => {
      this.onlineUsersSubject.next(users);
    });

    this.socket.on('newMessage', (message: Message) => {
      this.newMessageSubject.next(message);
    });

    this.socket.on('messageSent', (message: Message) => {
      this.newMessageSubject.next(message);
    });

    this.socket.on('userTyping', (data: { userId: string; username: string }) => {
      this.typingSubject.next(data);
    });

    this.socket.on('userStoppedTyping', (data: { userId: string }) => {
      this.stoppedTypingSubject.next(data.userId);
    });

    this.socket.on('userStatusChanged', (data: { userId: string; status: string }) => {
      this.userStatusSubject.next(data);
    });

    this.socket.on('messagesRead', (data: { readBy: string }) => {
      this.messagesReadSubject.next(data.readBy);
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  sendMessage(data: {
    receiverId: string;
    content: string;
    type?: string;
    fileName?: string;
    fileUrl?: string;
    fileSize?: number;
  }): void {
    this.socket?.emit('sendMessage', data);
  }

  emitTyping(receiverId: string): void {
    this.socket?.emit('typing', { receiverId });
  }

  emitStopTyping(receiverId: string): void {
    this.socket?.emit('stopTyping', { receiverId });
  }

  markAsRead(senderId: string): void {
    this.socket?.emit('markAsRead', { senderId });
  }
}
