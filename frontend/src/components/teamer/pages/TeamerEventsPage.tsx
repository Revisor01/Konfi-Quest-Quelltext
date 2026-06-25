import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  IonItemSliding,
  IonInput,
  IonButtons,
  IonBackButton,
  useIonModal
} from '@ionic/react';
import { useLocation } from 'react-router-dom';
// useLocation bleibt fuer Query-Parameter Auswertung (React Router v5 API)
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
  pricetag,
  shieldCheckmark,
  home,
  document as documentIcon,
  attachOutline,
  search,
  filterOutline,
  lockOpenOutline,
  personAdd,
  infinite
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import { SectionHeader, ListSection, StatusBadge, EventLegendModal } from '../../shared';
import { getStatusIcon } from '../../shared/StatusBadge';
import EmptyState from '../../shared/EmptyState';
import LoadingSpinner from '../../common/LoadingSpinner';
import QRScannerModal from '../../konfi/modals/QRScannerModal';
import TeamerMaterialDetailPage from './TeamerMaterialDetailPage';
import { Event } from '../../../types/event';
import { triggerPullHaptic } from '../../../utils/haptics';
import { safeUUID } from '../../../utils/uuid';

const TeamerEventsPage: React.FC = () => {
  const { user, setSuccess, setError } = useApp();
  const { pageRef, presentingElement } = useModalPage('teamer-events');
  const routerLocation = useLocation();
  const queryEventId = new URLSearchParams(routerLocation.search).get('eventId');

  const [activeTab, setActiveTab] = useState<'meine' | 'alle' | 'team'>('meine');
  const [searchText, setSearchText] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [initialEventHandled, setInitialEventHandled] = useState(false);
  const [eventMaterials, setEventMaterials] = useState<any[]>([]);
  const materialIdRef = useRef<number | null>(null);

  // Offline-Query: Events
  const { data: events, loading, refresh } = useOfflineQuery<Event[]>(
    'teamer:events:' + user?.id,
    async () => { const res = await api.get('/events'); return res.data; },
    { ttl: CACHE_TTL.EVENTS }
  );

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

  useLiveRefresh('events', refresh);

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
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

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

  const alleEvents = useMemo(() =>
    sortEvents(safeEvents.filter(e => !e.teamer_only)),
  [safeEvents]);

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

  // Status-Infos für Event-Karten
  const getEventStatusInfo = (event: Event) => {
    const isPastEvent = new Date(event.event_date) < new Date();
    // Darf sich der Teamer hier ueberhaupt anmelden? Nur bei teamer_needed/teamer_only.
    const canRegister = !!(event.teamer_needed || event.teamer_only);

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
    } else if (event.is_registered && !isPastEvent) {
      statusColor = C.info;
      statusText = 'Dabei';
    } else if (isPastEvent) {
      statusColor = C.past;
      statusText = 'Vergangen';
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
        await api.post(`/events/${event.id}/book`);
        await refresh();
        // Update selectedEvent
        const updated = (await api.get('/events')).data.find((e: Event) => e.id === event.id);
        if (updated) setSelectedEvent(updated);
      } else {
        await writeQueue.enqueue({
          method: 'POST',
          url: `/events/${event.id}/book`,
          body: {},
          maxRetries: 5,
          hasFileUpload: false,
          metadata: {
            type: 'teamer',
            clientId: safeUUID(),
            label: 'Event buchen',
          },
        });
        setSuccess('Buchung wird gesendet sobald du wieder online bist');
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

  // Status-Farben fuer SectionHeader — globale Tokens
  // Darf sich ein Teamer zu diesem Event ueberhaupt anmelden? Nur bei
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

    const isPastEvent = new Date(event.event_date) < new Date();
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
    const isPastEvent = new Date(event.event_date) < new Date();
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
  const formatDateLong = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  };

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
  if (selectedEvent) {
    const isPast = new Date(selectedEvent.event_date) < new Date();
    const isTeamerEvent = selectedEvent.teamer_needed || selectedEvent.teamer_only;

    return (
      <IonPage ref={pageRef}>
        <IonHeader translucent={true}>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={() => setSelectedEvent(null)}>
                <IonIcon icon={arrowBack} slot="icon-only" />
              </IonButton>
            </IonButtons>
            <IonTitle>{selectedEvent.name}</IonTitle>
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
            const konfiCount = selectedEvent.registered_count - (selectedEvent.teamer_count || 0);
            return (
              <SectionHeader
                title={selectedEvent.name}
                subtitle={getStatusText(selectedEvent)}
                icon={calendar}
                colors={getStatusColors(selectedEvent)}
                stats={[
                  { value: konfiCount, label: 'Konfis' },
                  { value: selectedEvent.teamer_count || 0, label: 'Team' },
                  { value: selectedEvent.points, label: 'Punkte' }
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

                {/* Konfis - ohne Teamer */}
                <div className="app-info-row">
                  <IonIcon icon={people} className="app-info-row__icon app-icon-color--participants" />
                  <div>
                    <div className="app-info-row__label">Teilnehmer:innen</div>
                    <div className="app-info-row__value">
                      {selectedEvent.registered_count - (selectedEvent.teamer_count || 0)} / {selectedEvent.max_participants > 0 ? selectedEvent.max_participants : '\u221E'}
                    </div>
                  </div>
                </div>

                {/* Team */}
                {(selectedEvent.teamer_count !== undefined && selectedEvent.teamer_count > 0) && (
                  <div className="app-info-row">
                    <IonIcon icon={people} className="app-info-row__icon app-icon-color--team" />
                    <div>
                      <div className="app-info-row__label">Teamer:innen</div>
                      <div className="app-info-row__value">{selectedEvent.teamer_count}</div>
                    </div>
                  </div>
                )}

                {/* Punkte */}
                <div className="app-info-row">
                  <IonIcon icon={trophy} className="app-info-row__icon app-icon-color--points" />
                  <div>
                    <div className="app-info-row__label">Punkte</div>
                    <div className="app-info-row__value">{selectedEvent.points}</div>
                  </div>
                </div>

                {/* Typ */}
                {selectedEvent.type && (
                  <div className="app-info-row">
                    <IonIcon
                      icon={selectedEvent.type === 'gottesdienst' ? home : people}
                      className={`app-info-row__icon ${selectedEvent.type === 'gottesdienst' ? 'app-icon-color--gottesdienst' : 'app-icon-color--gemeinde'}`}
                    />
                    <div>
                      <div className="app-info-row__label">Typ</div>
                      <div className="app-info-row__value">{selectedEvent.type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde'}</div>
                    </div>
                  </div>
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
                  {bookingLoading ? 'Wird verarbeitet...' : 'Nicht mehr dabei'}
                </IonButton>
              ) : teamerCanRegister(selectedEvent) ? (
                <IonButton
                  className="app-action-button"
                  expand="block"
                  color="success"
                  onClick={() => handleBook(selectedEvent)}
                  disabled={bookingLoading}
                >
                  <IonIcon icon={checkmarkCircle} slot="start" />
                  {bookingLoading ? 'Wird verarbeitet...' : 'Ich bin dabei'}
                </IonButton>
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
  }

  // Events-Liste
  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonTitle>Events</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Events</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          refresh();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        {loading ? (
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

                return (
                  <IonItemSliding key={event.id} style={{ marginBottom: index < filteredEvents.length - 1 ? '8px' : '0' }}>
                    <IonItem
                      button
                      onClick={() => setSelectedEvent(event)}
                      detail={false}
                      lines="none"
                      style={{
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
                        {/* Corner Badges - Team links innen, Pflicht, Status in der Ecke */}
                        {(showBadge || event.teamer_only || event.teamer_needed || event.mandatory) && (
                          <div className="app-corner-badges" style={{ opacity: shouldGrayOut ? 0.5 : 1 }}>
                            {(event.teamer_only || event.teamer_needed) && (
                              <>
                                <div
                                  className="app-corner-badge"
                                  style={{ backgroundColor: 'var(--app-color-teamer)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                                  title={event.teamer_only ? 'Nur Team' : 'Team gesucht'}
                                >
                                  <IonIcon icon={people} style={{ color: '#fff', fontSize: '0.85rem' }} />
                                </div>
                                {(event.mandatory || showBadge) && <div className="app-corner-badges__separator" />}
                              </>
                            )}
                            {event.mandatory && (
                              <>
                                <div
                                  className="app-corner-badge"
                                  style={{ backgroundColor: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                                  title="Pflichtveranstaltung"
                                >
                                  <IonIcon icon={shieldCheckmark} style={{ color: '#fff', fontSize: '0.85rem' }} />
                                </div>
                                {showBadge && <div className="app-corner-badges__separator" />}
                              </>
                            )}
                            {showBadge && <StatusBadge statusText={statusText} statusColor={statusColor} />}
                          </div>
                        )}

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

                              {/* Buchungen + Team + Punkte */}
                              <div className="app-list-item__meta">
                                <span className="app-list-item__meta-item">
                                  <IonIcon icon={people} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--participants'} />
                                  {event.registered_count - (event.teamer_count || 0)}{event.max_participants > 0 ? `/${event.max_participants}` : <>/<IonIcon icon={infinite} style={{ verticalAlign: 'middle', fontSize: '0.9em' }} /></>}
                                </span>
                                {(event.teamer_count !== undefined && event.teamer_count > 0) && (
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={people} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--team'} />
                                    {event.teamer_count} Team
                                  </span>
                                )}
                                {event.points > 0 && (
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={trophy} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--points'} />
                                    {event.points}P
                                  </span>
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
                  </IonItemSliding>
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
};

export default TeamerEventsPage;
