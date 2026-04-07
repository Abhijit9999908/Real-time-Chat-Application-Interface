import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { User, Message, MessagesResponse } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private selectedUserSubject = new BehaviorSubject<User | null>(null);
  private messagesSubject = new BehaviorSubject<Message[]>([]);
  private usersSubject = new BehaviorSubject<User[]>([]);

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
    return this.http.get<{ users: User[] }>(`${environment.apiUrl}/users/search?q=${query}`);
  }

  fetchContacts(): Observable<{ contacts: User[] }> {
    return this.http.get<{ contacts: User[] }>(`${environment.apiUrl}/users/contacts`);
  }

  addOrRemoveContact(userId: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${environment.apiUrl}/users/contacts/${userId}`, {});
  }

  setUsers(users: User[]): void {
    this.usersSubject.next(users);
  }

  updateUserStatus(userId: string, status: string): void {
    const users = this.usersSubject.value.map(u =>
      u._id === userId ? { ...u, status: status as User['status'] } : u
    );
    this.usersSubject.next(users);
  }

  fetchMessages(userId: string, page: number = 1): Observable<MessagesResponse> {
    return this.http.get<MessagesResponse>(`${environment.apiUrl}/messages/${userId}?page=${page}&limit=50`);
  }

  setMessages(messages: Message[]): void {
    this.messagesSubject.next(messages);
  }

  addMessage(message: Message): void {
    const current = this.messagesSubject.value;
    // Avoid duplicates
    if (!current.find(m => m._id === message._id)) {
      this.messagesSubject.next([...current, message]);
    }
  }

  uploadFile(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${environment.apiUrl}/messages/upload`, formData);
  }
}
