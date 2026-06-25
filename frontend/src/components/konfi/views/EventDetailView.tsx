import React, { useState, useEffect, useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonCard,
  IonCardContent,
  IonLabel,
  IonList,
  IonListHeader,
  IonRefresher,
  IonRefresherContent,
  useIonAlert,
  useIonModal,
  useIonActionSheet,
  IonNote
} from '@ionic/react';
import {
  arrowBack,
  calendar,
  location,
  people,
  time,
  trophy,
  checkmarkCircle,
  closeCircle,
  informationCircle,
  warning,
  hourglass,
  listOutline,
  home,
  pricetag,
  personOutline,
  shieldCheckmark,
  bagHandle,
  qrCodeOutline,
  cloudOfflineOutline,
  lockOpenOutline,
  infinite
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import LoadingSpinner from '../../common/LoadingSpinner';
import { SectionHeader } from '../../shared';
import UnregisterModal from '../modals/UnregisterModal';
import QRScannerModal from '../modals/QRScannerModal';
import { Event, Category } from '../../../types/event';
import { useLiveUpdate } from '../../../contexts/LiveUpdateContext';
import { triggerPullHaptic } from '../../../utils/haptics';
import { safeUUID } from '../../../utils/uuid';

interface EventDetailViewProps {
  eventId: number;
  onBack: () => void;
}

// Timeslot importiert aus types/event, lokaler Alias mit registered_count
interface DetailTimeslot {
  id: number;
  start_time: string;
  end_time: string;
  max_participants: number;
  registered_count: number;
}

interface Participant {
  id: number;
  display_name: string;
}

const EventDetailView: React.FC<EventDetailViewProps> = ({ eventId, onBack }) => {
  const pageRef = useRef<HTMLElement>(null);
  const { setSuccess, setError, isOnline } = useApp();
  const { triggerRefresh } = useLiveUpdate();
  const [presentAlert] = useIonAlert();
  const [presentActionSheet] = useIonActionSheet();

  // Event-Daten ueber useOfflineQuery mit 10min TTL Cache
  const { data: allEvents, loading, refresh: refreshEvents } = useOfflineQuery<Event[]>(
    `konfi:event-detail:${eventId}`,
    () => api.get('/konfi/events').then(r => r.data),
    { ttl: 10 * 60 * 1000 }
  );

  const eventData = allEvents?.find((e: Event) => e.id === eventId) || null;

  const [hasExistingKonfirmation, setHasExistingKonfirmation] = useState(false);
  const [timeslots, setTimeslots] = useState<DetailTimeslot[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);

  const handleOptOut = async (reason: string) => {
    if (!eventData || reason.trim().length < 5) {
      setError('Bitte gib einen Grund für die Abmeldung an (mind. 5 Zeichen)');
      return;
    }

    const clientId = safeUUID();

    if (networkMonitor.isOnline) {
      try {
        await api.post(`/konfi/events/${eventData.id}/opt-out`, {
          reason: reason.trim(),
          client_id: clientId,
        });
        // Kein Erfolgs-Toast: der Server schickt bereits einen Push.
        await refreshEvents();
        triggerRefresh('events');
      } catch (err: any) {
        setError(err.response?.data?.error || 'Fehler bei der Abmeldung');
      }
    } else {
      await writeQueue.enqueue({
        method: 'POST',
        url: `/konfi/events/${eventData.id}/opt-out`,
        body: { reason: reason.trim(), client_id: clientId },
        maxRetries: 5,
        hasFileUpload: false,
        metadata: {
          type: 'opt-out',
          clientId,
          label: `Abmeldung von "${eventData.name}"`,
        },
      });
      setSuccess('Abmeldung wird gesendet sobald du wieder online bist');
    }
  };

  const handleOptIn = async () => {
    if (!eventData) return;

    try {
      await api.post(`/konfi/events/${eventData.id}/opt-in`);
      // Kein Erfolgs-Toast: der Server schickt bereits einen Push.
      await refreshEvents();
      triggerRefresh('events');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler bei der Wiederanmeldung');
    }
  };

  const handleUnregister = async (reason: string) => {
    if (!eventData || !reason.trim()) {
      setError('Bitte gib einen Grund für die Abmeldung an');
      return;
    }

    try {
      await api.delete(`/konfi/events/${eventData.id}/register`, {
        data: { reason: reason.trim() }
      });

      // Kein Erfolgs-Toast: der Server schickt bereits einen Push.
      await refreshEvents();
      triggerRefresh('events');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler bei der Abmeldung');
    }
  };

  const [presentUnregisterModal, dismissUnregisterModal] = useIonModal(UnregisterModal, {
    eventName: eventData?.name || '',
    onClose: () => {
      dismissUnregisterModal();
      refreshEvents();
    },
    onUnregister: handleUnregister,
    dismiss: (data?: string, role?: string) => {
      dismissUnregisterModal(data, role);
      refreshEvents();
    }
  });

  const [presentOptOutModal, dismissOptOutModal] = useIonModal(UnregisterModal, {
    eventName: eventData?.name || '',
    mandatory: true,
    onClose: () => {
      dismissOptOutModal();
    },
    onUnregister: handleOptOut,
    dismiss: (data?: string, role?: string) => {
      dismissOptOutModal(data, role);
    }
  });

  const [presentScannerModal, dismissScannerModal] = useIonModal(QRScannerModal, {
    onClose: () => dismissScannerModal(),
    onSuccess: (eventId: number, eventName: string) => {
      dismissScannerModal();
      refreshEvents();
      setSuccess('Erfolgreich eingecheckt!');
    }
  });

  // Timeslots, Participants und Konfirmations-Check separat laden (nicht gecacht)
  useEffect(() => {
    if (!eventData) return;
    const loadDetails = async () => {
      try {
        if (eventData.has_timeslots) {
          const tsRes = await api.get(`/konfi/events/${eventId}/timeslots`);
          setTimeslots(tsRes.data || []);
        } else {
          setTimeslots([]);
        }
        const partRes = await api.get(`/konfi/events/${eventId}/participants`);
        setParticipants(partRes.data || []);
        const hasKonf = await checkExistingKonfirmation();
        setHasExistingKonfirmation(hasKonf);
      } catch (err) {
        // Timeslot/Participant-Laden darf fehlschlagen ohne Error-State
      }
    };
    loadDetails();
  }, [eventData?.id]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const canUnregister = (event: Event) => {
    if (!event.is_registered) return false;
    const eventDate = new Date(event.event_date);
    const now = new Date();
    const twoDaysBeforeEvent = new Date(eventDate.getTime() - (2 * 24 * 60 * 60 * 1000));
    return now < twoDaysBeforeEvent;
  };

  // Konfirmations-Event ueber das is_konfirmation-Flag (Phase 117, Migration 091).
  const isKonfirmationEvent = (event: Event) => {
    return event.is_konfirmation === true;
  };

  const checkExistingKonfirmation = async () => {
    try {
      const response = await api.get('/konfi/events');
      // Andere, bereits gebuchte Konfirmation (nicht dieses Event selbst).
      const myEvents = response.data.filter((e: Event) => e.is_registered && e.id !== eventData?.id);
      return myEvents.some((e: Event) => isKonfirmationEvent(e));
    } catch (err) {
      return false;
    }
  };

  const doRegister = async (timeslotId?: number) => {
    if (!eventData) return;

    try {
      const payload: any = {};
      if (timeslotId) {
        payload.timeslot_id = timeslotId;
      }
      await api.post(`/konfi/events/${eventData.id}/register`, payload);
      // Kein Erfolgs-Toast: der Server schickt bereits einen Push.
      await refreshEvents();
      triggerRefresh('events');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler bei der Anmeldung');
    }
  };

  const handleRegister = async () => {
    if (!eventData) return;

    if (isKonfirmationEvent(eventData)) {
      const hasExistingKonfirmation = await checkExistingKonfirmation();
      if (hasExistingKonfirmation) {
        presentAlert({
          header: 'Konfirmationstermin bereits gebucht',
          message: 'Du hast bereits einen Konfirmationstermin gebucht. Bitte melde dich zuerst vom bisherigen Termin ab, bevor du einen neuen buchst.',
          buttons: ['OK']
        });
        return;
      }
    }

    const hasTimeslots = eventData.has_timeslots && timeslots.length > 0;
    if (hasTimeslots) {
      const timeslotButtons = timeslots.map((slot) => {
        const isFull = slot.max_participants > 0 && parseInt(String(slot.registered_count || 0)) >= slot.max_participants;
        const startTime = formatTime(slot.start_time);
        const endTime = formatTime(slot.end_time);
        const spotsLeft = slot.max_participants - (slot.registered_count || 0);

        return {
          text: `${startTime} - ${endTime} (${spotsLeft} frei)`,
          handler: () => {
            if (isFull) {
              setError('Dieser Zeitslot ist leider voll');
              return false;
            }
            doRegister(slot.id);
          },
          cssClass: isFull ? 'action-sheet-disabled' : ''
        };
      });

      timeslotButtons.push({
        text: 'Abbrechen',
        role: 'cancel' as any,
        handler: () => {}
      } as any);

      presentActionSheet({
        header: 'Zeitslot auswählen',
        buttons: timeslotButtons
      });
      return;
    }

    doRegister();
  };

  // Status-Farben fuer SectionHeader — alle aus globalen Tokens
  const getStatusColors = (): { primary: string; secondary: string } => {
    const events = { primary: 'var(--app-color-events)', secondary: 'var(--app-color-events)' };
    const danger = { primary: 'var(--app-color-danger)', secondary: 'var(--app-color-danger)' };
    const info = { primary: 'var(--app-color-info)', secondary: 'var(--app-color-info)' }; // Konfirmation=blau, Pflicht-angemeldet=blau
    const success = { primary: 'var(--app-color-success)', secondary: 'var(--app-color-success)' };
    const bonus = { primary: 'var(--app-color-bonus)', secondary: 'var(--app-color-bonus)' };
    const past = { primary: '#6c757d', secondary: '#6c757d' };

    if (!eventData) return events;

    const isPastEvent = new Date(eventData.event_date) < new Date();
    const isKonfi = isKonfirmationEvent(eventData);
    const isOnWaitlist = eventData.booking_status === 'waitlist' || eventData.booking_status === 'pending';
    const isAusstehend = isPastEvent && eventData.is_registered && !isOnWaitlist && !eventData.attendance_status;

    if (eventData.cancelled) return danger;
    if (eventData.is_opted_out || eventData.booking_status === 'opted_out') return events;
    if (isKonfi && !isPastEvent) return info; // Konfirmation = blau (analog Admin)
    if (isPastEvent && eventData.attendance_status === 'present') return success;
    if (isPastEvent && eventData.attendance_status === 'absent') return danger;
    if (isAusstehend) return bonus;
    if (isOnWaitlist) return bonus;
    if (eventData.is_registered && !isPastEvent) return info;
    if (isPastEvent) return past;
    if (eventData.registration_status === 'open' && eventData.max_participants > 0 && eventData.registered_count >= eventData.max_participants && eventData.waitlist_enabled) return bonus;
    if (eventData.registration_status === 'open' && eventData.max_participants > 0 && eventData.registered_count >= eventData.max_participants) return danger;
    if (eventData.registration_status === 'open') return success;
    if (eventData.registration_status === 'upcoming') return bonus;
    return events;
  };

  // Status-Text für Header
  const getStatusText = () => {
    if (!eventData) return 'Event';
    const isPastEvent = new Date(eventData.event_date) < new Date();
    const isKonfi = isKonfirmationEvent(eventData);
    const isOnWaitlist = eventData.booking_status === 'waitlist' || eventData.booking_status === 'pending';
    const isAusstehend = isPastEvent && eventData.is_registered && !isOnWaitlist && !eventData.attendance_status;

    if (eventData.cancelled) return 'Abgesagt';
    if (eventData.is_opted_out || eventData.booking_status === 'opted_out') return 'Abgemeldet';
    if (isKonfi && !isPastEvent) return eventData.is_registered ? 'Angemeldet' : 'Konfirmation';
    if (isPastEvent && eventData.attendance_status === 'present') return 'Verbucht';
    if (isPastEvent && eventData.attendance_status === 'absent') return 'Verpasst';
    if (isAusstehend) return 'Ausstehend';
    if (isOnWaitlist) return `Warteliste (${eventData.waitlist_position || '?'})`;
    if (eventData.is_registered && !isPastEvent) return 'Angemeldet';
    if (isPastEvent) return 'Vergangen';
    // Voll aber Warteliste aktiv
    if (eventData.registration_status === 'open' && eventData.max_participants > 0 && eventData.registered_count >= eventData.max_participants && eventData.waitlist_enabled) return 'Warteliste';
    // Voll ohne Warteliste
    if (eventData.registration_status === 'open' && eventData.max_participants > 0 && eventData.registered_count >= eventData.max_participants) return 'Ausgebucht';
    if (eventData.registration_status === 'open') return 'Offen';
    if (eventData.registration_status === 'upcoming') return 'Bald';
    return 'Geschlossen';
  };

  if (loading) {
    return (
      <IonPage ref={pageRef}>
        <IonHeader translucent>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={onBack}>
                <IonIcon icon={arrowBack} />
              </IonButton>
            </IonButtons>
            <IonTitle>Event Details</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent fullscreen>
          <LoadingSpinner message="Event wird geladen..." />
        </IonContent>
      </IonPage>
    );
  }

  if (!eventData) {
    return (
      <IonPage ref={pageRef}>
        <IonHeader translucent>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={onBack}>
                <IonIcon icon={arrowBack} />
              </IonButton>
            </IonButtons>
            <IonTitle>Event nicht gefunden</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent fullscreen />
      </IonPage>
    );
  }

  const spotsLeft = eventData.max_participants - eventData.registered_count;

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onBack}>
              <IonIcon icon={arrowBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>{eventData.name}</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">{eventData.name}</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          refreshEvents();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        {/* Event Header - SectionHeader mit status-basierten Farben */}
        <SectionHeader
          title={eventData.name}
          subtitle={getStatusText()}
          icon={calendar}
          colors={getStatusColors()}
          stats={[
            { value: spotsLeft > 0 ? spotsLeft : 0, label: 'Frei' },
            { value: eventData.points, label: 'Punkte' },
            { value: eventData.registered_count, label: 'Dabei' }
          ]}
        />

        {/* QR Check-in Status / Button */}
        {eventData.attendance_status === 'present' ? (
          <div className="app-status-box app-status-box--success" style={{ margin: '0 16px 8px 16px' }}>
            <IonIcon icon={checkmarkCircle} style={{ fontSize: '1.3rem' }} />
            Anwesend
          </div>
        ) : (eventData.booking_status === 'confirmed' && !eventData.attendance_status) && (
          <div style={{ padding: '0 16px', marginBottom: '8px' }}>
            <IonButton
              expand="block"
              color="primary"
              onClick={() => presentScannerModal({
                presentingElement: pageRef.current || undefined
              })}
            >
              <IonIcon icon={qrCodeOutline} slot="start" />
              Einchecken
            </IonButton>
          </div>
        )}

        {/* Event Details - 1:1 wie Admin */}
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
                    {formatDate(eventData.event_date)}
                    {' · '}
                    {formatTime(eventData.event_date)}
                    {eventData.event_end_time && ` – ${formatTime(eventData.event_end_time)}`}
                  </div>
                </div>
              </div>

              {/* Zeitslots anzeigen wenn vorhanden (wie Admin) */}
              {eventData.has_timeslots && timeslots.length > 0 && (
                <div className="app-info-row app-info-row--top">
                  <IonIcon icon={time} className="app-info-row__icon app-icon-color--time app-event-detail__icon--align-top" />
                  <div className="app-event-detail__timeslot-list">
                    <div className="app-info-row__label">Zeitfenster</div>
                    {timeslots.map((slot, idx) => (
                      <div key={slot.id || idx} className="app-info-row__value app-event-detail__timeslot-entry">
                        {formatTime(slot.start_time)} – {formatTime(slot.end_time)} ({slot.registered_count || 0}/{slot.max_participants} TN)
                      </div>
                    ))}
                    {/* Gebuchter Timeslot hervorheben wenn angemeldet */}
                    {eventData.is_registered && eventData.booked_timeslot_start && (
                      <div className="app-icon-color--success app-event-detail__booked-slot">
                        Dein Slot: {formatTime(eventData.booked_timeslot_start)}
                        {eventData.booked_timeslot_end && ` - ${formatTime(eventData.booked_timeslot_end)}`}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Anmeldezeitraum — wie Zeitfenster aufgebaut, nicht bei Pflicht-Events */}
              {!eventData.mandatory && (
                <div className="app-info-row app-info-row--top">
                  <IonIcon icon={lockOpenOutline} className="app-info-row__icon app-icon-color--events app-event-detail__icon--align-top" />
                  <div>
                    <div className="app-info-row__label">Anmeldung</div>
                    {eventData.registration_opens_at ? (
                      <>
                        <div className="app-info-row__value">
                          von {new Date(eventData.registration_opens_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} – {formatTime(eventData.registration_opens_at)}
                        </div>
                        {eventData.registration_closes_at && (
                          <div className="app-info-row__value">
                            bis {new Date(eventData.registration_closes_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} – {formatTime(eventData.registration_closes_at)}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="app-info-row__value">Sofort möglich</div>
                    )}
                  </div>
                </div>
              )}

              {/* TN gesamt — ohne Teamer */}
              <div className="app-info-row">
                <IonIcon icon={people} className="app-info-row__icon app-icon-color--participants" />
                <div>
                  <div className="app-info-row__label">Teilnehmer:innen</div>
                  <div className="app-info-row__value">{eventData.registered_count - (eventData.teamer_count || 0)} / {eventData.max_participants > 0 ? eventData.max_participants : <IonIcon icon={infinite} style={{ verticalAlign: 'middle', fontSize: '0.9em' }} />}</div>
                </div>
              </div>

              {/* Warteliste */}
              {eventData.waitlist_enabled && (
                <div className="app-info-row">
                  <IonIcon icon={listOutline} className="app-info-row__icon app-icon-color--waitlist" />
                  <div>
                    <div className="app-info-row__label">Warteliste</div>
                    <div className="app-info-row__value">
                      {eventData.waitlist_count || 0} / {eventData.max_waitlist_size || 10}
                      {eventData.waitlist_position && ` (Du: Platz ${eventData.waitlist_position})`}
                    </div>
                  </div>
                </div>
              )}

              {/* Punkte */}
              <div className="app-info-row">
                <IonIcon icon={trophy} className="app-info-row__icon app-icon-color--points" />
                <div>
                  <div className="app-info-row__label">Punkte</div>
                  <div className="app-info-row__value">{eventData.points}</div>
                </div>
              </div>

              {/* Typ */}
              <div className="app-info-row">
                <IonIcon
                  icon={eventData.point_type === 'gottesdienst' ? home : people}
                  className={`app-info-row__icon ${eventData.point_type === 'gottesdienst' ? 'app-icon-color--gottesdienst' : 'app-icon-color--gemeinde'}`}
                />
                <div>
                  <div className="app-info-row__label">Typ</div>
                  <div className="app-info-row__value">{eventData.point_type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde'}</div>
                </div>
              </div>

              {/* Kategorien */}
              {eventData.categories && eventData.categories.length > 0 && (
                <div className="app-info-row">
                  <IonIcon icon={pricetag} className="app-info-row__icon app-icon-color--category" />
                  <div>
                    <div className="app-info-row__label">Kategorien</div>
                    <div className="app-info-row__value">{eventData.categories.map(c => c.name).join(', ')}</div>
                  </div>
                </div>
              )}

              {/* Ort */}
              {eventData.location && (
                <div className="app-info-row">
                  <IonIcon icon={location} className="app-info-row__icon app-icon-color--location" />
                  <div
                    onClick={() => {
                      if (eventData.location_maps_url) {
                        window.open(eventData.location_maps_url, '_blank');
                      } else if (eventData.location) {
                        const mapsUrl = `https://maps.apple.com/?q=${encodeURIComponent(eventData.location)}`;
                        window.open(mapsUrl, '_blank');
                      }
                    }}
                  >
                    <div className="app-info-row__label">Ort</div>
                    <div className="app-info-row__value app-event-detail__location-link">{eventData.location}</div>
                  </div>
                </div>
              )}

              {/* Pflicht-Badge */}
              {eventData.mandatory && (
                <div className="app-info-row">
                  <IonIcon icon={shieldCheckmark} className="app-info-row__icon app-icon-color--events" />
                  <div>
                    <div className="app-info-row__label">Pflicht-Event</div>
                    <div className="app-info-row__value">Teilnahme erforderlich</div>
                  </div>
                </div>
              )}

              {/* Was mitbringen */}
              {eventData.bring_items && (
                <div className="app-info-row app-info-row--top">
                  <IonIcon icon={bagHandle} className="app-info-row__icon app-icon-color--bring app-event-detail__icon--align-top" />
                  <div>
                    <div className="app-info-row__label">Mitbringen</div>
                    <div className="app-info-row__value">{eventData.bring_items}</div>
                  </div>
                </div>
              )}


            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Beschreibung - eigene Card mit rotem Icon */}
        {eventData.description && (
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
                  {eventData.description}
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* Teilnehmer-Liste */}
        {participants.length > 0 && (
          <IonList className="app-section-inset" inset={true}>
            <IonListHeader>
              <div className="app-section-icon app-section-icon--events">
                <IonIcon icon={people} />
              </div>
              <IonLabel>Teilnehmer:innen ({participants.length})</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {participants.map((participant) => (
                    <div
                      key={participant.id}
                      className="app-list-item app-list-item--events"
                    >
                      <div className="app-list-item__row">
                        <div className="app-list-item__main">
                          <div className="app-icon-circle app-icon-circle--events">
                            <IonIcon icon={personOutline} />
                          </div>
                          <div className="app-list-item__content">
                            <div className="app-list-item__title">{participant.display_name}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* Action Buttons */}
        <div className="app-event-detail__action-area">
          {eventData.mandatory ? (
            (() => {
              const isPastEvent = new Date(eventData.event_date) < new Date();
              const isOptedOut = eventData.is_opted_out || eventData.booking_status === 'opted_out';

              if (isPastEvent) {
                return (
                  <IonNote color="medium" style={{ display: 'block', textAlign: 'center', padding: '16px', fontSize: '0.95rem' }}>
                    <IonIcon icon={shieldCheckmark} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                    Pflicht-Event (vergangen)
                  </IonNote>
                );
              }

              if (isOptedOut) {
                return (
                  <div style={{ textAlign: 'center', padding: '12px 16px' }}>
                    <div className="app-status-box app-status-box--events" style={{ marginBottom: '12px' }}>
                      <IonIcon icon={closeCircle} />
                      Du hast dich abgemeldet
                    </div>
                    <IonButton
                      className="app-action-button"
                      expand="block"
                      color="success"
                      onClick={handleOptIn}
                    >
                      <IonIcon icon={checkmarkCircle} slot="start" />
                      Wieder anmelden
                    </IonButton>
                  </div>
                );
              }

              if (eventData.is_registered) {
                return (
                  <div style={{ textAlign: 'center', padding: '12px 16px' }}>
                    <IonNote color="medium" style={{ display: 'block', marginBottom: '12px', fontSize: '0.95rem' }}>
                      <IonIcon icon={shieldCheckmark} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                      Du bist automatisch angemeldet
                    </IonNote>
                    <IonButton
                      className="app-action-button"
                      expand="block"
                      fill="outline"
                      color="danger"
                      disabled={!isOnline}
                      onClick={() => presentOptOutModal({
                        presentingElement: pageRef.current || undefined
                      })}
                    >
                      <IonIcon icon={closeCircle} slot="start" />
                      {!isOnline ? <><IonIcon icon={cloudOfflineOutline} style={{ marginRight: 4 }} /> Du bist offline</> : 'Abmelden'}
                    </IonButton>
                  </div>
                );
              }

              // Nicht angemeldet bei Pflicht-Event -- nur Hinweis, kein Button
              return (
                <IonNote color="medium" style={{ display: 'block', textAlign: 'center', padding: '16px', fontSize: '0.95rem' }}>
                  <IonIcon icon={shieldCheckmark} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                  Pflicht-Event
                </IonNote>
              );
            })()
          ) : eventData.is_registered ? (
            <div>
              {canUnregister(eventData) ? (
                <IonButton
                  className="app-action-button"
                  expand="block"
                  fill="outline"
                  color="danger"
                  disabled={!isOnline}
                  onClick={() => presentUnregisterModal({
                    presentingElement: pageRef.current || undefined
                  })}
                >
                  <IonIcon icon={closeCircle} slot="start" />
                  {!isOnline ? <><IonIcon icon={cloudOfflineOutline} style={{ marginRight: 4 }} /> Du bist offline</> : 'Abmelden'}
                </IonButton>
              ) : (
                <IonButton
                  className="app-action-button"
                  expand="block"
                  fill="outline"
                  color="medium"
                  disabled
                >
                  <IonIcon icon={warning} slot="start" />
                  Abmeldung nicht mehr möglich
                </IonButton>
              )}
            </div>
          ) : (isKonfirmationEvent(eventData) && hasExistingKonfirmation) ? (
            <IonButton
              className="app-action-button"
              expand="block"
              disabled
              color="medium"
            >
              <IonIcon icon={warning} slot="start" />
              Konfirmationstermin bereits gebucht
            </IonButton>
          ) : eventData.can_register && eventData.registration_status === 'open' && (eventData.max_participants === 0 || eventData.registered_count < eventData.max_participants) ? (
            <IonButton
              className="app-action-button"
              expand="block"
              color="success"
              disabled={!isOnline}
              onClick={handleRegister}
            >
              <IonIcon icon={checkmarkCircle} slot="start" />
              {!isOnline ? <><IonIcon icon={cloudOfflineOutline} style={{ marginRight: 4 }} /> Du bist offline</> : `Anmelden (${eventData.registered_count}/${eventData.max_participants})`}
            </IonButton>
          ) : eventData.waitlist_enabled && eventData.max_participants > 0 && eventData.registered_count >= eventData.max_participants && eventData.registration_status === 'open' ? (
            <IonButton
              className="app-action-button"
              expand="block"
              color="warning"
              disabled={!isOnline}
              onClick={handleRegister}
            >
              <IonIcon icon={hourglass} slot="start" />
              {!isOnline ? <><IonIcon icon={cloudOfflineOutline} style={{ marginRight: 4 }} /> Du bist offline</> : `Warteliste offen (${eventData.waitlist_count || 0}/${eventData.max_waitlist_size || 0})`}
            </IonButton>
          ) : (
            <IonButton
              className="app-action-button"
              expand="block"
              disabled
              color="medium"
            >
              <IonIcon icon={informationCircle} slot="start" />
              {eventData.registration_status === 'closed' ? 'Anmeldung geschlossen' : 'Nicht verfügbar'}
            </IonButton>
          )}
        </div>

      </IonContent>
    </IonPage>
  );
};

export default EventDetailView;
