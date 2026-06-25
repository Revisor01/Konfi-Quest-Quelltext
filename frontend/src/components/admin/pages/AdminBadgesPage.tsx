import React, { useState, useCallback, useRef } from 'react';
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
import BadgesView from '../BadgesView';
import LoadingSpinner from '../../common/LoadingSpinner';
import BadgeManagementModal from '../modals/BadgeManagementModal';
import { triggerPullHaptic } from '../../../utils/haptics';

interface Badge {
  id: number;
  name: string;
  icon: string;
  description?: string;
  criteria_type: string;
  criteria_value: number;
  criteria_extra?: string;
  is_active: boolean;
  is_hidden: boolean;
  earned_count: number;
  created_at: string;
  target_role?: string;
}

const AdminBadgesPage: React.FC = () => {
  const { user, setError, isOnline } = useApp();
  const { pageRef, presentingElement } = useModalPage('admin-badges');

  // State
  const [selectedRole, setSelectedRole] = useState<'konfi' | 'teamer'>('konfi');

  // Offline-Query: Badges (key enthält selectedRole)
  const { data: badges, loading, refresh: refreshBadges } = useOfflineQuery<Badge[]>(
    `admin:badges:${user?.organization_id}:${selectedRole}`,
    async () => { const res = await api.get(`/admin/badges?target_role=${selectedRole}`); return res.data; },
    { ttl: CACHE_TTL.STAMMDATEN }
  );

  // Modal state
  const [selectedBadge, setSelectedBadge] = useState<Badge | null>(null);
  const [modalBadgeId, setModalBadgeId] = useState<number | null>(null);

  // Alert Hook für Bestätigungsdialoge
  const [presentAlert] = useIonAlert();

  // Modal mit useIonModal Hook
  // Haelt den "ungespeicherte Aenderungen"-Stand des Badge-Modals, damit canDismiss
  // auch Swipe-/Backdrop-Schliessen abfangen und nachfragen kann (nicht nur der X-Button).
  const badgeModalDirtyRef = useRef(false);

  const [presentBadgeModalHook, dismissBadgeModalHook] = useIonModal(BadgeManagementModal, {
    badgeId: modalBadgeId,
    targetRole: selectedRole,
    onDirtyChange: (dirty: boolean) => { badgeModalDirtyRef.current = dirty; },
    onClose: () => {
      dismissBadgeModalHook();
      setSelectedBadge(null);
      setModalBadgeId(null);
    },
    onSuccess: () => {
      dismissBadgeModalHook();
      setSelectedBadge(null);
      setModalBadgeId(null);
      refreshBadges();
    }
  });

  // Faengt JEDEN Schliess-Weg ab (Swipe, Backdrop): bei ungespeicherten
  // Aenderungen erst nachfragen, sonst direkt schliessen lassen.
  const badgeModalCanDismiss = async (): Promise<boolean> => {
    if (!badgeModalDirtyRef.current) return true;
    return new Promise<boolean>((resolve) => {
      let decided = false;
      const decide = (v: boolean) => { decided = true; resolve(v); };
      presentAlert({
        header: 'Ungespeicherte Änderungen',
        message: 'Möchtest du die Änderungen verwerfen?',
        backdropDismiss: false,
        buttons: [
          { text: 'Abbrechen', role: 'cancel', handler: () => decide(false) },
          { text: 'Verwerfen', role: 'destructive', handler: () => decide(true) }
        ],
        // Fallback: schliesst der Alert ohne Button, Promise nie haengen lassen.
        onDidDismiss: () => { if (!decided) resolve(false); }
      });
    });
  };

  // Subscribe to live updates for badges
  useLiveRefresh('badges', refreshBadges);

  const handleDeleteBadge = async (badge: Badge) => {
    if (!isOnline) return;
    presentAlert({
      header: 'Badge löschen',
      message: `Badge "${badge.name}" wirklich löschen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/admin/badges/${badge.id}`);
              await refreshBadges();
            } catch (err: any) {
              if (err.response?.data?.error) {
                setError(err.response.data.error);
              } else {
                setError('Fehler beim Löschen des Badges');
              }
            }
          }
        }
      ]
    });
  };

  const handleSelectBadge = (badge: Badge) => {
    setSelectedBadge(badge);
    setModalBadgeId(badge.id);
    presentBadgeModalHook({
      presentingElement: presentingElement,
      canDismiss: badgeModalCanDismiss,
      backdropDismiss: false
    });
  };

  const presentBadgeModal = () => {
    setSelectedBadge(null);
    setModalBadgeId(null);
    presentBadgeModalHook({
      presentingElement: presentingElement,
      canDismiss: badgeModalCanDismiss,
      backdropDismiss: false
    });
  };

  const handleRoleChange = (role: 'konfi' | 'teamer') => {
    setSelectedRole(role);
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => window.history.back()}>
              <IonIcon icon={arrowBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>Badges</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={presentBadgeModal}>
              <IonIcon icon={add} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Badges</IonTitle>
          </IonToolbar>
        </IonHeader>
        
        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          refreshBadges();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        {loading ? (
          <LoadingSpinner message="Badges werden geladen..." />
        ) : (
          <BadgesView
            badges={badges || []}
            onUpdate={refreshBadges}
            onAddBadgeClick={presentBadgeModal}
            onSelectBadge={handleSelectBadge}
            onDeleteBadge={handleDeleteBadge}
            targetRole={selectedRole}
            onRoleChange={handleRoleChange}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default AdminBadgesPage;