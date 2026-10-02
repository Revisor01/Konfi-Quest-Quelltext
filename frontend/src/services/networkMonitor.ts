import { Network } from '@capacitor/network';
import { Capacitor } from '@capacitor/core';
import { API_BASE_URL } from './apiBasis';

// Modul-Level State (Singleton-Pattern wie websocket.ts)
let _isOnline: boolean = true; // Optimistisch starten
let _initialized = false;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

type NetworkListener = (isOnline: boolean) => void;
const _listeners: Set<NetworkListener> = new Set();

function notifyListeners() {
  _listeners.forEach(fn => fn(_isOnline));
}

// Online-Auswertung auf dem Gerät.
//
// Jetzt entscheidet in diesem unsicheren Fall eine echte Probe an /health:
// Kommt irgendeine Antwort (auch 503 beim Neustart), ist Netz da — der
// Play-Fall bleibt online. Kommt keine, ist die App offline, und die Probe
// wiederholt sich im Abstand PROBE_ABSTAND_MS, bis Netz da ist oder das Plugin
// wieder eine Verbindung meldet. 'no-cors': Es zählt nur, OB eine Antwort
// kommt; der Inhalt wird nicht gelesen, CORS spielt keine Rolle.
const PROBE_ABSTAND_MS = 15_000;
const PROBE_ZEITLIMIT_MS = 4_000;
let _probeTimer: ReturnType<typeof setTimeout> | null = null;
// Jede Auswertung bekommt eine Nummer; eine ältere Probe, die nach einer
// neueren Statusmeldung zurückkommt, darf deren Ergebnis nicht überschreiben.
let _auswertung = 0;

function unsicher(status: { connected: boolean; connectionType?: string }): boolean {
  return !status.connected && (status.connectionType === 'none' || status.connectionType === 'unknown');
}

async function serverAntwortet(): Promise<boolean> {
  const abbruch = new AbortController();
  const zeitlimit = setTimeout(() => abbruch.abort(), PROBE_ZEITLIMIT_MS);
  try {
    await fetch(`${API_BASE_URL}/health`, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: abbruch.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(zeitlimit);
  }
}

function probeStoppen() {
  if (_probeTimer) clearTimeout(_probeTimer);
  _probeTimer = null;
}

function setzen(online: boolean) {
  if (online === _isOnline) return;
  _isOnline = online;
  notifyListeners();
}

async function proben(nummer: number): Promise<void> {
  const online = await serverAntwortet();
  if (nummer !== _auswertung) return;
  setzen(online);
  probeStoppen();
  if (!online) _probeTimer = setTimeout(() => { void proben(nummer); }, PROBE_ABSTAND_MS);
}

async function auswerten(status: { connected: boolean; connectionType?: string }): Promise<void> {
  const nummer = ++_auswertung;
  probeStoppen();
  if (unsicher(status)) {
    await proben(nummer);
    return;
  }
  setzen(status.connected);
}

async function initNetworkMonitor(): Promise<void> {
  if (_initialized) return;

  try {
    if (Capacitor.isNativePlatform()) {
      // Initialen Status abfragen
      await auswerten(await Network.getStatus());

      // Listener für Status-Änderungen
      Network.addListener('networkStatusChange', (status) => {
        if (_debounceTimer) clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => { void auswerten(status); }, 300);
      });
    }
  } catch {
    console.warn('Capacitor Network Plugin nicht verfügbar, nutze Web-Fallback');
  }

  // Web-Fallback (für Browser-Dev und falls Capacitor-Plugin nicht verfügbar)
  if (!Capacitor.isNativePlatform()) {
    _isOnline = navigator.onLine;

    window.addEventListener('online', () => {
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        _isOnline = true;
        notifyListeners();
      }, 300);
    });

    window.addEventListener('offline', () => {
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        _isOnline = false;
        notifyListeners();
      }, 300);
    });
  }

  _initialized = true;
}

function subscribe(fn: NetworkListener): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

export const networkMonitor = {
  get isOnline() { return _isOnline; },
  subscribe,
  init: initNetworkMonitor,
};
