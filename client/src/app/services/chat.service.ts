import { Injectable } from '@angular/core';
import { HttpClient, HttpRequest, HttpEventType } from '@angular/common/http';
import { BehaviorSubject, Observable, filter, map, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { Message, MessagesResponse, PrivacySettings, User } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private selectedUserSubject = new BehaviorSubject<User | null>(null);
  private messagesSubject = new BehaviorSubject<Message[]>([]);
  private usersSubject = new BehaviorSubject<User[]>([]);
  uploadProgress$ = new BehaviorSubject<number>(0);

  selectedUser$ = this.selectedUserSubject.asObservable();
  messages$ = this.messagesSubject.asObservable();
  users$ = this.usersSubject.asObservable();

  constructor(private http: HttpClient) {}

  get selectedUser(): User | null {
    return this.selectedUserSubject.value;
  }

  get currentMessages(): Message[] {
    return this.messagesSubject.value;
  }

  selectUser(user: User): void {
    this.selectedUserSubject.next(user);
  }

  clearSelection(): void {
    this.selectedUserSubject.next(null);
    this.messagesSubject.next([]);
  }

  fetchUsers(): Observable<{ users: User[] }> {
    return this.http.get<{ users: User[] }>(`${environment.apiUrl}/users`);
  }

  searchUsers(query: string): Observable<{ users: User[] }> {
    return this.http.get<{ users: User[] }>(`${environment.apiUrl}/users/search?q=${encodeURIComponent(query)}`);
  }

  fetchContacts(): Observable<{ contacts: User[] }> {
    return this.http.get<{ contacts: User[] }>(`${environment.apiUrl}/users/contacts`);
  }

  addOrRemoveContact(userId: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${environment.apiUrl}/users/contacts/${userId}`, {});
  }

  updateChatPreferences(userId: string, prefs: Partial<Pick<User, 'isMuted' | 'isArchived' | 'isPinned'>>): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${environment.apiUrl}/users/contacts/${userId}/preferences`, {
      muted: prefs.isMuted,
      archived: prefs.isArchived,
      pinned: prefs.isPinned
    });
  }

  fetchProfile(): Observable<{ user: User }> {
    return this.http.get<{ user: User }>(`${environment.apiUrl}/users/profile`);
  }

  updateProfile(data: {
    username?: string;
    avatar?: string;
    bio?: string;
    theme?: 'dark' | 'light';
    wallpaper?: string;
    privacy?: PrivacySettings;
  }): Observable<{ user: User }> {
    return this.http.patch<{ user: User }>(`${environment.apiUrl}/users/profile`, data);
  }

  setUsers(users: User[]): void {
    this.usersSubject.next(users);
  }

  fetchMessages(userId: string, page: number = 1): Observable<MessagesResponse> {
    return this.http.get<MessagesResponse>(`${environment.apiUrl}/messages/${userId}?page=${page}&limit=50`);
  }

  searchMessages(userId: string, query: string): Observable<{ messages: Message[] }> {
    return this.http.get<{ messages: Message[] }>(`${environment.apiUrl}/messages/search/${userId}?q=${encodeURIComponent(query)}`);
  }

  setMessages(messages: Message[]): void {
    this.messagesSubject.next(messages);
  }

  uploadFile(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    this.uploadProgress$.next(0);

    const req = new HttpRequest('POST', `${environment.apiUrl}/messages/upload`, formData, {
      reportProgress: true
    });

    return this.http.request(req).pipe(
      tap((event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const progress = event.total ? Math.round((100 * event.loaded) / event.total) : 0;
          this.uploadProgress$.next(progress);
        } else if (event.type === HttpEventType.Response) {
          this.uploadProgress$.next(100);
        }
      }),
      filter((event) => event.type === HttpEventType.Response),
      map((event: any) => event.body)
    );
  }
}
