/// <reference types="@capawesome/capacitor-badge" />

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.godsapp.konfiquest',
  appName: 'konfipoints-clean',
  webDir: 'dist',
  plugins: {
    Keyboard: {
      resize: 'ionic'
    },
    Badge: {
      persist: true,
      autoClear: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    FCM: {
      // Native FCM Plugin für APNS/FCM Token Management
    }
  }
};

export default config;
