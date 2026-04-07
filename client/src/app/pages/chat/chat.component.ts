import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { SocketService } from '../../services/socket.service';
import { ChatService } from '../../services/chat.service';
import { User, Message } from '../../models/interfaces';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-chat',
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css'
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  currentUser: User | null = null;
  users: User[] = [];
  filteredUsers: User[] = [];
  selectedUser: User | null = null;
  messages: Message[] = [];
  onlineUserIds: string[] = [];
  messageText = '';
  searchQuery = '';
  typingUser: string | null = null;
  showMobileSidebar = true;
  uploadingFile = false;

  private subs: Subscription[] = [];
  private shouldScroll = false;
  private typingTimeout: any = null;

  constructor(
    private authService: AuthService,
    private socketService: SocketService,
    private chatService: ChatService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.currentUser;
    this.socketService.connect();
    this.loadUsers();
    this.setupSocketListeners();
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.socketService.disconnect();
    if (this.typingTimeout) clearTimeout(this.typingTimeout);
  }

  private loadUsers(): void {
    this.chatService.fetchUsers().subscribe({
      next: (res) => {
        this.users = res.users;
        this.filteredUsers = res.users;
      }
    });
  }

  private setupSocketListeners(): void {
    this.subs.push(
      this.socketService.onlineUsers$.subscribe(ids => {
        this.onlineUserIds = ids;
        this.users = this.users.map(u => ({
          ...u,
          status: ids.includes(u._id) ? 'online' as const : 'offline' as const
        }));
        this.filterUsers();
      })
    );

    this.subs.push(
      this.socketService.newMessage$.subscribe(msg => {
        if (!msg) return;
        const senderId = typeof msg.sender === 'object' ? msg.sender._id : msg.sender;
        const receiverId = typeof msg.receiver === 'object' ? msg.receiver._id : msg.receiver;
        const isCurrentConversation = this.selectedUser && (
          (senderId === this.selectedUser._id && receiverId === this.currentUser?._id) ||
          (senderId === this.currentUser?._id && receiverId === this.selectedUser._id)
        );

        if (isCurrentConversation && !this.messages.find(m => m._id === msg._id)) {
          this.messages = [...this.messages, msg];
          this.shouldScroll = true;
          if (senderId === this.selectedUser?._id) {
            this.socketService.markAsRead(senderId);
          }
        }
      })
    );

    this.subs.push(
      this.socketService.typing$.subscribe(data => {
        if (data && this.selectedUser && data.userId === this.selectedUser._id) {
          this.typingUser = data.username;
          setTimeout(() => {
            if (this.typingUser === data.username) {
              this.typingUser = null;
            }
          }, 3000);
        }
      })
    );

    this.subs.push(
      this.socketService.stoppedTyping$.subscribe(userId => {
        if (userId && this.selectedUser && userId === this.selectedUser._id) {
          this.typingUser = null;
        }
      })
    );
  }

  selectUser(user: User): void {
    this.selectedUser = user;
    this.messages = [];
    this.typingUser = null;
    this.showMobileSidebar = false;

    this.chatService.fetchMessages(user._id).subscribe({
      next: (res) => {
        this.messages = res.messages;
        this.shouldScroll = true;
        this.socketService.markAsRead(user._id);
      }
    });
  }

  filterUsers(): void {
    if (!this.searchQuery.trim()) {
      this.filteredUsers = this.users;
      return;
    }
    const q = this.searchQuery.toLowerCase();
    this.filteredUsers = this.users.filter(u =>
      u.username.toLowerCase().includes(q)
    );
  }

  onSearchChange(): void {
    this.filterUsers();
  }

  sendMessage(): void {
    if (!this.messageText.trim() || !this.selectedUser) return;

    this.socketService.sendMessage({
      receiverId: this.selectedUser._id,
      content: this.messageText.trim(),
      type: 'text'
    });

    this.messageText = '';
    this.socketService.emitStopTyping(this.selectedUser._id);
  }

  onTyping(): void {
    if (!this.selectedUser) return;

    this.socketService.emitTyping(this.selectedUser._id);

    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      if (this.selectedUser) {
        this.socketService.emitStopTyping(this.selectedUser._id);
      }
    }, 2000);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  triggerFileUpload(): void {
    this.fileInput?.nativeElement?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.selectedUser) return;

    this.uploadingFile = true;
    this.chatService.uploadFile(file).subscribe({
      next: (res) => {
        this.socketService.sendMessage({
          receiverId: this.selectedUser!._id,
          content: file.name,
          type: res.type,
          fileName: res.fileName,
          fileUrl: res.fileUrl,
          fileSize: res.fileSize
        });
        this.uploadingFile = false;
        input.value = '';
      },
      error: () => {
        this.uploadingFile = false;
        input.value = '';
      }
    });
  }

  isOwnMessage(msg: Message): boolean {
    const senderId = typeof msg.sender === 'object' ? msg.sender._id : msg.sender;
    return senderId === this.currentUser?._id;
  }

  getSenderName(msg: Message): string {
    return typeof msg.sender === 'object' ? msg.sender.username : '';
  }

  isUserOnline(userId: string): boolean {
    return this.onlineUserIds.includes(userId);
  }

  getFileUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    return `${environment.socketUrl}${url}`;
  }

  formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  shouldShowDate(index: number): boolean {
    if (index === 0) return true;
    const curr = new Date(this.messages[index].createdAt).toDateString();
    const prev = new Date(this.messages[index - 1].createdAt).toDateString();
    return curr !== prev;
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  getUserInitial(username: string): string {
    return username ? username.charAt(0).toUpperCase() : '?';
  }

  goBackToSidebar(): void {
    this.showMobileSidebar = true;
    this.selectedUser = null;
  }

  logout(): void {
    this.socketService.disconnect();
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  private scrollToBottom(): void {
    try {
      const el = this.messagesContainer?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    } catch {}
  }
}
