import { Injectable } from '@angular/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private hasPermission = false;

  constructor() {
    this.init();
  }

  async init() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const res = await LocalNotifications.requestPermissions();
      this.hasPermission = res.display === 'granted';
    } catch (e) {
      console.log('Local notifications not supported on this platform.');
    }
  }

  async showMessageNotification(title: string, body: string, messageId: string) {
    if (!this.hasPermission || !Capacitor.isNativePlatform()) return;
    
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            title: title,
            body: body,
            id: new Date().getTime(),
            schedule: { at: new Date(Date.now() + 100) },
            actionTypeId: '',
            extra: { messageId }
          }
        ]
      });
    } catch (e) {
      console.error('Error showing notification', e);
    }
  }
}
