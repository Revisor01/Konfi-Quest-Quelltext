import { ICON_AUFKLAPPEN_GEFUELLT } from '../shared/icons';
import React, { useState, useEffect, useRef } from 'react';
import {
  IonContent,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  useIonModal,
  useIonAlert,
  useIonActionSheet
} from '@ionic/react';
import { useApp } from '../../contexts/AppContext';
import { offlineBlockiert } from '../../utils/offlineAktion';
import { useBadge } from '../../contexts/BadgeContext';
import { useOfflineQuery } from '../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../services/offlineCache';
import api from '../../services/api';
import { Message, ChatRoomProps as ChatRoomComponentProps } from '../../types/chat';
import ChatMessagesList from './ChatMessagesList';
import ChatVerlaufAnfang from './ChatVerlaufAnfang';
import PollModal from './modals/PollModal';
import MembersModal from './modals/MembersModal';
import { writeQueue, onItemFailed } from '../../services/writeQueue';
import {
  ergaenzeLokaleBubbles,
  chatNachrichtEinreihen,
  nachrichtNeuEinreihen,
  wartendeNachrichtAufraeumen,
} from './chatOutbox';
import {
  sendeFehlerText,
  SENDEFEHLER_ZU_GROSS,
  SENDEFEHLER_DATEITYP,
  SENDEFEHLER_ABGELEHNT,
} from './sendeFehler';
import { fehlerStatus } from '../../utils/fehler';
import { uploadFehlerMelden, warteschlangenFehlerMelden } from '../../services/uploadDiagnose';
import { safeUUID } from '../../utils/uuid';
import { networkMonitor } from '../../services/networkMonitor';
import { ChatHeader, MessageInput, autoCapitalize } from './ChatRoomSections';
import AppKopfzeile from '../shared/AppKopfzeile';
import { haptik, triggerPullHaptic, ImpactStyle } from '../../utils/haptics';
import { useChatScroll } from './useChatScroll';
import { useChatSocket } from './useChatSocket';
import { useUmfragenUndReaktionen } from './useUmfragenUndReaktionen';
import { useChatDateien } from './useChatDateien';
import { nachrichtTeilen } from './chatTeilen';
import { useChatVerwaltung } from './useChatVerwaltung';
import {
  AELTERE_SEITE,
  ERSTER_BLOCK,
  aeltereVoranstellen,
  aeltesteServerId,
  alsGeloescht,
  anfangErreicht,
  juengstenBlockEinpflegen,
} from './chatVerlauf';



const ChatRoom: React.FC<ChatRoomComponentProps> = ({ room, onBack, presentingElement }) => {
  const { user, setError, isOnline } = useApp();
  const { markRoomAsRead: badgeMarkRoomAsRead, refreshAllCounts, chatUnreadByRoom } = useBadge();
  // Anzahl ungelesener Nachrichten beim Oeffnen EINMAL einfrieren (bevor
  // markRoomAsRead sie auf 0 setzt) -> Position des "Neu"-Trenners + Scrollziel.
  const initialUnreadRef = useRef<number | null>(null);
  const newDividerRef = useRef<HTMLDivElement | null>(null);
  // Message-ID, VOR der der "Neue Nachrichten"-Trenner steht — EINMAL beim
  // ersten vollstaendigen Laden eingefroren. Ein Index (laenge - unread) wuerde
  // bei jeder neu angehaengten (auch eigenen) Nachricht nach unten wandern.
  const newDividerAnchorRef = useRef<number | null>(null);

  // --- useOfflineQuery: Initial messages load mit Cache ---
  //
  // Der Offline-Cache haelt NUR den juengsten Block (ERSTER_BLOCK Nachrichten)
  // — genau das, was dieser Abruf liefert. Nachgeladene aeltere Seiten
  // (?before=) leben nur im State des offenen Raums und kommen bewusst nicht in
  // den Cache: Wer ein Jahr zurueckblaettert, wuerde sonst
  // Tausende Nachrichten samt Reaktionen und Umfragen in den Geraetespeicher
  // schreiben und bei jedem Oeffnen wieder einlesen. Offline zeigt der Raum
  // damit die juengsten 100; aeltere laden, sobald wieder Netz da ist.
  const { data: initialMessages, refresh: refreshMessagesCache } = useOfflineQuery<Message[]>(
    'chat:messages:' + room?.id,
    () => api.get(`/chat/rooms/${room?.id}/messages?limit=${ERSTER_BLOCK}`).then(r => r.data),
    { ttl: CACHE_TTL.CHAT_MESSAGES, enabled: !!room?.id }
  );

  // Lokaler messages-State für Live-Updates (WebSocket aktualisiert diesen direkt)
  const [messages, setMessages] = useState<Message[]>([]);

  // Blaettern nach oben (chatVerlauf.ts): id der aeltesten Nachricht in dem
  // Moment, als der Server weniger lieferte als angefordert — solange sie die
  // aelteste der Liste ist, ist der Anfang des Chats erreicht.
  const [anfangBei, setAnfangBei] = useState<number | null>(null);
  const [laedtAeltere, setLaedtAeltere] = useState(false);
  const [aeltereFehlgeschlagen, setAeltereFehlgeschlagen] = useState(false);
  const laedtAeltereRef = useRef(false);
  // Raum zum Zeitpunkt der Antwort — eine spaete Antwort fuer einen anderen
  // Raum darf nicht in diese Liste geraten.
  const raumIdRef = useRef(room?.id);
  useEffect(() => { raumIdRef.current = room?.id; }, [room?.id]);

  // Den juengsten Block einpflegen: bereits nachgeladene aeltere Nachrichten
  // bleiben stehen, wenn der Block an sie anschliesst. Ein Block unter
  // ERSTER_BLOCK ist der ganze Chat — dann ist der Anfang erreicht.
  const juengstenBlockUebernehmen = (block: Message[]) => {
    setMessages(prev => juengstenBlockEinpflegen(block, prev));
    if (block.length < ERSTER_BLOCK) setAnfangBei(block.length > 0 ? block[0].id : null);
  };

  // Initiale Nachrichten aus Cache/API in lokalen State kopieren
  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      // Merge statt Ersetzen: sonst löscht der Cache-/API-Stand die noch nicht
      // zugestellten lokalen Nachrichten aus der Liste — und die bereits
      // nachgeladenen aelteren.
      juengstenBlockUebernehmen(initialMessages);
      // Ist die Server-Kopie da, ist der "endgueltig fehlgeschlagen"-Merker
      // fuer diese client_ids hinfaellig (best-effort).
      writeQueue.forgetFailedChatMany(initialMessages.map(m => m.client_id));
    }
  }, [initialMessages]);

  // Gibt die Queue eine Nachricht endgueltig auf, blieb die Bubble bisher auf
  // 'pending' stehen — ohne Hinweis und ohne Weg zum Neuversand. Jetzt wird sie
  // als fehlgeschlagen markiert und bekommt damit den Retry-Button.
  useEffect(() => {
    return onItemFailed((item) => {
      if (item.metadata.type !== 'chat') return;
      if (room?.id && item.metadata.roomId !== room.id) return;
      const clientId = item.metadata.clientId;
      // Mit Datei: fuer die Messung, ob auch der Versand aus der eigenen
      // Kopie der Warteschlange scheitert (services/uploadDiagnose.ts).
      if (item.body?._localFilePath) warteschlangenFehlerMelden(item.error.status);
      // Mit dem Status: Bei einer endgueltigen Ablehnung (413, 415 ...) steht
      // der Grund an der Nachricht, und das Menue bietet kein "Erneut senden".
      setMessages(prev => prev.map(m =>
        m.localId === clientId ? { ...m, queueStatus: 'error' as const, sendeFehlerStatus: item.error.status } : m
      ));
    });
  }, [room?.id]);

  // Beim Oeffnen des Raums noch nicht zugestellte Nachrichten wieder anzeigen:
  // wartende Queue-Items als "wird gesendet", endgueltig fehlgeschlagene aus
  // dem Merker als "fehlgeschlagen" mit Retry-Knopf. Ohne das war eine
  // ungesendete Nachricht nach App-Neustart unsichtbar — und ein endgueltiger
  // Fehlschlag bei geschlossenem Chat spurlos (verschwundene Nachricht).
  useEffect(() => {
    if (!room?.id || !user) return;
    let aktiv = true;
    (async () => {
      const [queueItems, fehlgeschlagene] = await Promise.all([
        writeQueue.getByMetadata({ roomId: room.id, type: 'chat' }),
        writeQueue.getFailedChat(room.id),
      ]);
      if (!aktiv || (queueItems.length === 0 && fehlgeschlagene.length === 0)) return;
      setMessages(prev => ergaenzeLokaleBubbles(prev, queueItems, fehlgeschlagene, {
        id: user.id,
        name: user.display_name || '',
        type: (user.type || 'konfi') as 'admin' | 'teamer' | 'konfi',
      }));
    })();
    return () => { aktiv = false; };
  }, [room?.id]);

  const [messageText, setMessageText] = useState('');
  // Datei-Auswahl (Kamera, Galerie, Kompression, 10MB-Grenze) und das Oeffnen
  // empfangener Dateien liegen gebuendelt in useChatDateien.
  const {
    selectedFile,
    selectedFilePreview,
    dateiWaehlen,
    clearSelectedFile,
    handleFileClick,
    ladendeDatei,
  } = useChatDateien({ messages });

  const [uploading, setUploading] = useState(false);
  // Die gerade hochgeladene Nachricht und ihr Fortschritt. Ohne sichtbare
  // Rueckmeldung tippen Leute bei grossen PDFs mehrfach auf Senden, weil
  // nichts zu passieren scheint.
  //
  // Die Anzeige haengt an der optimistischen Nachricht, NICHT an der
  // Datei-Vorschau: Die wird beim Senden sofort geleert (clearSelectedFile),
  // damit das Eingabefeld wieder frei ist — ein Balken dort waere nie zu
  // sehen. `localId` ordnet den Fortschritt der richtigen Blase zu.
  const [uploadFortschritt, setUploadFortschritt] = useState<{ localId: string; prozent: number } | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  // Scroll-Verhalten (Initial-Scroll, Auto-Scroll, Tages-Chip, "Nach unten"-
  // Button, Tastatur) liegt gebuendelt in useChatScroll.
  // Nahe am Listenanfang ruft useChatScroll ladeAeltere (weiter unten
  // definiert, darum ueber eine Ref).
  const ladeAeltereRef = useRef<() => void>(() => {});
  const {
    contentRef,
    setShouldAutoScroll,
    floatingDay,
    showScrollDown,
    parkedAtDividerRef,
    handleScroll,
    handleScrollDownClick,
    handleTextareaFocus,
    positionVorVoranstellenMerken,
  } = useChatScroll({
    messages,
    initialUnreadRef,
    newDividerRef,
    onNaheAmAnfang: () => ladeAeltereRef.current(),
  });
  const textareaRef = useRef<HTMLIonTextareaElement>(null);
  // client_ids eigener Sendungen, deren Server-Kopie noch nicht per Socket
  // angekommen ist — Fallback-Reload nur wenn der Socket nicht liefert.
  const pendingSendsRef = useRef<Set<string>>(new Set());


  // Hooks müssen vor conditional returns stehen!
  const [presentAlert] = useIonAlert();
  const [presentActionSheet] = useIonActionSheet();

  const handleRetryMessage = (message: Message) => {
    const loeschen = {
      text: 'Nachricht löschen',
      role: 'destructive',
      handler: async () => {
        // Aus UI entfernen
        setMessages(prev => prev.filter(m => m.localId !== message.localId));
        // Queue-Item, Fehl-Merker und lokale Dateikopien aufraeumen
        // (Loeschen ist eine bewusste Entscheidung).
        await wartendeNachrichtAufraeumen(room?.id, message.localId);
      }
    };
    const abbrechen = { text: 'Abbrechen', role: 'cancel' };

    // Endgueltig abgelehnt (413 zu gross, 415 Dateityp, sonst 4xx ausser
    // 408/429): Ein neuer Versuch schickte dieselbe Datei und scheiterte
    // gleich. Das Menue nennt den Grund und bietet nur das Loeschen an.
    const grund = sendeFehlerText(message.sendeFehlerStatus);
    if (grund) {
      presentActionSheet({
        header: 'Nachricht nicht gesendet',
        subHeader: grund,
        buttons: [loeschen, abbrechen]
      });
      return;
    }

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
            // Erneut einreihen — die Fallunterscheidung (Queue-Item, Fehl-
            // Merker, Text) liegt in chatOutbox.nachrichtNeuEinreihen.
            const eingereiht = await nachrichtNeuEinreihen(room?.id, message);
            if (!eingereiht) {
              // Ein Neuversand ist nicht möglich. Ehrlich melden statt still
              // nichts zu tun.
              setMessages(prev => prev.map(m =>
                m.localId === message.localId ? { ...m, queueStatus: 'error' as const } : m
              ));
              setError('Diese Nachricht lässt sich nicht mehr senden. Bitte neu schreiben.');
              return;
            }
            // Flush versuchen wenn online
            if (networkMonitor.isOnline) {
              writeQueue.flush();
            }
          }
        },
        loeschen,
        abbrechen
      ]
    });
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

  // Mark-Read drosseln: Ohne Debounce feuerte dieser
  // Effekt pro empfangener Nachricht einen POST /mark-read. Wichtig: Der lokale
  // Badge geht trotzdem SOFORT weg -- badgeMarkRoomAsRead() im BadgeContext
  // macht ein optimistisches Update. Gedrosselt wird NUR der Server-POST.
  // Verhalten: erster Aufruf (Chat-Oeffnen) läuft sofort (leading), damit der
  // Badge zuegig verschwindet; Folgenachrichten werden mit 1.5s gebuendelt
  // (letzter Aufruf gewinnt).
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadLeadingDoneRef = useRef(false);
  useEffect(() => {
    if (messages.length === 0) return;

    if (!markReadLeadingDoneRef.current) {
      // Erster Trigger nach Mount: sofort ausfuehren (Badge zuegig weg).
      markReadLeadingDoneRef.current = true;
      markRoomAsRead();
      return;
    }

    // Folgenachrichten: debounced, letzter Aufruf gewinnt.
    if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
    markReadTimerRef.current = setTimeout(() => {
      markRoomAsRead();
    }, 1500);

    return () => {
      if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
    };
  }, [messages.length]);


  const loadMessages = async () => {
    // Kein eigener Loading State - ChatRoomView handled das Loading
    if (!room) return;
    try {
      const response = await api.get(`/chat/rooms/${room.id}/messages?limit=${ERSTER_BLOCK}`);
      juengstenBlockUebernehmen(response.data);

      // Don't pre-load images anymore - use lazy loading instead for better performance
    } catch (err) {
      setError('Fehler beim Laden der Nachrichten');
 console.error('Error loading messages:', err);
    } finally {
      // Loading wird im ChatRoomView gehandhabt
    }
  };

  // Aeltere Nachrichten nachladen: die
  // naechsten AELTERE_SEITE vor der aeltesten geladenen, oben einfuegen, die
  // Leseposition halten (useChatScroll). Kommen weniger als angefordert, ist
  // der Anfang des Chats erreicht. Doppelte fuehrt aeltereVoranstellen nach
  // id zusammen. Schlaegt es fehl, laedt nichts automatisch nach — der Knopf
  // oben startet den naechsten Versuch (sonst feuerte jedes Scroll-Ereignis
  // am Anfang eine weitere Anfrage ins Funkloch).
  const ladeAeltere = async (erneut = false) => {
    if (!room || laedtAeltereRef.current) return;
    if (aeltereFehlgeschlagen && !erneut) return;
    if (anfangErreicht(messages, anfangBei)) return;
    const aelteste = aeltesteServerId(messages);
    if (aelteste === null) return;
    const raumId = room.id;

    laedtAeltereRef.current = true;
    setLaedtAeltere(true);
    setAeltereFehlgeschlagen(false);
    try {
      const response = await api.get(`/chat/rooms/${raumId}/messages?before=${aelteste}&limit=${AELTERE_SEITE}`);
      const aeltere: Message[] = response.data;
      if (raumIdRef.current !== raumId) return;
      if (aeltere.length > 0) {
        positionVorVoranstellenMerken(aelteste);
        setMessages(prev => aeltereVoranstellen(prev, aeltere));
      }
      if (aeltere.length < AELTERE_SEITE) {
        setAnfangBei(aeltere.length > 0 ? aeltere[0].id : aelteste);
      }
    } catch (err) {
      console.error('Fehler beim Laden älterer Nachrichten:', err);
      setAeltereFehlgeschlagen(true);
    } finally {
      laedtAeltereRef.current = false;
      setLaedtAeltere(false);
    }
  };
  // Nach jedem Rendern die aktuelle Fassung hinterlegen (sie liest messages
  // und anfangBei aus diesem Rendern).
  useEffect(() => { ladeAeltereRef.current = () => { ladeAeltere(); }; });

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

  const markRoomAsRead = async () => {
    if (!room) return;
    try {
      // ERST das Lesen beim Server verbuchen lassen, DANN die Zaehler holen.
      await badgeMarkRoomAsRead(room.id);

      // Jetzt stimmen die Zahlen auf dem Server, das Nachladen bestaetigt sie.
      await refreshAllCounts();

    } catch (err) {
      // Silent fail - marking as read is not critical
      console.error('Error marking room as read:', err);
    }
  };

  // Socket-Verdrahtung (Raum betreten, Live-Events, 30s-Fallback-Poll,
  // Reconnect-Nachladen) liegt gebuendelt in useChatSocket. Der Hook friert
  // beim Betreten auch die Ungelesen-Anzahl ein und setzt die Trenner-Refs
  // beim Verlassen des Raums zurueck.
  useChatSocket({
    roomId: room?.id,
    roomUnreadCount: room?.unread_count,
    userId: user?.id,
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
  });

  // Umfrage-Stimmen, Reaktionen und der Reaktions-Picker liegen gebuendelt in
  // useUmfragenUndReaktionen (optimistisches UI + Offline-Queue 'chat-aktion').
  const {
    showReactionPicker,
    setShowReactionPicker,
    reactionTargetMessage,
    setReactionTargetMessage,
    voteInPoll,
    toggleReaction,
    openReactionPicker,
  } = useUmfragenUndReaktionen({ setMessages, setShouldAutoScroll, loadMessages });

  const sendMessage = async () => {
    if (!messageText.trim() && !selectedFile) return;
    if (!room) return;

    const clientId = safeUUID();
    // EINE Kennung fuer die Blase und fuer Warteschlange und Fehl-Merker
    // Bis dahin bekam die Blase eine eigene localId, waehrend
    // onItemFailed, "Erneut senden" und "Nachricht löschen" sie mit der
    // client_id der Warteschlange verglichen -- fuer eine in dieser Sitzung
    // geschriebene Nachricht passte das nie: Sie blieb nach einem Fehlschlag
    // auf "wartet", Loeschen raeumte den Merker nicht, und sie kam beim
    // naechsten Oeffnen wieder. Die Blasen aus Warteschlange und Merker
    // (chatOutbox) tragen schon immer beides gleich.
    const localId = clientId;
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
      clientId,
    };

    // Eigene Nachricht geschrieben -> der "Neue Nachrichten"-Trenner hat seinen
    // Zweck erfuellt (Einstiegs-Indikator) und verschwindet.
    newDividerAnchorRef.current = null;
    initialUnreadRef.current = 0;
    parkedAtDividerRef.current = false;

    // UI sofort aktualisieren
    setMessages(prev => [...prev, optimisticMsg]);
    setMessageText('');
    setReplyToMessage(null);
    clearSelectedFile();
    setShouldAutoScroll(true);
    // Eigene Nachricht: am Divider-Park lösen, sonst bleibt der Scroll oben hängen.
    parkedAtDividerRef.current = false;
    // Doppel-rAF statt setTimeout(100): direkt nach dem Rendern der optimistischen
    // Bubble instant ans Ende springen — kein animiertes Nachziehen.
    requestAnimationFrame(() => requestAnimationFrame(() => contentRef.current?.scrollToBottom(0)));

    if (networkMonitor.isOnline) {
      // Online: Normal senden
      setUploading(true);
      // Nur bei einer Datei: Reiner Text ist sofort durch, ein Balken wuerde
      // dabei nur aufblitzen.
      setUploadFortschritt(file ? { localId, prozent: 0 } : null);
      pendingSendsRef.current.add(clientId);
      try {
        const formData = new FormData();
        if (content) formData.append('content', content);
        if (file) formData.append('file', file);
        if (replyToId) formData.append('reply_to', replyToId.toString());
        formData.append('client_id', clientId);

        await api.post(`/chat/rooms/${room.id}/messages`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          // Mit Datei kann der Upload auf Mobilfunk laenger als die globalen 20s dauern
          timeout: file ? 60000 : 20000,
          onUploadProgress: file ? (ereignis) => {
            // `total` fehlt, wenn der Server die Groesse nicht meldet — dann
            // bleibt der Balken unbestimmt statt auf einer geratenen Zahl zu
            // stehen.
            if (!ereignis.total) return;
            const prozent = Math.round((ereignis.loaded / ereignis.total) * 100);
            // Bei 100 bleibt der Balken stehen, bis die Antwort da ist: Der
            // Server verarbeitet danach noch (Bild umrechnen, verschluesseln).
            setUploadFortschritt({ localId, prozent: Math.min(prozent, 100) });
          } : undefined
        });

        // Die Server-Kopie kommt per newMessage-Socket-Event und ersetzt die
        // optimistische Nachricht IN-PLACE (client_id-Match im Handler) —
        // kein Voll-Reload pro Senden mehr; der liess die eigene Nachricht
        // kurz doppelt erscheinen. Fallback: liefert der Socket nicht binnen
        // 2,5s (z.B. still tot), einmal komplett nachladen.
        setTimeout(() => {
          if (pendingSendsRef.current.has(clientId)) {
            pendingSendsRef.current.delete(clientId);
            loadMessages();
          }
        }, 2500);

        if (room) markRoomAsRead();
        setShouldAutoScroll(true);
      } catch (err) {
        pendingSendsRef.current.delete(clientId);
        const status = fehlerStatus(err);
        const grund = sendeFehlerText(status);
        if (status !== undefined && grund) {
          setMessages(prev => prev.map(m =>
            m.localId === localId ? { ...m, queueStatus: 'error' as const, sendeFehlerStatus: status } : m
          ));
          // Feste Texte (Positivliste der Fehlermessung), nie der des Servers.
          setError(status === 413 ? SENDEFEHLER_ZU_GROSS : status === 415 ? SENDEFEHLER_DATEITYP : SENDEFEHLER_ABGELEHNT);
          try {
            await writeQueue.chatAblehnungMerken(
              { clientId, roomId: room.id, content, fileName: file?.name, fileType: file?.type, createdAt: Date.now() },
              { status, message: grund }
            );
          } catch (merkErr) {
            console.error('Abgelehnte Nachricht konnte nicht gemerkt werden:', merkErr);
          }
          return;
        }
        if (file) uploadFehlerMelden('chat-datei-direkt', err);
        // Fehlgeschlagener Online-Versand: Die Nachricht lebte bisher NUR im
        // React-State — Raum verlassen oder App neu gestartet, und sie war
        // weg (verschwundene Nachricht). Jetzt wird sie in die Queue
        // persistiert und automatisch neu versucht; die client_id macht den
        // Neuversand serverseitig idempotent, falls nur die Antwort verloren
        // ging (kein Doppelversand).
        try {
          await chatNachrichtEinreihen(room.id, { clientId, content, file, replyToId });
          if (networkMonitor.isOnline) writeQueue.flush();
        } catch (queueErr) {
          console.error('Nachricht konnte nicht in die Queue gesichert werden:', queueErr);
          if (file) uploadFehlerMelden('chat-datei-sichern', queueErr);
          setMessages(prev => prev.map(m =>
            m.localId === localId ? { ...m, queueStatus: 'error' as const } : m
          ));
        }
      } finally {
        setUploading(false);
        setUploadFortschritt(null);
      }
    } else {
      // Offline: In Queue schreiben (Datei wird dabei lokal gesichert)
      try {
        await chatNachrichtEinreihen(room.id, { clientId, content, file, replyToId });
      } catch (fileErr) {
        console.error('Fehler beim Einreihen der Nachricht:', fileErr);
        setMessages(prev => prev.map(m =>
          m.localId === localId ? { ...m, queueStatus: 'error' as const } : m
        ));
      }
    }
  };

  const handlePollCreated = async () => {
    await loadMessages();
  };


  const deleteMessage = (messageId: number) => {
    if (offlineBlockiert(isOnline, setError)) return;
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
                // Sofort als geloescht zeigen: Liegt die Nachricht im
                // nachgeladenen aelteren Teil, bringt der juengste Block sie
                // nicht mit.
                setMessages(prev => prev.map(m => (m.id === messageId ? alsGeloescht(m) : m)));
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

  const handleTextInputChange = (value: string) => {
    setMessageText(autoCapitalize(value));
  };

  const handleLongPress = async (message: Message) => {
    try {
      // Native haptic feedback
      await haptik(ImpactStyle.Medium);

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

  // Teilen-Blatt fuer eine Nachricht, Details in chatTeilen.nachrichtTeilen.
  // Die Nachricht kommt als Argument, nicht aus selectedMessage: der frühere
  // Weg setzte den Zustand und las ihn sofort wieder — also den Stand des
  // vorigen Renderns. Solange nur die ohnehin ausgewählte Nachricht geteilt
  // wurde, fiel das nicht auf; eine zweite Aufrufstelle hätte die falsche
  // Nachricht geteilt.
  const handleShareMessage = async (message: Message) => {
    setSelectedMessage(message);
    await nachrichtTeilen(message, setError);
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

  // Verwaltung (Rechte-Ableitungen, Optionen-Blatt hinter dem Menue-Button,
  // Team-Chat leeren, Verlassen) liegt gebuendelt in useChatVerwaltung.
  const {
    canLeaveChat,
    istLeitung,
    darfTeamChatLeeren,
    handleChatOptions,
    handleClearChat,
  } = useChatVerwaltung({ room, onBack, getDisplayRoomName, setMessages, refreshMessagesCache });

  // Early return nach allen Hooks wenn room noch nicht geladen ist
  if (!room) {
    return (
      <>
        {/* Opak wie der ChatHeader danach, sonst springt die Kopfzeile beim
            Wechsel vom Laden zum Raum. */}
        <AppKopfzeile titel="Chat wird geladen..." onZurueck={onBack} translucent={false} gemeindeUmschalter={false} />
        <IonContent className="app-gradient-background" fullscreen>
          <div style={{ textAlign: 'center', padding: 'var(--app-abstand-riesig)' }}>
            <p>Chat wird geladen...</p>
          </div>
        </IonContent>
      </>
    );
  }

  return (
    <>
      <ChatHeader
        roomName={getDisplayRoomName()}
        roomType={room?.type ?? 'group'}
        isAdmin={user?.type === 'admin'}
        // Menue-Button auch für die Leitung zeigen, wenn sie den Chat zwar
        // nicht verlassen darf, aber exportieren kann.
        canLeave={canLeaveChat() || istLeitung}
        isOnline={isOnline}
        onBack={onBack}
        onOpenMembers={openMembersModal}
        onOpenPoll={openPollModal}
        onLeaveChat={handleChatOptions}
        // Mülleimer nur im automatischen Team-Chat und nur für die Leitung —
        // der Server prüft beides ebenfalls.
        onClearChat={darfTeamChatLeeren && room?.is_team_chat ? handleClearChat : null}
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
              fontSize: 'var(--app-text-meta)', fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-text-body)',
              background: 'var(--app-surface-muted)', backdropFilter: 'blur(4px)',
              padding: 'var(--app-abstand-mini) var(--app-abstand-mittelweit)', borderRadius: 'var(--app-radius-karte)', boxShadow: 'var(--app-schatten-flach)'
            }}>
              {floatingDay}
            </span>
          </div>
        )}

        {/* "Nach unten"-Button: slot="fixed" -> haengt ueber dem Scroll-Inhalt
            unten rechts, direkt oberhalb des Eingabefelds. Erscheint nur, wenn
            man weiter oben liest (SCROLL_DOWN_THRESHOLD). */}
        <div
          slot="fixed"
          style={{
            position: 'absolute',
            right: '16px',
            bottom: 'calc(16px + env(safe-area-inset-bottom))',
            zIndex: 11,
            opacity: showScrollDown ? 1 : 0,
            transform: showScrollDown ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.9)',
            pointerEvents: showScrollDown ? 'auto' : 'none',
            transition: 'opacity 180ms ease, transform 180ms ease'
          }}
          aria-hidden={!showScrollDown}
        >
          <button
            type="button"
            onClick={handleScrollDownClick}
            aria-label="Zu den neuesten Nachrichten springen"
            style={{
              width: '40px',
              height: '40px',
              borderRadius: 'var(--app-radius-kreis)',
              border: 'none',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              backgroundColor: 'var(--app-surface-card)',
              backdropFilter: 'blur(10px)',
              boxShadow: 'var(--app-schatten-karte-stark)'
            }}
          >
            <IonIcon icon={ICON_AUFKLAPPEN_GEFUELLT} style={{ fontSize: 'var(--app-text-titel)', color: 'var(--app-text-chat)' }} />
          </button>
        </div>

        {user?.type === 'admin' && room && (room.type === 'group' || room.type === 'admin') && (
          <div style={{
            margin: 'var(--app-abstand-eng) var(--app-abstand-basis) 0',
            padding: 'var(--app-abstand-eng) var(--app-abstand-mittel)',
            backgroundColor: 'rgba(0,0,0,0.05)',
            borderRadius: 'var(--app-radius-klein)',
            fontSize: 'var(--app-text-hinweis)',
            color: 'var(--app-text-secondary)',
            textAlign: 'center'
          }}>
            Die Leitung kann Chats nicht verlassen. Chats können nur gelöscht werden.
          </div>
        )}

        {messages.length > 0 && (
          <ChatVerlaufAnfang
            laedt={laedtAeltere}
            fehler={aeltereFehlgeschlagen}
            anfang={anfangErreicht(messages, anfangBei)}
            onErneutLaden={() => { ladeAeltere(true); }}
          />
        )}

        <ChatMessagesList
          messages={messages}
          initialUnreadRef={initialUnreadRef}
          newDividerAnchorRef={newDividerAnchorRef}
          newDividerRef={newDividerRef}
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
          ladendeDatei={ladendeDatei}
          uploadFortschritt={uploadFortschritt}
          onError={setError}
          onDeselectMessage={() => {
            setSelectedMessage(null);
            setShowReactionPicker(false);
            setReactionTargetMessage(null);
          }}
          textareaRef={textareaRef}
          onRetry={handleRetryMessage}
        />
      </IonContent>

      <MessageInput
        messageText={messageText}
        uploading={uploading}
        selectedFile={selectedFile}
        selectedFilePreview={selectedFilePreview}
        replyToMessage={replyToMessage}
        textareaRef={textareaRef}
        onTextChange={handleTextInputChange}
        onFocus={handleTextareaFocus}
        onSend={sendMessage}
        onDateiWaehlen={dateiWaehlen}
        onClearFile={clearSelectedFile}
        onClearReply={() => setReplyToMessage(null)}
      />

    </>
  );
};

export default ChatRoom;
