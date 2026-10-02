import { fehlerText } from '../../utils/fehler';
import React, { useState, useEffect } from 'react';
import { useAppLocation } from '../../navigation/useAppLocation';
import {
  IonPage,
  IonContent,
  IonItem,
  IonInput,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  IonCard,
  IonCardContent,
  IonButton,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonList,
  IonListHeader,
  IonItemGroup,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  useIonModal,
  useIonAlert,
  useIonViewWillEnter
} from '@ionic/react';
import AppKopfzeile, { AppKopfzeileGross } from '../shared/AppKopfzeile';
import {
  ICON_CHATS,
  ICON_CHATS_GEFUELLT,
  ICON_EINSTELLUNGEN_GEFUELLT,
  ICON_FILTER,
  ICON_GRUPPE_GEFUELLT,
  ICON_HINZUFUEGEN_GEFUELLT,
  ICON_LOESCHEN_GEFUELLT,
  ICON_PERSON_GEFUELLT,
  ICON_SUCHE_GEFUELLT,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT_GEFUELLT,
} from '../shared/icons';

import { useApp } from '../../contexts/AppContext';
import { offlineBlockiert } from '../../utils/offlineAktion';
import { useBadge } from '../../contexts/BadgeContext';
import ZaehlerKugel from '../shared/ZaehlerKugel';
import { SectionHeader, EmptyState } from '../shared';
import { useModalPage } from '../../contexts/ModalContext';
import { useOfflineQuery } from '../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../services/offlineCache';
import api from '../../services/api';
import { onReconnect, initializeWebSocket } from '../../services/websocket';
import { getToken } from '../../services/tokenStore';
import { useLiveUpdate } from '../../contexts/LiveUpdateContext';
import LoadingSpinner from '../common/LoadingSpinner';
import SimpleCreateChatModal from './modals/SimpleCreateChatModal';
import { ChatRoomOverview } from '../../types/chat';
import { triggerPullHaptic } from '../../utils/haptics';
import { closeOpenSlidingItems } from '../../utils/slidingItems';
import { istTeamTyp } from '../../utils/chatRoles';

interface ChatOverviewProps {
  onSelectRoom: (room: ChatRoomOverview) => void;
  // Im iPad-Split-View aktuell rechts geoeffneter Raum (für Highlighting).
  selectedRoomId?: number | null;
}

interface ChatOverviewRef {
  loadChatRooms: () => void;
}

const ChatOverview = React.forwardRef<ChatOverviewRef, ChatOverviewProps>(({ onSelectRoom, selectedRoomId }, ref) => {
  const { user, setError, isOnline } = useApp();
  const [presentAlert] = useIonAlert();
  const { chatUnreadByRoom } = useBadge();
  // socketEpoch: nach Reconnect-mit-neuem-Token ist getSocket() ein anderes
  // Objekt -> Listener am frischen Socket neu binden (gleiches Muster wie im
  // BadgeContext).
  const { socketEpoch } = useLiveUpdate();
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<string>('alle');

  // Loeschrecht: nur Leitung/Admins (so prüft es auch das Backend,
  // DELETE /chat/rooms/:roomId verlangt type === 'admin').
  const isAdmin = user?.type === 'admin';
  // Reiter "Team": alle, die selbst zum Team gehören — also auch Teamer:innen.
  // Sie sind in Produktion in 4 Team-Chats, sahen den Reiter aber nicht, weil
  // hier auf 'admin' geprüft wurde (gleiche Verwechslung wie in chatRoles).
  const gehoertZumTeam = istTeamTyp(user?.type);

  // Zentrale Logik: Ist das ein Team-Chat (= pink, gehört in den Team-Tab)?
  // - Direktchat: Partner gehört zum Team (partner_user_type 'admin' ODER 'teamer')
  // - type='admin': ausdrueckliche Team-Gruppe
  // - type='group': reiner Team-Gruppenchat (alle Teilnehmer Teamer:innen)
  // Konfi-Direktchats + gemischte/Konfi-Gruppen sind KEINE Team-Chats.
  //
  // chat_participants.user_type speichert 'teamer' als eigenen Wert (nicht als
  // 'admin'). Die Prüfung nur auf 'admin' sortierte Direktchats mit
  // Teamer:innen deshalb in den falschen Reiter.
  const isTeamChat = (room: ChatRoomOverview): boolean => {
    if (room.event_id) return false;
    if (room.type === 'admin') return true;
    if (room.type === 'direct') return istTeamTyp(room.partner_user_type);
    if (room.type === 'group') return room.is_team_only === true;
    return false;
  };

  const getRoomColorClass = (room: ChatRoomOverview): string => {
    if (room.event_id) return 'events';
    if (room.type === 'jahrgang') return 'chat-jahrgang';
    // Team-Chats (Team-Gruppe / Team-DM / reine Team-group) -> pink
    if (isTeamChat(room)) return 'team';
    switch (room.type) {
      case 'group': return 'group';     // gemischte/Konfi-Gruppe -> orange
      case 'direct': return 'konfi';    // Konfi-DM -> lila
      default: return 'konfi';
    }
  };

  // Nutze den useModalPage Hook, um die Seite zu registrieren
  const location = useAppLocation();
  // Bestimme die korrekte Tab-ID basierend auf dem Pfad
  const tabId = location.pathname.startsWith('/admin') ? 'admin-chat' : 'chat';
  const { pageRef } = useModalPage(tabId);

  const sanitizeRooms = (raw: ChatRoomOverview[]): ChatRoomOverview[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(room => room && typeof room === 'object' && room.id != null)
      .map(room => ({
        ...room,
        name: typeof room.name === 'string' ? room.name : '',
        // participant_count defensiv: nur plausible Zahlen, sonst 0.
        // Verhindert dass eine absurd grosse Zahl (Explosion) durchschlaegt.
        participant_count:
          typeof room.participant_count === 'number' && room.participant_count >= 0
            ? room.participant_count
            : 0,
        // participants-Array bleibt nur wenn es wirklich ein Array ist
        participants: Array.isArray(room.participants) ? room.participants : [],
      }));
  };

  const { data: rooms, loading, refresh } = useOfflineQuery<ChatRoomOverview[]>(
    'chat:rooms:' + user?.id,
    () => api.get('/chat/rooms').then(r => r.data),
    { ttl: CACHE_TTL.CHAT_ROOMS, select: sanitizeRooms }
  );

  // Live-Update der Chat-Räume wenn Badge Count sich ändert.
  // Das ist der EINZIGE newMessage-getriebene Refresh-Trigger der Overview:
  // BadgeContext haelt einen eigenen (socketEpoch-rebindenden) 'newMessage'-
  // Listener, der refreshAllCounts() ruft -> chatUnreadByRoom ändert sich ->
  // dieser Effect feuert refresh(). Ein zusaetzlicher eigener socket.on(
  // 'newMessage')-Handler wäre redundant (3x /chat/rooms pro Nachricht) und
  // hätte zudem KEIN socketEpoch-Rebind nach Reconnect -- deshalb bewusst
  // entfernt.
  useEffect(() => {
    if (rooms && rooms.length > 0) { // Nur wenn bereits Räume geladen sind
      refresh(); // Silent reload via useOfflineQuery
    }
  }, [chatUnreadByRoom]);

  // Bei Socket-Reconnect Raumliste neu laden
  useEffect(() => {
    const unsubReconnect = onReconnect(() => {
      refresh(); // Silent reload bei Reconnect
    });
    return () => { unsubReconnect(); };
  }, [refresh]);

  // Live-Update der Raumliste bei Raum-Änderungen (Raum erstellt/gelöscht,
  // Teilnehmer hinzugefuegt/entfernt/verlassen). Der Server sendet 'roomsChanged'
  // an die persoenlichen User-Räume der betroffenen Nutzer.
  // socketEpoch in den Deps -> Rebind am frischen Socket nach
  // Reconnect-mit-neuem-Token (gleiche Disziplin wie der BadgeContext-Listener).
  useEffect(() => {
    const token = getToken();
    if (!token || !user) return;

    const socket = initializeWebSocket(token);
    const handleRoomsChanged = () => {
      refresh();
    };
    socket.on('roomsChanged', handleRoomsChanged);

    return () => {
      socket.off('roomsChanged', handleRoomsChanged);
    };
  }, [refresh, user, socketEpoch]);

  const mountedAtRef = React.useRef(Date.now());
  useIonViewWillEnter(() => {
    if (Date.now() - mountedAtRef.current > 2000) {
      refresh();
    }
  });

  // Modal mit useIonModal Hook
  const [presentChatModalHook, dismissChatModalHook] = useIonModal(SimpleCreateChatModal, {
    onClose: () => dismissChatModalHook(),
    onSuccess: async (roomId?: number) => {
      dismissChatModalHook();
      await refresh(); // Chatliste neu laden
      // Direkt in den neu erstellten/gefundenen Chat springen statt auf der Liste
      // zu bleiben. Raum frisch von der API holen (refresh-State ist evtl. noch
      // nicht durchgereicht).
      if (roomId) {
        try {
          const freshRooms: ChatRoomOverview[] = (await api.get('/chat/rooms')).data;
          const target = freshRooms.find(r => r.id === roomId);
          if (target) onSelectRoom(target);
        } catch (err) {
          console.error('Konnte neuen Chat nicht oeffnen:', err);
        }
      }
    }
  });

  const handleCreateNewChat = () => {
    presentChatModalHook({
      presentingElement: pageRef.current || undefined
    });
  };

  // Expose refresh to parent component (backward-compatible as loadChatRooms)
  React.useImperativeHandle(ref, () => ({
    loadChatRooms: () => refresh()
  }));

  const deleteRoom = (room: ChatRoomOverview) => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Chat löschen?',
      message: `"${room.name}" wird für alle Teilnehmer:innen gelöscht. Alle Nachrichten und Dateien gehen unwiderruflich verloren.`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: () => {
            // Direkt löschen
            api.delete(`/chat/rooms/${room.id}`)
              .then(() => {
                refresh();
              })
              .catch((error: unknown) => {
                const data = typeof error === 'object' && error !== null
                  ? (error as { response?: { data?: { canForceDelete?: boolean; error?: string } } }).response?.data
                  : undefined;
                if (data?.canForceDelete) {
                  // Hat Nachrichten - Force Delete nötig
                  setTimeout(() => {
                    presentAlert({
                      header: 'Chat hat Nachrichten',
                      message: `${data.error}\n\nTrotzdem löschen?`,
                      buttons: [
                        { text: 'Abbrechen', role: 'cancel' },
                        {
                          text: 'Trotzdem löschen',
                          role: 'destructive',
                          handler: () => {
                            api.delete(`/chat/rooms/${room.id}?force=true`)
                              .then(() => {
                                refresh();
                              })
                              .catch(() => setError('Fehler beim Löschen'));
                          }
                        }
                      ]
                    });
                  }, 300);
                } else {
                  setError(fehlerText(error, 'Fehler beim Löschen'));
                }
              });
          }
        }
      ]
    });
  };

  const filteredRooms = (rooms || [])
    .filter(room => {
      // Suchfilter (room.name ist durch sanitizeRooms garantiert ein String)
      const matchesSearch = (room.name || '').toLowerCase().includes(searchText.toLowerCase());
      if (!matchesSearch) return false;

      // Typ-Filter
      if (filterType === 'alle') return true;
      // Ungelesen statt Direkt: Nach Chat-ART zu filtern hilft beim Wiederfinden
      // kaum — man weiß ohnehin, wen man sucht, und dafuer gibt es die Suche.
      // Die eigentliche Frage beim Oeffnen der Übersicht ist "wo muss ich
      // ran?". Genau das beantwortet dieser Filter.
      if (filterType === 'ungelesen') return (chatUnreadByRoom[room.id] || 0) > 0;
      // Konfis-Tab: Jahrgangs-/Gruppenchats mit Konfis, KEINE reinen Team-Gruppen.
      if (filterType === 'konfis') return (room.type === 'jahrgang' || room.type === 'group') && !isTeamChat(room);
      // Team-Tab: Team-Gruppen + reine Team-group + Direktchats mit Teamer:innen.
      if (filterType === 'team') return isTeamChat(room);
      return true;
    })
    .sort((a, b) => {
      // Immer der aktuellste Chat oben (nach letzter Nachricht), dynamisch nach
      // unten durchgereicht — KEINE Gruppierung nach Team/Konfis. Die Team/Konfi-
      // Filter-Tabs uebernehmen die Trennung, wenn man sie braucht.
      const aTime = a.last_message?.created_at ? new Date(a.last_message.created_at).getTime() : 0;
      const bTime = b.last_message?.created_at ? new Date(b.last_message.created_at).getTime() : 0;
      return bTime - aTime; // Newest first
    });

  const formatLastMessageTime = (dateString: string) => {
    if (!dateString) return '';
    
    const date = new Date(dateString);
    const now = new Date();
    
    // Prüfe auf gültiges Datum
    if (isNaN(date.getTime())) return '';
    
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) {
      const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
      return diffInMinutes < 1 ? 'Jetzt' : `${diffInMinutes}m`;
    } else if (diffInHours < 24) {
      return `${diffInHours}h`;
    } else {
      const diffInDays = Math.floor(diffInHours / 24);
      return `${diffInDays}d`;
    }
  };

  const getDisplayRoomName = (room: ChatRoomOverview) => {
    // Für Direktchats: Zeige den Namen des Chat-Partners, nicht des eigenen Users
    if (room.type === 'direct') {
      // Finde den Chat-Partner (nicht der aktuelle User) — robust per user_id
      // statt per user_type. chat_participants.user_type kennt drei Werte
      // ('admin', 'teamer', 'konfi'); ein Vergleich darauf ginge fehl.
      const otherParticipant = room.participants?.find(p => p.user_id !== user?.id);
      
      if (otherParticipant) {
        return otherParticipant.display_name || otherParticipant.name || 'Unbekannt';
      }
      
      // Fallback: verwende room.name wenn keine Participants geladen
      return room.name || 'Direktchat';
    }
    
    // Event-Chats mit Prefix
    if (room.event_id) {
      const name = room.name?.replace(/ - Chat$/, '') || 'Event';
      return `Event: ${name}`;
    }

    // Für alle anderen Chat-Typen: normaler Name
    return room.name || 'Chat';
  };

  const getRoomIcon = (room: ChatRoomOverview) => {
    if (room.event_id) return ICON_TERMIN_GEFUELLT;
    switch (room.type) {
      case 'admin':
        return ICON_EINSTELLUNGEN_GEFUELLT;
      case 'jahrgang':
        return ICON_GRUPPE_GEFUELLT;
      case 'group':
        return ICON_CHATS_GEFUELLT;
      case 'direct':
        return ICON_PERSON_GEFUELLT;
      default:
        return ICON_CHATS_GEFUELLT;
    }
  };

  const getRoomSubtitle = (room: ChatRoomOverview) => {
    if (room.event_id) return 'Event';
    if (room.type === 'jahrgang') return 'Jahrgang';
    if (room.type === 'admin' || room.type === 'group') return 'Gruppe';
    if (room.type === 'direct') return 'Direkt';
    return '';
  };

  const getRoomTypeIcon = (room: ChatRoomOverview) => {
    if (room.event_id) return ICON_TERMIN_GEFUELLT;
    if (room.type === 'jahrgang') return ICON_GRUPPE_GEFUELLT;
    if (room.type === 'admin' || room.type === 'group') return ICON_CHATS_GEFUELLT;
    if (room.type === 'direct') return ICON_PERSON_GEFUELLT;
    return ICON_CHATS_GEFUELLT;
  };

  if (loading) {
    return <LoadingSpinner message="Chaträume werden geladen..." />;
  }

  return (
    <IonPage ref={pageRef}>
      <AppKopfzeile
        titel="Chat"
        rechts={(
          <IonButton aria-label="Neuen Chat starten" onClick={handleCreateNewChat}>
            <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} />
          </IonButton>
        )}
      />

      <IonContent className="app-gradient-background" fullscreen>
        <AppKopfzeileGross titel="Chat" />

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          await refresh();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        <SectionHeader
          title="Deine Chats"
          subtitle="Nachrichten und Gruppen"
          icon={ICON_CHATS_GEFUELLT}
          colors={{ primary: 'var(--app-color-chat)', secondary: 'var(--app-color-chat-dunkel)' }}
          stats={[
            // CHATS und UNGELESEN entsprechen je einem Reiter und schalten
            // dorthin (gleiches Muster wie Challenges/Anfragen/Nutzende).
            // AKTIV hat keinen Reiter und bleibt reine Anzeige.
            {
              value: (rooms || []).length,
              label: 'CHATS',
              onClick: () => setFilterType('alle'),
              active: filterType === 'alle'
            },
            {
              value: Object.values(chatUnreadByRoom).reduce((sum, c) => sum + c, 0),
              label: 'UNGELESEN',
              onClick: () => setFilterType('ungelesen'),
              active: filterType === 'ungelesen'
            },
            { value: (rooms || []).filter(room => room.last_message && new Date(room.last_message.created_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length, label: 'AKTIV' }
          ]}
        />

        {/* Reiter ZUERST, Suche darunter: "dann
            filtert man erst und dann sucht man." Vorher stand die Suche
            oben -- man tippte einen Namen und schraenkte danach die Menge
            ein, also gegen die eigene Erwartung. */}
        <div className="app-segment-wrapper">
          <IonSegment value={filterType} onIonChange={(e) => setFilterType(String(e.detail.value))}>
            <IonSegmentButton value="alle"><IonLabel>Alle</IonLabel></IonSegmentButton>
            <IonSegmentButton value="ungelesen"><IonLabel>Ungelesen</IonLabel></IonSegmentButton>
            <IonSegmentButton value="konfis"><IonLabel>Konfis</IonLabel></IonSegmentButton>
            {gehoertZumTeam && (
              <IonSegmentButton value="team"><IonLabel>Team</IonLabel></IonSegmentButton>
            )}
          </IonSegment>
        </div>

        {/* Suche -- steht UNTER den Reitern, siehe Kommentar oben */}
        <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--chat">
              <IonIcon icon={ICON_FILTER} />
            </div>
            <IonLabel>Suche</IonLabel>
          </IonListHeader>
          <IonItemGroup>
            <IonItem>
              <IonIcon
                icon={ICON_SUCHE_GEFUELLT}
                slot="start"
                style={{
                  color: 'var(--app-text-system)',
                  fontSize: 'var(--app-text-standard)'
                }}
              />
              <IonInput aria-label="Chaträume durchsuchen"
                value={searchText}
                onIonInput={(e) => setSearchText(e.detail.value!)}
                placeholder="Chaträume durchsuchen..."
              />
            </IonItem>
          </IonItemGroup>
        </IonList>

        {/* Chat Rooms Liste - Karten-Design mit farbigem Rand + Swipe */}
        <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--chat">
              <IonIcon icon={ICON_CHATS} />
            </div>
            <IonLabel>Chats ({filteredRooms.length})</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: filteredRooms.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
              {filteredRooms.length === 0 ? (
                <EmptyState
                  icon={ICON_CHATS_GEFUELLT}
                  title="Keine Chaträume gefunden"
                  message="Erstelle deinen ersten Chat!"
                  iconColor="var(--app-color-chat)"
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {filteredRooms.map((room) => {
                    const colorClass = getRoomColorClass(room);
                    // Nur Admins dürfen direct/group Chats löschen
                    const canDelete = isAdmin && (room.type === 'direct' || room.type === 'group');

                    return (
                      <IonItemSliding key={room.id} disabled={!canDelete}>
                        <IonItem
                          onClick={() => onSelectRoom(room)}
                          lines="none"
                          detail={false}
                          style={{
                            '--background': 'transparent',
                            '--padding-start': '0',
                            '--padding-end': '0',
                            '--inner-padding-end': '0',
                            '--inner-border-width': '0',
                            '--border-style': 'none',
                            '--min-height': 'auto'
                          }}
                        >
                          <div
                            className={`app-list-item app-list-item--${colorClass}${selectedRoomId === room.id ? ' app-list-item--selected' : ''}`}
                            style={{
                              width: '100%',
                              position: 'relative',
                              overflow: 'hidden'
                            }}
                          >
                            {/* Eselsohr-Style Corner Badge - Chat-Typ als Icon */}
                            <div className="app-corner-badges">
                              <div
                                className={`app-corner-badge app-corner-badge--${colorClass}`}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--app-abstand-mini) var(--app-abstand-eng)' }}
                                title={getRoomSubtitle(room)}
                                role="img"
                                aria-label={getRoomSubtitle(room)}
                              >
                                <IonIcon icon={getRoomTypeIcon(room)} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
                              </div>
                            </div>

                            <div className="app-list-item__row">
                              <div className="app-list-item__main">
                                {/* Symbol mit Zaehler-Kugel; Lage siehe .app-zaehler-anker */}
                                <div className="app-zaehler-anker">
                                  <div
                                    className={`app-icon-circle app-icon-circle--lg app-icon-circle--${colorClass}`}
                                  >
                                    <IonIcon icon={getRoomIcon(room)} />
                                  </div>
                                  <ZaehlerKugel
                                    anzahl={chatUnreadByRoom[room.id] ?? room.unread_count ?? 0}
                                    label="ungelesene Nachrichten"
                                  />
                                </div>

                                {/* Content */}
                                <div className="app-list-item__content">
                                  <div
                                    className="app-list-item__title"
                                    style={{
                                      paddingRight: 'var(--app-abstand-riesig)',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap'
                                    }}
                                  >
                                    {getDisplayRoomName(room)}
                                  </div>
                                  <div className="app-list-item__meta">
                                    {room.last_message?.created_at && (
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={ICON_UHRZEIT_GEFUELLT} style={{ color: 'var(--app-text-events)' }} />
                                        {formatLastMessageTime(room.last_message.created_at)}
                                      </span>
                                    )}
                                    {room.type !== 'direct' && (
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={ICON_GRUPPE_GEFUELLT} style={{ color: 'var(--app-color-success)' }} />
                                        {room.participant_count || 0}
                                      </span>
                                    )}
                                  </div>
                                  {/* Letzte Nachricht */}
                                  {room.last_message && (room.last_message.content || room.last_message.file_name) && (
                                    <div className="app-list-item__subtitle" style={{
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 'var(--app-abstand-mini)'
                                    }}>
                                      <IonIcon icon={ICON_CHATS_GEFUELLT} style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', flexShrink: 0 }} />
                                      <span style={{ fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-text-primary)' }}>
                                        {room.last_message.sender_name}:
                                      </span>{' '}
                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {room.last_message.content || room.last_message.file_name || 'Datei'}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </IonItem>

                        {/* Swipe Delete für direct/group chats */}
                        {canDelete && (
                          <IonItemOptions side="end" className="app-swipe-actions">
                            <IonItemOption
                              onClick={() => { closeOpenSlidingItems(); deleteRoom(room); }}
                              aria-label="Chat löschen"
                              className="app-swipe-action"
                            >
                              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                                <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
                              </div>
                            </IonItemOption>
                          </IonItemOptions>
                        )}
                      </IonItemSliding>
                    );
                  })}
                </div>
              )}
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
});

export default ChatOverview;