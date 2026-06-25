import { Network } from '@capacitor/network';
import { Capacitor } from '@capacitor/core';

// Modul-Level State (Singleton-Pattern wie websocket.ts)
let _isOnline: boolean = true; // Optimistisch starten
let _initialized = false;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

type NetworkListener = (isOnline: boolean) => void;
const _listeners: Set<NetworkListener> = new Set();

function notifyListeners() {
  _listeners.forEach(fn => fn(_isOnline));
}

// Robuste Online-Auswertung: Manche Plattformen (v.a. Android-Emulatoren,
// teils auch echte Geraete) melden connected=false bei connectionType='unknown',
// obwohl Netz vorhanden ist. In diesem Fall optimistisch online bleiben — sonst
// blockt die App den Login VOR dem ersten Request ("Keine Verbindung").
function evaluateOnline(status: { connected: boolean; connectionType?: string }): boolean {
  if (status.connectionType === 'unknown') return true;
  return status.connected;
}

async function initNetworkMonitor(): Promise<void> {
  if (_initialized) return;

  try {
    // Initialen Status abfragen
    const status = await Network.getStatus();
    _isOnline = evaluateOnline(status);

    // Listener für Status-Änderungen
    Network.addListener('networkStatusChange', (status) => {
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        _isOnline = evaluateOnline(status);
        notifyListeners();
      }, 300);
    });
  } catch (err) {
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
