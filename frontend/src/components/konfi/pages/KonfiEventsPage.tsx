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
  IonSearchbar,
  IonList,
  IonListHeader,
  IonLabel,
  IonCard,
  IonCardContent,
  useIonModal,
  useIonRouter,
  useIonViewWillEnter
} from '@ionic/react';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren
import { qrCodeOutline, searchOutline } from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import { removeDeliveredForEvents } from '../../../services/notifications';
import api from '../../../services/api';
import EventsView from '../views/EventsView';
import QRScannerModal from '../modals/QRScannerModal';
import LoadingSpinner from '../../common/LoadingSpinner';
import { Event } from '../../../types/event';
import { triggerPullHaptic } from '../../../utils/haptics';

interface KonfiEventsPageProps {
  // Im iPad-Split-View setzt der Master die Auswahl als State statt zu
  // navigieren. Fehlt der Callback (iPhone/Portrait), wird wie bisher per
  // Route auf die Event-Detail-Seite navigiert.
  onSelectEvent?: (eventId: number) => void;
  selectedEventId?: number | null;
}

const KonfiEventsPage: React.FC<KonfiEventsPageProps> = ({ onSelectEvent, selectedEventId }) => {
  const { user, setSuccess, setError } = useApp();
  const { pageRef, presentingElement } = useModalPage('konfi-events');
  const router = useIonRouter();

  // --- useOfflineQuery: Events ---
  const { data: events, loading, refresh } = useOfflineQuery<Event[]>(
    'konfi:events:' + user?.id,
    () => api.get('/konfi/events').then(r => r.data),
    { ttl: CACHE_TTL.EVENTS }
  );

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

  // Subscribe to live updates for events
  useLiveRefresh('events', refresh);

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

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonTitle>Events</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => presentScannerModal()}>
              <IonIcon icon={qrCodeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">
              Events
            </IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          await refresh();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        {loading ? (
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
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default KonfiEventsPage;
