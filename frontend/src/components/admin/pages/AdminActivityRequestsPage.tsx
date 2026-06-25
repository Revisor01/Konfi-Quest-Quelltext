import React, { useState, useCallback } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  useIonModal,
  useIonAlert
} from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh, useLiveUpdate } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import ActivityRequestsView from '../ActivityRequestsView';
import LoadingSpinner from '../../common/LoadingSpinner';
import ActivityRequestModal from '../modals/ActivityRequestModal';
import { triggerPullHaptic } from '../../../utils/haptics';
import { safeUUID } from '../../../utils/uuid';

interface ActivityRequest {
  id: number;
  konfi_id: number;
  konfi_name: string;
  jahrgang_name?: string;
  activity_id: number;
  activity_name: string;
  requested_date: string;
  comment?: string;
  photo_filename?: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_comment?: string;
  approved_by?: number;
  created_at: string;
  updated_at: string;
}

const AdminActivityRequestsPage: React.FC = () => {
  const { user, setSuccess, setError, isOnline } = useApp();
  const { pageRef, presentingElement } = useModalPage('admin-requests');
  const { triggerRefresh } = useLiveUpdate();

  // Offline-Query: Requests
  const { data: requests, loading, refresh: refreshRequests } = useOfflineQuery<ActivityRequest[]>(
    'admin:requests:' + user?.organization_id,
    async () => { const res = await api.get('/admin/activities/requests'); return res.data; },
    { ttl: CACHE_TTL.REQUESTS }
  );
  
  // Modal state
  const [selectedRequest, setSelectedRequest] = useState<ActivityRequest | null>(null);
  const [modalRequestId, setModalRequestId] = useState<number | null>(null);

  // Alert Hook für Bestätigungsdialoge
  const [presentAlert] = useIonAlert();

  // Modal mit useIonModal Hook
  const [presentRequestModalHook, dismissRequestModalHook] = useIonModal(ActivityRequestModal, {
    requestId: modalRequestId,
    onClose: () => {
      dismissRequestModalHook();
      setSelectedRequest(null);
      setModalRequestId(null);
    },
    onSuccess: () => {
      dismissRequestModalHook();
      setSelectedRequest(null);
      setModalRequestId(null);
      refreshRequests();
      // Genehmigen/Ablehnen aendert die Anzahl offener Antraege -> 'requests'
      // triggern, damit das Antraege-Tab-Badge (BadgeContext) sofort aktualisiert
      // statt erst beim 30s-Poll.
      triggerRefresh('requests');
      // Genehmigen/Ablehnen aendert Konfi-Punkte -> Admin-Konfi-Liste live
      // aktualisieren, damit man nicht manuell refreshen muss.
      triggerRefresh('konfis');
    }
  });

  // Subscribe to live updates for requests
  useLiveRefresh('requests', refreshRequests);

  const handleResetRequest = async (request: ActivityRequest) => {
    const statusText = request.status === 'approved' ? 'genehmigten' : 'abgelehnten';
    presentAlert({
      header: 'Antrag zurücksetzen',
      message: `${statusText} Antrag von "${request.konfi_name}" zurücksetzen und wieder als offen markieren?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Zurücksetzen',
          handler: async () => {
            if (networkMonitor.isOnline) {
              try {
                await api.put(`/admin/activities/requests/${request.id}/reset`);
                await refreshRequests();
                // Zuruecksetzen macht den Antrag wieder offen -> Badge muss
                // hochzaehlen; Punkte werden zurueckgenommen -> Konfi-Liste.
                triggerRefresh('requests');
                triggerRefresh('konfis');
              } catch (err: any) {
                if (err.response?.data?.error) {
                  setError(err.response.data.error);
                } else {
                  setError('Fehler beim Zurücksetzen des Antrags');
                }
              }
            } else {
              await writeQueue.enqueue({
                method: 'PUT',
                url: `/admin/activities/requests/${request.id}/reset`,
                body: {},
                maxRetries: 5,
                hasFileUpload: false,
                metadata: {
                  type: 'admin',
                  clientId: safeUUID(),
                  label: 'Antrag zurücksetzen'
                }
              });
              setSuccess('Wird gespeichert sobald du wieder online bist');
            }
          }
        }
      ]
    });
  };


  const handleSelectRequest = (request: ActivityRequest) => {
    setSelectedRequest(request);
    setModalRequestId(request.id);
    presentRequestModalHook({
      presentingElement: presentingElement
    });
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonTitle>Anträge</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Anträge</IonTitle>
          </IonToolbar>
        </IonHeader>
        
        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          refreshRequests();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>
        
        {loading ? (
          <LoadingSpinner message="Anträge werden geladen..." />
        ) : (
          <ActivityRequestsView
            requests={requests || []}
            onUpdate={refreshRequests}
            onSelectRequest={handleSelectRequest}
            onResetRequest={handleResetRequest}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default AdminActivityRequestsPage;