import {
  AfterViewChecked,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { SocketService } from '../../services/socket.service';
import { ChatService } from '../../services/chat.service';
import {
  Message,
  PrivacySettings,
  SharedContact,
  SharedLocation,
  User
} from '../../models/interfaces';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-chat',
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css'
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('fileInputGallery') fileInputGallery!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputCamera') fileInputCamera!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputDocs') fileInputDocs!: ElementRef<HTMLInputElement>;
  @ViewChild('avatarInput') avatarInput!: ElementRef<HTMLInputElement>;

  currentUser: User | null = null;
  contacts: User[] = [];
  filteredUsers: User[] = [];
  selectedUser: User | null = null;
  messages: Message[] = [];
  onlineUserIds: string[] = [];
  messageText = '';
  searchQuery = '';
  activeTab: 'contacts' | 'search' = 'contacts';
  typingUser: string | null = null;
  showMobileSidebar = true;
  showAttachMenu = false;
  showEmojiPicker = false;
  showSettingsPanel = false;
  showChatInfoPanel = false;
  showArchivedChats = false;
  showForwardSheet = false;
  showShareContactSheet = false;
  showMessageActions = false;
  showChatSearch = false;
  uploadingFile = false;
  uploadProgress = 0;
  chatSearchQuery = '';
  highlightedMessageIds = new Set<string>();
  connectionState: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';
  activeMessage: Message | null = null;
  replyingTo: Message | null = null;
  editingMessageId: string | null = null;
  forwardingMessage: Message | null = null;
  longPressTimer: any = null;
  incomingTypingTimeout: any = null;
  outgoingTypingTimeout: any = null;
  isRecording = false;
  recordingSeconds = 0;
  recordingError = '';
  toastMessage = '';

  profileDraft = {
    username: '',
    bio: '',
    avatar: '',
    wallpaper: '',
    theme: 'dark' as 'dark' | 'light',
    privacy: {
      lastSeen: 'everyone',
      profilePhoto: 'everyone',
      onlineStatus: 'everyone'
    } as PrivacySettings
  };

  readonly quickEmojis = ['😀', '😂', '😍', '🔥', '🎉', '🙏', '👍', '❤️', '😮', '😢', '😎', '🤝'];
  readonly reactionOptions = ['👍', '❤️', '😂', '🔥', '😮', '😢'];

  private subs: Subscription[] = [];
  private shouldScroll = false;
  private mediaRecorder: MediaRecorder | null = null;
  private recordingChunks: Blob[] = [];
  private recordingInterval: any = null;
  private lastTypingEmit = 0;

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
    if (!this.currentUser) {
      this.router.navigate(['/login']);
      return;
    }

    this.seedProfileDraft(this.currentUser);
    this.applyTheme(this.currentUser.theme || 'dark');
    this.socketService.connect();
    this.loadContacts();
    this.setupSocketListeners();
    this.loadProfile();

    this.subs.push(
      this.chatService.uploadProgress$.subscribe(progress => {
        this.uploadingFile = progress > 0 && progress < 100;
        this.uploadProgress = progress;
        this.cdr.detectChanges();
      })
    );
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub.unsubscribe());
    this.socketService.disconnect();
    clearTimeout(this.incomingTypingTimeout);
    clearTimeout(this.outgoingTypingTimeout);
    clearTimeout(this.longPressTimer);
    clearInterval(this.recordingInterval);
  }

  private loadProfile(): void {
    this.chatService.fetchProfile().subscribe({
      next: (res) => {
        this.currentUser = res.user;
        this.authService.updateStoredUser(res.user);
        this.seedProfileDraft(res.user);
        this.applyTheme(res.user.theme || 'dark');
        this.cdr.detectChanges();
      }
    });
  }

  private seedProfileDraft(user: User): void {
    this.profileDraft = {
      username: user.username || '',
      bio: user.bio || '',
      avatar: user.avatar || '',
      wallpaper: user.wallpaper || '',
      theme: user.theme || 'dark',
      privacy: {
        lastSeen: user.privacy?.lastSeen || 'everyone',
        profilePhoto: user.privacy?.profilePhoto || 'everyone',
        onlineStatus: user.privacy?.onlineStatus || 'everyone'
      }
    };
  }

  private loadContacts(): void {
    this.chatService.fetchContacts().subscribe({
      next: (res) => {
        const previousSelectedId = this.selectedUser?._id;
        this.contacts = res.contacts;
        this.filteredUsers = this.getVisibleContacts();

        if (previousSelectedId) {
          const refreshedSelected = this.contacts.find(contact => contact._id === previousSelectedId);
          if (refreshedSelected) {
            this.selectedUser = refreshedSelected;
          }
        }

        this.cdr.detectChanges();
      }
    });
  }

  private setupSocketListeners(): void {
    this.subs.push(
      this.socketService.onlineUsers$.subscribe(ids => {
        this.onlineUserIds = ids;
        this.contacts = this.contacts.map(contact => ({
          ...contact,
          status: ids.includes(contact._id) ? 'online' : 'offline'
        }));
        if (this.selectedUser) {
          const selected = this.contacts.find(contact => contact._id === this.selectedUser?._id);
          if (selected) this.selectedUser = selected;
        }
        this.filteredUsers = this.getVisibleContacts();
        this.cdr.detectChanges();
      })
    );

    this.subs.push(
      this.socketService.newMessage$.subscribe(message => {
        if (!message || !this.currentUser) return;
        const senderId = this.getMessageUserId(message.sender);
        const receiverId = this.getMessageUserId(message.receiver);
        const otherUserId = senderId === this.currentUser._id ? receiverId : senderId;
        const belongsToSelectedConversation = this.selectedUser && otherUserId === this.selectedUser._id;

        this.mergeMessage(message);
        this.updateConversationPreview(message, senderId !== this.currentUser._id && !belongsToSelectedConversation);

        if (belongsToSelectedConversation && senderId !== this.currentUser._id) {
          this.socketService.markAsRead(senderId);
          this.touchContact(senderId, { unreadCount: 0 });
          this.shouldScroll = true;
        }

        this.filteredUsers = this.getVisibleContacts();
        this.cdr.detectChanges();
      })
    );

    this.subs.push(
      this.socketService.typing$.subscribe(data => {
        if (data && this.selectedUser && data.userId === this.selectedUser._id) {
          this.typingUser = `${data.username} is typing…`;
          clearTimeout(this.incomingTypingTimeout);
          this.incomingTypingTimeout = setTimeout(() => {
            this.typingUser = null;
            this.cdr.detectChanges();
          }, 2500);
          this.cdr.detectChanges();
        }
      })
    );

    this.subs.push(
      this.socketService.stoppedTyping$.subscribe(userId => {
        if (userId && this.selectedUser && userId === this.selectedUser._id) {
          this.typingUser = null;
          this.cdr.detectChanges();
        }
      })
    );

    this.subs.push(
      this.socketService.userStatus$.subscribe(data => {
        if (!data) return;
        this.contacts = this.contacts.map(contact =>
          contact._id === data.userId
            ? { ...contact, status: data.status as User['status'], lastSeen: data.lastSeen || contact.lastSeen }
            : contact
        );
        if (this.selectedUser?._id === data.userId) {
          const updated = this.contacts.find(contact => contact._id === data.userId);
          if (updated) this.selectedUser = updated;
        }
        this.filteredUsers = this.getVisibleContacts();
        this.cdr.detectChanges();
      })
    );

    this.subs.push(
      this.socketService.messagesRead$.subscribe(readBy => {
        if (!readBy || !this.currentUser) return;
        this.messages = this.messages.map(message =>
          this.getMessageUserId(message.receiver) === readBy && this.getMessageUserId(message.sender) === this.currentUser?._id
            ? { ...message, read: true, delivered: true }
            : message
        );
        this.touchContact(readBy, { unreadCount: 0 });
        this.cdr.detectChanges();
      })
    );

    this.subs.push(
      this.socketService.messageUpdated$.subscribe(message => {
        if (!message) return;
        this.mergeMessage(message, true);
        this.updateConversationPreview(message, false);
        this.cdr.detectChanges();
      })
    );

    this.subs.push(
      this.socketService.messageDelivered$.subscribe(data => {
        if (!data) return;
        this.messages = this.messages.map(message =>
          message._id === data.messageId ? { ...message, delivered: true, deliveredAt: data.deliveredAt || message.deliveredAt } : message
        );
        this.cdr.detectChanges();
      })
    );

    this.subs.push(
      this.socketService.connectionState$.subscribe(state => {
        this.connectionState = state;
        this.cdr.detectChanges();
      })
    );
  }


  isContact(userId: string): boolean {
    return this.contacts.some(contact => contact._id === userId);
  }

  toggleContact(user: User, event?: Event): void {
    event?.stopPropagation();
    const wasContact = this.isContact(user._id);
    this.chatService.addOrRemoveContact(user._id).subscribe({
      next: () => {
        this.loadContacts();
        if (!wasContact) {
          this.activeTab = 'contacts';
          setTimeout(() => {
            const refreshed = this.contacts.find(contact => contact._id === user._id);
            this.selectUser(refreshed || user);
          }, 200);
        }
      },
      error: () => this.showToast('Unable to update contacts right now.')
    });
  }

  switchTab(tab: 'contacts' | 'search'): void {
    this.activeTab = tab;
    this.searchQuery = '';
    this.filteredUsers = this.getVisibleContacts();
    if (tab === 'search') {
      this.chatService.fetchUsers().subscribe({
        next: (res) => {
          this.filteredUsers = res.users;
          this.cdr.detectChanges();
        }
      });
    }
  }

  toggleArchiveView(): void {
    this.showArchivedChats = !this.showArchivedChats;
    this.filteredUsers = this.getVisibleContacts();
  }

  onContactSearchChange(): void {
    if (this.activeTab === 'search') {
      if (!this.searchQuery.trim()) {
        this.filteredUsers = [];
        return;
      }
      this.chatService.searchUsers(this.searchQuery).subscribe({
        next: (res) => {
          this.filteredUsers = res.users;
          this.cdr.detectChanges();
        }
      });
      return;
    }

    this.filteredUsers = this.getVisibleContacts();
  }

  private getVisibleContacts(): User[] {
    const query = this.searchQuery.trim().toLowerCase();
    return this.contacts
      .filter(contact => !!contact.isArchived === this.showArchivedChats)
      .filter(contact => {
        if (!query) return true;
        return (
          contact.username.toLowerCase().includes(query) ||
          (contact.lastMessagePreview || '').toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        if (!!a.isPinned !== !!b.isPinned) {
          return a.isPinned ? -1 : 1;
        }
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bTime - aTime;
      });
  }

  selectUser(user: User): void {
    this.selectedUser = user;
    this.showMobileSidebar = false;
    this.showAttachMenu = false;
    this.showEmojiPicker = false;
    this.showForwardSheet = false;
    this.showMessageActions = false;
    this.replyingTo = null;
    this.editingMessageId = null;
    this.chatSearchQuery = '';
    this.highlightedMessageIds.clear();
    this.touchContact(user._id, { unreadCount: 0 });

    this.chatService.fetchMessages(user._id).subscribe({
      next: (res) => {
        this.messages = res.messages;
        this.socketService.markAsRead(user._id);
        this.shouldScroll = true;
        this.cdr.detectChanges();
      }
    });
  }

  closeConversation(): void {
    this.selectedUser = null;
    this.messages = [];
    this.showMobileSidebar = true;
    this.showChatInfoPanel = false;
  }

  sendMessage(): void {
    if (!this.selectedUser || !this.currentUser) return;

    const trimmed = this.messageText.trim();
    if (!trimmed) return;

    if (this.editingMessageId) {
      this.socketService.editMessage(this.editingMessageId, trimmed, (result) => {
        if (!result.success) {
          this.showToast(result.error || 'Unable to edit message.');
          return;
        }
        this.messageText = '';
        this.editingMessageId = null;
        this.replyingTo = null;
        this.cdr.detectChanges();
      });
      return;
    }

    this.socketService.sendMessage({
      receiverId: this.selectedUser._id,
      content: trimmed,
      type: 'text',
      replyToId: this.replyingTo?._id || null
    });

    this.messageText = '';
    this.replyingTo = null;
    this.showEmojiPicker = false;
    this.emitStopTyping();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  onTyping(): void {
    if (!this.selectedUser) return;
    
    const now = Date.now();
    if (now - this.lastTypingEmit > 1000) {
      this.socketService.emitTyping(this.selectedUser._id);
      this.lastTypingEmit = now;
    }

    clearTimeout(this.outgoingTypingTimeout);
    this.outgoingTypingTimeout = setTimeout(() => {
      this.emitStopTyping();
      this.lastTypingEmit = 0;
    }, 1500);
  }

  private emitStopTyping(): void {
    if (!this.selectedUser) return;
    this.socketService.emitStopTyping(this.selectedUser._id);
  }

  toggleAttachMenu(): void {
    this.showAttachMenu = !this.showAttachMenu;
    this.showEmojiPicker = false;
  }

  toggleEmojiPicker(): void {
    this.showEmojiPicker = !this.showEmojiPicker;
    this.showAttachMenu = false;
  }

  addEmoji(emoji: string): void {
    this.messageText = `${this.messageText}${emoji}`;
    this.showEmojiPicker = false;
  }

  pickFile(type: 'gallery' | 'camera' | 'docs'): void {
    const input = type === 'gallery'
      ? this.fileInputGallery
      : type === 'camera'
        ? this.fileInputCamera
        : this.fileInputDocs;

    this.showAttachMenu = false;
    input.nativeElement.value = '';
    input.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    if (!this.selectedUser) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.chatService.uploadFile(file).subscribe({
      next: (res) => {
        this.socketService.sendMessage({
          receiverId: this.selectedUser!._id,
          content: file.type.startsWith('audio/') ? 'Voice message' : '',
          type: res.type,
          fileName: res.fileName,
          fileUrl: res.fileUrl,
          fileSize: res.fileSize,
          mimeType: res.mimeType,
          replyToId: this.replyingTo?._id || null
        });
        this.replyingTo = null;
      },
      error: () => this.showToast('Upload failed. Please try again.')
    });
  }

  async toggleVoiceRecording(): Promise<void> {
    if (!this.selectedUser) return;

    if (this.isRecording) {
      this.mediaRecorder?.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.recordingError = 'Voice recording is not supported in this browser.';
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordingChunks = [];
      this.recordingSeconds = 0;
      this.recordingError = '';
      this.mediaRecorder = new MediaRecorder(stream);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordingChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(this.recordingChunks, { type: 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        const duration = this.recordingSeconds;
        clearInterval(this.recordingInterval);
        this.isRecording = false;
        this.recordingSeconds = 0;

        this.chatService.uploadFile(file).subscribe({
          next: (res) => {
            this.socketService.sendMessage({
              receiverId: this.selectedUser!._id,
              content: 'Voice message',
              type: 'audio',
              fileName: res.fileName,
              fileUrl: res.fileUrl,
              fileSize: res.fileSize,
              mimeType: res.mimeType,
              duration,
              replyToId: this.replyingTo?._id || null
            });
            this.replyingTo = null;
          },
          error: () => this.showToast('Voice message upload failed.')
        });
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordingInterval = setInterval(() => {
        this.recordingSeconds += 1;
        this.cdr.detectChanges();
      }, 1000);
    } catch {
      this.recordingError = 'Microphone permission was denied.';
    }
  }

  shareLocation(): void {
    if (!this.selectedUser) return;
    if (!navigator.geolocation) {
      this.showToast('Geolocation is not available on this device.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position: GeolocationPosition) => {
        const location: SharedLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: 'Shared current location'
        };

        this.socketService.sendMessage({
          receiverId: this.selectedUser!._id,
          content: 'Shared a location',
          type: 'location',
          location,
          replyToId: this.replyingTo?._id || null
        });
        this.replyingTo = null;
      },
      () => this.showToast('Unable to access your location.')
    );
  }

  openShareContactSheet(): void {
    this.showShareContactSheet = true;
    this.showAttachMenu = false;
  }

  shareContact(user: User): void {
    if (!this.selectedUser) return;
    const sharedContact: SharedContact = {
      user: user._id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      bio: user.bio
    };

    this.socketService.sendMessage({
      receiverId: this.selectedUser._id,
      content: `Shared contact: ${user.username}`,
      type: 'contact',
      sharedContact,
      replyToId: this.replyingTo?._id || null
    });
    this.replyingTo = null;
    this.showShareContactSheet = false;
  }

  openMessageActions(message: Message): void {
    this.activeMessage = message;
    this.showMessageActions = true;
  }

  startLongPress(message: Message): void {
    this.cancelLongPress();
    this.longPressTimer = setTimeout(() => this.openMessageActions(message), 450);
  }

  cancelLongPress(): void {
    clearTimeout(this.longPressTimer);
  }

  replyToMessage(message: Message): void {
    this.replyingTo = message;
    this.showMessageActions = false;
  }

  editMessage(message: Message): void {
    if (!this.canEditMessage(message)) return;
    this.editingMessageId = message._id;
    this.messageText = message.content;
    this.replyingTo = null;
    this.showMessageActions = false;
  }

  copyMessage(message: Message): void {
    if (!message.content) return;
    navigator.clipboard.writeText(message.content);
    this.showToast('Message copied');
    this.showMessageActions = false;
  }

  deleteMessage(message: Message): void {
    this.socketService.deleteMessage(message._id, (result) => {
      if (!result.success) {
        this.showToast(result.error || 'Unable to delete message.');
      }
    });
    this.showMessageActions = false;
  }

  openForwardSheet(message: Message): void {
    this.forwardingMessage = message;
    this.showForwardSheet = true;
    this.showMessageActions = false;
  }

  forwardMessageTo(user: User): void {
    if (!this.forwardingMessage) return;
    const message = this.forwardingMessage;
    this.socketService.sendMessage({
      receiverId: user._id,
      content: message.content,
      type: message.type,
      fileName: message.fileName,
      fileUrl: message.fileUrl,
      fileSize: message.fileSize,
      mimeType: message.mimeType,
      duration: message.duration,
      location: message.location || null,
      sharedContact: message.sharedContact || null
    });
    this.showForwardSheet = false;
    this.forwardingMessage = null;
    this.showToast(`Forwarded to ${user.username}`);
  }

  toggleReaction(message: Message, emoji: string): void {
    this.socketService.toggleReaction(message._id, emoji);
  }

  togglePinMessage(message: Message): void {
    this.socketService.togglePinMessage(message._id);
    this.showMessageActions = false;
  }

  toggleChatPreference(user: User, preference: 'isPinned' | 'isMuted' | 'isArchived'): void {
    const updates = { [preference]: !user[preference] } as Partial<Pick<User, 'isPinned' | 'isMuted' | 'isArchived'>>;
    this.chatService.updateChatPreferences(user._id, updates).subscribe({
      next: () => {
        this.touchContact(user._id, updates);
        this.filteredUsers = this.getVisibleContacts();
        if (preference === 'isArchived' && this.selectedUser?._id === user._id && updates.isArchived) {
          this.closeConversation();
        }
        this.cdr.detectChanges();
      }
    });
  }

  saveProfile(): void {
    this.chatService.updateProfile(this.profileDraft).subscribe({
      next: (res) => {
        this.currentUser = res.user;
        this.authService.updateStoredUser(res.user);
        this.seedProfileDraft(res.user);
        this.applyTheme(res.user.theme || 'dark');
        this.showToast('Profile updated');
        this.cdr.detectChanges();
      },
      error: () => this.showToast('Unable to save profile right now.')
    });
  }

  triggerAvatarInput(): void {
    this.avatarInput.nativeElement.click();
  }

  onAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.chatService.uploadFile(file).subscribe({
      next: (res) => {
        this.profileDraft.avatar = this.getFileUrl(res.fileUrl);
        this.cdr.detectChanges();
      },
      error: () => this.showToast('Avatar upload failed.')
    });
  }

  applyTheme(theme: 'dark' | 'light'): void {
    document.documentElement.setAttribute('data-theme', theme);
    this.profileDraft.theme = theme;
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  performChatSearch(): void {
    if (!this.selectedUser || !this.chatSearchQuery.trim()) {
      this.highlightedMessageIds.clear();
      return;
    }

    this.chatService.searchMessages(this.selectedUser._id, this.chatSearchQuery).subscribe({
      next: (res) => {
        this.highlightedMessageIds = new Set(res.messages.map(message => message._id));
        this.cdr.detectChanges();
      }
    });
  }

  clearReplyState(): void {
    this.replyingTo = null;
    this.editingMessageId = null;
  }

  isOwnMessage(message: Message): boolean {
    return this.getMessageUserId(message.sender) === this.currentUser?._id;
  }

  canEditMessage(message: Message): boolean {
    if (!this.isOwnMessage(message) || message.type !== 'text' || !!message.deletedForEveryone) return false;
    return Date.now() - new Date(message.createdAt).getTime() <= 15 * 60 * 1000;
  }

  hasHighlights(message: Message): boolean {
    return this.highlightedMessageIds.has(message._id);
  }

  getMessageUserId(user: User | string): string {
    return typeof user === 'string' ? user : user._id;
  }

  getUserInitial(name: string): string {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  getAvatarUrl(user: User | null): string {
    return user?.avatar || '';
  }

  getUserStatusText(user: User): string {
    if (this.onlineUserIds.includes(user._id)) return 'Online now';
    if (!user.lastSeen) return 'Offline';
    return `Last seen ${this.formatLastSeen(user.lastSeen)}`;
  }

  formatTime(date: string): string {
    return new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  formatLastSeen(date: string): string {
    return new Date(date).toLocaleString([], {
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric'
    });
  }

  formatContactTimestamp(date: string | null | undefined): string {
    if (!date) return '';
    const target = new Date(date);
    const now = new Date();
    if (target.toDateString() === now.toDateString()) {
      return target.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return target.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  formatDuration(seconds = 0): string {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  formatFileSize(bytes: number): string {
    if (!bytes) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(size > 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  formatPreview(message?: Message | null): string {
    if (!message) return 'No messages yet';
    if (message.deletedForEveryone) return 'Message deleted';
    switch (message.type) {
      case 'text':
        return message.content;
      case 'image':
        return '📷 Photo';
      case 'video':
        return '🎥 Video';
      case 'audio':
        return '🎙️ Voice message';
      case 'location':
        return '📍 Location';
      case 'contact':
        return '👤 Contact card';
      default:
        return `📎 ${message.fileName || 'Attachment'}`;
    }
  }

  messageStatus(message: Message): 'sent' | 'delivered' | 'read' {
    if (message.read) return 'read';
    if (message.delivered) return 'delivered';
    return 'sent';
  }

  shouldShowDate(index: number): boolean {
    if (index === 0) return true;
    const current = new Date(this.messages[index].createdAt).toDateString();
    const previous = new Date(this.messages[index - 1].createdAt).toDateString();
    return current !== previous;
  }

  getFileUrl(path: string): string {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    return `${environment.socketUrl}${path}`;
  }

  getReplyPreview(message: Message | null | undefined): string {
    if (!message) return '';
    return this.formatPreview(message);
  }

  getPinnedMessages(): Message[] {
    return this.messages.filter(message => message.pinned && !message.deletedForEveryone);
  }

  getSharedMedia(): Message[] {
    return this.messages.filter(message => ['image', 'video', 'audio'].includes(message.type) && !message.deletedForEveryone);
  }

  getSharedFiles(): Message[] {
    return this.messages.filter(message => ['file', 'contact', 'location'].includes(message.type) && !message.deletedForEveryone);
  }

  private mergeMessage(message: Message, updateOnly: boolean = false): void {
    const existingIndex = this.messages.findIndex(item => item._id === message._id);
    if (existingIndex >= 0) {
      this.messages = this.messages.map(item => (item._id === message._id ? message : item));
      return;
    }

    if (!updateOnly) {
      this.messages = [...this.messages, message].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      this.shouldScroll = true;
    }
  }

  private updateConversationPreview(message: Message, incrementUnread: boolean): void {
    if (!this.currentUser) return;
    const senderId = this.getMessageUserId(message.sender);
    const receiverId = this.getMessageUserId(message.receiver);
    const contactId = senderId === this.currentUser._id ? receiverId : senderId;

    this.touchContact(contactId, {
      lastMessagePreview: this.formatPreview(message),
      lastMessageAt: message.createdAt,
      unreadCount: incrementUnread ? ((this.getContact(contactId)?.unreadCount || 0) + 1) : 0
    });

    this.filteredUsers = this.getVisibleContacts();
  }

  private touchContact(contactId: string, updates: Partial<User>): void {
    this.contacts = this.contacts.map(contact =>
      contact._id === contactId ? { ...contact, ...updates } : contact
    );
    if (this.selectedUser?._id === contactId) {
      const updated = this.contacts.find(contact => contact._id === contactId);
      if (updated) this.selectedUser = updated;
    }
  }

  private getContact(contactId: string): User | undefined {
    return this.contacts.find(contact => contact._id === contactId);
  }

  private scrollToBottom(): void {
    if (!this.messagesContainer) return;
    const element = this.messagesContainer.nativeElement;
    element.scrollTop = element.scrollHeight;
  }

  private showToast(message: string): void {
    this.toastMessage = message;
    setTimeout(() => {
      if (this.toastMessage === message) {
        this.toastMessage = '';
        this.cdr.detectChanges();
      }
    }, 2200);
  }
}
