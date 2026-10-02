import { fehlerText, fehlerTextOderMessage } from '../../../utils/fehler';
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
  IonSelect,
  IonSelectOption,
  IonInput,
  IonSpinner,
  IonSegment,
  IonSegmentButton,
  IonList,
  IonItem,
  IonItemGroup,
  IonListHeader,
  IonCard,
  IonCardContent,
  useIonAlert
} from '@ionic/react';
import {
  ICON_FILTER,
  ICON_GRUPPE,
  ICON_GRUPPE_GEFUELLT,
  ICON_HAKEN,
  ICON_OFFLINE,
  ICON_PERSON,
  ICON_PERSON_GEFUELLT,
  ICON_SCHLIESSEN,
  ICON_SUCHE_GEFUELLT,
  ICON_TERMIN_GEFUELLT,
} from '../../shared/icons';
import { useApp } from '../../../contexts/AppContext';
import { offlineBlockiert } from '../../../utils/offlineAktion';
import { useBadge } from '../../../contexts/BadgeContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';
import { ChatUser } from '../../../types/user';
import { EigenerJahrgang, KonfiEintrag, TeamKontakt, VerfuegbarerPartner } from '../../../types/chat';
import { istTeamTyp } from '../../../utils/chatRoles';
import { rollenFarbeVar, rollenTextFarbeVar } from '../../../utils/rollenNamen';
import { tastaturKlick } from '../../../utils/tastatur';

interface SimpleCreateChatModalProps {
  onClose: () => void;
  // roomId der neu erstellten/gefundenen Unterhaltung -> Aufrufer kann direkt
  // in den Chat navigieren statt auf der Liste zu landen.
  onSuccess: (roomId?: number) => void;
  dismiss?: () => void;
}

const SimpleCreateChatModal: React.FC<SimpleCreateChatModalProps> = ({ onClose, onSuccess, dismiss }) => {
  const { user, setError, isOnline } = useApp();
  const { refreshFromAPI } = useBadge();
  const [presentUnsavedAlert] = useIonAlert();
  const pageRef = useRef<HTMLElement>(null);
  const [isDirty, setIsDirty] = useState(false);

  // State
  const [chatType, setChatType] = useState<'direct' | 'group'>('direct');

  const doClose = () => {
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };

  const handleClose = () => {
    if (isDirty) {
      presentUnsavedAlert({
        header: 'Ungespeicherte Änderungen',
        message: 'Möchtest du die Änderungen verwerfen?',
        buttons: [
          { text: 'Abbrechen', role: 'cancel' },
          { text: 'Verwerfen', role: 'destructive', handler: () => doClose() }
        ]
      });
    } else {
      doClose();
    }
  };
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const { isSubmitting: creating, guard } = useActionGuard();

  // Filter states
  const [selectedRole, setSelectedRole] = useState<string>('alle');
  const [selectedJahrgang, setSelectedJahrgang] = useState<string>('alle');
  const [availableJahrgaenge, setAvailableJahrgaenge] = useState<string[]>([]);

  // Group chat specific
  const [groupName, setGroupName] = useState('');
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());

  // isDirty bei relevanten Änderungen setzen
  useEffect(() => {
    if (groupName.trim() || selectedParticipants.size > 0) {
      setIsDirty(true);
    }
  }, [groupName, selectedParticipants]);

  useEffect(() => {
    loadUsers();
  }, [chatType]);

  useEffect(() => {
    // DATENSCHUTZ: Konfis dürfen NUR Direktnachrichten an Admins senden
    if (user?.type === 'konfi') {
      setChatType('direct'); // Konfis haben nur Direktnachrichten
    }
  }, [user]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      if (user?.type === 'konfi') {
        // Konfi: Verwende neue sichere API
        const response = await api.get('/chat/available-users');
        const availableUsers: ChatUser[] = (response.data.users as VerfuegbarerPartner[]).map((u) => ({
          id: u.id,
          name: u.name,
          display_name: u.name,
          // Das Backend liefert 'teamer' als eigenen Wert — vorher war der Typ
          // hier auf admin|konfi verengt und Teamer:innen wurden in der Liste
          // wie Konfis dargestellt.
          type: u.type,
          jahrgang_name: u.jahrgang_name ?? undefined,
          // Funktionsbeschreibung vom Backend (bereits mit Fallback)
          role_description: u.role_description
        }));


        // Verfügbare Jahrgänge ermitteln
        const jahrgaenge = [...new Set(availableUsers
          .map((u) => u.jahrgang_name)
          .filter((name): name is string => Boolean(name)))]
          .sort();
        setAvailableJahrgaenge(jahrgaenge);

        setUsers(availableUsers);

      } else if (user?.type === 'admin' || user?.type === 'teamer') {
        // Admin/Teamer: Verwende bestehende Admin-APIs
        const [konfisRes, userJahrgangRes] = await Promise.all([
          api.get('/admin/konfis'),
          // /users statt /admin/users -- gleicher Router, ein Praefix in der
          // Oberflaeche.
          api.get('/users/me/jahrgaenge').catch(() => ({ data: [] }))
        ]);

        // Filtere Konfis basierend auf Jahrgangs-Zuweisungen
        // Backend liefert {id, name, ...} -- nicht jahrgang_id (Bug-Quelle)
        let allowedJahrgangIds: number[] = [];
        const eigeneJahrgaenge = userJahrgangRes.data as EigenerJahrgang[];
        if (eigeneJahrgaenge.length > 0) {
          allowedJahrgangIds = eigeneJahrgaenge.map((j) => j.id);
        }

        const istTeamer = user?.type === 'teamer';

        const konfis: ChatUser[] = (konfisRes.data as KonfiEintrag[])
          .filter((konfi) => {
            if (!istTeamer) return true;
            return Boolean(konfi.jahrgang_id) && allowedJahrgangIds.includes(konfi.jahrgang_id as number);
          })
          // GET /admin/konfis liefert display_name als `name` und den Jahrgang
          // ausschliesslich als `jahrgang_name`. Die frueheren Fallbacks
          // (konfi.display_name, konfi.jahrgang) griffen nie.
          .map((konfi) => ({
            id: konfi.id,
            name: konfi.name,
            display_name: konfi.name,
            type: 'konfi' as const,
            jahrgang_name: konfi.jahrgang_name ?? undefined
          }));

        // Auch die anderen Team-Mitglieder (Admins, Org-Admins, Teamer:innen) laden.
        // Bewusst über /chat/team-contacts statt /users: Letztere ist mit
        // requireOrgAdmin geschuetzt, Teamer:innen liefen dort in einen 403 und
        // bekamen deshalb gar keine Team-Kontakte angezeigt.
        let adminUsers: ChatUser[] = [];
        try {
          const usersRes = await api.get('/chat/team-contacts');
          adminUsers = (usersRes.data as TeamKontakt[]).map((member) => ({
            id: member.id,
            name: member.display_name,
            display_name: member.display_name,
            type: (member.role_name === 'teamer' ? 'teamer' : 'admin') as 'admin' | 'teamer',
            role_description: member.role_description
          }));
        } catch (err) {
 console.warn('Team-Kontakte für Chat konnten nicht geladen werden:', err);
        }

        const allUsers = [...konfis, ...adminUsers];

        // Extrahiere verfügbare Jahrgänge (nur von gefilterten Konfis)
        const jahrgaenge = [...new Set(
          konfis
            .filter(u => u.jahrgang_name || u.jahrgang)
            .map(u => u.jahrgang_name || u.jahrgang)
        )].filter(Boolean) as string[];
        setAvailableJahrgaenge(jahrgaenge);

        // Filter out current user for direct messages
        if (chatType === 'direct') {
          const filteredUsers = allUsers.filter(u =>
            !(u.id === user?.id && u.type === user?.type)
          );
          setUsers(filteredUsers);
        } else {
          setUsers(allUsers);
        }
      }

    } catch (err) {
      setError('Fehler beim Laden der Benutzer');
 console.error('Error loading users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleParticipantToggle = (id: string) => {
    const newSelected = new Set(selectedParticipants);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedParticipants(newSelected);
  };

  const createDirectMessage = async (targetUser: ChatUser) => {
    if (offlineBlockiert(isOnline, setError)) return;
    // Frueher stand hier eine Doppel-Pruefung ("Chat existiert bereits") gegen
    // chat.participants. GET /chat/rooms liefert dieses Feld gar nicht — die
    // Pruefung war immer false und der Hinweis erschien nie. Sie wird auch
    // nicht gebraucht: POST /chat/direct gibt einen bestehenden Raum zurueck
    // (created: false), und /chat/available-users blendet Partner mit
    // bestehendem Direktchat ohnehin aus.
    await guard(async () => {
      try {
        const directRes = await api.post('/chat/direct', {
          target_user_id: targetUser.id,
          target_user_type: targetUser.type
        });

        await refreshFromAPI(); // Update badge context
        handleModalClose();
        onSuccess(directRes.data?.room_id);
      } catch (err) {
        setError(fehlerText(err, 'Fehler beim Erstellen der Direktnachricht'));
        console.error('Error creating direct message:', err);
      }
    });
  };

  const createGroupChat = async () => {
    if (!groupName.trim()) {
      setError('Bitte gib einen Gruppennamen ein');
      return;
    }

    if (selectedParticipants.size === 0) {
      setError('Bitte wähle mindestens eine:n Teilnehmer:in aus');
      return;
    }

    await guard(async () => {
      try {
        // Convert participant IDs from "type-id" format to objects
        const participants = Array.from(selectedParticipants).map(participantId => {
          const [type, id] = participantId.split('-');
          return {
            user_id: parseInt(id),
            user_type: type
          };
        });

        const groupData = {
          name: groupName.trim(),
          type: 'group',
          participants: participants
        };

        const groupRes = await api.post('/chat/rooms', groupData);

        await refreshFromAPI(); // Update badge context
        handleModalClose();
        onSuccess(groupRes.data?.room_id);
      } catch (err) {
        console.error('Error creating group chat:', err);
        setError(`Fehler beim Erstellen des Gruppenchats: ${fehlerTextOderMessage(err, 'Unbekannter Fehler')}`);
      }
    });
  };

  const handleModalClose = () => {
    setChatType('direct');
    setGroupName('');
    setSearchText('');
    setSelectedParticipants(new Set());
    setUsers([]);
    setIsDirty(false);
    doClose();
  };

  const filteredUsers = users.filter(user => {
    // Name/Suchfilter
    const name = user.name || user.display_name || '';
    const matchesSearch = name.toLowerCase().includes(searchText.toLowerCase()) ||
           (user.jahrgang && user.jahrgang.toLowerCase().includes(searchText.toLowerCase()));

    if (!matchesSearch) return false;

    // Rollenfilter
    if (selectedRole !== 'alle') {
      if (selectedRole === 'konfi' && user.type !== 'konfi') return false;
      // "Team" meint Admins UND Teamer:innen. Vorher nur 'admin' — der Filter
      // "Team" zeigte dadurch das Team ohne seine Teamer:innen.
      if (selectedRole === 'admin' && !istTeamTyp(user.type)) return false;
    }

    // Jahrgangsfilter (nur für Konfis)
    if (selectedJahrgang !== 'alle' && user.type === 'konfi') {
      const userJahrgang = user.jahrgang_name || user.jahrgang;
      if (userJahrgang !== selectedJahrgang) return false;
    }

    return true;
  });

  const getUserDisplayName = (user: ChatUser) => {
    return user.name || user.display_name || 'Unbekannt';
  };

  const isFormValid = chatType === 'direct' || (chatType === 'group' && groupName.trim() && selectedParticipants.size > 0);
  const isAdmin = user?.type === 'admin';
  const isTeamer = user?.type === 'teamer';

  return (
    <IonPage ref={pageRef}>
      {/* Fixierter Header */}
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={handleClose} disabled={creating} aria-label="Schließen">
              <IonIcon icon={ICON_SCHLIESSEN} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>{chatType === 'direct' ? 'Neue Direktnachricht' : 'Neuer Gruppenchat'}</IonTitle>
          {chatType === 'group' && (
            <IonButtons slot="end">
              <IonButton className="app-modal-submit-btn app-modal-submit-btn--chat" onClick={createGroupChat} disabled={!isFormValid || creating || !isOnline} aria-label="Gruppenchat erstellen">
                {!isOnline ? <><IonIcon icon={ICON_OFFLINE} /> Du bist offline</> : creating ? <IonSpinner name="crescent" /> : <IonIcon icon={ICON_HAKEN} slot="icon-only" />}
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
        {/* Segment im Header für Admin und Teamer:innen */}
        {(isAdmin || isTeamer) && (
          <IonToolbar>
            <IonSegment
              value={chatType}
              onIonChange={(e) => setChatType(e.detail.value as 'direct' | 'group')}
            >
              <IonSegmentButton value="direct">
                <IonLabel>Direktnachricht</IonLabel>
              </IonSegmentButton>
              <IonSegmentButton value="group">
                <IonLabel>Gruppenchat</IonLabel>
              </IonSegmentButton>
            </IonSegment>
          </IonToolbar>
        )}
      </IonHeader>

      <IonContent className="app-gradient-background">

          {/* Gruppenname Input für Group Chat - iOS26 Pattern */}
          {chatType === 'group' && (
            <IonList inset={true} className="app-modal-section">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--chat">
                  <IonIcon icon={ICON_GRUPPE} />
                </div>
                <IonLabel>Gruppenname</IonLabel>
              </IonListHeader>
              <IonItemGroup>
                <IonItem>
                  <IonInput aria-label="Gruppenname eingeben"
                    value={groupName}
                    onIonInput={(e) => setGroupName(e.detail.value!)}
                    placeholder="Gruppenname eingeben"
                    clearInput={true}
                    disabled={creating}
                  />
                </IonItem>
              </IonItemGroup>
            </IonList>
          )}

          {/* Filter mit Suche - iOS26 Pattern */}
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--chat">
                <IonIcon icon={ICON_FILTER} />
              </div>
              <IonLabel>Suche & Filter</IonLabel>
            </IonListHeader>
            <IonItemGroup>
              {/* Suchfeld */}
              <IonItem>
                <IonIcon
                  icon={ICON_SUCHE_GEFUELLT}
                  slot="start"
                  style={{
                    color: 'var(--app-text-system)',
                    fontSize: 'var(--app-text-standard)'
                  }}
                />
                <IonInput aria-label="Person suchen"
                  value={searchText}
                  onIonInput={(e) => setSearchText(e.detail.value!)}
                  placeholder="Person suchen..."
                />
              </IonItem>
              {/* Rolle Filter - für Admins und Teamer:innen */}
              {(isAdmin || isTeamer) && (
                <IonItem>
                  <IonIcon
                    icon={ICON_PERSON}
                    slot="start"
                    style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }}
                  />
                  <IonSelect aria-label="Nach Rolle filtern"
                    value={selectedRole}
                    onIonChange={(e) => setSelectedRole(e.detail.value!)}
                    placeholder="Alle Rollen"
                    interface="popover"
                    interfaceOptions={{ arrow: false }}
                    style={{ width: '100%' }}
                  >
                    <IonSelectOption value="alle">Alle</IonSelectOption>
                    <IonSelectOption value="konfi">Konfis</IonSelectOption>
                    <IonSelectOption value="admin">Team</IonSelectOption>
                  </IonSelect>
                </IonItem>
              )}
              {/* Jahrgang Filter - für Admins und Teamer:innen */}
              {(isAdmin || isTeamer) && availableJahrgaenge.length > 0 && (
                <IonItem>
                  <IonIcon
                    icon={ICON_TERMIN_GEFUELLT}
                    slot="start"
                    style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }}
                  />
                  <IonSelect aria-label="Nach Jahrgang filtern"
                    value={selectedJahrgang}
                    onIonChange={(e) => setSelectedJahrgang(e.detail.value!)}
                    placeholder="Alle Jahrgänge"
                    interface="popover"
                    interfaceOptions={{ arrow: false }}
                    style={{ width: '100%' }}
                  >
                    <IonSelectOption value="alle">Alle Jahrgänge</IonSelectOption>
                    {availableJahrgaenge.map(jg => (
                      <IonSelectOption key={jg} value={jg}>{jg}</IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>
              )}
            </IonItemGroup>
          </IonList>

          {/* Users List - IonListHeader ueber der Card */}
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--chat">
                <IonIcon icon={ICON_GRUPPE} />
              </div>
              <IonLabel>Personen ({filteredUsers.length})</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: filteredUsers.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
                {loading ? (
                  <div style={{ padding: 'var(--app-abstand-riesig) var(--app-abstand-gross)', textAlign: 'center' }}>
                    <IonSpinner name="crescent" />
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div style={{
                    padding: 'var(--app-abstand-riesig) var(--app-abstand-gross)',
                    textAlign: 'center',
                    color: 'var(--app-text-secondary)'
                  }}>
                    <IonIcon icon={ICON_SUCHE_GEFUELLT} style={{ fontSize: 'var(--app-anzeige-riesig)', opacity: 0.3, marginBottom: 'var(--app-abstand-basis)' }} />
                    <p style={{ margin: '0', fontSize: 'var(--app-text-standard)' }}>Keine Personen gefunden</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {filteredUsers.map((targetUser) => {
                      const participantId = `${targetUser.type}-${targetUser.id}`;
                      const isSelected = selectedParticipants.has(participantId);
                      // Teamer:innen gehören zum Team, nicht zu den Konfis —
                      // sonst Konfi-Farbe und keine Funktionsbezeichnung.
                      const isAdmin = istTeamTyp(targetUser.type);

                      return (
                        <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
                          key={participantId}
                          className={`app-list-item ${isAdmin ? 'app-list-item--team' : 'app-list-item--konfi'}`}
                          onClick={() => {
                            if (!creating) {
                              if (chatType === 'direct') {
                                createDirectMessage(targetUser);
                              } else {
                                handleParticipantToggle(participantId);
                              }
                            }
                          }}
                          style={{
                            cursor: creating ? 'default' : 'pointer',
                            opacity: creating ? 0.6 : 1,
                            position: 'relative',
                            overflow: 'hidden',
                            background: isSelected ? (isAdmin ? 'rgba(var(--app-color-teamer-rgb), 0.08)' : 'rgba(var(--app-color-konfis-rgb), 0.08)') : undefined
                          }}
                        >
                          <div className="app-corner-badges">
                            <div
                              className="app-corner-badge"
                              style={{ backgroundColor: isAdmin ? rollenFarbeVar(targetUser.role_name, 'teamer') : 'var(--app-color-konfis)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--app-abstand-mini) var(--app-abstand-eng)' }}
                              title={isAdmin ? (targetUser.role_description || 'Leitung') : 'Konfi'}
                              role="img"
                              aria-label={isAdmin ? (targetUser.role_description || 'Leitung') : 'Konfi'}
                            >
                              <IonIcon icon={isAdmin ? ICON_GRUPPE_GEFUELLT : ICON_PERSON_GEFUELLT} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
                            </div>
                          </div>

                          <div className="app-list-item__row" style={chatType === 'group' ? { paddingRight: 'var(--app-abstand-eng)' } : undefined}>
                            <div className="app-list-item__main">
                              <div className={`app-icon-circle app-icon-circle--lg ${isAdmin ? 'app-icon-circle--team' : 'app-icon-circle--konfi'}`}>
                                <IonIcon icon={ICON_PERSON_GEFUELLT} />
                              </div>
                              <div className="app-list-item__content">
                                <div className="app-list-item__title" style={{ paddingRight: 'var(--app-freiraum-aktion-l)' }}>
                                  {getUserDisplayName(targetUser)}
                                </div>
                                {isAdmin && targetUser.role_description && (
                                  <div className="app-list-item__meta">
                                    <span className="app-list-item__meta-item">
                                      <IonIcon icon={ICON_GRUPPE} style={{ color: rollenTextFarbeVar(targetUser.role_name, 'teamer') }} />
                                      {targetUser.role_description}
                                    </span>
                                  </div>
                                )}
                                {!isAdmin && (targetUser.jahrgang_name || targetUser.jahrgang) && (
                                  <div className="app-list-item__meta">
                                    <span className="app-list-item__meta-item">
                                      <IonIcon icon={ICON_TERMIN_GEFUELLT} style={{ color: 'var(--app-text-jahrgang)' }} />
                                      {targetUser.jahrgang_name || targetUser.jahrgang}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>

                          </div>
                        </div>
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
};

export default SimpleCreateChatModal;
