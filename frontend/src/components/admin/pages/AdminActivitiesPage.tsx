import React, { useState, useCallback } from 'react';
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
import { add, arrowBack } from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import ActivitiesView from '../ActivitiesView';
import LoadingSpinner from '../../common/LoadingSpinner';
import ActivityManagementModal from '../modals/ActivityManagementModal';
import { triggerPullHaptic } from '../../../utils/haptics';

interface Activity {
  id: number;
  name: string;
  description?: string;
  points: number;
  type: 'gottesdienst' | 'gemeinde' | null;
  target_role?: 'konfi' | 'teamer';
  category?: string;
  created_at: string;
}

const AdminActivitiesPage: React.FC = () => {
  const { user, setError, isOnline } = useApp();
  const { pageRef, presentingElement, cleanupModals } = useModalPage('admin-activities');
  
  // State
  const [selectedRole, setSelectedRole] = useState<'konfi' | 'teamer'>('konfi');

  // Offline-Query: Activities (key enthält selectedRole)
  const { data: activities, loading, refresh: refreshActivities } = useOfflineQuery<Activity[]>(
    `admin:activities:${user?.organization_id}:${selectedRole}`,
    async () => { const res = await api.get(`/admin/activities?target_role=${selectedRole}`); return res.data; },
    { ttl: CACHE_TTL.STAMMDATEN }
  );

  // Modal state
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);

  // Alert Hook für Bestätigungsdialoge
  const [presentAlert] = useIonAlert();

  // Modal mit useIonModal Hook
  const [presentActivityModalHook, dismissActivityModalHook] = useIonModal(ActivityManagementModal, {
    activity: selectedActivity,
    activityId: selectedActivity?.id || null,
    targetRole: selectedRole,
    onClose: () => dismissActivityModalHook(),
    onSuccess: () => {
      dismissActivityModalHook();
      refreshActivities();
    }
  });

  // Subscribe to live updates for activities
  useLiveRefresh('activities', refreshActivities);

  const handleDeleteActivity = async (activity: Activity) => {
    if (!isOnline) return;
    presentAlert({
      header: 'Aktivität löschen',
      message: `Aktivität "${activity.name}" wirklich löschen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/admin/activities/${activity.id}`);
              await refreshActivities();
            } catch (err: any) {
              const errorMessage = err.response?.data?.error || 'Fehler beim Löschen der Aktivität';
              setError(errorMessage);
            }
          }
        }
      ]
    });
  };

  const handleSelectActivity = (activity: Activity) => {
    setSelectedActivity(activity);
    presentActivityModalHook({ 
      presentingElement: presentingElement || pageRef.current || undefined 
    });
  };

  const presentActivityModal = () => {
    setSelectedActivity(null);
    presentActivityModalHook({
      presentingElement: presentingElement || pageRef.current || undefined
    });
  };

  const handleRoleChange = (role: 'konfi' | 'teamer') => {
    setSelectedRole(role);
    // useOfflineQuery reagiert automatisch auf selectedRole-Änderung im cacheKey
  };

  // Rollen-basierte Berechtigungen (org_admin und admin dürfen alles)
  const isAdmin = ['org_admin', 'admin'].includes(user?.role_name || '');
  const canCreate = isAdmin;
  const canEdit = isAdmin;
  const canDelete = isAdmin;


  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => window.history.back()}>
              <IonIcon icon={arrowBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>Aktivitäten</IonTitle>
          {canCreate && (
            <IonButtons slot="end">
              <IonButton onClick={presentActivityModal}>
                <IonIcon icon={add} />
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Aktivitäten</IonTitle>
          </IonToolbar>
        </IonHeader>
        
        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          refreshActivities();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        {loading ? (
          <LoadingSpinner message="Aktivitäten werden geladen..." />
        ) : (
          <ActivitiesView
            activities={activities || []}
            onUpdate={refreshActivities}
            onAddActivityClick={presentActivityModal}
            onSelectActivity={handleSelectActivity}
            onDeleteActivity={handleDeleteActivity}
            canEdit={canEdit}
            canDelete={canDelete}
            targetRole={selectedRole}
            onRoleChange={handleRoleChange}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default AdminActivitiesPage;