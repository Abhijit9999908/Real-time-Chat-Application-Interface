import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, NgZone, ChangeDetectorRef } from '@angular/core';
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
  contacts: User[] = [];
  filteredUsers: User[] = [];
  activeTab: 'contacts' | 'search' = 'contacts';
  selectedUser: User | null = null;
  messages: Message[] = [];
  onlineUserIds: string[] = [];
  messageText = '';
  searchQuery = '';
  typingUser: string | null = null;
  showMobileSidebar = true;
  uploadingFile = false;
  uploadProgress = 0;
  lastSeenMap: { [userId: string]: string } = {};
  connectionState: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';

  private subs: Subscription[] = [];
  private shouldScroll = false;
  private typingTimeout: any = null;

  constructor(
    private authService: AuthService,
    private socketService: SocketService,
    private chatService: ChatService,
    private router: Router,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.currentUser;
    this.socketService.connect();
    this.loadContacts();
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

  private loadContacts(): void {
    this.chatService.fetchContacts().subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          this.contacts = res.contacts;
          this.users = res.contacts;
          this.filterUsers();
          this.cdr.detectChanges();
        });
      }
    });
  }

  switchTab(tab: 'contacts' | 'search'): void {
    this.activeTab = tab;
    this.searchQuery = '';
    
    if (tab === 'contacts') {
      this.loadContacts();
    } else {
      this.users = [];
      this.filterUsers();
    }
  }

  toggleContact(user: User, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    const wasContact = this.isContact(user._id);
    this.chatService.addOrRemoveContact(user._id).subscribe({
      next: () => {
        this.ngZone.run(() => {
          if (!wasContact) {
            // Added as contact — switch to contacts tab & auto-select them
            this.activeTab = 'contacts';
            this.searchQuery = '';
            this.chatService.fetchContacts().subscribe(res => {
              this.ngZone.run(() => {
                this.contacts = res.contacts;
                this.users = res.contacts;
                this.filterUsers();
                // Auto-select the user to start chatting immediately
                this.selectUser(user);
                this.cdr.detectChanges();
              });
            });
          } else {
            // Removed contact — refresh the contacts list
            this.chatService.fetchContacts().subscribe(res => {
              this.ngZone.run(() => {
                this.contacts = res.contacts;
                if (this.activeTab === 'contacts') {
                  this.users = res.contacts;
                  this.filterUsers();
                }
                this.cdr.detectChanges();
              });
            });
          }
        });
      }
    });
  }

  isContact(userId: string): boolean {
    return this.contacts.some(c => c._id === userId);
  }

  private setupSocketListeners(): void {
    this.subs.push(
      this.socketService.onlineUsers$.subscribe(ids => {
        this.ngZone.run(() => {
          this.onlineUserIds = ids;
          this.users = this.users.map(u => ({
            ...u,
            status: ids.includes(u._id) ? 'online' as const : 'offline' as const
          }));
          this.contacts = this.contacts.map(u => ({
            ...u,
            status: ids.includes(u._id) ? 'online' as const : 'offline' as const
          }));
          this.filterUsers();
          this.cdr.detectChanges();
        });
      })
    );

    this.subs.push(
      this.socketService.newMessage$.subscribe(msg => {
        if (!msg) return;
        this.ngZone.run(() => {
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
          this.cdr.detectChanges();
        });
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

    // Listen for individual user status changes with lastSeen
    this.subs.push(
      this.socketService.userStatus$.subscribe(data => {
        if (!data) return;
        this.ngZone.run(() => {
          const { userId, status, lastSeen } = data;

          // Update lastSeen map
          if (lastSeen) {
            this.lastSeenMap[userId] = lastSeen;
          } else {
            delete this.lastSeenMap[userId];
          }

          // Update status in all arrays
          const newStatus = status as 'online' | 'offline' | 'away';
          this.users = this.users.map(u =>
            u._id === userId ? { ...u, status: newStatus, lastSeen: lastSeen || u.lastSeen } : u
          );
          this.contacts = this.contacts.map(u =>
            u._id === userId ? { ...u, status: newStatus, lastSeen: lastSeen || u.lastSeen } : u
          );

          // Update selected user if it's the affected user
          if (this.selectedUser && this.selectedUser._id === userId) {
            this.selectedUser = { ...this.selectedUser, status: newStatus, lastSeen: lastSeen || this.selectedUser.lastSeen };
          }

          this.filterUsers();
          this.cdr.detectChanges();
        });
      })
    );

    // Track connection state
    this.subs.push(
      this.socketService.connectionState$.subscribe(state => {
        this.ngZone.run(() => {
          this.connectionState = state;
          this.cdr.detectChanges();
        });
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
        this.ngZone.run(() => {
          this.messages = res.messages;
          this.shouldScroll = true;
          this.socketService.markAsRead(user._id);
          this.cdr.detectChanges();
        });
      }
    });
  }

  filterUsers(): void {
    if (!this.searchQuery.trim()) {
      if (this.activeTab === 'search') {
        this.filteredUsers = []; // Clear search results if empty
      } else {
        this.filteredUsers = this.contacts;
      }
      return;
    }
    const q = this.searchQuery.toLowerCase();
    
    // Auto-switch to search tab if they type and are on contacts
    if (this.activeTab === 'contacts') {
      this.filteredUsers = this.contacts.filter(u =>
        u.username.toLowerCase().includes(q)
      );
    } else {
      // It's the search tab, perform API search
    }
  }

  onSearchChange(): void {
    if (this.activeTab === 'search' && this.searchQuery.trim()) {
      this.chatService.searchUsers(this.searchQuery).subscribe({
        next: (res) => {
          this.ngZone.run(() => {
            this.users = res.users;
            this.filteredUsers = res.users;
            this.cdr.detectChanges();
          });
        }
      });
    } else {
      this.filterUsers();
    }
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

    // Check file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be under 10MB');
      input.value = '';
      return;
    }

    this.uploadingFile = true;
    this.uploadProgress = 0;

    // Subscribe to progress
    const progressSub = this.chatService.uploadProgress$.subscribe(p => {
      this.ngZone.run(() => {
        this.uploadProgress = p;
        this.cdr.detectChanges();
      });
    });

    this.chatService.uploadFile(file).subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          this.socketService.sendMessage({
            receiverId: this.selectedUser!._id,
            content: file.name,
            type: res.type,
            fileName: res.fileName,
            fileUrl: res.fileUrl,
            fileSize: res.fileSize
          });
          this.uploadingFile = false;
          this.uploadProgress = 0;
          progressSub.unsubscribe();
          input.value = '';
          this.cdr.detectChanges();
        });
      },
      error: () => {
        this.ngZone.run(() => {
          this.uploadingFile = false;
          this.uploadProgress = 0;
          progressSub.unsubscribe();
          input.value = '';
          this.cdr.detectChanges();
        });
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

  formatLastSeen(userId: string): string {
    const lastSeen = this.lastSeenMap[userId];
    if (!lastSeen) return 'Offline';

    const diff = Date.now() - new Date(lastSeen).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(lastSeen).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  getUserStatusText(user: any): string {
    if (this.isUserOnline(user._id)) return 'Online';
    const lastSeen = this.lastSeenMap[user._id] || user.lastSeen;
    if (lastSeen) {
      return 'Last seen ' + this.formatLastSeen(user._id);
    }
    return 'Offline';
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
