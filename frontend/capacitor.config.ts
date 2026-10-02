/// <reference types="@capawesome/capacitor-badge" />

import type { CapacitorConfig } from '@capacitor/cli';
// Nur der Typ: Die CLI liest diese Datei in Node, ein Wert-Import zoege das
// Plugin samt @capacitor/core mit hinein.
import type { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'de.godsapp.konfiquest',
  appName: 'Konfi Quest',
  // NUR das App-Buendel, nicht dist/.
  // dist/ ist die Web-Auslieferung und traegt Handbuch, API-Referenz,
  // Werbeseite und Rechtstexte -- bis hierher gingen davon rund 35 MB in jede
  // App, angezeigt hat sie nichts davon. `vite build` legt dist-app/ daneben
  // an (scripts/app-buendel.mjs, dort steht auch, was hinein darf). Der Name
  // muss mit APP_VERZEICHNIS dort uebereinstimmen; appBuendel.test.ts prueft
  // das.
  webDir: 'dist-app',
  // androidScheme https: WebView laeuft auf https://localhost statt http://localhost,
  // sonst blockt Android HTTPS-Calls zur API als Mixed-Content ("Keine Verbindung").
  //
  // CAP_LIVE_URL laedt die Oberflaeche zur Laufzeit vom Vite-Server statt aus dem
  // mitgelieferten Buendel -- Aenderungen am CSS sind dann sofort auf dem Geraet
  // zu sehen, ohne neu zu bauen. NUR fuer die Entwicklung:
  //
  //   CAP_LIVE_URL="http://$(scutil --get LocalHostName | tr 'A-Z' 'a-z').local:5173" \
  //     npx cap sync ios
  //
  // KLEINSCHREIBUNG IST PFLICHT: Bonjour loest den Namen
  // kleingeschrieben auf, Capacitor vergleicht den geladenen Host aber strikt
  // mit dieser Adresse. Steht hier "MacBook-Air-...", haelt die App die eigene
  // Seite fuer fremd und oeffnet sie in Safari, statt sie selbst zu laden.
  //
  // Ohne die Variable bleibt der Block unveraendert. Das ist Absicht: Eine fest
  // eingetragene Adresse wuerde in einem Store-Build auf eine tote IP im
  // Heimnetz zeigen -- die App zeigte dann bei jeder Nutzerin eine weisse Seite.
  // cleartext erlaubt dabei http:// (der Vite-Server spricht kein TLS).
  // NUR diese Plugins nativ einbinden.
  //
  // WARUM DIE LISTE NOETIG IST: @rdlabo/ionic-theme-ios27 deklariert sich in
  // seiner package.json als Capacitor-Plugin ("capacitor": {"ios": {"src":
  // "ios"}}) — das ist der experimentelle "Native UI Shell". Es liefert dafuer
  // aber nur ein Package.swift, KEINE podspec. In einem CocoaPods-Projekt wie
  // diesem bricht `npx cap sync ios` deshalb ab:
  //
  //   [!] No podspec found for `RdlaboIonicThemeIos27`
  //
  // Genau daran ist iOS-Build 220 gescheitert. Laut Theme-Doku braeuchte der
  // native Teil eine Umstellung auf SPM (`npx cap spm-migration-assistant`) —
  // ein grosser Eingriff fuer eine Funktion, die dort ausdruecklich als
  // experimentell steht und die wir nicht nutzen. Wir wollen vom Theme nur
  // CSS und die Web-Effekte, und die kommen ueber den normalen Import.
  //
  // `includePlugins` ist eine POSITIVLISTE: Was hier nicht steht, wird nicht
  // nativ eingebunden. Das hat einen zweiten Nutzen — ein neues Plugin faellt
  // beim ersten Bau auf, statt still zu fehlen. Wer eines hinzufuegt, traegt
  // es hier ein.
  includePlugins: [
    '@capacitor-community/file-opener',
    '@capacitor-firebase/crashlytics',
    '@capacitor-firebase/messaging',
    '@capacitor/app',
    '@capacitor/device',
    '@capacitor/file-viewer',
    '@capacitor/filesystem',
    '@capacitor/haptics',
    '@capacitor/keyboard',
    '@capacitor/network',
    '@capacitor/preferences',
    '@capacitor/push-notifications',
    '@capacitor/share',
    '@capacitor/status-bar',
    '@capawesome/capacitor-background-task',
    '@capawesome/capacitor-badge',
    '@capgo/capacitor-native-biometric',
  ],
  server: {
    androidScheme: 'https',
    ...(process.env.CAP_LIVE_URL
      ? { url: process.env.CAP_LIVE_URL, cleartext: true }
      : {}),
  },
  plugins: {
    // URSACHE, aus der Capacitor-8-Quelle (SystemBars.java, getStyleForTheme):
    // Das eingebaute SystemBars-Plugin richtet die Farbe der Leisten-Symbole
    // mit der Voreinstellung DEFAULT nach dem THEMA DES TELEFONS. Telefon
    // dunkel -> weisse Symbole. Solange die App immer hell war, stand hier
    // deshalb fest LIGHT (dunkle Symbole).
    SystemBars: {
      style: 'DEFAULT',
    },
    Keyboard: {
      // 'ionic' (Ionic passt Padding an). 'native' wurde am 04.07. probiert
      // (Build 76) und sah SCHLECHTER aus (WebView-Frame springt unanimiert).
      // Das eigentliche Problem "Tastatur klappt nach Senden zu" war ein
      // Fokus-Verlust im Send-Flow, nicht der Resize-Modus.
      // In der Datei steht nur der Wert des Enums KeyboardResize.Ionic.
      resize: 'ionic' as KeyboardResize,
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
