import { ICON_HINZUFUEGEN_GEFUELLT, ICON_ZURUECK } from '../../shared/icons';
import { fehlerText } from '../../../utils/fehler';
import React, { useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonButtons,
  IonButton,
  IonIcon,
  useIonModal,
  useIonAlert
} from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import { offlineBlockiert } from '../../../utils/offlineAktion';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import UsersView from '../UsersView';
import LoadingSpinner from '../../common/LoadingSpinner';
import UserManagementModal from '../modals/UserManagementModal';
import { AdminUser } from '../../../types/user';
import { triggerPullHaptic } from '../../../utils/haptics';

const AdminUsersPage: React.FC = () => {
  const { setError, user, isOnline } = useApp();
  const { pageRef, presentingElement } = useModalPage('admin-users');
  
  // Offline-Query: Users
  const { data: users, loading, refresh: refreshUsers, refreshLive: refreshUsersLive } = useOfflineQuery<AdminUser[]>(
    'admin:users:' + user?.organization_id,
    async () => { const res = await api.get('/users'); return res.data; },
    { ttl: CACHE_TTL.KONFIS }
  );
  
  // Modal state
  const [modalUserId, setModalUserId] = useState<number | null>(null);

  // Alert Hook für Bestätigungsdialoge
  const [presentAlert] = useIonAlert();

  // Modal mit useIonModal Hook
  const [presentUserModalHook, dismissUserModalHook] = useIonModal(UserManagementModal, {
    userId: modalUserId,
    onClose: () => {
      dismissUserModalHook();
      setModalUserId(null);
    },
    onSuccess: () => {
      dismissUserModalHook();
      setModalUserId(null);
      refreshUsers();
    }
  });

  // Subscribe to live updates for users
  useLiveRefresh('users', refreshUsersLive);

  const handleDeleteUser = async (userToDelete: AdminUser) => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Benutzer löschen',
      message: `Benutzer "${userToDelete.display_name}" (@${userToDelete.username}) wirklich löschen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/users/${userToDelete.id}`);
              await refreshUsers();
            } catch (err) {
              setError(fehlerText(err, 'Fehler beim Löschen des Benutzers'));
            }
          }
        }
      ]
    });
  };

  const handleSelectUser = (user: AdminUser) => {
    setModalUserId(user.id);
    presentUserModalHook({
      presentingElement: presentingElement
    });
  };

  const presentUserModal = () => {
    setModalUserId(null);
    presentUserModalHook({
      presentingElement: presentingElement
    });
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
        <IonButtons slot="start">
          <IonButton aria-label="Zurück" onClick={() => window.history.back()}>
            <IonIcon icon={ICON_ZURUECK} />
          </IonButton>
        </IonButtons>
          <IonTitle>Benutzer:innen</IonTitle>
          <IonButtons slot="end">
            {user?.role_name === 'org_admin' && (
              <IonButton aria-label="Neue Benutzer:in anlegen" onClick={presentUserModal}>
                <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} />
              </IonButton>
            )}
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Benutzer:innen</IonTitle>
          </IonToolbar>
        </IonHeader>
        
        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          refreshUsers();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>
        
        {loading ? (
          <LoadingSpinner message="Benutzer werden geladen..." />
        ) : (
          <UsersView 
            users={users || []}
            onUpdate={refreshUsers}
            onSelectUser={handleSelectUser}
            onDeleteUser={handleDeleteUser}
            darfVerwalten={user?.role_name === 'org_admin'}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default AdminUsersPage;