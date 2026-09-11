import React, { useState, useEffect, useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonIcon,
  IonLabel,
  IonList,
  IonItemGroup,
  IonListHeader,
  IonSpinner,
  IonRefresher,
  IonRefresherContent,
  IonInput,
  IonItem,
  IonCard,
  IonCardContent,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  useIonAlert
} from '@ionic/react';
import {
  ICON_FILTER,
  ICON_GRUPPE,
  ICON_GRUPPE_GEFUELLT,
  ICON_HAKEN,
  ICON_LOESCHEN_GEFUELLT,
  ICON_OFFLINE,
  ICON_PERSON_GEFUELLT,
  ICON_PERSON_HINZUFUEGEN,
  ICON_SCHLIESSEN,
  ICON_SUCHE_GEFUELLT,
  ICON_TERMIN_GEFUELLT,
} from '../../shared/icons';
import { useApp } from '../../../contexts/AppContext';
import { offlineBlockiert } from '../../../utils/offlineAktion';
import api from '../../../services/api';
import LoadingSpinner from '../../common/LoadingSpinner';
import { AdminUser, ChatUser } from '../../../types/user';
import { EigenerJahrgang, KonfiEintrag } from '../../../types/chat';
import { triggerPullHaptic } from '../../../utils/haptics';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';
import { istTeamTyp } from '../../../utils/chatRoles';

interface Participant {
  user_id: number;
  user_type: 'admin' | 'konfi' | 'teamer';
  name: string;
  role_name?: string;
  role_title?: string;
  role_display_name?: string;
  jahrgang_id?: number;
  jahrgang_name?: string;
  joined_at: string;
}

// Team-Mitglied = Admin/Org-Admin ODER Teamer:in (NICHT Konfi). Teamer wurden bisher
// faelschlich wie Konfis dargestellt (lila, ohne Funktion), weil nur auf 'admin'
// geprüft wurde. Diese Helfer behandeln 'teamer' konsistent als Team.
const isTeamType = istTeamTyp;
const isTeamUser = (u: { user_type?: string; type?: string }) =>
  isTeamType('user_type' in u ? u.user_type : u.type);

interface MembersModalProps {
  onClose: () => void;
  onSuccess: () => void;
  roomId: number;
  roomType: string;
  presentingElement?: HTMLElement | null;
}

const MembersModal: React.FC<MembersModalProps> = ({
  onClose,
  onSuccess,
  roomId,
  roomType
}) => {
  const { user, setError, isOnline } = useApp();
  const [presentRemoveAlert] = useIonAlert();
  const pageRef = useRef<HTMLElement>(null);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [allUsers, setAllUsers] = useState<ChatUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showAddMode, setShowAddMode] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (roomId) {
      loadParticipants();
      loadAllUsers();
    }
  }, [roomId]);

  const loadParticipants = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/chat/rooms/${roomId}/participants`);
      setParticipants(response.data);
    } catch (err) {
      setError('Fehler beim Laden der Mitglieder');
 console.error('Error loading participants:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAllUsers = async () => {
    try {
      const [konfisRes, userJahrgangRes, adminsRes] = await Promise.all([
        api.get('/admin/konfis'),
        // /users statt /admin/users: createApp.js haengt denselben Router
        // unter beiden Praefixen ein (:480 und :483). Die Oberflaeche nutzt
        // durchgaengig /users; der zweite Mount bleibt nur fuer ausgelieferte
        // Apps stehen.
        api.get('/users/me/jahrgaenge').catch(() => ({ data: [] })),
        api.get('/users').catch(() => ({ data: [] }))
      ]);

      // Jahrgangs-Filter wie SimpleCreateChatModal
      let allowedJahrgangIds: number[] = [];
      const eigeneJahrgaenge = userJahrgangRes.data as EigenerJahrgang[];
      if (eigeneJahrgaenge.length > 0) {
        allowedJahrgangIds = eigeneJahrgaenge.map((j) => j.id);
      }

      // GET /admin/konfis liefert den Jahrgang nur als jahrgang_name; der
      // frühere Fallback auf konfi.jahrgang griff nie.
      const konfis: ChatUser[] = (konfisRes.data as KonfiEintrag[])
        .filter((konfi) => {
          if (allowedJahrgangIds.length > 0) {
            return Boolean(konfi.jahrgang_id) && allowedJahrgangIds.includes(konfi.jahrgang_id as number);
          }
          return true;
        })
        .map((konfi) => ({
          ...konfi,
          type: 'konfi' as const,
          jahrgang_name: konfi.jahrgang_name ?? undefined
        }));

      // GET /users schliesst Konfis bereits serverseitig aus
      // (WHERE r.name NOT IN ('konfi', 'super_admin')).
      const adminUsers: ChatUser[] = (adminsRes.data as AdminUser[])
        .filter((u) => u.role_name !== 'konfi')
        .map((admin) => ({
          ...admin,
          type: 'admin' as const,
          role_description: admin.role_title || admin.role_display_name
        }));

      setAllUsers([...konfis, ...adminUsers]);
    } catch (err) {
 console.error('Error loading users:', err);
    }
  };

  const getAvailableUsers = () => {
    const participantIds = new Set(
      participants.map(p => `${p.user_type}-${p.user_id}`)
    );

    return allUsers.filter(user =>
      !participantIds.has(`${user.type}-${user.id}`)
    );
  };

  // Sortierung: Team-Mitglieder (Admins + Teamer) zuerst, dann alphabetisch nach Name
  const sortUsers = <T extends { name?: string; display_name?: string; type?: string; user_type?: string }>(users: T[]): T[] => {
    return [...users].sort((a, b) => {
      const aIsTeam = isTeamUser(a);
      const bIsTeam = isTeamUser(b);

      // Team-Mitglieder zuerst
      if (aIsTeam && !bIsTeam) return -1;
      if (!aIsTeam && bIsTeam) return 1;

      // Dann alphabetisch nach Name
      const aName = (a.name || a.display_name || '').toLowerCase();
      const bName = (b.name || b.display_name || '').toLowerCase();
      return aName.localeCompare(bName, 'de');
    });
  };

  const filteredAvailableUsers = sortUsers(getAvailableUsers().filter(user => {
    const name = user.name || user.display_name || '';
    return name.toLowerCase().includes(searchText.toLowerCase()) ||
      (user.jahrgang && user.jahrgang.toLowerCase().includes(searchText.toLowerCase()));
  }));

  // Sortierte Teilnehmer
  const sortedParticipants = sortUsers(participants);

  const handleUserToggle = (user: ChatUser) => {
    const userId = `${user.type}-${user.id}`;
    const newSelected = new Set(selectedUsers);

    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }

    setSelectedUsers(newSelected);
  };

  const addSelectedUsers = async () => {
    if (selectedUsers.size === 0) return;

    setAdding(true);
    try {
      const promises = Array.from(selectedUsers).map(userId => {
        const [type, id] = userId.split('-');
        return api.post(`/chat/rooms/${roomId}/participants`, {
          user_id: parseInt(id),
          user_type: type
        });
      });

      await Promise.all(promises);

      setSelectedUsers(new Set());
      setShowAddMode(false);
      await loadParticipants();
      onSuccess();
    } catch (err) {
      setError('Fehler beim Hinzufügen der Mitglieder');
 console.error('Error adding participants:', err);
    } finally {
      setAdding(false);
    }
  };

  const confirmRemoveUser = (participant: Participant) => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentRemoveAlert({
      header: 'Mitglied entfernen',
      message: `${participant.name} wirklich aus dem Chat entfernen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Entfernen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/chat/rooms/${roomId}/participants/${participant.user_id}/${participant.user_type}`);
              await loadParticipants();
              onSuccess();
            } catch (err) {
              setError('Fehler beim Entfernen des Mitglieds');
 console.error('Error removing participant:', err);
            }
          }
        }
      ]
    });
  };

  const handleClose = () => {
    setShowAddMode(false);
    setSelectedUsers(new Set());
    setSearchText('');
    onClose();
  };

  const getUserDisplayName = (user: ChatUser | Participant) => {
    if ('display_name' in user) {
      return user.name || user.display_name || 'Unbekannt';
    }
    return user.name || 'Unbekannt';
  };

  const isGroupChat = roomType === 'group';
  const canManageMembers = user?.type === 'admin' && isGroupChat;

  // Rolle/Funktion ermitteln (für Eselsohr)
  const getRoleText = (targetUser: ChatUser | Participant) => {
    if (isTeamUser(targetUser)) {
      if ('role_title' in targetUser && targetUser.role_title) {
        return targetUser.role_title;
      }
      if ('role_display_name' in targetUser && targetUser.role_display_name) {
        return targetUser.role_display_name;
      }
      if ('role_description' in targetUser && targetUser.role_description) {
        return targetUser.role_description;
      }
      // Fallback nach echter Rolle (Teamer vs. Admin), wenn kein Titel hinterlegt ist.
      const roleName = 'role_name' in targetUser ? targetUser.role_name : undefined;
      return roleName === 'teamer' ? 'Teamer:in' : 'Admin';
    }

    return 'Konfi';
  };

  // Jahrgang ermitteln (für Meta-Zeile)
  const getJahrgang = (targetUser: ChatUser | Participant) => {
    if ('jahrgang_name' in targetUser && targetUser.jahrgang_name) {
      return targetUser.jahrgang_name;
    }
    if ('jahrgang' in targetUser && targetUser.jahrgang) {
      return targetUser.jahrgang;
    }
    return null;
  };

  // Render User Item - mit CSS-Klassen
  const renderUserItem = (
    targetUser: ChatUser | Participant,
    isSelectable: boolean,
    isSelected: boolean,
    onToggle?: () => void
  ) => {
    const isTeam = isTeamUser(targetUser);
    const name = getUserDisplayName(targetUser);
    const participantId = `${isTeam ? 'admin' : 'konfi'}-${'user_id' in targetUser ? targetUser.user_id : targetUser.id}`;
    const roleText = getRoleText(targetUser);
    const jahrgang = getJahrgang(targetUser);
    const badgeColor = isTeam ? 'var(--app-color-teamer)' : 'var(--app-color-konfis)';

    return (
      <div
        key={participantId}
        className={`app-list-item ${isTeam ? 'app-list-item--team' : 'app-list-item--konfi'} ${isSelected ? 'app-list-item--selected' : ''}`}
        onClick={isSelectable ? onToggle : undefined}
        style={{ cursor: isSelectable ? 'pointer' : 'default', position: 'relative', overflow: 'hidden', width: '100%' }}
      >
        {/* Eselsohr mit Rolle als Icon */}
        <div className="app-corner-badges">
          <div
            className="app-corner-badge"
            style={{ backgroundColor: badgeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--app-abstand-mini) var(--app-abstand-eng)' }}
            title={roleText}
          >
            <IonIcon icon={isTeam ? ICON_GRUPPE_GEFUELLT : ICON_PERSON_GEFUELLT} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
          </div>
        </div>

        <div className="app-list-item__row">
          <div className="app-list-item__main">
            <div className={`app-icon-circle app-icon-circle--lg ${isTeam ? 'app-icon-circle--team' : 'app-icon-circle--konfi'}`}>
              <IonIcon icon={ICON_PERSON_GEFUELLT} />
            </div>
            <div className="app-list-item__content">
              <div className="app-list-item__title" style={{ paddingRight: 'var(--app-freiraum-aktion-l)' }}>{name}</div>
              {/* Meta-Zeile: Jahrgang fuer Konfi, Rolle/Funktion fuer Team (Admin/Teamer) */}
              {isTeam && roleText && (
                <div className="app-list-item__meta">
                  <span className="app-list-item__meta-item">
                    <IonIcon icon={ICON_GRUPPE} style={{ color: 'var(--app-color-teamer)' }} />
                    {roleText}
                  </span>
                </div>
              )}
              {!isTeam && jahrgang && (
                <div className="app-list-item__meta">
                  <span className="app-list-item__meta-item">
                    <IonIcon icon={ICON_TERMIN_GEFUELLT} style={{ color: 'var(--app-color-jahrgang)' }} />
                    {jahrgang}
                  </span>
                </div>
              )}
            </div>
          </div>
          {/* Keine Checkbox / kein Haekchen: die Auswahl wird allein ueber die
              Hintergrundfaerbung des Listen-Elements (app-list-item--selected)
              markiert — konsistent mit allen anderen Auswahllisten der App. */}
        </div>
      </div>
    );
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={handleClose} aria-label="Schließen">
              <IonIcon icon={ICON_SCHLIESSEN} slot="icon-only" />
            </IonButton>
          </IonButtons>

          <IonTitle>
            {showAddMode ? 'Mitglied hinzufügen' : 'Mitglieder'}
          </IonTitle>

          {canManageMembers && (
            <IonButtons slot="end">
              {showAddMode ? (
                <IonButton
                  className="app-modal-submit-btn app-modal-submit-btn--chat"
                  onClick={addSelectedUsers}
                  disabled={selectedUsers.size === 0 || adding || !isOnline}
                  aria-label="Ausgewählte Mitglieder hinzufügen"
                >
                  {!isOnline ? <><IonIcon icon={ICON_OFFLINE} /> Du bist offline</> : adding ? <IonSpinner name="crescent" /> : <IonIcon icon={ICON_HAKEN} slot="icon-only" />}
                </IonButton>
              ) : (
                <IonButton onClick={() => setShowAddMode(true)} aria-label="Mitglieder hinzufügen">
                  <IonIcon icon={ICON_PERSON_HINZUFUEGEN} slot="icon-only" />
                </IonButton>
              )}
            </IonButtons>
          )}
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          Promise.all([loadParticipants(), loadAllUsers()]).finally(() => {
            e.detail.complete();
          });
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

          {showAddMode ? (
            <>
              {/* Suche - iOS26 Pattern */}
              <IonList inset={true} className="app-modal-section">
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
                    <IonInput
                      value={searchText}
                      onIonInput={(e) => setSearchText(e.detail.value!)}
                      placeholder="Person suchen..."
                    />
                  </IonItem>
                </IonItemGroup>
              </IonList>

              {/* Verfügbare Personen - IonListHeader über der Card */}
              <IonList inset={true} className="app-modal-section">
                <IonListHeader>
                  <div className="app-section-icon app-section-icon--chat">
                    <IonIcon icon={ICON_GRUPPE} />
                  </div>
                  <IonLabel>Verfügbare Personen ({filteredAvailableUsers.length})</IonLabel>
                </IonListHeader>
                <IonCard className="app-card">
                  <IonCardContent style={{ padding: filteredAvailableUsers.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
                    {filteredAvailableUsers.length === 0 ? (
                      <div style={{
                        padding: 'var(--app-abstand-riesig) var(--app-abstand-gross)',
                        textAlign: 'center',
                        color: 'var(--app-text-secondary)'
                      }}>
                        <IonIcon icon={ICON_SUCHE_GEFUELLT} style={{ fontSize: 'var(--app-anzeige-riesig)', opacity: 0.3, marginBottom: 'var(--app-abstand-basis)' }} />
                        <p style={{ margin: '0', fontSize: 'var(--app-text-standard)' }}>Keine verfügbaren Personen gefunden</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {filteredAvailableUsers.map((u) => {
                          const userId = `${u.type}-${u.id}`;
                          return renderUserItem(
                            u,
                            true,
                            selectedUsers.has(userId),
                            () => handleUserToggle(u)
                          );
                        })}
                      </div>
                    )}
                  </IonCardContent>
                </IonCard>
              </IonList>
            </>
          ) : (
            <>
              {loading ? (
                <LoadingSpinner message="Mitglieder werden geladen..." />
              ) : (
                <IonList inset={true} className="app-modal-section">
                  <IonListHeader>
                    <div className="app-section-icon app-section-icon--chat">
                      <IonIcon icon={ICON_GRUPPE} />
                    </div>
                    <IonLabel>Mitglieder ({sortedParticipants.length})</IonLabel>
                  </IonListHeader>
                  <IonCard className="app-card">
                    <IonCardContent style={{ padding: sortedParticipants.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
                      {sortedParticipants.length === 0 ? (
                        <div style={{
                          padding: 'var(--app-abstand-riesig) var(--app-abstand-gross)',
                          textAlign: 'center',
                          color: 'var(--app-text-secondary)'
                        }}>
                          <IonIcon icon={ICON_GRUPPE} style={{ fontSize: 'var(--app-anzeige-riesig)', opacity: 0.3, marginBottom: 'var(--app-abstand-basis)' }} />
                          <p style={{ margin: '0', fontSize: 'var(--app-text-standard)' }}>Keine Mitglieder</p>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          {sortedParticipants.map((p) => (
                            <IonItemSliding key={`${p.user_type}-${p.user_id}`} disabled={!canManageMembers}>
                              <IonItem
                                detail={false}
                                lines="none"
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
                                {renderUserItem(p, false, false)}
                              </IonItem>
                              {canManageMembers && (
                                <IonItemOptions side="end" className="app-swipe-actions">
                                  <IonItemOption
                                    onClick={() => { closeOpenSlidingItems(); confirmRemoveUser(p); }}
                                    aria-label="Mitglied entfernen"
                                    className="app-swipe-action"
                                  >
                                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                                      <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
                                    </div>
                                  </IonItemOption>
                                </IonItemOptions>
                              )}
                            </IonItemSliding>
                          ))}
                        </div>
                      )}
                    </IonCardContent>
                  </IonCard>
                </IonList>
              )}
            </>
          )}
      </IonContent>

    </IonPage>
  );
};

export default MembersModal;
