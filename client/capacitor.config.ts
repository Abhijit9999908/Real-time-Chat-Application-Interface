import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chitchat.app',
  appName: 'Real-time Chat Application Interface',
  webDir: 'dist/client/browser',
  server: {
    cleartext: true
  }
};

export default config;
