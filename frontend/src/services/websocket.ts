import { io, Socket } from 'socket.io-client';
import { writeQueue } from './writeQueue';
import { offlineCache } from './offlineCache';

const WS_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api$/, '')
  : 'https://konfi-quest.de';

let socket: Socket | null = null;

// Reconnect-Callback-System: Benachrichtigt Listener bei Socket-Reconnect
type ReconnectCallback = () => void;
const reconnectCallbacks: Set<ReconnectCallback> = new Set();
let _hasConnectedOnce = false;

export const onReconnect = (callback: ReconnectCallback): (() => void) => {
  reconnectCallbacks.add(callback);
  return () => { reconnectCallbacks.delete(callback); };
};

export const initializeWebSocket = (token: string): Socket => {
  // Prüfen ob Socket bereits existiert (auch wenn noch nicht connected)
  if (socket) {
    return socket;
  }

  socket = io(WS_URL, {
    auth: { token },
    transports: ['websocket', 'polling'], // WebSocket zuerst, dann Polling als Fallback
    upgrade: true,
    reconnection: true,
    // Unbegrenzt weiterversuchen: Ein Deploy-Downtime-Fenster (~20-40s) hat die
    // vorher gedeckelten 10 Versuche endgueltig verbrannt — danach blieb der Socket
    // tot bis zum App-Neustart. reconnectionDelayMax deckelt den exponentiellen
    // Backoff bei 30s, sodass dauerhaft (aber ohne Haemmern) neu verbunden wird.
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    timeout: 20000,
  });

  socket.on('connect', () => {
    if (_hasConnectedOnce) {
      // Koordinierte Sync-Sequenz: flush -> invalidate -> badges -> callbacks
      (async () => {
        try {
          // 1. Queue flushen (Server-State aktuell machen)
          await writeQueue.flush();
          // 2. Cache invalidieren (stale markieren für Revalidierung)
          await offlineCache.invalidateAll();
          // 3. Badge-Refresh via CustomEvent (BadgeContext hoert darauf)
          window.dispatchEvent(new CustomEvent('sync:reconnect'));
        } catch (e) {
          console.error('Reconnect sync error:', e);
        }
        // 4. Bestehende Reconnect-Callbacks (Chat-Nachladen etc.)
        reconnectCallbacks.forEach(cb => {
          try { cb(); } catch (e) { console.error('Reconnect callback error:', e); }
        });
      })();
    }
    _hasConnectedOnce = true;
  });

  socket.on('disconnect', (reason) => {
    console.warn('WebSocket getrennt:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('WebSocket connection error:', error.message);
    // Abgelaufenes/ungueltiges Token: Server lehnt den Handshake mit einer
    // Auth-Meldung ab ("jwt expired" / "Authentifizierung fehlgeschlagen" o.ae.).
    // Ohne API-Call zu diesem Zeitpunkt wuerde sonst niemand den Token-Refresh
    // ausloesen — der Chat-Tab haengt dann scheinbar grundlos. Wir stossen den
    // zentralen Refresh-/Relogin-Flow an (api.ts -> auth:relogin-required).
    const msg = (error?.message || '').toLowerCase();
    if (msg.includes('jwt') || msg.includes('token') || msg.includes('auth') || msg.includes('unauthorized')) {
      window.dispatchEvent(new CustomEvent('socket:auth-error'));
    }
  });

  socket.on('reconnect_attempt', (attempt) => {
    console.warn('WebSocket reconnect attempt:', attempt);
  });

  return socket;
};

export const getSocket = (): Socket | null => socket;

// Erzwingt einen Reconnect-Versuch, wenn der Socket existiert aber getrennt ist.
// Wird beim Wiedererlangen der Netzwerkverbindung (online-Event) aufgerufen:
// nach einem Netzwerkwechsel haengt socket.io manchmal im getrennten Zustand,
// ohne von selbst neu zu verbinden. connect() stoesst das aktiv an.
export const ensureSocketConnected = (): void => {
  if (socket && !socket.connected) {
    socket.connect();
  }
};

export const disconnectWebSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  _hasConnectedOnce = false;
};

// Socket mit frischem Token neu aufbauen (nach erfolgreichem Token-Refresh).
// Der alte Socket wird verworfen, damit die Listener im LiveUpdateContext beim
// naechsten initializeWebSocket sauber neu gebunden werden.
export const reconnectWithToken = (token: string): void => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  _hasConnectedOnce = false;
  initializeWebSocket(token);
};

export const joinRoom = (roomId: number) => {
  if (socket?.connected) {
    socket.emit('joinRoom', roomId);
  }
};

export const leaveRoom = (roomId: number) => {
  if (socket?.connected) {
    socket.emit('leaveRoom', roomId);
  }
};
