import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonIcon,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonButton,
  IonList,
  IonListHeader,
  IonCard,
  IonCardContent,
  IonFab,
  IonFabButton,
  IonItem,
  IonItemGroup,
  IonInput,
  IonButtons,
  IonBackButton,
  useIonModal,
  useIonAlert,
  useIonViewWillEnter
} from '@ionic/react';
import { useIonRouter } from '@ionic/react';
import { useLocation } from 'react-router-dom';
// useLocation bleibt für Query-Parameter Auswertung (React Router v5 API)
import {
  calendar,
  time,
  location,
  people,
  checkmarkCircle,
  closeCircle,
  hourglass,
  calendarOutline,
  arrowBack,
  trophy,
  bagHandle,
  qrCodeOutline,
  navigateOutline,
  informationCircle,
  informationCircleOutline,
  closeOutline,
  pricetag,
  shieldCheckmark,
  home,
  document as documentIcon,
  attachOutline,
  search,
  filterOutline,
  lockOpenOutline,
  lockOpen,
  copy,
  chatbubbleOutline,
  personAdd,
  infinite,
  add,
  timeOutline,
  listOutline,
  ribbon,
  cloudOfflineOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { writeQueue, QueueItem } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import { removeDeliveredForEvents } from '../../../services/notifications';
import { SectionHeader, ListSection, StatusBadge, EventLegendModal, EventCornerBadges, formatEventDate as formatDate, formatEventTime as formatTime, formatEventDateLong as formatDateLong, istVergangen } from '../../shared';
import { getStatusIcon } from '../../shared/StatusBadge';
import EmptyState from '../../shared/EmptyState';
import LoadingSpinner from '../../common/LoadingSpinner';
import QRScannerModal from '../../konfi/modals/QRScannerModal';
import QRDisplayModal from '../../shared/QRDisplayModal';
import RequestsView from '../../konfi/views/RequestsView';
import TeamerActivityRequestModal from '../modals/TeamerActivityRequestModal';
import RequestDetailModal from '../../konfi/modals/RequestDetailModal';
import TeamerMaterialDetailPage from './TeamerMaterialDetailPage';
import { Event } from '../../../types/event';
import { triggerPullHaptic } from '../../../utils/haptics';
import { safeUUID } from '../../../utils/uuid';

// Einmaliger Hinweis nach dem Tab-Umbau: die Aktivitäten/Anträge sind aus
// ihrem eigenen Tab in dieses Segment gewandert (analog zu Admin/Konfi).

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

const TeamerEventsPage: React.FC = () => {
  const { user, setSuccess, setError, isOnline } = useApp();
  const { pageRef, presentingElement } = useModalPage('teamer-events');
  const routerLocation = useLocation();
  const router = useIonRouter();
  const queryEventId = new URLSearchParams(routerLocation.search).get('eventId');
  const [presentAlert] = useIonAlert();

  // Oberste Segment-Ebene: Events oder Aktivitäten.
  const [mainSegment, setMainSegment] = useState<'events' | 'antraege'>('events');

  const [activeTab, setActiveTab] = useState<'meine' | 'alle' | 'team'>('meine');
  const [searchText, setSearchText] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [initialEventHandled, setInitialEventHandled] = useState(false);
  const [eventMaterials, setEventMaterials] = useState<any[]>([]);
  const [eventTimeslots, setEventTimeslots] = useState<Array<{ id: number; start_time: string; end_time: string; max_participants: number; registered_count: number; waitlist_count?: number }>>([]);
  const materialIdRef = useRef<number | null>(null);

  // Query-Parameter ?segment=antraege auswerten — kommt vom Redirect der alten
  // Route /teamer/requests und damit aus bestehenden Deep-Links.
  useEffect(() => {
    const segment = new URLSearchParams(routerLocation.search).get('segment');
    if (segment === 'antraege') {
      setMainSegment('antraege');
    } else if (segment === 'events') {
      setMainSegment('events');
    }
  }, [routerLocation.search]);


  // Offline-Query: Events
  const { data: events, loading, refresh, refreshLive } = useOfflineQuery<Event[]>(
    'teamer:events:' + user?.id,
    async () => { const res = await api.get('/events'); return res.data; },
    { ttl: CACHE_TTL.EVENTS }
  );

  // --- Offline-Query: Aktivitäten (aus TeamerRequestsPage uebernommen) ---
  const { data: requests, loading: requestsLoading, refresh: refreshRequests, refreshLive: refreshRequestsLive } = useOfflineQuery<ActivityRequest[]>(
    'teamer:requests:' + user?.id,
    () => api.get('/teamer/requests').then(r => r.data),
    { ttl: CACHE_TTL.REQUESTS }
  );

  const [requestsTab, setRequestsTab] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
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
    TeamerActivityRequestModal,
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

  const formatRequestDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const getRequestStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'warning';
      case 'approved': return 'success';
      case 'rejected': return 'danger';
      default: return 'medium';
    }
  };

  const getRequestStatusText = (status: string) => {
    switch (status) {
      case 'pending': return 'Offen';
      case 'approved': return 'Verbucht';
      case 'rejected': return 'Abgelehnt';
      default: return 'Unbekannt';
    }
  };

  // RequestsView verlangt diese Props, nutzt sie im teamerMode aber NICHT —
  // Gottesdienst/Gemeinde gibt es bei Teamer-Aktivitäten nicht. Deshalb
  // bewusst neutral: wuerde die View sie eines Tages doch auswerten, stünde
  // hier kein falsches "Gemeinde".
  const getRequestTypeIcon = (_type: string) => ribbon;
  const getRequestTypeText = (_type: string) => 'Aktivität';

  const getFilteredRequests = () => {
    const allRequests = Array.isArray(requests) ? requests : [];
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
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/teamer/requests/${request.id}`);
              refreshRequests();
            } catch (error: any) {
              setError(error.response?.data?.error || 'Fehler beim Löschen der Aktivität');
            }
          }
        }
      ]
    });
  };

  // Beim Oeffnen der Events-Seite die zugestellten Event-Notifications aus dem
  // Mitteilungszentrum entfernen (Bereich wurde geoeffnet/gesehen).
  useIonViewWillEnter(() => {
    removeDeliveredForEvents();
  });

  // Material Detail Modal (useRef für dynamische materialId)
  const [presentMaterialModal, dismissMaterialModal] = useIonModal(TeamerMaterialDetailPage, {
    get materialId() { return materialIdRef.current; },
    onClose: () => dismissMaterialModal()
  });

  // Farbcode-Legende
  const [presentLegend, dismissLegend] = useIonModal(EventLegendModal, {
    variant: 'teamer',
    onClose: () => dismissLegend(),
  });

  // QR Scanner Modal
  const [presentScannerModal, dismissScannerModal] = useIonModal(QRScannerModal, {
    onClose: () => dismissScannerModal(),
    onSuccess: (_eventId: number, eventName: string) => {
      dismissScannerModal();
      setSuccess(`Eingecheckt bei: ${eventName}`);
      refresh();
    }
  });

  const [presentQRDisplayModal, dismissQRDisplayModal] = useIonModal(QRDisplayModal, {
    eventId: selectedEvent?.id ?? 0,
    eventName: selectedEvent?.name ?? '',
    eventDate: selectedEvent?.event_date ?? '',
    onClose: () => dismissQRDisplayModal(),
  });

  useLiveRefresh('events', refreshLive);

  // Material für ausgewähltes Event laden
  useEffect(() => {
    if (selectedEvent) {
      api.get(`/material/by-event/${selectedEvent.id}`)
        .then(res => setEventMaterials(res.data || []))
        .catch(() => setEventMaterials([]));
    } else {
      setEventMaterials([]);
    }
  }, [selectedEvent?.id]);

  // Zeitslots (samt Belegung + Warteliste) für ausgewaehltes Timeslot-Event laden
  useEffect(() => {
    if (selectedEvent?.has_timeslots) {
      api.get(`/events/${selectedEvent.id}/timeslots`)
        .then(res => setEventTimeslots(res.data || []))
        .catch(() => setEventTimeslots([]));
    } else {
      setEventTimeslots([]);
    }
  }, [selectedEvent?.id, selectedEvent?.has_timeslots]);

  // Wenn von Dashboard mit selectedEventId navigiert wurde, Event direkt öffnen
  useEffect(() => {
    if (!initialEventHandled && !loading && events && events.length > 0 && queryEventId) {
      const eventToSelect = events.find(e => e.id === parseInt(queryEventId, 10));
      if (eventToSelect) {
        setSelectedEvent(eventToSelect);
      }
      setInitialEventHandled(true);
    }
  }, [loading, events, queryEventId, initialEventHandled]);

  // Formatierung
  // Sortierung: naechstes Event zuerst, vergangene am Ende
  const sortEvents = (eventsList: Event[]) => {
    const now = new Date();
    return [...eventsList].sort((a, b) => {
      const dateA = new Date(a.event_date);
      const dateB = new Date(b.event_date);
      const isPastA = dateA < now;
      const isPastB = dateB < now;

      if ((isPastA && isPastB) || (!isPastA && !isPastB)) {
        return dateA.getTime() - dateB.getTime();
      }
      if (!isPastA && isPastB) return -1;
      if (isPastA && !isPastB) return 1;
      return 0;
    });
  };

  const safeEvents = events || [];

  // Gefilterte Events per Segment
  const meineEvents = useMemo(() =>
    sortEvents(safeEvents.filter(e => e.is_registered)),
  [safeEvents]);

  const alleEvents = useMemo(() => sortEvents(safeEvents), [safeEvents]);

  const teamEvents = useMemo(() =>
    sortEvents(safeEvents.filter(e => e.teamer_needed || e.teamer_only)),
  [safeEvents]);

  const getFilteredEvents = () => {
    let result: Event[];
    switch (activeTab) {
      case 'meine': result = meineEvents; break;
      case 'alle': result = alleEvents; break;
      case 'team': result = teamEvents; break;
      default: result = safeEvents;
    }
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter(e =>
        e.name?.toLowerCase().includes(lower) ||
        e.title?.toLowerCase().includes(lower) ||
        e.location?.toLowerCase().includes(lower)
      );
    }
    return result;
  };

  const filteredEvents = getFilteredEvents();

  // Stats — tab-abhaengig (analog Konfi-Pattern)
  const statsData = useMemo(() => {
    const now = new Date();
    const isFuture = (e: Event) => new Date(e.event_date) >= now;
    const isPast = (e: Event) => new Date(e.event_date) < now;

    if (activeTab === 'meine') {
      return [
        { value: meineEvents.length, label: 'Gebucht' },
        { value: meineEvents.filter(isFuture).length, label: 'Anstehend' },
        { value: meineEvents.filter(isPast).length, label: 'Vergangen' }
      ];
    }
    if (activeTab === 'team') {
      const gesucht = safeEvents.filter(e => e.teamer_needed && !e.teamer_only).length;
      const nurTeam = safeEvents.filter(e => e.teamer_only).length;
      const meineImTeam = teamEvents.filter(e => e.is_registered).length;
      return [
        { value: gesucht, label: 'Team gesucht' },
        { value: nurTeam, label: 'Nur Team' },
        { value: meineImTeam, label: 'Meine' }
      ];
    }
    // 'alle'
    return [
      { value: alleEvents.length, label: 'Gesamt' },
      { value: alleEvents.filter(isFuture).length, label: 'Anstehend' },
      { value: alleEvents.filter(e => e.is_registered).length, label: 'Meine' }
    ];
  }, [activeTab, safeEvents, meineEvents, alleEvents, teamEvents]);

  const handleZusage = async (event: Event, dabei: boolean) => {
    setBookingLoading(true);
    try {
      if (networkMonitor.isOnline) {
        await api.post(`/teamer/events/${event.id}/zusage`, { dabei });
        const updated = (await api.get('/events')).data.find((e: Event) => e.id === event.id);
        if (updated) setSelectedEvent(updated);
        setSuccess(dabei ? 'Du bist dabei' : 'Absage gespeichert');
      } else {
        await writeQueue.enqueue({
          method: 'POST',
          url: `/teamer/events/${event.id}/zusage`,
          body: { dabei },
          maxRetries: 5,
          hasFileUpload: false,
          metadata: {
            type: 'teamer',
            clientId: safeUUID(),
            label: dabei ? 'Zusage' : 'Absage',
          },
        });
        setSuccess('Wird gesendet, sobald du wieder online bist');
      }
      refreshLive();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Speichern');
    } finally {
      setBookingLoading(false);
    }
  };

  // Status-Infos für Event-Karten
  const getEventStatusInfo = (event: Event) => {
    const isPastEvent = istVergangen(event);
    // Darf sich der Teamer hier überhaupt anmelden? Nur bei teamer_needed/teamer_only.
    const canRegister = !!(event.teamer_needed || event.teamer_only);
    const isOnWaitlist = event.booking_status === 'waitlist' || event.booking_status === 'pending';

    // Globale Tokens
    const C = {
      success: 'var(--app-color-success)',
      danger: 'var(--app-color-danger)',
      bonus: 'var(--app-color-bonus)',
      info: 'var(--app-color-info)',
      teamer: 'var(--app-color-teamer)',
      past: '#6c757d',
      neutral: '#9ca3af',
    };
    // Default: reines Konfi-Event, zu dem der Teamer sich NICHT anmelden kann.
    // Das ist NICHT gruen, sondern neutral ("Nur Info"), damit keine Anmeldung
    // suggeriert wird.
    let statusColor = C.neutral;
    let statusText = 'Nur Info';

    if (event.registration_status === 'cancelled') {
      statusColor = C.danger;
      statusText = 'Abgesagt';
    } else if (isPastEvent && event.is_registered) {
      if (event.attendance_status === 'present') {
        statusColor = C.success;
        statusText = 'Anwesend';
      } else if (event.attendance_status === 'absent') {
        statusColor = C.danger;
        statusText = 'Abwesend';
      } else {
        statusColor = C.bonus;
        statusText = 'Ausstehend';
      }
    } else if (isOnWaitlist) {
      statusColor = C.bonus;
      statusText = 'Warteliste';
    } else if (event.is_registered && !isPastEvent) {
      statusColor = C.info;
      statusText = 'Dabei';
    } else if (isPastEvent) {
      statusColor = C.past;
      statusText = 'Vergangen';
    } else if (canRegister && event.teamer_registration_status === 'closed') {
      statusColor = C.danger;
      statusText = 'Ausgebucht';
    } else if (canRegister && event.teamer_registration_status === 'waitlist') {
      statusColor = C.bonus;
      statusText = 'Warteliste offen';
    } else if (canRegister && event.teamer_registration_status === 'upcoming') {
      statusColor = C.neutral;
      statusText = 'Noch nicht offen';
    } else if (canRegister) {
      // Anmeldbares Team-Event = rosa (Teamer-Farbe), nicht gruen/lila.
      statusColor = C.teamer;
      statusText = 'Offen';
    }

    // Icon zentral aus der StatusBadge-Map -> Kreis-Icon == Corner-Badge-Icon.
    const statusIcon = getStatusIcon(statusText) || informationCircle;
    const shouldGrayOut = isPastEvent && !event.is_registered;

    return { statusColor, statusText, statusIcon, isPastEvent, shouldGrayOut };
  };

  // Buchung/Storno
  const handleBook = async (event: Event) => {
    setBookingLoading(true);
    try {
      if (networkMonitor.isOnline) {
        const res = await api.post(`/events/${event.id}/book`);
        // Bei voller Buchung kann der Status confirmed ODER waitlist sein -
        // für die Warteliste braucht der Teamer eine sichtbare Rueckmeldung.
        if (res.data?.status === 'waitlist') {
          setSuccess('Du stehst auf der Warteliste. Wird ein Platz frei, rückst du automatisch nach.');
        }
        await refresh();
        // Update selectedEvent
        const updated = (await api.get('/events')).data.find((e: Event) => e.id === event.id);
        if (updated) setSelectedEvent(updated);
      } else {
        // Bis hierher wurde sie in die Warteschlange gelegt und die Antwort
        // des Servers verworfen. Genau darin steckt aber, ob der Platz
        // sicher ist oder nur die Warteliste: Der Online-Zweig oben liest
        // `res.data.status === 'waitlist'` aus und sagt es. Nachgereicht
        // erfuhr das niemand — die App bestaetigte "wird gesendet", und wer
        // spaeter auf der Warteliste stand, merkte es nicht.
        //
        // Die Konfi-Anmeldung loest das seit jeher so: Der Knopf ist offline
        // deaktiviert (`EventDetailView.tsx`, `disabled={!isOnline}`). Hier
        // jetzt genauso, statt eine Zusage zu geben, die der Server erst
        // spaeter einschraenken koennte.
        setError('Für die Buchung brauchst du eine Verbindung — sonst wüsstest du nicht, ob du einen Platz oder die Warteliste bekommst.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler bei der Buchung');
    } finally {
      setBookingLoading(false);
    }
  };

  const handleUnbook = async (event: Event) => {
    setBookingLoading(true);
    try {
      if (networkMonitor.isOnline) {
        await api.delete(`/events/${event.id}/book`);
        await refresh();
        const updated = (await api.get('/events')).data.find((e: Event) => e.id === event.id);
        if (updated) setSelectedEvent(updated);
      } else {
        await writeQueue.enqueue({
          method: 'DELETE',
          url: `/events/${event.id}/book`,
          body: {},
          maxRetries: 5,
          hasFileUpload: false,
          metadata: {
            type: 'teamer',
            clientId: safeUUID(),
            label: 'Event abmelden',
          },
        });
        setSuccess('Abmeldung wird gesendet sobald du wieder online bist');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Stornieren');
    } finally {
      setBookingLoading(false);
    }
  };

  // Status-Farben für SectionHeader — globale Tokens
  // Darf sich ein Teamer zu diesem Event überhaupt anmelden? Nur bei
  // teamer_needed/teamer_only. Reine Konfi-Events sieht der Teamer zwar (zur
  // Info), aber er kann sich NICHT anmelden -> nicht "offen" faerben.
  const teamerCanRegister = (event: Event): boolean => !!(event.teamer_needed || event.teamer_only);

  const getStatusColors = (event: Event): { primary: string; secondary: string } => {
    const danger = { primary: 'var(--app-color-danger)', secondary: 'var(--app-color-danger)' };
    const success = { primary: 'var(--app-color-success)', secondary: 'var(--app-color-success)' };
    const bonus = { primary: 'var(--app-color-bonus)', secondary: 'var(--app-color-bonus)' };
    const info = { primary: 'var(--app-color-info)', secondary: 'var(--app-color-info)' };
    const teamer = { primary: 'var(--app-color-teamer)', secondary: 'var(--app-color-teamer)' };
    const past = { primary: '#6c757d', secondary: '#6c757d' };
    const neutral = { primary: '#9ca3af', secondary: '#9ca3af' };

    const isPastEvent = istVergangen(event);
    const isOnWaitlist = event.booking_status === 'waitlist' || event.booking_status === 'pending';

    // Logik 1:1 wie Konfi (EventDetailView) — EINZIGER Unterschied: ein "offenes"
    // Event, zu dem sich der Teamer NICHT anmelden kann, wird NICHT gruen, sondern
    // neutral ("Nur Info"), damit keine Anmeldung suggeriert wird.
    if (event.registration_status === 'cancelled') return danger;
    if (isPastEvent && event.attendance_status === 'present') return success;
    if (isPastEvent && event.attendance_status === 'absent') return danger;
    if (isPastEvent && event.is_registered && !event.attendance_status) return bonus;
    if (isOnWaitlist) return bonus;
    if (event.is_registered && !isPastEvent) return info; // angemeldet = blau
    if (isPastEvent) return past;
    if (event.registration_status === 'open') {
      // Anmeldbares Team-Event = rosa (Teamer-Farbe), nicht gruen.
      return teamerCanRegister(event) ? teamer : neutral;
    }
    return neutral;
  };

  // Status-Text für Header (1:1 wie Konfi EventDetailView, plus Teamer-Sonderfall)
  const getStatusText = (event: Event): string => {
    const isPastEvent = istVergangen(event);
    const isOnWaitlist = event.booking_status === 'waitlist' || event.booking_status === 'pending';

    if (event.registration_status === 'cancelled') return 'Abgesagt';
    if (isPastEvent && event.attendance_status === 'present') return 'Anwesend';
    if (isPastEvent && event.attendance_status === 'absent') return 'Abwesend';
    if (isPastEvent && event.is_registered && !event.attendance_status) return 'Ausstehend';
    if (isOnWaitlist) return 'Warteliste';
    if (event.is_registered && !isPastEvent) return 'Dabei';
    if (isPastEvent) return 'Vergangen';
    if (event.registration_status === 'open') {
      return teamerCanRegister(event) ? 'Offen' : 'Nur Info';
    }
    return 'Geschlossen';
  };

  // Formatierung lang (wie Konfi EventDetailView)
  // Leere-Segment Texte
  const getEmptyMessage = () => {
    switch (activeTab) {
      case 'meine': return 'Du bist noch bei keinem Event dabei';
      case 'alle': return 'Keine Events vorhanden';
      case 'team': return 'Keine Events für Teamer:innen verfügbar';
      default: return 'Keine Events';
    }
  };

  // Event Detail Ansicht - 1:1 wie Konfi EventDetailView
  // Detail-Ansicht als render-Funktion (statt früher early-return), damit sie
  // im iPad-Split-View NEBEN der Liste gerendert werden kann.
  // hideBackButton blendet den Zurück-Button im Split-View aus (Liste sichtbar).
  const renderDetail = (hideBackButton?: boolean) => {
    if (!selectedEvent) return null;
    const isPast = istVergangen(selectedEvent);
    const isTeamerEvent = selectedEvent.teamer_needed || selectedEvent.teamer_only;

    return (
      <IonPage ref={pageRef}>
        <IonHeader translucent={true}>
          <IonToolbar>
            {!hideBackButton && (
              <IonButtons slot="start">
                <IonButton onClick={() => setSelectedEvent(null)} aria-label="Zurück zur Event-Liste">
                  <IonIcon icon={arrowBack} slot="icon-only" />
                </IonButton>
              </IonButtons>
            )}
            <IonTitle>{selectedEvent.name}</IonTitle>
            <IonButtons slot="end">
              {/* Einstieg in den Event-Chat — bisher hatte ihn nur die Leitung
                  (`admin/views/EventDetailView.tsx`), obwohl Teamer:innen beim
                  Buchen ohnehin Mitglied des Raums werden (`addToEventChat`).
                  Sie fanden ihn nur ueber die Chat-Uebersicht.
                  Der Knopf erscheint nur, wenn es einen Raum gibt UND diese
                  Person darin Mitglied ist: `chat_room_id` kommt aus
                  `GET /events` und ist sonst null (events.js). Erstellen bleibt
                  der Leitung vorbehalten. */}
              {selectedEvent.chat_room_id && (
                <IonButton
                  aria-label="Event-Chat öffnen"
                  onClick={() => router.push(`/teamer/chat/room/${selectedEvent.chat_room_id}`, 'root')}
                >
                  <IonIcon icon={chatbubbleOutline} slot="icon-only" />
                </IonButton>
              )}
              <IonButton
                aria-label="QR-Code zum Einchecken anzeigen"
                onClick={() => presentQRDisplayModal({
                  presentingElement: pageRef.current || presentingElement || undefined
                })}
              >
                <IonIcon icon={qrCodeOutline} slot="icon-only" />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>

        <IonContent className="app-gradient-background" fullscreen>
          <IonHeader collapse="condense">
            <IonToolbar className="app-condense-toolbar">
              <IonTitle size="large">{selectedEvent.name}</IonTitle>
            </IonToolbar>
          </IonHeader>

          <IonRefresher slot="fixed" onIonRefresh={async (e) => {
            await refresh();
            const updated = safeEvents.find(ev => ev.id === selectedEvent.id);
            if (updated) setSelectedEvent(updated);
            e.detail.complete();
          }} onIonPull={triggerPullHaptic}>
            <IonRefresherContent />
          </IonRefresher>

          {/* SectionHeader mit Status-Farben */}
          {(() => {
            const konfiCount = Math.max(0, selectedEvent.registered_count || 0);
            const nurTeam = !!selectedEvent.teamer_only;
            // Punkte-Kachel nur, wenn es überhaupt Punkte gibt — dieselbe
            // Bedingung wie die Punkte-Zeile weiter unten. Bei Terminen nur
            // fuers Team, Pflichtterminen und Konfirmationen stand hier sonst
            // "0 Punkte" (User-Hinweis 11.08.).
            const showPoints = !selectedEvent.teamer_only && !selectedEvent.mandatory
              && !selectedEvent.is_konfirmation && (selectedEvent.points || 0) > 0;
            return (
              <SectionHeader
                title={selectedEvent.name}
                subtitle={getStatusText(selectedEvent)}
                icon={calendar}
                colors={getStatusColors(selectedEvent)}
                stats={nurTeam
                  ? [
                      // Nur-Team-Termin: eine Konfi-Kachel waere immer 0 und
                      // sagt nichts. Stattdessen erzaehlen die Kacheln vom Team.
                      { value: Math.max(0, selectedEvent.teamer_count || 0), label: 'Team' },
                      { value: Math.max(0, selectedEvent.teamer_waitlist_count || 0), label: 'Warteliste' }
                    ]
                  : [
                      { value: konfiCount, label: 'Konfis' },
                      { value: Math.max(0, selectedEvent.teamer_count || 0), label: 'Team' },
                      ...(showPoints ? [{ value: selectedEvent.points, label: 'Punkte' }] : [])
                    ]}
              />
            );
          })()}

          {/* Details Card - wie Admin EventDetailView */}
          <IonList className="app-section-inset" inset={true}>
            <IonListHeader>
              <div className="app-section-icon app-section-icon--events">
                <IonIcon icon={calendar} />
              </div>
              <IonLabel>Details</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent className="app-card-content">
                {/* Datum */}
                <div className="app-info-row">
                  <IonIcon icon={calendar} className="app-info-row__icon app-icon-color--events" />
                  <div>
                    <div className="app-info-row__label">Datum</div>
                    <div className="app-info-row__value">
                      {formatDateLong(selectedEvent.event_date)}
                      {' \u00B7 '}
                      {formatTime(selectedEvent.event_date)}
                      {selectedEvent.event_end_time && ` \u2013 ${formatTime(selectedEvent.event_end_time)}`}
                    </div>
                  </div>
                </div>

                {/* Konfis \u2014 entfaellt bei reinen Teamer-Events (dort gibt es
                    keine Konfi-Teilnahme, die Zeile zeigte "0 / \u221E") */}
                {!selectedEvent.teamer_only && (
                  <div className="app-info-row">
                    <IonIcon icon={people} className="app-info-row__icon app-icon-color--participants" />
                    <div>
                      <div className="app-info-row__label">Teilnehmer:innen</div>
                      <div className="app-info-row__value">
                        {(selectedEvent.registered_count || 0)} / {selectedEvent.max_participants > 0 ? selectedEvent.max_participants : '\u221E'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Zeitslots mit Belegung + Warteliste pro Slot */}
                {selectedEvent.has_timeslots && eventTimeslots.length > 0 && (
                  <div className="app-info-row app-info-row--top">
                    <IonIcon icon={time} className="app-info-row__icon app-icon-color--time app-event-detail__icon--align-top" />
                    <div className="app-event-detail__timeslot-list">
                      <div className="app-info-row__label">Zeitfenster</div>
                      {eventTimeslots.map((slot, idx) => (
                        <div key={slot.id || idx} className="app-info-row__value app-event-detail__timeslot-entry">
                          {formatTime(slot.start_time)} \u2013 {formatTime(slot.end_time)} ({slot.registered_count || 0}/{slot.max_participants} TN{(slot.waitlist_count || 0) > 0 ? ` \u00B7 ${slot.waitlist_count} Warteliste` : ''})
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Anmeldezeitraum — wie Zeitfenster aufgebaut, nicht bei Pflicht-Events.
                    Fehlte als einziger der drei Ansichten hier (Leitung:
                    `admin/views/EventDetailSections.tsx`, Konfi:
                    `konfi/views/EventDetailView.tsx`). */}
                {!selectedEvent.mandatory && (
                  <div className="app-info-row app-info-row--top">
                    <IonIcon icon={lockOpen} className="app-info-row__icon app-icon-color--events app-event-detail__icon--align-top" />
                    <div>
                      <div className="app-info-row__label">Anmeldung</div>
                      {selectedEvent.registration_opens_at ? (
                        <>
                          <div className="app-info-row__value">
                            von {new Date(selectedEvent.registration_opens_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} – {formatTime(selectedEvent.registration_opens_at)}
                          </div>
                          {selectedEvent.registration_closes_at && (
                            <div className="app-info-row__value">
                              bis {new Date(selectedEvent.registration_closes_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} – {formatTime(selectedEvent.registration_closes_at)}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="app-info-row__value">Sofort möglich</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Team — haengt an der EINSTELLUNG des Events, nicht daran, ob
                    sich schon jemand angemeldet hat. Sonst fehlt bei einem
                    frischen "5 gesucht"-Event genau die Zeile "0 / 5". */}
                {(selectedEvent.teamer_needed || selectedEvent.teamer_only) && (
                  <div className="app-info-row">
                    <IonIcon icon={people} className="app-info-row__icon app-icon-color--team" />
                    <div>
                      <div className="app-info-row__label">Teamer:innen</div>
                      <div className="app-info-row__value">
                        {(selectedEvent.teamer_count || 0)} / {(selectedEvent.teamer_max_participants || 0) > 0 ? selectedEvent.teamer_max_participants : '∞'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Teamer-Warteliste — nur bei begrenztem Kontingent + aktiver Warteliste */}
                {(selectedEvent.teamer_max_participants || 0) > 0 && selectedEvent.teamer_waitlist_enabled && (
                  <div className="app-info-row">
                    <IonIcon icon={listOutline} className="app-info-row__icon app-icon-color--waitlist" />
                    <div>
                      <div className="app-info-row__label">Team-Warteliste</div>
                      <div className="app-info-row__value">
                        {selectedEvent.teamer_waitlist_count || 0} / {selectedEvent.teamer_max_waitlist_size || 10}
                      </div>
                    </div>
                  </div>
                )}

                {/* Punkte und Typ: nur wenn es fuer die KONFIS ueberhaupt
                    Punkte gibt. Teamer:innen bekommen nie Konfi-Punkte — bei
                    Pflicht-/Konfirmations- und reinen Teamer-Events stand hier
                    sonst "Punkte 0 / Typ Gemeinde".
                    Der Typ kommt aus point_type (nicht aus type — das ist die
                    Event-Art und war der Grund, warum hier immer "Gemeinde"
                    stand). */}
                {!selectedEvent.teamer_only && !selectedEvent.mandatory
                  && !selectedEvent.is_konfirmation && (selectedEvent.points || 0) > 0 && (
                  <>
                    <div className="app-info-row">
                      <IonIcon icon={trophy} className="app-info-row__icon app-icon-color--points" />
                      <div>
                        <div className="app-info-row__label">Punkte</div>
                        <div className="app-info-row__value">{selectedEvent.points}</div>
                      </div>
                    </div>
                    <div className="app-info-row">
                      <IonIcon
                        icon={selectedEvent.point_type === 'gottesdienst' ? home : people}
                        className={`app-info-row__icon ${selectedEvent.point_type === 'gottesdienst' ? 'app-icon-color--gottesdienst' : 'app-icon-color--gemeinde'}`}
                      />
                      <div>
                        <div className="app-info-row__label">Typ</div>
                        <div className="app-info-row__value">{selectedEvent.point_type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde'}</div>
                      </div>
                    </div>
                  </>
                )}

                {/* Kategorien */}
                {selectedEvent.category_names && (
                  <div className="app-info-row">
                    <IonIcon icon={pricetag} className="app-info-row__icon app-icon-color--category" />
                    <div>
                      <div className="app-info-row__label">Kategorien</div>
                      <div className="app-info-row__value">{selectedEvent.category_names}</div>
                    </div>
                  </div>
                )}

                {/* Ort */}
                {selectedEvent.location && (
                  <div className="app-info-row">
                    <IonIcon icon={location} className="app-info-row__icon app-icon-color--location" />
                    <div
                      onClick={() => {
                        if (selectedEvent.location_maps_url) {
                          window.open(selectedEvent.location_maps_url, '_blank');
                        } else if (selectedEvent.location) {
                          window.open(`https://maps.apple.com/?q=${encodeURIComponent(selectedEvent.location)}`, '_blank');
                        }
                      }}
                    >
                      <div className="app-info-row__label">Ort</div>
                      <div className="app-info-row__value app-event-detail__location-link">{selectedEvent.location}</div>
                    </div>
                  </div>
                )}

                {/* Pflicht-Event */}
                {selectedEvent.mandatory && (
                  <div className="app-info-row">
                    <IonIcon icon={shieldCheckmark} className="app-info-row__icon app-icon-color--events" />
                    <div>
                      <div className="app-info-row__label">Pflicht-Event</div>
                      <div className="app-info-row__value">Teilnahme erforderlich</div>
                    </div>
                  </div>
                )}

                {/* Team gesucht */}
                {isTeamerEvent && (
                  <div className="app-info-row">
                    <IonIcon icon={people} className="app-info-row__icon app-icon-color--team" />
                    <div>
                      <div className="app-info-row__label">Teamer-Zugang</div>
                      <div className="app-info-row__value">{selectedEvent.teamer_only ? 'Nur Team' : 'Team gesucht'}</div>
                    </div>
                  </div>
                )}

                {/* Serien-Kennzeichnung — sah bisher nur die Leitung, und nur in ihrer
                    Liste (`admin/EventsView.tsx:403`). Konfis und Teamer:innen konnten
                    nicht erkennen, dass ein Termin Teil einer Reihe ist. Die WEITEREN
                    Termine der Serie bleiben der Leitung vorbehalten: sie kommen aus
                    `series_events` in `GET /events/:id`, und diese beiden Ansichten
                    lesen ihren Termin aus der Liste. */}
                {selectedEvent.is_series && (
                  <div className="app-info-row">
                    <IonIcon icon={copy} className="app-info-row__icon app-icon-color--events" />
                    <div>
                      <div className="app-info-row__label">Terminreihe</div>
                      <div className="app-info-row__value">Teil einer Serie</div>
                    </div>
                  </div>
                )}

                {/* Check-in-Fenster — das Zeitfenster fuer den QR-Code. Es wird im
                    Formular gesetzt, war aber in keiner Detailansicht zu sehen: wer es
                    aendert, konnte nicht nachsehen, ob es wirkt. Formulierung wie im
                    Formular (`EventFormSections.tsx:223`). NICHT die Abmeldefrist —
                    die sind zwei Tage und stehen im Anmelde-Abschnitt. */}
                {selectedEvent.checkin_window && (
                  <div className="app-info-row app-info-row--top">
                    <IonIcon icon={qrCodeOutline} className="app-info-row__icon app-icon-color--events app-event-detail__icon--align-top" />
                    <div>
                      <div className="app-info-row__label">Check-in-Fenster</div>
                      <div className="app-info-row__value">
                        QR-Code {selectedEvent.checkin_window} Min. vor bis {selectedEvent.checkin_window} Min. nach Beginn
                      </div>
                    </div>
                  </div>
                )}

                {/* Was mitbringen */}
                {selectedEvent.bring_items && (
                  <div className="app-info-row app-info-row--top">
                    <IonIcon icon={bagHandle} className="app-info-row__icon app-icon-color--bring app-event-detail__icon--align-top" />
                    <div>
                      <div className="app-info-row__label">Mitbringen</div>
                      <div className="app-info-row__value">{selectedEvent.bring_items}</div>
                    </div>
                  </div>
                )}
              </IonCardContent>
            </IonCard>
          </IonList>

          {/* Beschreibung - eigene Card wie Konfi */}
          {selectedEvent.description && (
            <IonList className="app-section-inset" inset={true}>
              <IonListHeader>
                <div className="app-section-icon app-section-icon--events">
                  <IonIcon icon={informationCircle} />
                </div>
                <IonLabel>Beschreibung</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent className="app-card-content">
                  <div className="app-description-text">
                    {selectedEvent.description}
                  </div>
                </IonCardContent>
              </IonCard>
            </IonList>
          )}

          {/* Material */}
          {eventMaterials.length > 0 && (
            <IonList className="app-section-inset" inset={true}>
              <IonListHeader>
                <div className="app-section-icon app-section-icon--events">
                  <IonIcon icon={documentIcon} />
                </div>
                <IonLabel>Material ({eventMaterials.length})</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent className="app-card-content">
                  {eventMaterials.map((mat: any) => (
                    <div
                      key={mat.id}
                      className="app-list-item app-list-item--material"
                      style={{ cursor: 'pointer', marginBottom: '8px' }}
                      onClick={() => {
                        materialIdRef.current = mat.id;
                        presentMaterialModal({ presentingElement: presentingElement || pageRef.current || undefined });
                      }}
                    >
                      <div className="app-list-item__row">
                        <div className="app-list-item__main">
                          <div className="app-icon-circle app-icon-circle--material">
                            <IonIcon icon={documentIcon} />
                          </div>
                          <div className="app-list-item__content">
                            <div className="app-list-item__title">{mat.title}</div>
                            <div className="app-list-item__meta">
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={attachOutline} className="app-icon-color--material" />
                                {mat.file_count || 0} {(mat.file_count || 0) === 1 ? 'Datei' : 'Dateien'}
                              </span>
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

          {/* Action Buttons */}
          <div className="app-event-detail__action-area">
            {isPast ? (
              selectedEvent.is_registered ? (
                <div style={{ textAlign: 'center', padding: '12px 16px' }}>
                  {selectedEvent.attendance_status === 'present' && (
                    <div className="app-status-box app-status-box--success">
                      <IonIcon icon={checkmarkCircle} />
                      Anwesend
                    </div>
                  )}
                  {selectedEvent.attendance_status === 'absent' && (
                    <div className="app-status-box app-status-box--danger">
                      <IonIcon icon={closeCircle} />
                      Abwesend
                    </div>
                  )}
                  {!selectedEvent.attendance_status && (
                    <div className="app-status-box app-status-box--bonus">
                      <IonIcon icon={hourglass} />
                      Anwesenheit ausstehend
                    </div>
                  )}
                </div>
              ) : null
            ) : (
              selectedEvent.is_registered ? (
                <IonButton
                  className="app-action-button"
                  expand="block"
                  fill="outline"
                  color="danger"
                  onClick={() => handleUnbook(selectedEvent)}
                  disabled={bookingLoading}
                >
                  <IonIcon icon={closeCircle} slot="start" />
                  {bookingLoading
                    ? 'Wird verarbeitet...'
                    : selectedEvent.booking_status === 'waitlist'
                      ? 'Von der Warteliste austragen'
                      : 'Nicht mehr dabei'}
                </IonButton>
              ) : teamerCanRegister(selectedEvent) ? (
                (() => {
                  const teamerMax = selectedEvent.teamer_max_participants || 0;
                  const teamerCount = selectedEvent.teamer_count || 0;
                  const teamerFull = teamerMax > 0 && teamerCount >= teamerMax;

                  if (!teamerFull) {
                    // Kontingent frei (oder unbegrenzt) -> normaler Buchen-Button.
                    return (
                      <>
                        <IonButton
                          className="app-action-button"
                          expand="block"
                          color="success"
                          onClick={() => handleBook(selectedEvent)}
                          disabled={bookingLoading || !isOnline}
                        >
                          <IonIcon icon={bookingLoading || isOnline ? checkmarkCircle : cloudOfflineOutline} slot="start" />
                          {bookingLoading
                            ? 'Wird verarbeitet...'
                            : !isOnline ? 'Du bist offline' : 'Ich bin dabei'}
                        </IonButton>
                        {/* Gegenknopf: Ohne ihn war eine Absage nicht von
                            "hat noch nicht reagiert" zu unterscheiden. Bei
                            bereits abgesagten Terminen entfaellt er. */}
                        {selectedEvent.booking_status !== 'opted_out' && (
                          <IonButton
                            className="app-action-button"
                            expand="block"
                            fill="outline"
                            color="medium"
                            onClick={() => handleZusage(selectedEvent, false)}
                            disabled={bookingLoading}
                          >
                            <IonIcon icon={closeCircle} slot="start" />
                            Ich bin nicht dabei
                          </IonButton>
                        )}
                      </>
                    );
                  }

                  const teamerWaitlistMax = selectedEvent.teamer_max_waitlist_size || 0;
                  const teamerWaitlistCount = selectedEvent.teamer_waitlist_count || 0;
                  const waitlistOpen = !!selectedEvent.teamer_waitlist_enabled &&
                    (teamerWaitlistMax === 0 || teamerWaitlistCount < teamerWaitlistMax);

                  if (waitlistOpen) {
                    // Kontingent voll, aber Warteliste offen -> Warteliste-Button.
                    return (
                      <IonButton
                        className="app-action-button"
                        expand="block"
                        color="warning"
                        onClick={() => handleBook(selectedEvent)}
                        disabled={bookingLoading || !isOnline}
                      >
                        <IonIcon icon={bookingLoading || isOnline ? hourglass : cloudOfflineOutline} slot="start" />
                        {bookingLoading
                          ? 'Wird verarbeitet...'
                          : !isOnline
                            ? 'Du bist offline'
                            : `Auf die Warteliste (${teamerWaitlistCount}/${teamerWaitlistMax || '∞'})`}
                      </IonButton>
                    );
                  }

                  // Kontingent voll und Warteliste voll/deaktiviert -> nur Hinweis.
                  return (
                    <IonButton
                      className="app-action-button"
                      expand="block"
                      disabled
                      color="medium"
                    >
                      <IonIcon icon={informationCircle} slot="start" />
                      Kein Platz mehr frei
                    </IonButton>
                  );
                })()
              ) : (
                // Reines Konfi-Event: Teamer kann sich NICHT anmelden -> nur Hinweis.
                <div
                  className="app-status-box"
                  style={{
                    backgroundColor: 'rgba(156, 163, 175, 0.12)',
                    color: '#6b7280',
                    borderColor: 'rgba(156, 163, 175, 0.35)'
                  }}
                >
                  <IonIcon icon={informationCircle} />
                  Nur zur Info - keine Anmeldung
                </div>
              )
            )}
          </div>
        </IonContent>
      </IonPage>
    );
  };

  const isAntraege = mainSegment === 'antraege';
  // Der Titel folgt dem Segment — analog zu KonfiEventsPage/AdminEventsPage.
  const pageTitle = isAntraege ? 'Aktivitäten' : 'Events';

  // Oberste Segment-Ebene (Events | Aktivitäten). Wird
  // DIREKT UNTER dem Grafik-/Stats-Header gerendert (gleiches Muster wie bei
  // Konfi/Admin).
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

  // Events-Liste als render-Funktion (früher early-return).
  const renderList = () => (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonTitle>{pageTitle}</IonTitle>
          <IonButtons slot="end">
            {isAntraege && (
              <IonButton onClick={handleAddRequest} aria-label="Neue Aktivität melden">
                <IonIcon icon={add} />
              </IonButton>
            )}
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">{pageTitle}</IonTitle>
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
          <IonRefresherContent />
        </IonRefresher>

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
              formatDate={formatRequestDate}
              getStatusColor={getRequestStatusColor}
              getStatusText={getRequestStatusText}
              getTypeIcon={getRequestTypeIcon}
              getTypeText={getRequestTypeText}
              teamerMode={true}
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
          <>
            {/* Header mit Stats */}
            <SectionHeader
              title="Events"
              subtitle="Termine und Veranstaltungen"
              icon={calendar}
              preset="events"
              stats={statsData}
              onInfo={() => presentLegend({ presentingElement: presentingElement || pageRef.current || undefined })}
            />

            {mainSegmentSlot}

            {/* Suche & Filter — gleiches Pattern wie Konfi/Admin */}
            <IonList inset={true} style={{ margin: '16px' }}>
              <IonListHeader>
                <div className="app-section-icon app-section-icon--events">
                  <IonIcon icon={filterOutline} />
                </div>
                <IonLabel>Suche & Filter</IonLabel>
              </IonListHeader>
              <IonItemGroup>
                <IonItem>
                  <IonIcon icon={search} slot="start" className="app-icon-color--system" style={{ fontSize: '1rem' }} />
                  <IonInput
                    value={searchText}
                    onIonInput={(e) => setSearchText(e.detail.value || '')}
                    placeholder="Events durchsuchen..."
                  />
                </IonItem>
              </IonItemGroup>
            </IonList>

            {/* 3 Segmente */}
            <div className="app-segment-wrapper">
              <IonSegment
                value={activeTab}
                onIonChange={(e) => setActiveTab(e.detail.value as any)}
              >
                <IonSegmentButton value="alle">
                  <IonLabel>Alle</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="meine">
                  <IonLabel>Meine</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="team">
                  <IonLabel>Team</IonLabel>
                </IonSegmentButton>
              </IonSegment>
            </div>

            {/* Events Liste */}
            <ListSection
              icon={calendarOutline}
              title="Events"
              count={filteredEvents.length}
              iconColorClass="events"
              isEmpty={filteredEvents.length === 0}
              emptyIcon={calendarOutline}
              emptyTitle="Keine Events"
              emptyMessage={getEmptyMessage()}
              emptyIconColor="#dc2626"
            >
              {filteredEvents.map((event, index) => {
                const { statusColor, statusText, statusIcon, isPastEvent, shouldGrayOut } = getEventStatusInfo(event);
                const showBadge = !isPastEvent || event.is_registered;

                // Kein IonItemSliding: es gab hier nie IonItemOptions, das Item
                // liess sich also anwischen und federte wirkungslos zurück —
                // das wirkt kaputt.
                return (
                    <IonItem
                      key={event.id}
                      button
                      onClick={() => setSelectedEvent(event)}
                      detail={false}
                      lines="none"
                      style={{
                        marginBottom: index < filteredEvents.length - 1 ? '8px' : '0',
                        '--background': 'transparent',
                        '--padding-start': '0',
                        '--padding-end': '0',
                        '--inner-padding-end': '0',
                        '--inner-border-width': '0',
                        '--border-style': 'none',
                        '--min-height': 'auto'
                      }}
                    >
                      <div
                        className="app-list-item app-list-item--events"
                        style={{
                          width: '100%',
                          borderLeftColor: statusColor,
                          opacity: shouldGrayOut ? 0.6 : 1,
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        {/* Corner Badges (shared) - Team, Pflicht, Status */}
                        <EventCornerBadges
                          event={event}
                          statusText={statusText}
                          statusColor={statusColor}
                          showStatus={showBadge}
                          grayOut={shouldGrayOut}
                        />

                        <div className="app-list-item__row">
                          <div className="app-list-item__main">
                            {/* Status Icon */}
                            <div
                              className="app-icon-circle app-icon-circle--lg"
                              style={{ backgroundColor: statusColor }}
                            >
                              <IonIcon icon={statusIcon} />
                            </div>

                            {/* Content */}
                            <div className="app-list-item__content">
                              {/* Titel */}
                              <div
                                className="app-list-item__title app-list-item__title--events"
                                style={{
                                  color: shouldGrayOut ? '#999' : undefined,
                                  paddingRight: showBadge ? '70px' : '0',
                                  paddingTop: showBadge ? '4px' : '0'
                                }}
                              >
                                {event.name}
                              </div>
                              {event.jahrgang_names && (
                                <div className="app-list-item__subtitle" style={{ color: shouldGrayOut ? '#999' : undefined }}>
                                  {event.jahrgang_names.split(',').join(' · ')}
                                </div>
                              )}

                              <div className="app-list-item__meta">
                                {event.teamer_only ? (
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={people} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--team'} />
                                    {Math.max(0, event.teamer_count || 0)}
                                    {(event.teamer_max_participants || 0) > 0
                                      ? `/${event.teamer_max_participants}`
                                      : <>/<IonIcon icon={infinite} style={{ verticalAlign: 'middle', fontSize: '0.9em' }} /></>} Team
                                  </span>
                                ) : null}
                                {event.teamer_only && (event.teamer_waitlist_count ?? 0) > 0 && (
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={listOutline} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--waitlist'} />
                                    {event.teamer_waitlist_count}
                                    {(event.teamer_max_waitlist_size || 0) > 0 ? `/${event.teamer_max_waitlist_size}` : ''}
                                  </span>
                                )}
                                {!event.teamer_only && (
                                  <>
                                    <span className="app-list-item__meta-item">
                                      <IonIcon icon={people} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--participants'} />
                                      {Math.max(0, event.registered_count || 0)}{event.max_participants > 0 ? `/${event.max_participants}` : <>/<IonIcon icon={infinite} style={{ verticalAlign: 'middle', fontSize: '0.9em' }} /></>}
                                    </span>
                                    {(event.teamer_count !== undefined && event.teamer_count > 0) && (
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={people} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--team'} />
                                        {event.teamer_count} Team
                                      </span>
                                    )}
                                    {(event.teamer_waitlist_count ?? 0) > 0 && (
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={listOutline} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--waitlist'} />
                                        {event.teamer_waitlist_count}
                                        {(event.teamer_max_waitlist_size || 0) > 0 ? `/${event.teamer_max_waitlist_size}` : ''} wartet
                                      </span>
                                    )}
                                    {event.points > 0 && (
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={trophy} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--points'} />
                                        {event.points}P
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>

                              {/* Datum + Uhrzeit */}
                              <div className="app-list-item__meta" style={{ marginTop: '4px' }}>
                                <span className="app-list-item__meta-item">
                                  <IonIcon icon={calendar} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--events'} />
                                  {formatDate(event.event_date)}
                                </span>
                                <span className="app-list-item__meta-item">
                                  <IonIcon icon={time} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--time'} />
                                  {formatTime(event.event_date)}
                                </span>
                              </div>

                              {/* Ort */}
                              {event.location && (
                                <div className="app-list-item__meta" style={{ marginTop: '4px' }}>
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={location} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--location'} />
                                    {event.location}
                                  </span>
                                </div>
                              )}

                              {/* Was mitbringen */}
                              {event.bring_items && (
                                <div className="app-list-item__meta" style={{ marginTop: '4px' }}>
                                  <span className="app-list-item__meta-item app-list-item__meta-item--multiline">
                                    <IonIcon icon={bagHandle} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--bring'} />
                                    {event.bring_items}
                                  </span>
                                </div>
                              )}
                              {/* Material */}
                              {(event.material_count || 0) > 0 && (
                                <div className="app-list-item__meta" style={{ marginTop: '4px' }}>
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={attachOutline} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--material'} />
                                    {event.material_count} {event.material_count === 1 ? 'Material' : 'Materialien'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </IonItem>
                );
              })}
            </ListSection>

            {/* FAB für QR-Scanner */}
            <IonFab vertical="bottom" horizontal="end" slot="fixed">
              <IonFabButton onClick={() => presentScannerModal()}>
                <IonIcon icon={qrCodeOutline} />
              </IonFabButton>
            </IonFab>
          </>
        )}
      </IonContent>
    </IonPage>
  );

  // Detail ersetzt die Liste (selectedEvent-State steuert die Ansicht).
  return selectedEvent ? renderDetail() : renderList();
};

export default TeamerEventsPage;
