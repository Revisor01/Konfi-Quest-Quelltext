// WOFUER: Der Betrieb braucht einen Weg, allen Geraeten etwas zu sagen —
// "diese Version wird nicht mehr unterstuetzt" oder "heute Abend Wartung".
// Der Server liefert dafuer in derselben Antwort wie den Store-Hinweis
// (services/updateCheck.ts) zwei zusaetzliche Angaben, gesetzt ueber
// Umgebungsvariablen (backend/utils/betriebshinweise.js):
//   ios/android.min_version  "2.3.0" | null
//   wartung                  { aktiv: boolean, text: string | null }
//
// WAS DARAUS WIRD:
//   - Liegt die INSTALLIERTE Version (App.getInfo, wie beim Store-Hinweis)
//     echt unter der Mindestversion der eigenen Plattform, steht
//     `aktualisierenUrl` auf der Store-Seite — und MindestversionHinweis
//     (components/common) bittet in einem Dialog um das Update.
//   - Ist wartung.aktiv, steht der Text in `wartungstext` — WartungsHinweis
//     (components/shared) zeigt ihn auf den Startseiten und der Anmeldung.
//
// WANN GEPRUEFT WIRD: beim Start und bei jeder Rueckkehr in die App
// (appStateChange mit isActive). Der Store-Hinweis prueft nur beim Start —
// hier reicht das nicht: Ein Wartungshinweis soll verschwinden, sobald der
// Server ihn nicht mehr meldet, und eine Mindestversion greifen, ohne dass
// jemand die App erst beenden muss. Beim Wegwechseln wird nicht gefragt.
//
// NUR AUF ENTSCHEIDUNG DES BETRIEBS: Ohne gesetzte Mindestversion bleibt es
// beim reinen Store-Hinweis (updateCheck.ts). Der Hinweis fuehrt
// ausschliesslich zur Store-Seite der App. Wer eine Mindestversion setzt,
// setzt sie nie hoeher als die Version, die in BEIDEN Stores freigegeben
// ist — sonst bittet die App um ein Update, das es fuer das Geraet noch gar
// nicht gibt.

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import api from './api';
import { networkMonitor } from './networkMonitor';
import { istNeuereVersion } from '../utils/versionVergleich';

export interface Betriebsstatus {
  /** Store-Seite, wenn die installierte Version unter der Mindestversion liegt — sonst null. */
  aktualisierenUrl: string | null;
  /** Wartungshinweis des Servers als Klartext — oder null. */
  wartungstext: string | null;
}

const LEER: Betriebsstatus = { aktualisierenUrl: null, wartungstext: null };

// Modul-Level-Stand wie networkMonitor: Die App haengt EINE Pruefung an
// (App.tsx), der Mindestversions-Hinweis und die Wartungshinweise lesen
// denselben Stand.
let stand: Betriebsstatus = LEER;
const zuhoerer = new Set<() => void>();
let laufendePruefung: Promise<void> | null = null;
// Siehe merkeMindestversionHinweisGezeigt.
let mindestversionHinweisGezeigt = false;

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === 'object' && wert !== null && !Array.isArray(wert);
}

function wartungstextAus(daten: Record<string, unknown>): string | null {
  const wartung = daten.wartung;
  if (!istObjekt(wartung) || wartung.aktiv !== true || typeof wartung.text !== 'string') return null;
  const text = wartung.text.trim();
  return text ? text : null;
}

async function aktualisierenUrlAus(daten: Record<string, unknown>): Promise<string | null> {
  // Im Browser nie — dort gibt es nichts zu aktualisieren.
  if (!Capacitor.isNativePlatform()) return null;
  const plattform = Capacitor.getPlatform();
  const eintrag = plattform === 'android' ? daten.android : plattform === 'ios' ? daten.ios : null;
  if (!istObjekt(eintrag)) return null;
  const { min_version: mindestversion, url } = eintrag;
  if (typeof mindestversion !== 'string' || typeof url !== 'string') return null;
  // Nur eine echte Store-Seite: Der Knopf oeffnet sie per window.open.
  if (!url.startsWith('https://')) return null;
  const { version: installiert } = await App.getInfo();
  // istNeuereVersion prueft beide Werte auf die Versionsform und vergleicht
  // segmentweise (2.10.0 > 2.9.0). Gleichstand ist kein Grund fuer den Hinweis.
  return istNeuereVersion(mindestversion, installiert) ? url : null;
}

/** Fragt den Server; null heisst "nichts erfahren" (offline, Fehler, Unsinn). */
async function frageServer(): Promise<Betriebsstatus | null> {
  // Offline: nicht anfragen (axios wuerde sonst dreimal wiederholen).
  if (!networkMonitor.isOnline) return null;
  const antwort = await api.get('/app-version');
  const daten = antwort?.data;
  if (!istObjekt(daten)) return null;
  return {
    aktualisierenUrl: await aktualisierenUrlAus(daten),
    wartungstext: wartungstextAus(daten),
  };
}

function setzeStand(neu: Betriebsstatus): void {
  // Gleicher Inhalt -> gleiche Referenz behalten: useSyncExternalStore
  // rendert sonst bei jeder Rueckkehr in die App ohne Grund neu.
  if (neu.aktualisierenUrl === stand.aktualisierenUrl && neu.wartungstext === stand.wartungstext) return;
  stand = neu;
  zuhoerer.forEach((fn) => fn());
}

/**
 * Fragt einmal beim Server nach und aktualisiert den Stand. Wirft nie;
 * laeuft schon eine Pruefung, wird sie mitbenutzt.
 */
export function pruefeBetriebsstatus(): Promise<void> {
  if (!laufendePruefung) {
    laufendePruefung = frageServer()
      .then((ergebnis) => { if (ergebnis) setzeStand(ergebnis); })
      .catch(() => { /* Fehler sind still: der Stand bleibt */ })
      .finally(() => { laufendePruefung = null; });
  }
  return laufendePruefung;
}

/** Der aktuelle Stand (fuer useSyncExternalStore). */
export function holeBetriebsstatus(): Betriebsstatus {
  return stand;
}

/**
 * Merkt fuer diesen App-Start, dass der Hinweis "Bitte aktualisiere Konfi
 * Quest" gezeigt wurde; bis zum naechsten Start erscheint er nicht wieder.
 *
 * WARUM BIS ZUM NAECHSTEN START — nur im Speicher, nicht in Preferences:
 *   - Nicht bei jeder Rueckkehr in die App: Geprueft wird zwar dann (siehe
 *     oben), aber ein Dialog nach jedem Wechsel zu einer anderen App waere
 *     Zwang durch Zermuerbung — genau das, was "Keine Zwangsupdates"
 *     ausschliesst.
 *   - Nicht dauerhaft: Dann hiesse "Später" in Wahrheit "nie". Der Betrieb
 *     setzt eine Mindestversion, weil die alte Fassung wirklich gehen soll;
 *     beim naechsten Start darf die App deshalb wieder fragen. iOS und
 *     Android beenden eine App im Hintergrund frueher oder spaeter ohnehin —
 *     "Später" heisst damit tatsaechlich spaeter.
 *   - Nicht je Anmeldung: Ab- und Anmelden aendert die installierte Version
 *     nicht, und der Hinweis erscheint schon auf der Anmeldeseite. Wer ihn
 *     dort weggetippt hat, bekommt ihn nach der Anmeldung nicht noch einmal.
 * Eine Mindestversion, die der Betrieb waehrend der Sitzung anhebt, fragt
 * ebenfalls erst beim naechsten Start — die Bitte ist dieselbe.
 * Dazwischen erinnert die blaue Store-Karte auf der Startseite
 * (StoreUpdateBanner), solange sie fuer diese Version nicht weggetippt ist.
 */
export function merkeMindestversionHinweisGezeigt(): void {
  mindestversionHinweisGezeigt = true;
}

/** true, wenn der Hinweis in diesem App-Start schon gezeigt wurde. */
export function mindestversionHinweisSchonGezeigt(): boolean {
  return mindestversionHinweisGezeigt;
}

/** Meldet Aenderungen des Stands; gibt die Abmeldung zurueck. */
export function abonniereBetriebsstatus(fn: () => void): () => void {
  zuhoerer.add(fn);
  return () => { zuhoerer.delete(fn); };
}

/**
 * Prueft jetzt und bei jeder Rueckkehr in die App. Genau einmal fuer die
 * ganze App einhaengen (App.tsx); gibt das Aufraeumen zurueck.
 */
export function beobachteBetriebsstatus(): () => void {
  void pruefeBetriebsstatus();
  let beendet = false;
  let entfernen: (() => Promise<void>) | null = null;
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void pruefeBetriebsstatus();
  })
    .then((handle) => {
      if (beendet) void handle.remove();
      else entfernen = () => handle.remove();
    })
    .catch(() => { /* Ohne Zuhoerer bleibt es bei der Pruefung beim Start */ });
  return () => {
    beendet = true;
    if (entfernen) void entfernen();
  };
}

// Nur fuer Tests: Stand wie nach einem frischen Start.
export function _nurFuerTests_reset(): void {
  stand = LEER;
  zuhoerer.clear();
  laufendePruefung = null;
  mindestversionHinweisGezeigt = false;
}
