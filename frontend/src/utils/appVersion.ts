// appVersion.ts — liefert die LAUFENDE App-Version als String ('2.2.0').
//
// Zwei Quellen, in dieser Reihenfolge:
// 1. Auf dem Geraet: App.getInfo() -- also CFBundleShortVersionString (iOS)
//    bzw. versionName (Android). Das ist die tatsaechlich installierte
//    Version. Genau diese Quelle nutzt auch der Store-Update-Hinweis
//    (services/updateCheck.ts), und aus demselben Grund: version.json
//    beschreibt, was gebaut WUERDE, nicht was laeuft. Wer im Store noch auf
//    2.1.1 steht, soll den 2.2-Hinweis auch erst nach dem Update sehen.
// 2. Im Browser: der zur Bauzeit eingesetzte Wert aus version.json
//    (__APP_VERSION__, siehe vite.config.ts). Dort gibt es kein
//    App.getInfo(), und der ausgelieferte Web-Build IST die laufende Version.
//
// Wirft nie: Schlaegt beides fehl, kommt null zurueck, und die
// Aenderungsanzeige unterbleibt (siehe utils/neuerungenGate.ts).

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

export async function ermittleAppVersion(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const info = await App.getInfo();
      return info?.version ?? null;
    } catch {
      // Plugin nicht verfuegbar -> auf den Bauzeit-Wert zurueckfallen.
    }
  }
  return typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : null;
}
