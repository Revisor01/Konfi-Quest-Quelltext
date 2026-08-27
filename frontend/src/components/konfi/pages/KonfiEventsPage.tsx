import React, { useState, useCallback, useEffect } from 'react';
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
  IonSegment,
  IonSegmentButton,
  IonList,
  IonListHeader,
  IonLabel,
  IonCard,
  IonCardContent,
  useIonModal,
  useIonRouter,
  useIonAlert,
  useIonViewWillEnter
} from '@ionic/react';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren
import { useLocation } from 'react-router-dom';
// useLocation für die Auswertung von ?segment=... (React Router v5 API)
import {
  qrCodeOutline,
  add,
  home,
  people,
  timeOutline,
  closeOutline,
  informationCircleOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import { writeQueue, QueueItem } from '../../../services/writeQueue';
import { removeDeliveredForEvents } from '../../../services/notifications';
import api from '../../../services/api';
import EventsView from '../views/EventsView';
import RequestsView from '../views/RequestsView';
import QRScannerModal from '../modals/QRScannerModal';
import ActivityRequestModal from '../modals/ActivityRequestModal';
import RequestDetailModal from '../modals/RequestDetailModal';
import LoadingSpinner from '../../common/LoadingSpinner';
import { Event } from '../../../types/event';
import { triggerPullHaptic } from '../../../utils/haptics';

// Einmaliger Hinweis nach dem Tab-Umbau: die Aktivitäten sind aus ihrem eigenen
// Tab in dieses Segment gewandert.

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

interface KonfiEventsPageProps {
  // Im iPad-Split-View setzt der Master die Auswahl als State statt zu
  // navigieren. Fehlt der Callback (iPhone/Portrait), wird wie bisher per
  // Route auf die Event-Detail-Seite navigiert.
  onSelectEvent?: (eventId: number) => void;
  selectedEventId?: number | null;
}

const KonfiEventsPage: React.FC<KonfiEventsPageProps> = ({ onSelectEvent, selectedEventId }) => {
  const { user, setSuccess, setError, isOnline } = useApp();
  const { pageRef, presentingElement } = useModalPage('konfi-events');
  const router = useIonRouter();
  const routerLocation = useLocation();
  const [presentAlert] = useIonAlert();

  // Oberste Segment-Ebene: Events oder Aktivitäten.
  const [mainSegment, setMainSegment] = useState<'events' | 'antraege'>('events');

  // --- useOfflineQuery: Events ---
  const { data: events, loading, refresh, refreshLive } = useOfflineQuery<Event[]>(
    'konfi:events:' + user?.id,
    () => api.get('/konfi/events').then(r => r.data),
    { ttl: CACHE_TTL.EVENTS }
  );

  // --- useOfflineQuery: Aktivitäten (aus KonfiRequestsPage uebernommen) ---
  const { data: requests, loading: requestsLoading, refresh: refreshRequests, refreshLive: refreshRequestsLive } = useOfflineQuery<ActivityRequest[]>(
    'konfi:requests:' + user?.id,
    () => api.get('/konfi/requests').then(r => r.data),
    { ttl: CACHE_TTL.REQUESTS }
  );

  // Query-Parameter ?segment=antraege auswerten — kommt vom Redirect der alten
  // Route /konfi/requests und damit aus bestehenden Push-Deep-Links.
  useEffect(() => {
    const segment = new URLSearchParams(routerLocation.search).get('segment');
    if (segment === 'antraege') {
      setMainSegment('antraege');
    } else if (segment === 'events') {
      setMainSegment('events');
    }
  }, [routerLocation.search]);

  // Beim Oeffnen der Events-Seite die zugestellten Event-Notifications aus dem
  // Mitteilungszentrum entfernen (Bereich wurde geoeffnet/gesehen).
  useIonViewWillEnter(() => {
    removeDeliveredForEvents();
  });

  const [presentScannerModal, dismissScannerModal] = useIonModal(QRScannerModal, {
    onClose: () => dismissScannerModal(),
    onSuccess: (_eventId: number, eventName: string) => {
      dismissScannerModal();
      setSuccess(`Eingecheckt bei: ${eventName}`);
      refresh();
    }
  });

  // State
  const [activeTab, setActiveTab] = useState<'meine' | 'alle' | 'konfirmation'>('meine');
  const [searchText, setSearchText] = useState('');

  // --- Aktivitäten-State ---
  const [requestsTab, setRequestsTab] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [selectedRequest, setSelectedRequest] = useState<ActivityRequest | null>(null);
  const [pendingQueueItems, setPendingQueueItems] = useState<QueueItem[]>([]);


  const loadPendingFromQueue = useCallback(async () => {
    const queueItems = await writeQueue.getByMetadata({ type: 'request' });
    setPendingQueueItems(queueItems);
  }, []);

  useEffect(() => {
    loadPendingFromQueue();
  }, [requests, loadPendingFromQueue]);

  const [presentRequestModal, dismissRequestModal] = useIonModal(
    ActivityRequestModal,
    {
      onClose: () => dismissRequestModal(),
      onSuccess: () => {
        dismissRequestModal();
        refreshRequests();
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

  // Subscribe to live updates
  useLiveRefresh('events', refreshLive);
  useLiveRefresh('requests', refreshRequestsLive);

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
    const allRequests = requests || [];
    switch (requestsTab) {
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
      setError('Nur wartende Aktivitäten können gelöscht werden');
      return;
    }

    presentAlert({
      header: 'Aktivität löschen',
      message: `Möchtest du deine Meldung für "${request.activity_name}" wirklich löschen?`,
      buttons: [
        {
          text: 'Abbrechen',
          role: 'cancel'
        },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/konfi/requests/${request.id}`);
              refreshRequests();
            } catch (error: any) {
              setError(error.response?.data?.error || 'Fehler beim Löschen der Aktivität');
            }
          }
        }
      ]
    });
  };

  // Get filtered events by tab
  const getFilteredEvents = () => {
    const now = new Date();
    const allEvents = events || [];

    let filteredEvents;
    switch (activeTab) {
      case 'meine':
        // Persönliche Event-Historie: alle Events wo angemeldet (inkl. vergangene, abgesagte, opted_out)
        filteredEvents = allEvents.filter(event =>
          event.is_registered || event.booking_status === 'opted_out'
        );
        break;
      case 'alle':
        // NUR zukünftige Events (keine vergangenen), keine Konfirmation
        filteredEvents = allEvents.filter(event =>
          new Date(event.event_date) >= now &&
          !event.is_konfirmation
        );
        break;
      case 'konfirmation':
        filteredEvents = allEvents.filter(event =>
          event.is_konfirmation
        );
        break;
      default:
        filteredEvents = allEvents;
    }

    // Suchfilter
    if (searchText) {
      const lower = searchText.toLowerCase();
      filteredEvents = filteredEvents.filter(e =>
        e.name?.toLowerCase().includes(lower) ||
        e.title?.toLowerCase().includes(lower) ||
        e.location?.toLowerCase().includes(lower)
      );
    }

    // Sort events: nächstes Event immer oben
    return filteredEvents.sort((a, b) => {
      const dateA = new Date(a.event_date);
      const dateB = new Date(b.event_date);
      const isPastA = dateA < now;
      const isPastB = dateB < now;

      // Wenn beide in Zukunft oder beide in Vergangenheit: chronologisch sortieren
      if ((isPastA && isPastB) || (!isPastA && !isPastB)) {
        return dateA.getTime() - dateB.getTime();
      }

      // Zukunft kommt vor Vergangenheit
      if (!isPastA && isPastB) return -1;
      if (isPastA && !isPastB) return 1;

      return 0;
    });
  };

  const handleSelectEvent = (event: Event) => {
    // Split-View (iPad): Auswahl an den Wrapper melden, KEINE Navigation.
    // Sonst (iPhone/Portrait): wie bisher zur Detail-Route navigieren.
    if (onSelectEvent) {
      onSelectEvent(event.id);
    } else {
      router.push(`/konfi/events/${event.id}`);
    }
  };

  const isAntraege = mainSegment === 'antraege';
  // Der Titel folgt dem Segment. Ein frueherer Anlauf wurde zurueckgenommen,
  // weil der Large-Title dabei sprang — damals hing der Grafik-Header noch auf
  // Page-Ebene. Seit er in der View sitzt, ist das nicht mehr so: im
  // iOS-Modus nachgemessen, Titel (y=12), Large-Title (y=75) und
  // Condense-Header (52 px) bleiben beim Umschalten unveraendert.
  const pageTitle = isAntraege ? 'Aktivitäten' : 'Events';

  // Oberste Segment-Ebene (Events | Aktivitäten). Wird
  // als headerSlot an die jeweils aktive View gereicht und dort DIREKT UNTER
  // dem Grafik-/Stats-Header gerendert (Reihenfolge wie bei Badges/Challenges:
  // Header, dann Segment, dann Inhalt) - kein eigener Header auf Page-Ebene,
  // damit der Grafik-Header beim Umschalten nicht springt.
  const mainSegmentSlot = (
    <>
      <div className="app-segment-wrapper">
        <IonSegment
          value={mainSegment}
          onIonChange={(e) => setMainSegment(e.detail.value as 'events' | 'antraege')}
        >
          <IonSegmentButton value="events">
            <IonLabel>Events</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="antraege">
            <IonLabel>Aktivitäten</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </div>

    </>
  );

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonTitle>{pageTitle}</IonTitle>
          <IonButtons slot="end">
            {isAntraege ? (
              <IonButton onClick={handleAddRequest} aria-label="Neue Aktivität melden">
                <IonIcon icon={add} />
              </IonButton>
            ) : (
              <IonButton onClick={() => presentScannerModal()} aria-label="QR-Code scannen">
                <IonIcon icon={qrCodeOutline} />
              </IonButton>
            )}
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">
              {pageTitle}
            </IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          if (isAntraege) {
            await Promise.all([refreshRequests(), loadPendingFromQueue()]);
          } else {
            await refresh();
          }
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        {/* Oberste Segment-Ebene (Events | Aktivitäten) wird als
            headerSlot an die jeweilige View gereicht und dort DIREKT UNTER dem
            Grafik-/Stats-Header gerendert - passend zur Seitenstruktur der
            anderen Tabs (Badges, Challenges: Header, dann Segment, dann Inhalt). */}
        {isAntraege ? (
          requestsLoading ? (
            <LoadingSpinner message="Aktivitäten werden geladen..." />
          ) : (
            <RequestsView
              requests={getFilteredRequests()}
              onDeleteRequest={handleDeleteRequest}
              onSelectRequest={handleSelectRequest}
              activeTab={requestsTab}
              onTabChange={setRequestsTab}
              formatDate={formatDate}
              getStatusColor={getStatusColor}
              getStatusText={getStatusText}
              getTypeIcon={getTypeIcon}
              getTypeText={getTypeText}
              headerSlot={
                <>
                  {mainSegmentSlot}

                  {/* Pending Queue-Aktivitäten (Offline-Warteschlange) */}
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
                                  className="app-corner-badge"
                                  style={{ background: 'var(--app-color-warning)', padding: '4px 6px' }}
                                  title="Wartend — wird gesendet, sobald du wieder online bist"
                                >
                                  <IonIcon icon={timeOutline} style={{ color: '#fff', fontSize: '0.85rem', display: 'block' }} />
                                </div>
                              </div>
                              <div className="app-list-item__row">
                                <div className="app-list-item__main">
                                  <div className="app-icon-circle app-icon-circle--warning">
                                    <IonIcon icon={timeOutline} />
                                  </div>
                                  <div className="app-list-item__content">
                                    <div className="app-list-item__title" style={{ paddingRight: '60px' }}>
                                      {qi.metadata.label || 'Aktivität'}
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
                </>
              }
            />
          )
        ) : loading ? (
          <LoadingSpinner message="Events werden geladen..." />
        ) : (
          <EventsView
            events={getFilteredEvents()}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onSelectEvent={handleSelectEvent}
            selectedEventId={selectedEventId}
            onUpdate={refresh}
            presentingElement={presentingElement}
            headerSlot={mainSegmentSlot}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default KonfiEventsPage;
