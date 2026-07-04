/// <reference types="@capawesome/capacitor-badge" />

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.godsapp.konfiquest',
  appName: 'Konfi Quest',
  webDir: 'dist',
  // androidScheme https: WebView laeuft auf https://localhost statt http://localhost,
  // sonst blockt Android HTTPS-Calls zur API als Mixed-Content ("Keine Verbindung").
  server: {
    androidScheme: 'https',
  },
  plugins: {
    Keyboard: {
      // 'ionic' (Ionic passt Padding an). 'native' wurde am 04.07. probiert
      // (Build 76) und sah SCHLECHTER aus (WebView-Frame springt unanimiert).
      // Das eigentliche Problem "Tastatur klappt nach Senden zu" war ein
      // Fokus-Verlust im Send-Flow, nicht der Resize-Modus.
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
