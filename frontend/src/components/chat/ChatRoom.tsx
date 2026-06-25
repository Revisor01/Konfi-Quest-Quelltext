import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  useIonModal,
  useIonAlert,
  useIonActionSheet
} from '@ionic/react';
import {
  arrowBack
} from 'ionicons/icons';
import { useApp } from '../../contexts/AppContext';
import { useBadge } from '../../contexts/BadgeContext';
import { useOfflineQuery } from '../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../services/offlineCache';
import api from '../../services/api';
import { initializeWebSocket, getSocket, joinRoom, leaveRoom, disconnectWebSocket, onReconnect } from '../../services/websocket';
import { getToken } from '../../services/tokenStore';
import { Message, Reaction, PollVote, ChatRoomProps as ChatRoomComponentProps } from '../../types/chat';
import MessageBubble from './MessageBubble';
import PollModal from './modals/PollModal';
import MembersModal from './modals/MembersModal';
import FileViewerModal, { FileItem } from '../shared/FileViewerModal';
// Camera is now handled via ChatRoomSections helpers
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Keyboard } from '@capacitor/keyboard';
// Native FileViewer ueber openFileNatively, FileViewerModal als Web-Fallback
import { openFileNatively } from '../../utils/nativeFileViewer';
import { writeQueue } from '../../services/writeQueue';
import { safeUUID } from '../../utils/uuid';
import { networkMonitor } from '../../services/networkMonitor';
import { compressImage } from '../../services/mediaCompression';
import { ChatHeader, MessageInput, autoCapitalize, MIME_EXT_MAP, takePicture as takePictureHelper, selectFromGallery as selectFromGalleryHelper } from './ChatRoomSections';
import { triggerPullHaptic } from '../../utils/haptics';



// Tages-Trenner-Label (wie WhatsApp): Heute / Gestern / TT.MM.JJJJ.
const formatDayDivider = (d: Date): string => {
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Heute';
  if (d.toDateString() === yest.toDateString()) return 'Gestern';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const ChatRoom: React.FC<ChatRoomComponentProps> = ({ room, onBack, presentingElement }) => {
  const { user, setError, isOnline } = useApp();
  const { markRoomAsRead: badgeMarkRoomAsRead, refreshAllCounts, chatUnreadByRoom } = useBadge();
  // Anzahl ungelesener Nachrichten beim Oeffnen EINMAL einfrieren (bevor
  // markRoomAsRead sie auf 0 setzt) -> Position des "Neu"-Trenners + Scrollziel.
  const initialUnreadRef = useRef<number | null>(null);
  const newDividerRef = useRef<HTMLDivElement | null>(null);

  // --- useOfflineQuery: Initial messages load mit Cache ---
  const { data: initialMessages, refresh: refreshMessagesCache } = useOfflineQuery<Message[]>(
    'chat:messages:' + room?.id,
    () => api.get(`/chat/rooms/${room?.id}/messages?limit=100`).then(r => r.data),
    { ttl: CACHE_TTL.CHAT_MESSAGES, enabled: !!room?.id }
  );

  // Lokaler messages-State für Live-Updates (WebSocket aktualisiert diesen direkt)
  const [messages, setMessages] = useState<Message[]>([]);

  // Initiale Nachrichten aus Cache/API in lokalen State kopieren
  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  const [messageText, setMessageText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFilePreview, setSelectedFilePreview] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [reactionTargetMessage, setReactionTargetMessage] = useState<Message | null>(null);
  // Schwebender Tages-Chip oben (WhatsApp-Style): zeigt den Tag der obersten
  // sichtbaren Nachricht. Genau EIN Chip -> kein Ueberlagern mehrerer Sticky-Trenner.
  const [floatingDay, setFloatingDay] = useState<string>('');
  const contentRef = useRef<HTMLIonContentElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLIonTextareaElement>(null);
  const scrollPositionRef = useRef<number>(0);
  const viewerRef = useRef<{ files: FileItem[]; initialIndex: number }>({ files: [], initialIndex: 0 });


  // Hooks müssen vor conditional returns stehen!
  const [presentAlert] = useIonAlert();
  const [presentActionSheet] = useIonActionSheet();

  const handleRetryMessage = (message: Message) => {
    presentActionSheet({
      header: 'Nachricht fehlgeschlagen',
      buttons: [
        {
          text: 'Erneut senden',
          handler: async () => {
            // Message als pending markieren
            setMessages(prev => prev.map(m =>
              m.localId === message.localId ? { ...m, queueStatus: 'pending' as const } : m
            ));
            // Queue-Item finden und erneut enqueuen
            const queueItems = await writeQueue.getByMetadata({ roomId: room?.id, type: 'chat' });
            const item = queueItems.find(qi => qi.metadata.clientId === message.localId || qi.id === message.localId);
            if (item) {
              await writeQueue.remove(item.id);
              const retryItem = { ...item, retryCount: 0 };
              // retryCount/id/createdAt werden von enqueue überschrieben, also Omit-kompatibel machen
              await writeQueue.enqueue({
                method: retryItem.method,
                url: retryItem.url,
                body: retryItem.body,
                headers: retryItem.headers,
                maxRetries: retryItem.maxRetries,
                hasFileUpload: retryItem.hasFileUpload,
                metadata: retryItem.metadata,
              });
            }
            // Flush versuchen wenn online
            if (networkMonitor.isOnline) {
              writeQueue.flush();
            }
          }
        },
        {
          text: 'Nachricht l\u00f6schen',
          role: 'destructive',
          handler: async () => {
            // Aus UI entfernen
            setMessages(prev => prev.filter(m => m.localId !== message.localId));
            // Aus Queue entfernen
            const queueItems = await writeQueue.getByMetadata({ roomId: room?.id, type: 'chat' });
            const item = queueItems.find(qi => qi.metadata.clientId === message.localId || qi.id === message.localId);
            if (item) {
              await writeQueue.remove(item.id);
              // Lokale Datei l\u00f6schen falls vorhanden
              if (item.body?._localFilePath) {
                try {
                  await Filesystem.deleteFile({ path: item.body._localFilePath, directory: Directory.Data });
                } catch { /* ignore */ }
              }
            }
          }
        },
        {
          text: 'Abbrechen',
          role: 'cancel'
        }
      ]
    });
  };

  const handleDeleteQueuedMessage = async (message: Message) => {
    // Aus UI entfernen
    setMessages(prev => prev.filter(m => m.localId !== message.localId));
    // Aus Queue entfernen
    const queueItems = await writeQueue.getByMetadata({ roomId: room?.id, type: 'chat' });
    const item = queueItems.find(qi => qi.metadata.clientId === message.localId || qi.id === message.localId);
    if (item) {
      await writeQueue.remove(item.id);
      // Lokale Datei l\u00f6schen falls vorhanden
      if (item.body?._localFilePath) {
        try {
          await Filesystem.deleteFile({ path: item.body._localFilePath, directory: Directory.Data });
        } catch { /* ignore */ }
      }
    }
  };

  // Poll Modal mit useIonModal Hook (iOS Card Design)
  const [presentPollModalHook, dismissPollModalHook] = useIonModal(PollModal, {
    onClose: () => dismissPollModalHook(),
    onSuccess: () => {
      dismissPollModalHook();
      handlePollCreated();
    },
    roomId: room?.id ?? 0 // ?? statt || für klarere Intention
  });

  const openPollModal = () => {
    if (!room) return;
    presentPollModalHook({
      presentingElement: presentingElement || undefined // <-- Verwendet das Prop
    });
  };

  // Members Modal mit useIonModal Hook (iOS Card Design)
  const [presentMembersModalHook, dismissMembersModalHook] = useIonModal(MembersModal, {
    onClose: () => dismissMembersModalHook(),
    onSuccess: () => {
      dismissMembersModalHook();
      loadMessages();
    },
    roomId: room?.id ?? 0,
    roomType: room?.type ?? 'group'
  });

  const openMembersModal = () => {
    if (!room) return;
    presentMembersModalHook({
      presentingElement: presentingElement || undefined // <-- Verwendet das Prop
    });
  };

  // FileViewer Modal mit useIonModal Hook (universeller Datei-Viewer)
  const [presentFileViewer, dismissFileViewer] = useIonModal(FileViewerModal, {
    get files() { return viewerRef.current.files; },
    get initialIndex() { return viewerRef.current.initialIndex; },
    onClose: () => {
      dismissFileViewer();
      viewerRef.current.files.forEach(f => {
        if (f.url.startsWith('blob:')) URL.revokeObjectURL(f.url);
      });
      viewerRef.current = { files: [], initialIndex: 0 };
    }
  });

  // Setup WebSocket for real-time updates (initial load via useOfflineQuery)
  useEffect(() => {
    if (!room?.id) return;
    // Ungelesen-Anzahl einfrieren, BEVOR markRoomAsRead sie auf 0 setzt.
    // Fallback auf room.unread_count (vom Server am room-Objekt), falls der
    // Badge-Context beim Oeffnen noch nicht aktualisiert hat -> sonst waere die
    // Zahl 0 und der "Neu"-Trenner + Scrollziel wuerden fehlen.
    if (initialUnreadRef.current === null) {
      initialUnreadRef.current = chatUnreadByRoom[room.id] ?? (room as any).unread_count ?? 0;
    }
    markRoomAsRead();

    // WebSocket: Join room and listen for new messages
    const token = getToken();
    if (token) {
      const socket = initializeWebSocket(token);

      // Join room when connected (or immediately if already connected)
      // WICHTIG: socket.on statt socket.once - damit bei JEDEM Reconnect joinRoom aufgerufen wird!
      const handleConnect = () => {
        joinRoom(room.id);
      };

      if (socket.connected) {
        joinRoom(room.id);
      }
      socket.on('connect', handleConnect);

      // Listen for new messages
      socket.on('newMessage', (data: { roomId: number; message: any }) => {
        if (data.roomId === room.id) {
          setMessages(prev => {
            // Avoid duplicates
            if (prev.some(m => m.id === data.message.id)) return prev;
            return [...prev, data.message];
          });
        }
      });

      // Listen for deleted messages
      socket.on('messageDeleted', (data: { roomId: number; messageId: number }) => {
        if (data.roomId === room.id) {
          setMessages(prev => prev.map(m =>
            m.id === data.messageId ? { ...m, deleted_at: new Date().toISOString() } : m
          ));
        }
      });

      // Listen for typing indicators
      socket.on('userTyping', (data: { roomId: number; userId: number; userName: string }) => {
        if (data.roomId === room.id && data.userId !== user?.id) {
          // Could show typing indicator here
        }
      });

      // Listen for reaction added
      socket.on('reactionAdded', (data: { roomId: number; messageId: number; reaction: Reaction }) => {
        if (data.roomId === room.id) {
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
        if (data.roomId === room.id) {
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
    }

    // Fallback: 30-second polling als Backup (falls WebSocket ausfaellt)
    const interval = setInterval(async () => {
      await loadMessages();
    }, 30000);

    return () => {
      clearInterval(interval);
      if (room?.id) {
        leaveRoom(room.id);
      }
      const socket = getSocket();
      if (socket) {
        socket.off('connect');
        socket.off('newMessage');
        socket.off('messageDeleted');
        socket.off('userTyping');
        socket.off('reactionAdded');
        socket.off('reactionRemoved');
      }
    };
  }, [room?.id]);

  // Mark as read only when new messages arrive (not every 5 seconds)
  useEffect(() => {
    if (messages.length > 0) {
      markRoomAsRead();
    }
  }, [messages.length]);


  // Track previous message count to only scroll on NEW messages
  const prevMessageCountRef = useRef(0);
  // Beim Initial-Load am "Neu"-Trenner geparkt? Dann KEIN Auto-Scroll nach unten,
  // bis der Nutzer selbst nach unten scrollt. Verhindert, dass die API-
  // Revalidierung (2. messages-Update nach Cache-Treffer) die Divider-Position
  // mit einem Sprung ans Listenende ueberschreibt.
  const parkedAtDividerRef = useRef(false);

  useEffect(() => {
    // Always scroll to bottom on initial load or new messages
    if (contentRef.current && messages.length > 0) {
      if (isInitialLoad) {
        // Initial load: wenn ungelesene Nachrichten existieren, zur ERSTEN neuen
        // scrollen (so kann man von dort nach unten lesen). Sonst ganz nach unten.
        // WICHTIG: isInitialLoad erst NACH erfolgreichem Scroll abschalten, sonst
        // ueberschreibt die API-Revalidierung (2. messages-Update) die Position
        // mit einem Auto-Scroll nach unten.
        const unread = initialUnreadRef.current ?? 0;
        const targetDivider = unread > 0 && unread <= messages.length;
        // requestAnimationFrame: warten bis der Divider wirklich im DOM gerendert ist.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (targetDivider && newDividerRef.current) {
              newDividerRef.current.scrollIntoView({ block: 'center' });
              // Geparkt am Trenner: nachfolgende Updates duerfen nicht nach unten springen.
              parkedAtDividerRef.current = true;
            } else {
              contentRef.current?.scrollToBottom(0);
            }
            setIsInitialLoad(false);
            // Schwebenden Tages-Chip initial befuellen.
            handleScroll();
          });
        });
      } else if (shouldAutoScroll && !parkedAtDividerRef.current && messages.length > prevMessageCountRef.current) {
        // New message - smooth scroll
        contentRef.current.scrollToBottom(300);
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages, shouldAutoScroll, isInitialLoad]);

  // Sobald der Nutzer selbst bis ans (nahe) Listenende scrollt, "entparken" -> ab
  // dann folgen neue Nachrichten wieder automatisch nach unten (WhatsApp-Verhalten).
  // Zusaetzlich: schwebenden Tages-Chip aktualisieren (oberster sichtbarer Tag).
  const handleScroll = async () => {
    if (!contentRef.current) return;
    const scrollEl = await contentRef.current.getScrollElement();

    if (parkedAtDividerRef.current) {
      const nearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80;
      if (nearBottom) parkedAtDividerRef.current = false;
    }

    // Obersten Tages-Trenner finden, der gerade noch oberhalb der Sichtgrenze
    // liegt -> dessen Tag im schwebenden Chip anzeigen.
    // WICHTIG: Marker liegen im LIGHT DOM (geslotteter ion-content-Inhalt), NICHT
    // im scrollEl (.inner-scroll im Shadow DOM) -> ueber contentRef suchen, sonst
    // findet querySelectorAll nichts und floatingDay bleibt leer.
    const markers = contentRef.current.querySelectorAll<HTMLElement>('[data-day-divider]');
    const containerTop = scrollEl.getBoundingClientRect().top;
    let current = '';
    for (const m of Array.from(markers)) {
      const top = m.getBoundingClientRect().top - containerTop;
      // 40px Toleranz = ungefaehre Hoehe des schwebenden Chips.
      if (top <= 40) current = m.getAttribute('data-day-divider') || '';
      else break;
    }
    // Fallback: vor dem ersten Trenner -> Tag des ersten Trenners zeigen.
    if (!current && markers.length > 0) current = markers[0].getAttribute('data-day-divider') || '';
    setFloatingDay(prev => (prev === current ? prev : current));
  };

  const loadMessages = async () => {
    // Kein eigener Loading State - ChatRoomView handled das Loading
    if (!room) return;
    try {
      const response = await api.get(`/chat/rooms/${room.id}/messages?limit=100`);
      setMessages(response.data);

      // Don't pre-load images anymore - use lazy loading instead for better performance
    } catch (err) {
      setError('Fehler beim Laden der Nachrichten');
 console.error('Error loading messages:', err);
    } finally {
      // Loading wird im ChatRoomView gehandhabt
    }
  };

  // Ref für aktuelle Messages (verhindert häufige Re-Subscriptions im Reconnect-Effect)
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const loadMissedMessages = async (afterId: number) => {
    if (!room) return;
    try {
      const response = await api.get(`/chat/rooms/${room.id}/messages?after=${afterId}`);
      const missedMessages = response.data;
      if (missedMessages.length > 0) {
        setMessages(prev => [...prev, ...missedMessages]);
      }
    } catch (err) {
      console.error('Fehler beim Nachladen verpasster Nachrichten:', err);
    }
  };

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
  }, [room?.id]);

  const markRoomAsRead = async () => {
    if (!room) return;
    try {
      // BadgeContext macht optimistisches Update + API Call
      badgeMarkRoomAsRead(room.id);

      // Badge Context neu laden für genaue Counts
      await refreshAllCounts();

    } catch (err) {
      // Silent fail - marking as read is not critical
      console.error('Error marking room as read:', err);
    }
  };

  const sendMessage = async () => {
    if (!messageText.trim() && !selectedFile) return;
    if (!room) return;

    const clientId = safeUUID();
    const localId = safeUUID();
    const content = messageText.trim();
    const file = selectedFile;
    const currentReplyTo = replyToMessage;
    // Antwort auf eine noch NICHT serverseitig gespeicherte Nachricht (optimistisch:
    // negative ID bzw. noch in der Queue)? Dann reply_to weglassen — die echte ID
    // existiert serverseitig nicht, der FK-Constraint wuerde sonst greifen. Die
    // Nachricht geht ohne Antwort-Bezug raus (besser als ein Fehler).
    const replyToId = currentReplyTo && currentReplyTo.id > 0 && !currentReplyTo.queueStatus
      ? currentReplyTo.id
      : null;

    // Optimistic UI: Nachricht sofort in messages-State einfuegen
    const optimisticMsg: Message = {
      id: -Date.now(),
      content: content || (file ? file.name : ''),
      sender_id: user?.id ?? 0,
      sender_name: user?.display_name ?? '',
      sender_type: (user?.type || 'konfi') as 'admin' | 'konfi' | 'teamer',
      created_at: new Date().toISOString(),
      message_type: file ? 'image' : 'text',
      file_name: file?.name,
      queueStatus: 'pending',
      localId,
    };

    // UI sofort aktualisieren
    setMessages(prev => [...prev, optimisticMsg]);
    setMessageText('');
    setReplyToMessage(null);
    clearSelectedFile();
    setShouldAutoScroll(true);
    // Eigene Nachricht: am Divider-Park loesen, sonst bleibt der Scroll oben haengen.
    parkedAtDividerRef.current = false;
    setTimeout(() => contentRef.current?.scrollToBottom(300), 100);

    if (networkMonitor.isOnline) {
      // Online: Normal senden
      setUploading(true);
      try {
        const formData = new FormData();
        if (content) formData.append('content', content);
        if (file) formData.append('file', file);
        if (replyToId) formData.append('reply_to', replyToId.toString());
        formData.append('client_id', clientId);

        await api.post(`/chat/rooms/${room.id}/messages`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });

        // Optimistic msg wird durch WebSocket newMessage Event ersetzt
        setTimeout(() => {
          setMessages(prev => prev.filter(m => m.localId !== localId));
        }, 2000);

        if (room) markRoomAsRead();
        setShouldAutoScroll(true);
        await loadMessages();
      } catch (err) {
        // Bei Fehler: optimistic msg als error markieren
        setMessages(prev => prev.map(m =>
          m.localId === localId ? { ...m, queueStatus: 'error' as const } : m
        ));
      } finally {
        setUploading(false);
      }
    } else {
      // Offline: In Queue schreiben
      let hasFileUpload = false;
      const queueBody: Record<string, any> = { content, client_id: clientId };

      if (file) {
        // Bild lokal speichern
        hasFileUpload = true;
        try {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          const fileName = `queue_${clientId}_${file.name}`;
          await Filesystem.writeFile({
            path: `queue-uploads/${fileName}`,
            data: base64,
            directory: Directory.Data,
          });
          queueBody._localFilePath = `queue-uploads/${fileName}`;
          queueBody._fileName = file.name;
          queueBody._fileType = file.type;
        } catch (fileErr) {
          console.error('Fehler beim lokalen Speichern der Datei:', fileErr);
          setMessages(prev => prev.map(m =>
            m.localId === localId ? { ...m, queueStatus: 'error' as const } : m
          ));
          return;
        }
      }

      if (replyToId) queueBody.reply_to = replyToId.toString();

      await writeQueue.enqueue({
        method: 'POST',
        url: `/chat/rooms/${room.id}/messages`,
        body: queueBody,
        headers: { 'Content-Type': file ? 'multipart/form-data' : 'application/json' },
        maxRetries: 5,
        hasFileUpload,
        metadata: {
          type: 'chat',
          clientId,
          roomId: room.id,
          label: 'Chat-Nachricht',
        },
      });
    }
  };

  const handlePollCreated = async () => {
    await loadMessages();
  };


  const voteInPoll = async (messageId: number, optionIndex: number) => {
    // Offline: Optimistic UI + Queue-Fallback (fire-and-forget)
    if (!networkMonitor.isOnline) {
      setShouldAutoScroll(false);

      // Optimistisch den Vote anzeigen
      setMessages(prev => prev.map(m => {
        if (m.id === messageId && m.votes) {
          const newVote: PollVote = {
            user_id: user?.id ?? 0,
            user_type: (user?.role_name === 'konfi' ? 'konfi' : 'admin') as 'admin' | 'konfi',
            option_index: optionIndex,
          };
          return { ...m, votes: [...m.votes, newVote] };
        }
        return m;
      }));

      writeQueue.enqueue({
        method: 'POST',
        url: `/chat/polls/${messageId}/vote`,
        body: { option_index: optionIndex },
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'fire-and-forget', clientId: `poll-${messageId}-${optionIndex}-${safeUUID()}`, label: 'Abstimmung' },
      });

      setTimeout(() => setShouldAutoScroll(true), 1000);
      return;
    }

    try {
      setShouldAutoScroll(false); // Prevent auto-scroll when voting
      await api.post(`/chat/polls/${messageId}/vote`, { option_index: optionIndex });
      await loadMessages();
      // Re-enable auto-scroll after a short delay
      setTimeout(() => setShouldAutoScroll(true), 1000);
    } catch (err: any) {
      // Exklusive Umfrage: Option wurde inzwischen von jemand anderem belegt (409).
      if (err?.response?.status === 409) {
        setError('Diese Option ist bereits vergeben');
        await loadMessages(); // aktuellen Stand (Belegung) nachziehen
      } else {
        setError('Fehler beim Abstimmen');
        console.error('Error voting in poll:', err);
      }
      setShouldAutoScroll(true); // Re-enable on error
    }
  };

  const deleteMessage = (messageId: number) => {
    if (!isOnline) return;
    presentAlert({
      header: 'Nachricht löschen?',
      message: 'Diese Nachricht unwiderruflich löschen?',
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: () => {
            api.delete(`/chat/messages/${messageId}`)
              .then(() => {
                loadMessages();
              })
              .catch((err) => {
                setError('Fehler beim Löschen der Nachricht');
 console.error('Error deleting message:', err);
              });
          }
        }
      ]
    });
  };

  // Reaktion hinzufügen/entfernen
  const toggleReaction = async (messageId: number, emoji: string) => {
    // Offline: Optimistic UI + Queue-Fallback (fire-and-forget)
    if (!networkMonitor.isOnline) {
      await Haptics.impact({ style: ImpactStyle.Light });
      setShouldAutoScroll(false);

      // Optimistisch toggeln
      setMessages(prev => prev.map(msg => {
        if (msg.id !== messageId) return msg;
        const reactions = msg.reactions || [];
        const existing = reactions.find(r =>
          r.user_id === user!.id && r.user_type === user!.type && r.emoji === emoji
        );
        if (existing) {
          return { ...msg, reactions: reactions.filter(r => r !== existing) };
        }
        return {
          ...msg,
          reactions: [...reactions, {
            id: 0,
            emoji,
            user_id: user!.id,
            user_type: user!.type as 'admin' | 'konfi',
            user_name: user!.display_name || ''
          }]
        };
      }));

      writeQueue.enqueue({
        method: 'POST',
        url: `/chat/messages/${messageId}/reactions`,
        body: { emoji },
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'fire-and-forget', clientId: `reaction-${messageId}-${emoji}-${safeUUID()}`, label: 'Reaktion' },
      });

      setShowReactionPicker(false);
      setReactionTargetMessage(null);
      setTimeout(() => setShouldAutoScroll(true), 500);
      return;
    }

    try {
      await Haptics.impact({ style: ImpactStyle.Light });
      setShouldAutoScroll(false);

      const response = await api.post(`/chat/messages/${messageId}/reactions`, { emoji });

      // Optimistic update - direkt im State aktualisieren
      setMessages(prev => prev.map(msg => {
        if (msg.id !== messageId) return msg;

        const reactions = msg.reactions || [];
        if (response.data.action === 'added') {
          // Prüfe ob Reaktion schon existiert (verhindert Duplikate durch WebSocket)
          const alreadyExists = reactions.some(r =>
            r.user_id === user!.id && r.user_type === user!.type && r.emoji === emoji
          );
          if (alreadyExists) return msg;

          // Reaktion hinzufügen
          return {
            ...msg,
            reactions: [...reactions, {
              id: response.data.id,
              emoji,
              user_id: user!.id,
              user_type: user!.type as 'admin' | 'konfi',
              user_name: user!.display_name || ''
            }]
          };
        } else {
          // Reaktion entfernen
          return {
            ...msg,
            reactions: reactions.filter(r =>
              !(r.user_id === user!.id && r.user_type === user!.type && r.emoji === emoji)
            )
          };
        }
      }));

      setShowReactionPicker(false);
      setReactionTargetMessage(null);
      setTimeout(() => setShouldAutoScroll(true), 500);
    } catch (err) {
      setError('Fehler beim Reagieren');
 console.error('Error toggling reaction:', err);
      setShouldAutoScroll(true);
    }
  };

  // Reaktion-Picker öffnen
  const openReactionPicker = (message: Message) => {
    setReactionTargetMessage(message);
    setShowReactionPicker(true);
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // Input zuruecksetzen, damit dieselbe Datei erneut waehlbar ist.
    event.target.value = '';
    if (!picked) return;

    // Bilder vor Upload resizen + komprimieren (max 1920px lange Kante). Andere
    // Dateien (Videos, PDFs) bleiben unveraendert.
    let file = picked;
    let previewUrl: string | null = null;
    if (picked.type.startsWith('image/')) {
      try {
        const result = await compressImage(picked);
        file = result.file;
        previewUrl = result.previewUrl;
      } catch {
        file = picked;
        previewUrl = URL.createObjectURL(picked);
      }
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit (nach Kompression)
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setError('Datei ist zu groß (max. 10MB)');
      return;
    }

    setSelectedFile(file);
    setSelectedFilePreview(previewUrl);
  };

  // Cleanup preview URL on unmount or file change
  useEffect(() => {
    return () => {
      if (selectedFilePreview) {
        URL.revokeObjectURL(selectedFilePreview);
      }
    };
  }, [selectedFilePreview]);

  // Tastatur oeffnet sich (Eingabefeld fokussiert): ans LISTENENDE scrollen, damit
  // die letzte Nachricht ueber der Tastatur sichtbar bleibt (WhatsApp-Verhalten).
  // Sonst verdeckt die Tastatur das Chat-Ende. Mehrere Scroll-Versuche, weil die
  // Tastatur-/Viewport-Animation je nach Plattform ~150-350ms dauert.
  const handleTextareaFocus = async () => {
    if (!contentRef.current) return;
    // Beim Tippen wollen wir immer am Ende sein -> entparken + Auto-Scroll erlauben.
    parkedAtDividerRef.current = false;
    const scrollEnd = () => contentRef.current?.scrollToBottom(250);
    // Direkt + nach der Keyboard-Animation nochmal (Viewport hat sich dann verkleinert).
    scrollEnd();
    setTimeout(scrollEnd, 150);
    setTimeout(scrollEnd, 350);
  };

  // Robuster Trigger: wenn die Tastatur auf-/zugeht (nativ), ans Listenende
  // scrollen, damit die letzte Nachricht NICHT von der Tastatur verdeckt wird.
  // Bei resize:'ionic' passt Ionic die ion-content-Hoehe an — aber teils ERST
  // nach keyboardDidShow. Ein einzelnes scrollToBottom landet dann noch am alten
  // Ende (hinter der Tastatur). Darum: mehrfach ueber rAF + kurze Timeouts ans
  // Ende scrollen, sodass nach dem Layout-Reflow nachgezogen wird.
  useEffect(() => {
    const handles: any[] = [];

    const scrollToEndRepeated = () => {
      parkedAtDividerRef.current = false;
      const el = contentRef.current;
      if (!el) return;
      const go = () => el.scrollToBottom(150);
      // Sofort, im naechsten Frame (nach Reflow) und nochmal verzoegert, weil die
      // Keyboard-/Resize-Animation je nach Geraet ~150-400ms dauert.
      go();
      requestAnimationFrame(() => { go(); requestAnimationFrame(go); });
      setTimeout(go, 120);
      setTimeout(go, 300);
      setTimeout(go, 500);
    };

    Keyboard.addListener('keyboardWillShow', scrollToEndRepeated)
      .then(h => handles.push(h)).catch(() => { /* Web/kein nativer Keyboard */ });
    Keyboard.addListener('keyboardDidShow', scrollToEndRepeated)
      .then(h => handles.push(h)).catch(() => { /* Web/kein nativer Keyboard */ });

    return () => { handles.forEach(h => h?.remove?.()); };
  }, []);

  const handleTextInputChange = (value: string) => {
    setMessageText(autoCapitalize(value));
  };

  const takePicture = async () => {
    try {
      const result = await takePictureHelper();
      if (result) {
        if (result.file.size > 10 * 1024 * 1024) {
          setError('Foto ist zu groß (max. 10MB)');
          return;
        }
        setSelectedFile(result.file);
        setSelectedFilePreview(result.previewUrl);
      }
    } catch (error) {
 console.error('Camera error:', error);
      setError('Kamera-Zugriff fehlgeschlagen');
    }
  };

  const selectFromGallery = async () => {
    try {
      const result = await selectFromGalleryHelper();
      if (result) {
        if (result.file.size > 10 * 1024 * 1024) {
          setError('Foto ist zu groß (max. 10MB)');
          return;
        }
        setSelectedFile(result.file);
        setSelectedFilePreview(result.previewUrl);
      }
    } catch (error) {
 console.error('Gallery error:', error);
      setError('Galerie-Zugriff fehlgeschlagen');
    }
  };

  const clearSelectedFile = () => {
    if (selectedFilePreview) {
      URL.revokeObjectURL(selectedFilePreview);
    }
    setSelectedFile(null);
    setSelectedFilePreview(null);
  };

  const handleLongPress = async (message: Message) => {
    try {
      // Native haptic feedback
      await Haptics.impact({ style: ImpactStyle.Medium });

      // Toggle selection - zeige Inline-Aktionsleiste
      if (selectedMessage?.id === message.id) {
        setSelectedMessage(null);
        setShowReactionPicker(false);
      } else {
        setSelectedMessage(message);
        setShowReactionPicker(false);
      }
    } catch (error) {
 console.error('Error with long press:', error);
    }
  };

  const handleShare = async () => {
    if (!selectedMessage) return;

    try {
      if (selectedMessage.file_path) {
        // For files, share the actual file natively (with auth token)
        const response = await api.get(`/chat/files/${selectedMessage.file_path}`, { responseType: 'blob' });
        const blob = response.data;
        const fileName = selectedMessage.file_name || 'file';

        // Write to Documents directory for sharing
        const base64Data = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1];
            resolve(base64);
          };
          reader.readAsDataURL(blob);
        });

        const path = `share/${fileName}`;
        await Filesystem.writeFile({
          path,
          data: base64Data,
          directory: Directory.Documents,
          recursive: true
        });

        // Get local file URI for sharing
        const fileUri = await Filesystem.getUri({
          directory: Directory.Documents,
          path
        });

        await Share.share({
          title: 'Datei aus Konfi Quest',
          text: selectedMessage.content || fileName,
          url: fileUri.uri
        });
      } else {
        // For text messages, share text content
        await Share.share({
          text: selectedMessage.content,
          title: 'Nachricht aus Konfi Quest'
        });
      }
    } catch (error) {
 console.error('Error sharing:', error);
      if (error instanceof Error && error.name !== 'AbortError') {
        setError('Fehler beim Teilen');
      }
    }
  };


  const getDisplayRoomName = () => {
      if (!room) return 'Chat wird geladen...';
      if (room.type === 'direct' && room.participants) {
        const otherParticipant = room.participants.find(p =>
          p.user_id !== user?.id
        );
        if (otherParticipant) {
          return otherParticipant.display_name || otherParticipant.name || 'Unbekannt';
        }
      }
      return room.name || 'Chat';
    };

  // Early return nach allen Hooks wenn room noch nicht geladen ist
  if (!room) {
    return (
      <>
        <IonHeader translucent={true}>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={onBack}>
                <IonIcon icon={arrowBack} />
              </IonButton>
            </IonButtons>
            <IonTitle>Chat wird geladen...</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="app-gradient-background" fullscreen>
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <p>Chat wird geladen...</p>
          </div>
        </IonContent>
      </>
    );
  }

  const handleShareMessage = (message: Message) => {
    setSelectedMessage(message);
    handleShare();
  };

  const handleFileClick = async (filePath: string, fileName: string, mimeType: string) => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });

      // Angeklickte Datei als Blob laden
      const response = await api.get(`/chat/files/${filePath}`, { responseType: 'blob' });
      const blob = response.data;
      const contentType = response.headers?.['content-type'];
      const mime: string = typeof contentType === 'string' ? contentType : mimeType;

      const openedNatively = await openFileNatively(blob, fileName, mime);
      if (openedNatively) return;

      // Web-Fallback: FileViewerModal mit Swipe-Kontext
      const blobUrl = URL.createObjectURL(new Blob([blob], { type: mime }));
      const allFileMessages = messages.filter(m => m.file_path);
      const files: FileItem[] = allFileMessages.map(m => {
        if (m.file_path === filePath) {
          return { url: blobUrl, fileName: m.file_name || fileName, mimeType: mime };
        }
        return {
          url: `/api/chat/files/${m.file_path}`,
          fileName: m.file_name || 'Datei',
          mimeType: m.file_name ? getMimeFromFileName(m.file_name) : 'application/octet-stream'
        };
      });
      const clickedIndex = allFileMessages.findIndex(m => m.file_path === filePath);
      viewerRef.current = { files, initialIndex: Math.max(0, clickedIndex) };
      presentFileViewer({ cssClass: 'file-viewer-modal' });
    } catch {
      setError('Fehler beim Öffnen der Datei');
    }
  };

  // MIME-Type aus Dateiname ableiten
  const getMimeFromFileName = (name: string): string => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
      mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', webm: 'video/webm', m4v: 'video/mp4',
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    return map[ext] || 'application/octet-stream';
  };

  const canLeaveChat = (): boolean => {
    if (!room) return false;
    // Admins duerfen NIEMALS einen Chat verlassen
    if (user?.type === 'admin') return false;
    // Event-Chats sind an die Event-Teilnahme gekoppelt: Konfis verlassen sie
    // nur ueber die Event-Abmeldung, nicht direkt im Chat.
    if (user?.type === 'konfi' && room.event_id) return false;
    // Teamer:innen duerfen group und admin-Chats verlassen
    if (room.type === 'group') return true;
    if (room.type === 'admin') return true;
    return false;
  };

  const handleLeaveChat = () => {
    if (!isOnline) return;
    presentAlert({
      header: 'Chat verlassen',
      message: 'Chat wirklich verlassen? Du erhältst keine Nachrichten mehr aus diesem Chat.',
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Verlassen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/chat/rooms/${room?.id}/leave`);
              onBack();
            } catch {
              setError('Fehler beim Verlassen des Chats');
            }
          }
        }
      ]
    });
  };

  return (
    <>
      <ChatHeader
        roomName={getDisplayRoomName()}
        roomType={room?.type ?? 'group'}
        isAdmin={user?.type === 'admin'}
        canLeave={canLeaveChat()}
        isOnline={isOnline}
        onBack={onBack}
        onOpenMembers={openMembersModal}
        onOpenPoll={openPollModal}
        onLeaveChat={handleLeaveChat}
        eventId={room?.event_id ?? null}
        partnerType={
          room?.type === 'direct'
            ? (room.participants?.find(p => p.user_id !== user?.id)?.user_type ?? null)
            : null
        }
      />

      <IonContent
        ref={contentRef}
        className="app-gradient-background"
        scrollEvents
        onIonScroll={handleScroll}
        onClick={() => {
          if (selectedMessage || showReactionPicker) {
            setSelectedMessage(null);
            setShowReactionPicker(false);
            setReactionTargetMessage(null);
          }
        }}
      >
        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          loadMessages();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        {/* Schwebender Tages-Chip (WhatsApp-Style): slot="fixed" -> bleibt
            ausserhalb des Scroll-Containers immer oben sichtbar; der Text wird
            beim Scrollen aus der obersten sichtbaren Nachricht aktualisiert. */}
        {floatingDay && messages.length > 0 && (
          <div slot="fixed" style={{
            position: 'absolute', top: '6px', left: 0, right: 0,
            display: 'flex', justifyContent: 'center', zIndex: 10, pointerEvents: 'none'
          }}>
            <span style={{
              fontSize: '0.72rem', fontWeight: 600, color: '#555',
              background: 'rgba(245,245,247,0.95)', backdropFilter: 'blur(4px)',
              padding: '4px 14px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.12)'
            }}>
              {floatingDay}
            </span>
          </div>
        )}

        {user?.type === 'admin' && room && (room.type === 'group' || room.type === 'admin') && (
          <div style={{
            margin: '8px 16px 0',
            padding: '8px 12px',
            backgroundColor: 'rgba(0,0,0,0.05)',
            borderRadius: '8px',
            fontSize: '0.8rem',
            color: '#666',
            textAlign: 'center'
          }}>
            Admins können Chats nicht verlassen. Chats können nur gelöscht werden.
          </div>
        )}

        <div style={{ paddingBottom: '0px', position: 'relative' }}>
          {(() => {
            // Index der ersten ungelesenen Nachricht (= letzte N Nachrichten, N =
            // beim Oeffnen eingefrorene Ungelesen-Anzahl). -1 = keine ungelesenen.
            const unread = initialUnreadRef.current ?? 0;
            const firstUnreadIndex = unread > 0 && unread <= messages.length
              ? messages.length - unread
              : -1;
            let lastDayKey = '';
            return messages.map((message, index) => {
              const created = message.created_at ? new Date(message.created_at) : null;
              const dayKey = created && !isNaN(created.getTime()) ? created.toDateString() : '';
              const showDayDivider = dayKey && dayKey !== lastDayKey;
              if (showDayDivider) lastDayKey = dayKey;
              const showNewDivider = index === firstUnreadIndex;
              return (
                <React.Fragment key={message.id}>
                  {showDayDivider && (
                    <div
                      data-day-divider={formatDayDivider(created!)}
                      style={{
                        display: 'flex', justifyContent: 'center', margin: '12px 0 8px',
                        // Trenner scrollen normal mit. Der oben SCHWEBENDE Chip
                        // (ein einziger) zeigt den aktuellen Tag -> kein Ueberlagern.
                        pointerEvents: 'none'
                      }}
                    >
                      <span style={{
                        fontSize: '0.72rem', fontWeight: 600, color: '#555',
                        background: 'rgba(245,245,247,0.95)',
                        padding: '4px 14px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.12)'
                      }}>
                        {formatDayDivider(created!)}
                      </span>
                    </div>
                  )}
                  {showNewDivider && (
                    <div ref={newDividerRef} style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 12px' }}>
                      <div style={{ flex: 1, height: '1px', background: 'var(--app-color-events)' }} />
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--app-color-events)' }}>Neue Nachrichten</span>
                      <div style={{ flex: 1, height: '1px', background: 'var(--app-color-events)' }} />
                    </div>
                  )}
                  <MessageBubble
                    message={message}
                    room={room}
                    user={user}
                    selectedMessage={selectedMessage}
                    showReactionPicker={showReactionPicker}
                    reactionTargetMessage={reactionTargetMessage}
                    onLongPress={handleLongPress}
                    onReply={setReplyToMessage}
                    onShare={handleShareMessage}
                    onDelete={deleteMessage}
                    onToggleReaction={toggleReaction}
                    onOpenReactionPicker={openReactionPicker}
                    onVoteInPoll={voteInPoll}
                    onFileClick={handleFileClick}
                    onError={setError}
                    onDeselectMessage={() => setSelectedMessage(null)}
                    textareaRef={textareaRef}
                    onRetry={handleRetryMessage}
                    onDeleteQueued={handleDeleteQueuedMessage}
                  />
                </React.Fragment>
              );
            });
          })()}
        </div>
      </IonContent>

      <MessageInput
        messageText={messageText}
        uploading={uploading}
        selectedFile={selectedFile}
        selectedFilePreview={selectedFilePreview}
        replyToMessage={replyToMessage}
        textareaRef={textareaRef}
        fileInputRef={fileInputRef}
        onTextChange={handleTextInputChange}
        onFocus={handleTextareaFocus}
        onSend={sendMessage}
        onFileSelect={handleFileSelect}
        onClearFile={clearSelectedFile}
        onClearReply={() => setReplyToMessage(null)}
      />

    </>
  );
};

export default ChatRoom;
