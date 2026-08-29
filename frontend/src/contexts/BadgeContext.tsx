import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback, useMemo } from 'react';
import { Badge } from '@capawesome/capacitor-badge';
import { Capacitor } from '@capacitor/core';
import api from '../services/api';
import { writeQueue } from '../services/writeQueue';
import { networkMonitor } from '../services/networkMonitor';
import { initializeWebSocket, getSocket } from '../services/websocket';
import { getToken } from '../services/tokenStore';
import { removeDeliveredForChatRoom } from '../services/notifications';
import { useApp } from './AppContext';
import { useLiveRefresh, useLiveUpdate, LiveUpdateType } from './LiveUpdateContext';

// Stabiles Array (Modul-Ebene) -> useLiveRefresh re-subscribt nicht bei jedem Render.
const BADGE_LIVE_TYPES: LiveUpdateType[] = ['requests', 'events', 'challenges'];

// Badge Context Interface
interface BadgeContextType {
  // Chat
  chatUnreadByRoom: Record<number, number>;
  chatUnreadTotal: number;
  // Admin-only
  pendingRequestsCount: number;
  pendingEventsCount: number;
  // Leitung (Admin + Teamer): offene Challenge-Freigaben
  pendingChallengesCount: number;
  /** Ungesehene Abzeichen (Konfis und Teamer:innen). Die Leitung kann keine verdienen -> immer 0. */
  newBadgesCount: number;
  // Gesamt (Role-abhaengig)
  totalBadgeCount: number;
  // Actions
  refreshAllCounts: () => Promise<void>;
  markRoomAsRead: (roomId: number) => void;
  // Legacy Alias (Abwaertskompatibilitaet)
  badgeCount: number;
  refreshFromAPI: () => Promise<void>;
}

// Create Context
const BadgeContext = createContext<BadgeContextType | undefined>(undefined);

// Badge Provider Component
export const BadgeProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useApp();
  // Erhoeht sich nach Socket-Reconnect-mit-neuem-Token (LiveUpdateContext). Als
  // Dependency des newMessage-Effekts unten nötig, damit der Listener nach
  // reconnectWithToken am NEUEN Socket-Objekt neu gebunden wird (der alte Socket
  // wurde verworfen -> ohne Neubindung kaeme kein 'newMessage' mehr an).
  const { socketEpoch } = useLiveUpdate();

  const [chatUnreadByRoom, setChatUnreadByRoom] = useState<Record<number, number>>({});
  const [chatUnreadTotal, setChatUnreadTotal] = useState(0);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [pendingEventsCount, setPendingEventsCount] = useState(0);
  const [pendingChallengesCount, setPendingChallengesCount] = useState(0);
  const [newBadgesCount, setNewBadgesCount] = useState(0);

  const isAdmin = user?.type === 'admin' && user?.role_name !== 'super_admin';
  // Challenge-Freigaben betreffen die ganze Leitung — Teamer moderieren ihre
  // zugewiesenen Jahrgänge selbst (das Backend zählt entsprechend gefiltert).
  const isLeadership = isAdmin || user?.type === 'teamer';

  const totalBadgeCount = useMemo(() => {
    if (isAdmin) {
      return chatUnreadTotal + pendingRequestsCount + pendingEventsCount + pendingChallengesCount;
    }
    if (isLeadership) {
      return chatUnreadTotal + pendingChallengesCount + newBadgesCount;
    }
    return chatUnreadTotal + newBadgesCount;
  }, [chatUnreadTotal, pendingRequestsCount, pendingEventsCount, pendingChallengesCount, newBadgesCount, isAdmin, isLeadership]);

  // Zentraler Refresh aller Counts. Nutzt den leichtgewichtigen Zähler-Endpoint
  // statt der frueheren drei Voll-Fetches (/chat/rooms +
  // /admin/activities/requests + /events), die nur für Zahlen geladen wurden.
  // Die Semantik der Zähler repliziert der Server exakt aus den Listen-Queries
  // (unread pro Raum, pending-Anträge, unverarbeitete vergangene Events).
  const refreshAllCounts = useCallback(async () => {
    if (!user) return;

    try {
      const { data } = await api.get('/notifications/badge-counts');

      // chatUnreadByRoom-Struktur (Record<number, number>) beibehalten —
      // ChatRoom (initialUnreadRef) und ChatOverview (Effect-Trigger) hängen dran.
      const byRoomRaw: Record<string, number> = data?.chat?.byRoom || {};
      const unreadByRoom: Record<number, number> = {};
      let totalUnread = 0;
      Object.entries(byRoomRaw).forEach(([roomId, count]) => {
        const unread = Number(count) || 0;
        unreadByRoom[Number(roomId)] = unread;
        totalUnread += unread;
      });
      setChatUnreadByRoom(prev => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(unreadByRoom);
        const unveraendert = prevKeys.length === nextKeys.length
          && nextKeys.every(k => prev[Number(k)] === unreadByRoom[Number(k)]);
        return unveraendert ? prev : unreadByRoom;
      });
      setChatUnreadTotal(totalUnread);

      if (isAdmin) {
        setPendingRequestsCount(Number(data?.pendingRequests) || 0);
        setPendingEventsCount(Number(data?.pendingEvents) || 0);
      }
      if (isLeadership) {
        setPendingChallengesCount(Number(data?.pendingChallenges) || 0);
        setNewBadgesCount(Number(data?.newBadges) || 0);
      }
    } catch (error) {
      console.error('BadgeContext: refreshAllCounts fehlgeschlagen:', error);
    }
  }, [user, isAdmin, isLeadership]);

  // markRoomAsRead: Optimistisch + API Call
  const markRoomAsRead = useCallback((roomId: number) => {
    // Zugestellte Chat-Notifications dieses Raums aus dem Mitteilungszentrum
    // entfernen (Bereich wurde geoeffnet/gelesen). Fire-and-forget.
    removeDeliveredForChatRoom(roomId);

    setChatUnreadByRoom(prev => {
      const currentUnread = prev[roomId] || 0;
      if (currentUnread === 0) return prev;
      return { ...prev, [roomId]: 0 };
    });
    setChatUnreadTotal(prev => {
      const currentUnread = chatUnreadByRoom[roomId] || 0;
      return Math.max(0, prev - currentUnread);
    });

    // API Call im Hintergrund — offline: Queue-Fallback
    if (!networkMonitor.isOnline) {
      writeQueue.enqueue({
        method: 'POST',
        url: `/chat/rooms/${roomId}/mark-read`,
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'fire-and-forget', clientId: `mark-read-${roomId}-${Date.now()}`, label: 'Mark-Read' },
      });
      return;
    }
    api.post(`/chat/rooms/${roomId}/mark-read`).catch(err => {
      console.error('BadgeContext: markRoomAsRead API fehlgeschlagen:', err);
    });
  }, [chatUnreadByRoom]);

  // Sync Device Badge bei Änderung von totalBadgeCount.
  // Nur auf nativen Plattformen: im Desktop-Browser existiert navigator.setAppBadge/
  // clearAppBadge nicht (z.B. Firefox) -> der Web-Fallback des Plugins wirft eine
  // unhandled rejection. Promises zusaetzlich mit .catch absichern.
  const setzeGeraeteBadge = useCallback(() => {
    if (!Capacitor.isNativePlatform()) return;
    const p = totalBadgeCount > 0
      ? Badge.set({ count: totalBadgeCount })
      : Badge.clear();
    Promise.resolve(p).catch((error) => {
      console.warn('BadgeContext: Badge nicht verfügbar:', error);
    });
  }, [totalBadgeCount]);

  useEffect(() => { setzeGeraeteBadge(); }, [setzeGeraeteBadge]);

  // Ausdrueckliches Neusetzen auf Zuruf: Der Effekt oben
  // haengt am WERT und feuert nicht, wenn sich dieser nicht geaendert hat. Nach
  // removeAllDeliveredNotifications() ist das Icon aber leer, waehrend
  // totalBadgeCount unveraendert im Speicher steht -- die Zahl kaeme erst
  // zurueck, wenn zufaellig eine andere hereinkommt. AppContext schickt dieses
  // Signal deshalb direkt nach dem Aufraeumen.
  useEffect(() => {
    const bei = () => setzeGeraeteBadge();
    window.addEventListener('badge:resync', bei);
    return () => window.removeEventListener('badge:resync', bei);
  }, [setzeGeraeteBadge]);

  // WebSocket: Live-Update bei neuen Nachrichten
  useEffect(() => {
    const token = getToken();
    if (!token || !user) return;

    const socket = initializeWebSocket(token);

    const handleNewMessage = () => {
      refreshAllCounts();
    };

    socket.on('newMessage', handleNewMessage);

    return () => {
      socket.off('newMessage', handleNewMessage);
    };
    // socketEpoch in den Deps: nach Reconnect-mit-neuem-Token (reconnectWithToken)
    // ist getSocket() ein anderes Objekt -> Listener am frischen Socket neu binden.
  }, [refreshAllCounts, user, socketEpoch]);

  // LiveUpdateContext-basierte Subscriptions für Daten-Events.
  // Stabiles Array (Modul-Konstante BADGE_LIVE_TYPES) -> kein Re-Subscribe pro Render.
  useLiveRefresh(BADGE_LIVE_TYPES, refreshAllCounts);

  // Sync: Reconnect + Resume Badge-Refresh
  useEffect(() => {
    if (!user) return;

    const handleSyncReconnect = () => {
      refreshAllCounts();
    };

    // Push-Empfang/-Tap: Counts sofort aktualisieren. Der Push-Listener
    // (inkl. Navigation) liegt zentral in AppContext und feuert dieses Event,
    // damit hier KEIN zweiter PushNotifications-Listener nötig ist.
    window.addEventListener('sync:reconnect', handleSyncReconnect);
    window.addEventListener('push:received', handleSyncReconnect);
    return () => {
      window.removeEventListener('sync:reconnect', handleSyncReconnect);
      window.removeEventListener('push:received', handleSyncReconnect);
    };
  }, [user, refreshAllCounts]);

  // Initialer Load der Counts. KEIN Dauer-Polling mehr:
  // - Chat-Unread aktualisiert der WebSocket ('newMessage')
  // - Aktivitäten/Events aktualisiert LiveUpdate ('requests'/'events', s. useLiveRefresh oben)
  // - Nach Verbindungsabriss/Push feuert sync:reconnect bzw. push:received einen Refresh
  // Das frühere 30s-Intervall war durch diese Live-Kanäle redundant und erzeugte den
  // Großteil des /chat/rooms-Traffics (Admin-App offen = 120 Requests/h ohne Nutzen).
  useEffect(() => {
    if (!user) return;
    refreshAllCounts();
  }, [user, refreshAllCounts]);

  // Reset bei Logout
  useEffect(() => {
    if (!user) {
      setChatUnreadByRoom({});
      setChatUnreadTotal(0);
      setPendingRequestsCount(0);
      setPendingEventsCount(0);
      setPendingChallengesCount(0);
      setNewBadgesCount(0);
    }
  }, [user]);

  return (
    <BadgeContext.Provider value={{
      chatUnreadByRoom,
      chatUnreadTotal,
      pendingRequestsCount,
      pendingEventsCount,
      pendingChallengesCount,
      newBadgesCount,
      totalBadgeCount,
      refreshAllCounts,
      markRoomAsRead,
      // Legacy Alias
      badgeCount: chatUnreadTotal,
      refreshFromAPI: refreshAllCounts,
    }}>
      {children}
    </BadgeContext.Provider>
  );
};

// Custom Hook for easy access
export const useBadge = () => {
  const context = useContext(BadgeContext);
  if (context === undefined) {
    throw new Error('useBadge must be used within a BadgeProvider');
  }
  return context;
};
