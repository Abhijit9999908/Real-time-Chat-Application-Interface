import { Injectable, NgZone } from '@angular/core';
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
  private userStatusSubject = new BehaviorSubject<{ userId: string; status: string; lastSeen: string | null } | null>(null);
  private messagesReadSubject = new BehaviorSubject<string | null>(null);
  private connectionStateSubject = new BehaviorSubject<'connected' | 'disconnected' | 'reconnecting'>('disconnected');

  private heartbeatInterval: any = null;

  onlineUsers$ = this.onlineUsersSubject.asObservable();
  newMessage$ = this.newMessageSubject.asObservable();
  typing$ = this.typingSubject.asObservable();
  stoppedTyping$ = this.stoppedTypingSubject.asObservable();
  userStatus$ = this.userStatusSubject.asObservable();
  messagesRead$ = this.messagesReadSubject.asObservable();
  connectionState$ = this.connectionStateSubject.asObservable();

  constructor(private authService: AuthService, private ngZone: NgZone) {}

  connect(): void {
    if (this.socket?.connected) return;

    const token = this.authService.token;
    if (!token) return;

    this.socket = io(environment.socketUrl, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 10000
    });

    this.socket.on('connect', () => {
      this.ngZone.run(() => {
        console.log('✓ Socket connected');
        this.connectionStateSubject.next('connected');
        this.startHeartbeat();
      });
    });

    this.socket.on('onlineUsers', (users: string[]) => {
      this.ngZone.run(() => {
        this.onlineUsersSubject.next(users);
      });
    });

    this.socket.on('newMessage', (message: Message) => {
      this.ngZone.run(() => {
        this.newMessageSubject.next(message);
      });
    });

    this.socket.on('messageSent', (message: Message) => {
      this.ngZone.run(() => {
        this.newMessageSubject.next(message);
      });
    });

    this.socket.on('userTyping', (data: { userId: string; username: string }) => {
      this.ngZone.run(() => {
        this.typingSubject.next(data);
      });
    });

    this.socket.on('userStoppedTyping', (data: { userId: string }) => {
      this.ngZone.run(() => {
        this.stoppedTypingSubject.next(data.userId);
      });
    });

    this.socket.on('userStatusChanged', (data: { userId: string; status: string; lastSeen: string | null }) => {
      this.ngZone.run(() => {
        this.userStatusSubject.next(data);
      });
    });

    this.socket.on('messagesRead', (data: { readBy: string }) => {
      this.ngZone.run(() => {
        this.messagesReadSubject.next(data.readBy);
      });
    });

    this.socket.on('disconnect', () => {
      this.ngZone.run(() => {
        console.log('✗ Socket disconnected');
        this.connectionStateSubject.next('disconnected');
        this.stopHeartbeat();
      });
    });

    this.socket.on('reconnect_attempt', () => {
      this.ngZone.run(() => {
        this.connectionStateSubject.next('reconnecting');
      });
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connectionStateSubject.next('disconnected');
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.socket?.emit('heartbeat');
    }, 25000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
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
