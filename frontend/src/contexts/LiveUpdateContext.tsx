import React, { createContext, useContext, useEffect, useCallback, useRef, ReactNode } from 'react';
import { initializeWebSocket, reconnectWithToken } from '../services/websocket';
import { getToken } from '../services/tokenStore';
import api from '../services/api';
import { useApp } from './AppContext';

// Live Update Event Types
export type LiveUpdateType =
  | 'dashboard'      // Konfi Dashboard (Punkte, Level, etc.)
  | 'events'         // Events Liste
  | 'event_booking'  // Einzelne Buchung
  | 'badges'         // Badges
  | 'requests'       // Gemeldete Aktivitäten
  | 'konfis'         // Admin Konfi-Liste
  | 'points'         // Punkte-Änderungen
  | 'chat'           // Chat (bereits via BadgeContext)
  | 'activities'     // Aktivitäten-Verwaltung
  | 'categories'     // Kategorien-Verwaltung
  | 'jahrgaenge'     // Jahrgänge-Verwaltung
  | 'levels'         // Level-Verwaltung
  | 'users'          // Benutzer-Verwaltung
  | 'challenges'     // Challenges (neue Beiträge, Moderations-Änderungen)
  | 'materials'      // Material-Verwaltung (Leitung und Teamer:innen)
  | 'organizations'; // Organisations-Verwaltung

export interface LiveUpdateEvent {
  type: LiveUpdateType;
  // 'submission_update'/'challenge_update' sendet challenges.js real mit —
  // useLiveRefresh wertet die action nicht aus, der Typ soll aber nicht luegen.
  action: 'refresh' | 'update' | 'delete' | 'create' | 'earned' | 'submission_update' | 'challenge_update';
  targetUserId?: number;      // Fuer welchen User
  targetUserType?: string;    // 'konfi' | 'admin'
  // Optionale Nutzdaten des Ereignisses. Der Inhalt haengt am type; die
  // Empfaenger lesen ihn gezielt und muessen ihn selbst eingrenzen.
  data?: unknown;
}

interface LiveUpdateContextType {
  // Subscribe to specific update types
  subscribe: (type: LiveUpdateType, callback: (event: LiveUpdateEvent) => void) => () => void;
  // Manually trigger a refresh (for testing/debugging)
  triggerRefresh: (type: LiveUpdateType) => void;
  // Zähler, der sich nach jedem Socket-Reconnect-mit-neuem-Token erhöht.
  // Konsumenten, die eigene socket.on(...)-Listener binden (z.B. BadgeContext),
  // müssen socketEpoch als Effect-Dependency nutzen, damit sie ihre Handler nach
  // reconnectWithToken am NEUEN Socket-Objekt neu binden — sonst hängen sie am
  // verworfenen alten Socket und empfangen keine Events mehr.
  socketEpoch: number;
}

const LiveUpdateContext = createContext<LiveUpdateContextType | undefined>(undefined);

export const LiveUpdateProvider = ({ children }: { children: ReactNode }) => {
  // AppProvider liegt aussen (siehe App.tsx) — der angemeldete Nutzer ist hier
  // also verfuegbar und dient als Ausloeser für das Binden der Handler.
  const { user } = useApp();
  const listenersRef = useRef<Map<LiveUpdateType, Set<(event: LiveUpdateEvent) => void>>>(new Map());
  const authRecoveringRef = useRef(false);
  // Erhoeht sich nach einem Socket-Reconnect mit frischem Token -> der
  // Listener-Effekt unten bindet die Event-Handler dann am NEUEN Socket neu.
  const [socketEpoch, setSocketEpoch] = React.useState(0);

  // Socket-Auth-Fehler (abgelaufenes Token) sauber auffangen, statt den Chat-Tab
  // hängen/crashen zu lassen. Ein leichter authentifizierter Call laesst den
  // api.ts-Interceptor den Token-Refresh erledigen; klappt das, verbinden wir den
  // Socket mit dem frischen Token neu. Schlaegt der Refresh fehl, feuert der
  // Interceptor selbst 'auth:relogin-required' -> sauberer Weg zum Login.
  useEffect(() => {
    const onAuthError = async () => {
      if (authRecoveringRef.current) return;
      authRecoveringRef.current = true;
      try {
        await api.get('/auth/me'); // 401 hierauf -> Interceptor refresht (oder Relogin)
        const fresh = getToken();
        if (fresh) {
          reconnectWithToken(fresh);
          setSocketEpoch((e) => e + 1); // Listener am neuen Socket neu binden
        }
      } catch {
        // Refresh endgueltig fehlgeschlagen -> Interceptor hat Relogin ausgelöst.
      } finally {
        authRecoveringRef.current = false;
      }
    };
    window.addEventListener('socket:auth-error', onAuthError);
    return () => window.removeEventListener('socket:auth-error', onAuthError);
  }, []);

  // Setup WebSocket listener
  //
  // WICHTIG: Der Effekt hängt am angemeldeten Nutzer, nicht nur an socketEpoch.
  // Startete die App ausgeloggt, gab es beim ersten Lauf keinen Token — der
  // Handler wurde nie gebunden und die GANZE Sitzung blieb ohne Live-Updates,
  // obwohl BadgeContext den Socket später aufbaute.
  // Mit user.id in den Deps bindet der Effekt nach dem Login nach; ein
  // Nutzerwechsel bindet ihn ausserdem sauber neu.
  useEffect(() => {
    const token = getToken();
    if (!token || !user?.id) return;

    const socket = initializeWebSocket(token);

    // Main handler for all live updates
    const handleLiveUpdate = (event: LiveUpdateEvent) => {
      // Notify all listeners for this type
      const typeListeners = listenersRef.current.get(event.type);
      if (typeListeners) {
        typeListeners.forEach(callback => {
          try {
            callback(event);
          } catch (error) {
 console.error('Error in live update listener:', error);
          }
        });
      }

      // Also dispatch a DOM event for components that prefer that pattern
      window.dispatchEvent(new CustomEvent(`liveUpdate:${event.type}`, { detail: event }));
    };

    // Der Server sendet ALLE Live-Updates über das einheitliche 'liveUpdate'-Event
    // (utils/liveUpdate.js). Die früher hier registrierten 13 '*Update'-Kompatibilitaets-
    // Listener (dashboardUpdate, eventsUpdate, ...) waren tot: seit dem Entfernen des
    // globalen io.emit() im Backend wurde KEINES dieser Events mehr emittiert
    // (verifiziert per grep über backend/). Ersatzlos entfernt.
    socket.on('liveUpdate', handleLiveUpdate);

    return () => {
      socket.off('liveUpdate', handleLiveUpdate);
    };
    // socketEpoch in den Deps: nach Reconnect-mit-neuem-Token werden die
    // Listener am frischen Socket neu gebunden.
  }, [socketEpoch, user?.id]);

  // Subscribe function
  const subscribe = useCallback((type: LiveUpdateType, callback: (event: LiveUpdateEvent) => void) => {
    if (!listenersRef.current.has(type)) {
      listenersRef.current.set(type, new Set());
    }
    listenersRef.current.get(type)!.add(callback);

    // Return unsubscribe function
    return () => {
      listenersRef.current.get(type)?.delete(callback);
    };
  }, []);

  // Manual trigger for testing
  const triggerRefresh = useCallback((type: LiveUpdateType) => {
    const event: LiveUpdateEvent = { type, action: 'refresh' };
    const typeListeners = listenersRef.current.get(type);
    if (typeListeners) {
      typeListeners.forEach(callback => callback(event));
    }
    window.dispatchEvent(new CustomEvent(`liveUpdate:${type}`, { detail: event }));
  }, []);

  return (
    <LiveUpdateContext.Provider value={{ subscribe, triggerRefresh, socketEpoch }}>
      {children}
    </LiveUpdateContext.Provider>
  );
};

// Hook for easy subscription
export const useLiveUpdate = () => {
  const context = useContext(LiveUpdateContext);
  if (context === undefined) {
    // Graceful fallback für Komponenten die außerhalb des Provider-Trees gerendert werden
    // (z.B. useIonModal Modals). Statt Crash: no-op Funktionen zurueckgeben.
    return {
      subscribe: () => () => {},
      triggerRefresh: () => {},
      socketEpoch: 0,
    } as LiveUpdateContextType;
  }
  return context;
};

// Convenience hook that auto-subscribes and refreshes
export const useLiveRefresh = (
  types: LiveUpdateType | LiveUpdateType[],
  onRefresh: () => void
) => {
  const { subscribe } = useLiveUpdate();

  useEffect(() => {
    const typeArray = Array.isArray(types) ? types : [types];
    const unsubscribes: (() => void)[] = [];

    typeArray.forEach(type => {
      const unsub = subscribe(type, () => {
        onRefresh();
      });
      unsubscribes.push(unsub);
    });

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [types, onRefresh, subscribe]);
};
