import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chitchat.app',
  appName: 'ChitChat',
  webDir: 'dist/client/browser',
  server: {
    cleartext: true,
    androidScheme: 'https',
    url: 'https://real-time-chat-application-interface.onrender.com'
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#070b13',
    webContentsDebuggingEnabled: false
  },
  plugins: {
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true
    },
    StatusBar: {
      overlaysWebView: false,
      backgroundColor: '#070b13',
      style: 'DARK'
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: '#070b13',
      showSpinner: false
    }
  }
};

export default config;

