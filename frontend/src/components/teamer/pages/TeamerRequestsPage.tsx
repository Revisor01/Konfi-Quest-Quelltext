import React, { useState, useEffect } from 'react';
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
  IonCard,
  IonCardContent,
  IonList,
  IonListHeader,
  IonLabel,
  useIonModal,
  useIonAlert
} from '@ionic/react';
import { add, home, people, timeOutline } from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import { writeQueue, QueueItem } from '../../../services/writeQueue';
import api from '../../../services/api';
import LoadingSpinner from '../../common/LoadingSpinner';
import RequestsView from '../../konfi/views/RequestsView';
import TeamerActivityRequestModal from '../modals/TeamerActivityRequestModal';
import RequestDetailModal from '../../konfi/modals/RequestDetailModal';
import { triggerPullHaptic } from '../../../utils/haptics';

interface ActivityRequest {
  id: number;
  activity_id: number;
  activity_name: string;
  activity_points: number;
  activity_type: 'gottesdienst' | 'gemeinde';
  requested_date: string;
  comment?: string;
  photo_filename?: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_comment?: string;
  created_at: string;
  updated_at: string;
}

const TeamerRequestsPage: React.FC = () => {
  const { user, setError, isOnline } = useApp();
  const { pageRef, presentingElement } = useModalPage('teamer-requests');
  const [presentAlert] = useIonAlert();

  const { data: requests, loading, refresh } = useOfflineQuery<ActivityRequest[]>(
    'teamer:requests:' + user?.id,
    () => api.get('/teamer/requests').then(r => r.data),
    { ttl: CACHE_TTL.REQUESTS }
  );

  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [selectedRequest, setSelectedRequest] = useState<ActivityRequest | null>(null);
  const [pendingQueueItems, setPendingQueueItems] = useState<QueueItem[]>([]);

  const loadPendingFromQueue = async () => {
    const queueItems = await writeQueue.getByMetadata({ type: 'request' });
    setPendingQueueItems(queueItems);
  };

  useEffect(() => {
    loadPendingFromQueue();
  }, [requests]);

  const [presentRequestModal, dismissRequestModal] = useIonModal(
    TeamerActivityRequestModal,
    {
      onClose: () => dismissRequestModal(),
      onSuccess: () => {
        dismissRequestModal();
        refresh();
      }
    }
  );

  const [presentDetailModal, dismissDetailModal] = useIonModal(
    RequestDetailModal,
    {
      request: selectedRequest,
      onClose: () => {
        dismissDetailModal();
        setSelectedRequest(null);
      },
      onDelete: (request: ActivityRequest) => {
        dismissDetailModal();
        setSelectedRequest(null);
        handleDeleteRequest(request);
      }
    }
  );

  useLiveRefresh('requests', refresh);

  const handleAddRequest = () => {
    presentRequestModal({
      presentingElement: pageRef.current || presentingElement || undefined
    });
  };

  const handleSelectRequest = (request: ActivityRequest) => {
    setSelectedRequest(request);
    presentDetailModal({
      presentingElement: pageRef.current || presentingElement || undefined
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'warning';
      case 'approved': return 'success';
      case 'rejected': return 'danger';
      default: return 'medium';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return 'Offen';
      case 'approved': return 'Verbucht';
      case 'rejected': return 'Abgelehnt';
      default: return 'Unbekannt';
    }
  };

  const getTypeIcon = (type: string) => {
    return type === 'gottesdienst' ? home : people;
  };

  const getTypeText = (type: string) => {
    return type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde';
  };

  const getFilteredRequests = () => {
    const allRequests = Array.isArray(requests) ? requests : [];
    switch (activeTab) {
      case 'pending':
        return allRequests.filter(r => r.status === 'pending');
      case 'approved':
        return allRequests.filter(r => r.status === 'approved');
      case 'rejected':
        return allRequests.filter(r => r.status === 'rejected');
      default:
        return allRequests;
    }
  };

  const handleDeleteRequest = (request: ActivityRequest) => {
    if (!isOnline) {
      setError('Löschen nicht möglich — du bist offline');
      return;
    }
    if (request.status !== 'pending') {
      setError('Nur wartende Anträge können gelöscht werden');
      return;
    }

    presentAlert({
      header: 'Antrag löschen',
      message: `Möchtest du deinen Antrag für "${request.activity_name}" wirklich löschen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/teamer/requests/${request.id}`);
              refresh();
            } catch (error: any) {
              setError(error.response?.data?.error || 'Fehler beim Löschen des Antrags');
            }
          }
        }
      ]
    });
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonTitle>Aktivitäten</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handleAddRequest}>
              <IonIcon icon={add} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Aktivitäten</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          await Promise.all([refresh(), loadPendingFromQueue()]);
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        {pendingQueueItems.length > 0 && (
          <IonList inset={true} className="app-segment-wrapper">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--warning">
                <IonIcon icon={timeOutline} />
              </div>
              <IonLabel>Wird gesendet...</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent>
                {pendingQueueItems.map(qi => (
                  <div key={qi.id} className="app-list-item app-list-item--warning">
                    <div className="app-corner-badges">
                      <div
                        className="app-corner-badge app-corner-badge--warning"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                        title="Wartend (Offline-Queue)"
                      >
                        <IonIcon icon={timeOutline} style={{ color: '#fff', fontSize: '0.85rem' }} />
                      </div>
                    </div>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--warning">
                          <IonIcon icon={timeOutline} />
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title" style={{ paddingRight: '60px' }}>
                            {qi.metadata.label || 'Antrag'}
                          </div>
                          <div className="app-list-item__subtitle">
                            {qi.body?.description || 'Wird gesendet sobald du online bist'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {loading ? (
          <LoadingSpinner message="Aktivitäten werden geladen..." />
        ) : (
          <RequestsView
            requests={getFilteredRequests()}
            onDeleteRequest={handleDeleteRequest}
            onSelectRequest={handleSelectRequest}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            formatDate={formatDate}
            getStatusColor={getStatusColor}
            getStatusText={getStatusText}
            getTypeIcon={getTypeIcon}
            getTypeText={getTypeText}
            teamerMode={true}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default TeamerRequestsPage;
