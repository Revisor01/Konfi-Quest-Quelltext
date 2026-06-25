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
  IonItem,
  IonLabel,
  IonList,
  IonSearchbar,
  IonListHeader,
  IonCard,
  IonCardContent
} from '@ionic/react';
import { close, person, people, searchOutline, peopleOutline, informationCircleOutline, cloudOfflineOutline, calendar } from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';
import LoadingSpinner from '../../common/LoadingSpinner';
import { ChatUser } from '../../../types/user';

interface DirectMessageModalProps {
  onClose: () => void;
  onSuccess: () => void;
  dismiss?: () => void;
}

const DirectMessageModal: React.FC<DirectMessageModalProps> = ({ onClose, onSuccess, dismiss }) => {
  const { user, setError, isOnline } = useApp();
  const pageRef = useRef<HTMLElement>(null);
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);
  const { isSubmitting: creating, guard } = useActionGuard();

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const konfisEndpoint = user?.type === 'teamer' ? '/teamer/konfis' : '/admin/konfis';
      const [konfisRes, adminsRes] = await Promise.all([
        api.get(konfisEndpoint),
        api.get('/users').catch(() => ({ data: [] })) // Fallback if endpoint doesn't exist
      ]);

      const allUsers: ChatUser[] = [
        ...konfisRes.data.map((konfi: any) => ({ ...konfi, type: 'konfi' as const })),
        ...adminsRes.data.map((admin: any) => ({ ...admin, type: 'admin' as const }))
      ];

      // Filter out current user
      const filteredUsers = allUsers.filter(u =>
        !(u.id === user?.id && u.type === user?.type)
      );

      setUsers(filteredUsers);
    } catch (err) {
      setError('Fehler beim Laden der Benutzer');
 console.error('Error loading users:', err);
    } finally {
      setLoading(false);
    }
  };

  const createDirectMessage = async (targetUser: ChatUser) => {
    if (!isOnline) return;
    await guard(async () => {
      try {
        await api.post('/chat/direct', {
          target_user_id: targetUser.id,
          target_user_type: targetUser.type
        });

        onSuccess();
        handleClose();
      } catch (err) {
        setError('Fehler beim Erstellen der Direktnachricht');
        console.error('Error creating direct message:', err);
      }
    });
  };

  const handleClose = () => {
    setSearchText('');
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };

  const filteredUsers = users.filter(user => {
    const name = user.name || user.display_name || '';
    return name.toLowerCase().includes(searchText.toLowerCase()) ||
           (user.jahrgang && user.jahrgang.toLowerCase().includes(searchText.toLowerCase()));
  });

  const getUserDisplayName = (user: ChatUser) => {
    return user.name || user.display_name || 'Unbekannt';
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Direktnachricht</IonTitle>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={handleClose}>
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent>
        {loading ? (
          <LoadingSpinner message="Benutzer werden geladen..." />
        ) : (
          <>
            {/* Suche */}
            <IonList inset={true} className="app-modal-section">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--chat">
                  <IonIcon icon={searchOutline} />
                </div>
                <IonLabel>Suche</IonLabel>
              </IonListHeader>
              <IonSearchbar
                className="ios26-searchbar-classic"
                value={searchText}
                onIonInput={(e) => setSearchText(e.detail.value!)}
                placeholder="Person suchen..."
                style={{
                  '--background': '#f8f9fa',
                  '--border-radius': '12px'
                }}
              />
            </IonList>

            {/* Kontakte */}
            <IonList inset={true} className="app-modal-section">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--chat">
                  <IonIcon icon={peopleOutline} />
                </div>
                <IonLabel>Kontakte ({filteredUsers.length})</IonLabel>
              </IonListHeader>
              {filteredUsers.length === 0 ? (
                <IonCard className="app-card">
                  <IonCardContent style={{ textAlign: 'center', padding: '32px 16px' }}>
                    <p style={{ margin: 0, color: '#666' }}>Keine Personen gefunden</p>
                  </IonCardContent>
                </IonCard>
              ) : (
                <IonCard className="app-card">
                  <IonCardContent style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {filteredUsers.map((targetUser) => {
                        const isAdmin = targetUser.type === 'admin';
                        const badgeColor = isAdmin ? 'var(--app-color-teamer)' : 'var(--app-color-konfis)';
                        return (
                          <div
                            key={`${targetUser.type}-${targetUser.id}`}
                            className={`app-list-item ${isAdmin ? 'app-list-item--team' : 'app-list-item--konfi'}`}
                            onClick={() => !creating && isOnline && createDirectMessage(targetUser)}
                            style={{
                              cursor: creating || !isOnline ? 'default' : 'pointer',
                              opacity: creating ? 0.6 : 1,
                              position: 'relative',
                              overflow: 'hidden'
                            }}
                          >
                            <div className="app-corner-badges">
                              <div
                                className="app-corner-badge"
                                style={{ backgroundColor: badgeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                                title={isAdmin ? 'Admin' : 'Konfi'}
                              >
                                <IonIcon icon={isAdmin ? people : person} style={{ color: '#fff', fontSize: '0.85rem' }} />
                              </div>
                            </div>
                            <div className="app-list-item__row">
                              <div className="app-list-item__main">
                                <div className={`app-icon-circle app-icon-circle--lg ${isAdmin ? 'app-icon-circle--team' : 'app-icon-circle--konfi'}`}>
                                  <IonIcon icon={isAdmin ? person : people} />
                                </div>
                                <div className="app-list-item__content">
                                  <div className="app-list-item__title" style={{ paddingRight: '70px' }}>
                                    {getUserDisplayName(targetUser)}
                                  </div>
                                  {isAdmin && (targetUser as any).role_description && (
                                    <div className="app-list-item__meta">
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={peopleOutline} style={{ color: 'var(--app-color-teamer)' }} />
                                        {(targetUser as any).role_description}
                                      </span>
                                    </div>
                                  )}
                                  {!isAdmin && targetUser.jahrgang && (
                                    <div className="app-list-item__meta">
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={calendar} style={{ color: 'var(--app-color-jahrgang)' }} />
                                        {targetUser.jahrgang}
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
                  </IonCardContent>
                </IonCard>
              )}
            </IonList>

            {/* Hinweis */}
            <IonList inset={true} className="app-modal-section">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--chat">
                  <IonIcon icon={informationCircleOutline} />
                </div>
                <IonLabel>Hinweis</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: !isOnline ? '#ef4444' : '#666', lineHeight: '1.4' }}>
                    {!isOnline ? <><IonIcon icon={cloudOfflineOutline} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Du bist offline</> : 'Wähle eine Person aus, um eine private Unterhaltung zu starten.'}
                  </p>
                </IonCardContent>
              </IonCard>
            </IonList>
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default DirectMessageModal;
