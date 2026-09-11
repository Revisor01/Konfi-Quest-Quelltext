import { useEffect, useRef } from 'react';
import { initializeWebSocket, getSocket, joinRoom, leaveRoom, onReconnect } from '../../services/websocket';
import { getToken } from '../../services/tokenStore';
import { writeQueue } from '../../services/writeQueue';
import { Message, PollStand, Reaction } from '../../types/chat';

/**
 * Socket-Verdrahtung des Chatraums (beim Aufteilen von ChatRoom.tsx hierher
 * gezogen, Verhalten unveraendert): Raum betreten/verlassen, Live-Events
 * (neue/geloeschte Nachrichten, geleerter Chat, Reaktionen, Umfragen),
 * 30s-Fallback-Poll bei still gestorbenem Socket und das Nachladen
 * verpasster Nachrichten beim Reconnect.
 */

interface ChatSocketDeps {
  roomId: number | undefined;
  // unread_count direkt am room-Objekt (vom Server) — Fallback fuer den
  // Einfrier-Moment, falls der Badge-Context noch nicht aktualisiert hat.
  roomUnreadCount: number | undefined;
  userId: number | undefined;
  chatUnreadByRoom: Record<number, number>;
  messages: Message[];
  // Beim Oeffnen EINMAL eingefrorene Ungelesen-Anzahl (Neu-Trenner + Scrollziel).
  initialUnreadRef: React.MutableRefObject<number | null>;
  // Message-ID, VOR der der "Neue Nachrichten"-Trenner steht.
  newDividerAnchorRef: React.MutableRefObject<number | null>;
  // client_ids eigener Sendungen, deren Server-Kopie noch nicht per Socket
  // angekommen ist — Fallback-Reload nur wenn der Socket nicht liefert.
  pendingSendsRef: React.MutableRefObject<Set<string>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  refreshMessagesCache: () => void;
  markRoomAsRead: () => void;
  loadMessages: () => Promise<void>;
  loadMissedMessages: (afterId: number) => Promise<void>;
}

export function useChatSocket({
  roomId,
  roomUnreadCount,
  userId,
  chatUnreadByRoom,
  messages,
  initialUnreadRef,
  newDividerAnchorRef,
  pendingSendsRef,
  setMessages,
  refreshMessagesCache,
  markRoomAsRead,
  loadMessages,
  loadMissedMessages,
}: ChatSocketDeps) {
  // Ref für aktuelle Messages (verhindert häufige Re-Subscriptions im Reconnect-Effect)
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Setup WebSocket for real-time updates (initial load via useOfflineQuery)
  useEffect(() => {
    if (!roomId) return;
    // Ungelesen-Anzahl einfrieren, BEVOR markRoomAsRead sie auf 0 setzt.
    // Fallback auf room.unread_count (vom Server am room-Objekt), falls der
    // Badge-Context beim Oeffnen noch nicht aktualisiert hat -> sonst wäre die
    // Zahl 0 und der "Neu"-Trenner + Scrollziel wuerden fehlen.
    if (initialUnreadRef.current === null) {
      initialUnreadRef.current = chatUnreadByRoom[roomId] ?? roomUnreadCount ?? 0;
    }
    markRoomAsRead();

    // WebSocket: Join room and listen for new messages
    const token = getToken();
    if (token) {
      const socket = initializeWebSocket(token);

      // Join room when connected (or immediately if already connected)
      // WICHTIG: socket.on statt socket.once - damit bei JEDEM Reconnect joinRoom aufgerufen wird!
      const handleConnect = () => {
        joinRoom(roomId);
      };

      if (socket.connected) {
        joinRoom(roomId);
      }
      socket.on('connect', handleConnect);

      // Listen for new messages
      socket.on('newMessage', (data: { roomId: number; message: Message }) => {
        if (data.roomId === roomId) {
          if (data.message?.client_id) {
            pendingSendsRef.current.delete(data.message.client_id);
            // Server-Kopie ist da -> "endgueltig fehlgeschlagen"-Merker hinfaellig
            writeQueue.forgetFailedChat(data.message.client_id);
          }
          setMessages(prev => {
            // Avoid duplicates
            if (prev.some(m => m.id === data.message.id)) return prev;
            // Eigene Nachricht: die optimistische Kopie in-place ersetzen
            // (Match über client_id) statt zusaetzlich anzuhaengen — sonst
            // erscheint die Nachricht kurz doppelt, bis der Reload aufraeumt.
            if (data.message.client_id) {
              const optIdx = prev.findIndex(m => m.clientId === data.message.client_id);
              if (optIdx !== -1) {
                const next = [...prev];
                next[optIdx] = data.message;
                return next;
              }
            }
            return [...prev, data.message];
          });
        }
      });

      // Listen for deleted messages
      socket.on('messageDeleted', (data: { roomId: number; messageId: number }) => {
        if (data.roomId === roomId) {
          setMessages(prev => prev.map(m =>
            m.id === data.messageId ? { ...m, deleted_at: new Date().toISOString() } : m
          ));
        }
      });

      // Team-Chat wurde von der Leitung geleert: alle Nachrichten sind weg,
      // der Raum bleibt. Auch die Cache-Kopie auffrischen, sonst kommen die
      // geleerten Nachrichten beim naechsten Oeffnen aus dem Cache zurueck.
      socket.on('chatCleared', (data: { roomId: number }) => {
        if (data.roomId === roomId) {
          setMessages([]);
          refreshMessagesCache();
        }
      });

      // Listen for typing indicators
      socket.on('userTyping', (data: { roomId: number; userId: number; userName: string }) => {
        if (data.roomId === roomId && data.userId !== userId) {
          // Could show typing indicator here
        }
      });

      // Listen for reaction added
      socket.on('reactionAdded', (data: { roomId: number; messageId: number; reaction: Reaction }) => {
        if (data.roomId === roomId) {
          setMessages(prev => prev.map(m => {
            if (m.id !== data.messageId) return m;
            const reactions = m.reactions || [];
            // Avoid duplicates
            if (reactions.some(r => r.id === data.reaction.id)) return m;
            return { ...m, reactions: [...reactions, data.reaction] };
          }));
        }
      });

      // Listen for reaction removed
      socket.on('reactionRemoved', (data: { roomId: number; messageId: number; userId: number; userType: string; emoji: string }) => {
        if (data.roomId === roomId) {
          setMessages(prev => prev.map(m => {
            if (m.id !== data.messageId) return m;
            return {
              ...m,
              reactions: (m.reactions || []).filter(r =>
                !(r.user_id === data.userId && r.user_type === data.userType && r.emoji === data.emoji)
              )
            };
          }));
        }
      });

      // Listen for poll updates (live votes). Der Server liefert den kompletten,
      // aktuellen Poll-Stand -> Server gewinnt immer. Das ist die sichere
      // Variante: stammt das Event vom eigenen Vote, ist die eigene Stimme
      // serverseitig ohnehin schon enthalten. Wir ersetzen nur den Poll-Teil der
      // betroffenen Nachricht, nicht die ganze Nachricht.
      socket.on('pollUpdated', (data: { roomId: number; messageId: number; poll: PollStand | null }) => {
        const poll = data.poll;
        if (data.roomId !== roomId || !poll) return;
        setMessages(prev => prev.map(m => {
          if (m.id !== data.messageId) return m;
          return {
            ...m,
            question: poll.question ?? m.question,
            options: poll.options ?? m.options,
            multiple_choice: poll.multiple_choice ?? m.multiple_choice,
            anonymous: poll.anonymous ?? m.anonymous,
            exclusive_options: poll.exclusive_options ?? m.exclusive_options,
            expires_at: poll.expires_at ?? m.expires_at,
            poll_id: poll.poll_id ?? m.poll_id,
            votes: poll.votes ?? m.votes,
          };
        }));
      });
    }

    // Fallback: 30s-Poll als Backup für den Fall, dass der Socket still
    // gestorben ist (bewusster Anker, NICHT entfernen). Zwei Optimierungen
    // 
    // 1. Inkrementell via loadMissedMessages(lastId) statt jedes Mal die vollen
    //    100 Nachrichten neu zu laden.
    // 2. Nur pollen, wenn die Seite sichtbar ist (Web-Tab im Hintergrund pollt
    //    nicht). Auf Native ist visibilityState 'visible', solange die App im
    //    Vordergrund ist; im Hintergrund pausiert das OS den Timer ohnehin.
    // Hinweis: Deletes aelterer Nachrichten kommen über das 'messageDeleted'-
    // Socket-Event. Mit after= gehen sie im Poll verloren -- das ist ok, der
    // Poll ist nur der Fallback für NEUE Nachrichten bei totem Socket.
    const interval = setInterval(async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const currentMessages = messagesRef.current;
      if (currentMessages.length > 0) {
        const lastId = currentMessages[currentMessages.length - 1].id;
        // Nur echte (serverseitige) IDs als Marker verwenden. Optimistische
        // Nachrichten haben negative IDs -> dann lieber den vollen Load.
        if (lastId > 0) {
          await loadMissedMessages(lastId);
        } else {
          await loadMessages();
        }
      } else {
        await loadMessages();
      }
    }, 30000);

    return () => {
      clearInterval(interval);
      // Marker-Zustand zuruecksetzen: Der "Neue Nachrichten"-Trenner ist ein
      // einmaliger Einstiegs-Indikator — beim Verlassen des Raums (oder
      // Raumwechsel) wird er verworfen und beim nächsten Betreten nur bei
      // wirklich neuen Nachrichten neu berechnet (shownMarkerAnchors).
      initialUnreadRef.current = null;
      newDividerAnchorRef.current = null;
      if (roomId) {
        leaveRoom(roomId);
      }
      const socket = getSocket();
      if (socket) {
        socket.off('connect');
        socket.off('newMessage');
        socket.off('messageDeleted');
        socket.off('chatCleared');
        socket.off('userTyping');
        socket.off('reactionAdded');
        socket.off('reactionRemoved');
        socket.off('pollUpdated');
      }
    };
  }, [roomId]);

  // Bei Socket-Reconnect verpasste Nachrichten nachladen
  useEffect(() => {
    const unsubReconnect = onReconnect(() => {
      const currentMessages = messagesRef.current;
      if (currentMessages.length > 0) {
        const lastId = currentMessages[currentMessages.length - 1].id;
        loadMissedMessages(lastId);
      } else {
        loadMessages();
      }
    });
    return () => { unsubReconnect(); };
  }, [roomId]);
}
