import React, { useState, useEffect } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonItem,
  IonInput,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  IonCard,
  IonCardContent,
  IonButton,
  IonButtons,
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
import {
  chatbubbles,
  chatbubblesOutline,
  people,
  person,
  settings,
  add,
  time,
  trash,
  search,
  filterOutline,
  calendar
} from 'ionicons/icons';
import { useLocation } from 'react-router-dom';
import { useApp } from '../../contexts/AppContext';
import { useBadge } from '../../contexts/BadgeContext';
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

interface ChatOverviewProps {
  onSelectRoom: (room: ChatRoomOverview) => void;
  // Im iPad-Split-View aktuell rechts geoeffneter Raum (fuer Highlighting).
  selectedRoomId?: number | null;
}

interface ChatOverviewRef {
  loadChatRooms: () => void;
}

const ChatOverview = React.forwardRef<ChatOverviewRef, ChatOverviewProps>(({ onSelectRoom, selectedRoomId }, ref) => {
  const { user, setError, isOnline } = useApp();
  const [presentAlert] = useIonAlert();
  const { chatUnreadByRoom, refreshAllCounts } = useBadge();
  // socketEpoch: nach Reconnect-mit-neuem-Token ist getSocket() ein anderes
  // Objekt -> Listener am frischen Socket neu binden (gleiches Muster wie im
  // BadgeContext).
  const { socketEpoch } = useLiveUpdate();
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<string>('alle');

  const isAdmin = user?.type === 'admin';

  // Zentrale Logik: Ist das ein Team-Chat (= pink, gehoert in den Team-Tab)?
  // - Direktchat: Partner ist Teamer:in (partner_user_type='admin')
  // - type='admin': ausdrueckliche Team-Gruppe
  // - type='group': reiner Team-Gruppenchat (alle Teilnehmer Teamer:innen)
  // Konfi-Direktchats + gemischte/Konfi-Gruppen sind KEINE Team-Chats.
  const isTeamChat = (room: ChatRoomOverview): boolean => {
    if (room.event_id) return false;
    if (room.type === 'admin') return true;
    if (room.type === 'direct') return room.partner_user_type === 'admin';
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
  const location = useLocation();
  // Bestimme die korrekte Tab-ID basierend auf dem Pfad
  const tabId = location.pathname.startsWith('/admin') ? 'admin-chat' : 'chat';
  const { pageRef, presentingElement } = useModalPage(tabId);

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
  // Listener, der refreshAllCounts() ruft -> chatUnreadByRoom aendert sich ->
  // dieser Effect feuert refresh(). Ein zusaetzlicher eigener socket.on(
  // 'newMessage')-Handler waere redundant (3x /chat/rooms pro Nachricht) und
  // haette zudem KEIN socketEpoch-Rebind nach Reconnect -- deshalb bewusst
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

  // Live-Update der Raumliste bei Raum-Aenderungen (Raum erstellt/geloescht,
  // Teilnehmer hinzugefuegt/entfernt/verlassen). Der Server sendet 'roomsChanged'
  // an die persoenlichen User-Raeume der betroffenen Nutzer.
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

  // Bei Rückkehr zur View (z.B. nach ChatRoom) Raumliste aktualisieren
  useIonViewWillEnter(() => {
    refresh();
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
    if (!isOnline) return;
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
              .catch((error: any) => {
                if (error.response?.data?.canForceDelete) {
                  // Hat Nachrichten - Force Delete nötig
                  setTimeout(() => {
                    presentAlert({
                      header: 'Chat hat Nachrichten',
                      message: `${error.response.data.error}\n\nTrotzdem löschen?`,
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
                  setError(error.response?.data?.error || 'Fehler beim Löschen');
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
      if (filterType === 'direkt') return room.type === 'direct';
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
      // Finde den Chat-Partner (nicht der aktuelle User) — robust per user_id,
      // NICHT per user_type (eigener type kann 'teamer' sein, participants nur 'admin'|'konfi').
      const otherParticipant = room.participants?.find((p: { user_id: number; user_type: 'admin' | 'konfi'; name: string; display_name?: string }) =>
        p.user_id !== user?.id
      );
      
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
    if (room.event_id) return calendar;
    switch (room.type) {
      case 'admin':
        return settings;
      case 'jahrgang':
        return people;
      case 'group':
        return chatbubbles;
      case 'direct':
        return person;
      default:
        return chatbubbles;
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
    if (room.event_id) return calendar;
    if (room.type === 'jahrgang') return people;
    if (room.type === 'admin' || room.type === 'group') return chatbubbles;
    if (room.type === 'direct') return person;
    return chatbubbles;
  };

  if (loading) {
    return <LoadingSpinner message="Chaträume werden geladen..." />;
  }

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonTitle>Chat</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handleCreateNewChat}>
              <IonIcon icon={add} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      
      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Chat</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          await refresh();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        <SectionHeader
          title="Deine Chats"
          subtitle="Nachrichten und Gruppen"
          icon={chatbubbles}
          colors={{ primary: '#06b6d4', secondary: '#0891b2' }}
          stats={[
            { value: (rooms || []).length, label: 'CHATS' },
            { value: Object.values(chatUnreadByRoom).reduce((sum, c) => sum + c, 0), label: 'UNGELESEN' },
            { value: (rooms || []).filter(room => room.last_message && new Date(room.last_message.created_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length, label: 'AKTIV' }
          ]}
        />

        {/* Suche & Filter */}
        <IonList inset={true} style={{ margin: '16px' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--chat">
              <IonIcon icon={filterOutline} />
            </div>
            <IonLabel>Suche & Filter</IonLabel>
          </IonListHeader>
          <IonItemGroup>
            <IonItem>
              <IonIcon
                icon={search}
                slot="start"
                style={{
                  color: '#8e8e93',
                  fontSize: '1rem'
                }}
              />
              <IonInput
                value={searchText}
                onIonInput={(e) => setSearchText(e.detail.value!)}
                placeholder="Chaträume durchsuchen..."
              />
            </IonItem>
          </IonItemGroup>
        </IonList>

        {/* Filter-Tabs */}
        <div className="app-segment-wrapper">
          <IonSegment value={filterType} onIonChange={(e) => setFilterType(String(e.detail.value))}>
            <IonSegmentButton value="alle"><IonLabel>Alle</IonLabel></IonSegmentButton>
            <IonSegmentButton value="direkt"><IonLabel>Direkt</IonLabel></IonSegmentButton>
            <IonSegmentButton value="konfis"><IonLabel>Konfis</IonLabel></IonSegmentButton>
            {isAdmin && (
              <IonSegmentButton value="team"><IonLabel>Team</IonLabel></IonSegmentButton>
            )}
          </IonSegment>
        </div>

        {/* Chat Rooms Liste - Karten-Design mit farbigem Rand + Swipe */}
        <IonList inset={true} style={{ margin: '16px' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--chat">
              <IonIcon icon={chatbubblesOutline} />
            </div>
            <IonLabel>Chats ({filteredRooms.length})</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: filteredRooms.length === 0 ? '16px' : '12px' }}>
              {filteredRooms.length === 0 ? (
                <EmptyState
                  icon={chatbubbles}
                  title="Keine Chaträume gefunden"
                  message="Erstelle deinen ersten Chat!"
                  iconColor="#06b6d4"
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {filteredRooms.map((room, index) => {
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
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                                title={getRoomSubtitle(room)}
                              >
                                <IonIcon icon={getRoomTypeIcon(room)} style={{ color: '#fff', fontSize: '0.85rem' }} />
                              </div>
                            </div>

                            <div className="app-list-item__row">
                              <div className="app-list-item__main">
                                {/* Icon mit Unread-Badge */}
                                <div style={{ position: 'relative', flexShrink: 0 }}>
                                  <div
                                    className={`app-icon-circle app-icon-circle--lg app-icon-circle--${colorClass}`}
                                  >
                                    <IonIcon icon={getRoomIcon(room)} />
                                  </div>
                                  {(() => {
                                    const unread = chatUnreadByRoom[room.id] ?? room.unread_count ?? 0;
                                    return unread > 0 ? (
                                      <span style={{
                                        position: 'absolute',
                                        top: '0px',
                                        right: '0px',
                                        fontSize: '0.55rem',
                                        color: 'white',
                                        fontWeight: '700',
                                        backgroundColor: '#dc3545',
                                        width: unread > 9 ? '18px' : '16px',
                                        height: '16px',
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                        border: '2px solid white',
                                        zIndex: 2
                                      }}>
                                        {unread > 9 ? '9+' : unread}
                                      </span>
                                    ) : null;
                                  })()}
                                </div>

                                {/* Content */}
                                <div className="app-list-item__content">
                                  <div
                                    className="app-list-item__title"
                                    style={{
                                      paddingRight: '40px',
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
                                        <IonIcon icon={time} style={{ color: 'var(--app-color-events)' }} />
                                        {formatLastMessageTime(room.last_message.created_at)}
                                      </span>
                                    )}
                                    {room.type !== 'direct' && (
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={people} style={{ color: 'var(--app-color-success)' }} />
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
                                      gap: '4px'
                                    }}>
                                      <IonIcon icon={chatbubbles} style={{ fontSize: '0.75rem', color: '#8e8e93', flexShrink: 0 }} />
                                      <span style={{ fontWeight: '600', color: '#333' }}>
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
                              onClick={() => deleteRoom(room)}
                              className="app-swipe-action"
                            >
                              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                                <IonIcon icon={trash} />
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