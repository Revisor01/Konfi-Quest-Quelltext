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
import {
  add,
  arrowBack
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import OrganizationView from '../OrganizationView';
import LoadingSpinner from '../../common/LoadingSpinner';
import OrganizationManagementModal from '../modals/OrganizationManagementModal';
import { triggerPullHaptic } from '../../../utils/haptics';

interface Organization {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  contact_email?: string;
  website?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  user_count: number;
  konfi_count: number;
  activity_count: number;
  event_count: number;
  badge_count: number;
}

const AdminOrganizationsPage: React.FC = () => {
  const { setError, isOnline, refreshUser } = useApp();
  const { pageRef, presentingElement } = useModalPage('admin-organizations');
  
  // SWR-Cache für Organisationen
  const { data: organizationsData, loading, refresh: loadOrganizations } = useOfflineQuery<Organization[]>(
    'super-admin-organizations',
    useCallback(async () => {
      const response = await api.get('/organizations');
      return response.data;
    }, []),
    { ttl: CACHE_TTL.STAMMDATEN }
  );
  const organizations = organizationsData ?? [];

  // Modal state
  const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);
  const [modalOrganizationId, setModalOrganizationId] = useState<number | null>(null);

  // Alert Hook für Bestätigungsdialoge
  const [presentAlert] = useIonAlert();
  // Modal mit useIonModal Hook
  const [presentOrganizationModalHook, dismissOrganizationModalHook] = useIonModal(OrganizationManagementModal, {
    organizationId: modalOrganizationId,
    onClose: () => {
      dismissOrganizationModalHook();
      setSelectedOrganization(null);
      setModalOrganizationId(null);
    },
    onSuccess: () => {
      dismissOrganizationModalHook();
      // User-State neu laden -> Trial-Banner erscheint/verschwindet sofort
      // (ohne Logout/Neustart). Bedingungslos: ein /me-Call ist guenstig, und
      // der Vergleich auf die eigene Org war fehleranfaellig (modalOrganizationId
      // wurde teils schon zurueckgesetzt). super_admin ohne Org schadet es nicht.
      refreshUser();
      setSelectedOrganization(null);
      setModalOrganizationId(null);
      loadOrganizations();
    }
  });

  // Subscribe to live updates for organizations
  useLiveRefresh('organizations', loadOrganizations);

  const handleDeleteOrganization = async (organization: Organization) => {
    if (!isOnline) return;
    presentAlert({
      header: 'Organisation löschen',
      message: `Organisation "${organization.display_name}" (${organization.name}) wirklich löschen?\n\nWarnung: Alle zugehörigen Daten (Benutzer, Konfis, Aktivitäten) werden ebenfalls gelöscht!`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/organizations/${organization.id}`);
              await loadOrganizations();
            } catch (err: any) {
              if (err.response?.data?.error) {
                setError(err.response.data.error);
              } else {
                setError('Fehler beim Löschen der Organisation');
              }
            }
          }
        }
      ]
    });
  };

  const handleSelectOrganization = (organization: Organization) => {
    setSelectedOrganization(organization);
    setModalOrganizationId(organization.id);
    presentOrganizationModalHook({
      presentingElement: presentingElement
    });
  };

  const presentOrganizationModal = () => {
    setSelectedOrganization(null);
    setModalOrganizationId(null);
    presentOrganizationModalHook({
      presentingElement: presentingElement
    });
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
          <IonTitle>Organisationen</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={presentOrganizationModal}>
              <IonIcon icon={add} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Organisationen</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          loadOrganizations();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>
        
        {loading ? (
          <LoadingSpinner message="Organisationen werden geladen..." />
        ) : (
          <>
            <OrganizationView
              organizations={organizations}
              onUpdate={loadOrganizations}
              onAddOrganizationClick={presentOrganizationModal}
              onSelectOrganization={handleSelectOrganization}
              onDeleteOrganization={handleDeleteOrganization}
            />

            <div style={{ height: '32px' }} />
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default AdminOrganizationsPage;