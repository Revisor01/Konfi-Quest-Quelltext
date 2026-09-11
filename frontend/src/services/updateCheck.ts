// ABLAUF: Der Backend-Endpunkt GET /api/app-version meldet die aktuell im
// Store VEROEFFENTLICHTE Version (Quelle: iTunes-Lookup, gecacht — Details
// und Begruendung in backend/utils/storeVersion.js). Verglichen wird gegen
// die tatsaechlich installierte Version (App.getInfo, also
// CFBundleShortVersionString bzw. versionName), NICHT gegen version.json —
// die beschreibt nur, was gebaut wuerde, nicht was installiert ist.

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import api from './api';
import { networkMonitor } from './networkMonitor';
import { istNeuereVersion } from '../utils/versionVergleich';

export interface StoreUpdateInfo {
  /** Die im Store veroeffentlichte, neuere Version (z.B. "2.2.0"). */
  version: string;
  /** Store-Seite der App auf der jeweiligen Plattform. */
  url: string;
}

// Wegklicken haftet PRO VERSION, nicht fuer immer: Wer den Hinweis auf 2.2.0
// wegklickt, sieht ihn erst wieder, wenn 2.3.0 erscheint. Geraetelokal ohne
// Account-Suffix — ein App-Update betrifft das Geraet, nicht den Account.
const WEGGEKLICKT_PREFIX = 'store_update_hinweis_weggeklickt_';

// Einmal pro App-Start pruefen (Modul-Level-Memo wie networkMonitor):
// Der Banner haengt auf allen drei Dashboards; ohne Memo wuerde jede
// Tab-Rueckkehr einen Request ausloesen. Bewusst KEIN Neuversuch innerhalb
// der Session, wenn die erste Pruefung offline war — der Hinweis ist dezent,
// beim naechsten App-Start klappt es.
let laufendePruefung: Promise<StoreUpdateInfo | null> | null = null;

async function fuehrePruefungAus(): Promise<StoreUpdateInfo | null> {
  // Im Browser gibt es nichts zu aktualisieren — dort laeuft immer der
  // zuletzt deployte Web-Build.
  if (!Capacitor.isNativePlatform()) return null;
  // Offline: nicht anfragen, nicht stoeren (axios wuerde sonst 3x retryen).
  if (!networkMonitor.isOnline) return null;

  const appInfo = await App.getInfo();
  const antwort = await api.get('/app-version');
  const plattform = Capacitor.getPlatform(); // 'ios' | 'android'
  const eintrag = plattform === 'android' ? antwort.data?.android : antwort.data?.ios;
  if (!eintrag || typeof eintrag.version !== 'string' || typeof eintrag.url !== 'string') {
    return null;
  }
  if (!istNeuereVersion(eintrag.version, appInfo.version)) return null;
  return { version: eintrag.version, url: eintrag.url };
}

/**
 * Liefert die neuere Store-Version samt Store-URL — oder null, wenn es
 * nichts hinzuweisen gibt. Wirft nie, fragt hoechstens einmal pro App-Start.
 */
export function pruefeStoreUpdate(): Promise<StoreUpdateInfo | null> {
  if (!laufendePruefung) {
    laufendePruefung = fuehrePruefungAus().catch(() => null);
  }
  return laufendePruefung;
}

/** true, wenn der Hinweis auf GENAU diese Version schon weggeklickt wurde. */
export async function istHinweisWeggeklickt(version: string): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: WEGGEKLICKT_PREFIX + version });
    return value === '1';
  } catch {
    // Preferences kaputt -> lieber keinen Hinweis zeigen als einen, der
    // sich nicht dauerhaft wegklicken laesst.
    return true;
  }
}

/** Merkt das Wegklicken dauerhaft (pro Version, geraetelokal). */
export async function merkeHinweisWeggeklickt(version: string): Promise<void> {
  try {
    await Preferences.set({ key: WEGGEKLICKT_PREFIX + version, value: '1' });
  } catch {
    /* Preferences nicht verfuegbar -> Hinweis kommt beim naechsten Start erneut */
  }
}

// Nur fuer Tests: Session-Memo zuruecksetzen.
export function _nurFuerTests_reset(): void {
  laufendePruefung = null;
}
