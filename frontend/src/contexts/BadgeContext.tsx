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
import { useLiveRefresh, LiveUpdateType } from './LiveUpdateContext';

// Stabiles Array (Modul-Ebene) -> useLiveRefresh re-subscribt nicht bei jedem Render.
const BADGE_LIVE_TYPES: LiveUpdateType[] = ['requests', 'events'];

// Badge Context Interface
interface BadgeContextType {
  // Chat
  chatUnreadByRoom: Record<number, number>;
  chatUnreadTotal: number;
  // Admin-only
  pendingRequestsCount: number;
  pendingEventsCount: number;
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

  const [chatUnreadByRoom, setChatUnreadByRoom] = useState<Record<number, number>>({});
  const [chatUnreadTotal, setChatUnreadTotal] = useState(0);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [pendingEventsCount, setPendingEventsCount] = useState(0);

  const isAdmin = user?.type === 'admin' && user?.role_name !== 'super_admin';

  // totalBadgeCount: Admin = chat + requests + events, Konfi = nur chat
  const totalBadgeCount = useMemo(() => {
    if (isAdmin) {
      return chatUnreadTotal + pendingRequestsCount + pendingEventsCount;
    }
    return chatUnreadTotal;
  }, [chatUnreadTotal, pendingRequestsCount, pendingEventsCount, isAdmin]);

  // Zentraler Refresh aller Counts
  const refreshAllCounts = useCallback(async () => {
    if (!user) return;

    try {
      // Chat-Rooms immer laden
      const promises: Promise<any>[] = [api.get('/chat/rooms')];

      // Admin-only: Requests + Events
      if (isAdmin) {
        promises.push(api.get('/admin/activities/requests'));
        promises.push(api.get('/events'));
      }

      const results = await Promise.all(promises);

      // Chat-Rooms verarbeiten
      const rooms = results[0].data;
      const unreadByRoom: Record<number, number> = {};
      let totalUnread = 0;
      rooms.forEach((room: any) => {
        const unreadCount = room.unread_count || 0;
        unreadByRoom[room.id] = unreadCount;
        totalUnread += unreadCount;
      });
      setChatUnreadByRoom(unreadByRoom);
      setChatUnreadTotal(totalUnread);

      // Admin-Counts verarbeiten
      if (isAdmin && results.length >= 3) {
        const requests = results[1].data;
        const pendingCount = requests.filter((req: any) => req.status === 'pending').length;
        setPendingRequestsCount(pendingCount);

        const events = results[2].data;
        const pendingEvents = events.filter((event: any) =>
          event.unprocessed_count > 0 && new Date(event.event_date) < new Date()
        ).length;
        setPendingEventsCount(pendingEvents);
      }
    } catch (error) {
      console.error('BadgeContext: refreshAllCounts fehlgeschlagen:', error);
    }
  }, [user, isAdmin]);

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
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const p = totalBadgeCount > 0
      ? Badge.set({ count: totalBadgeCount })
      : Badge.clear();
    Promise.resolve(p).catch((error) => {
      console.warn('BadgeContext: Badge nicht verfügbar:', error);
    });
  }, [totalBadgeCount]);

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
  }, [refreshAllCounts, user]);

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
    // damit hier KEIN zweiter PushNotifications-Listener noetig ist.
    window.addEventListener('sync:reconnect', handleSyncReconnect);
    window.addEventListener('push:received', handleSyncReconnect);
    return () => {
      window.removeEventListener('sync:reconnect', handleSyncReconnect);
      window.removeEventListener('push:received', handleSyncReconnect);
    };
  }, [user, refreshAllCounts]);

  // Initialer Load + Polling für Admin-Counts (30s)
  useEffect(() => {
    if (!user) return;

    // Initialer Load
    refreshAllCounts();

    // Polling nur für Admin (requests + events ändern sich nicht per WebSocket)
    if (isAdmin) {
      const interval = setInterval(refreshAllCounts, 30000);
      return () => clearInterval(interval);
    }
  }, [user, isAdmin, refreshAllCounts]);

  // Reset bei Logout
  useEffect(() => {
    if (!user) {
      setChatUnreadByRoom({});
      setChatUnreadTotal(0);
      setPendingRequestsCount(0);
      setPendingEventsCount(0);
    }
  }, [user]);

  return (
    <BadgeContext.Provider value={{
      chatUnreadByRoom,
      chatUnreadTotal,
      pendingRequestsCount,
      pendingEventsCount,
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
