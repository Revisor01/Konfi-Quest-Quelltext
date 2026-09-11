import { FARBEN } from '../../../theme/colors';
import {
  ICON_ABSAGE,
  ICON_CHAT,
  ICON_ENTSPERRT,
  ICON_GEMEINDE_GEFUELLT,
  ICON_GOTTESDIENST_GEFUELLT,
  ICON_GRUPPE_GEFUELLT,
  ICON_INFO_GEFUELLT,
  ICON_KATEGORIE_GEFUELLT,
  ICON_KOPIEREN_GEFUELLT,
  ICON_LISTE,
  ICON_MATERIAL,
  ICON_OFFLINE,
  ICON_ORT_GEFUELLT,
  ICON_PERSON,
  ICON_POKAL_GEFUELLT,
  ICON_QRCODE,
  ICON_SCHUTZ_GEFUELLT,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT_GEFUELLT,
  ICON_UNENDLICH,
  ICON_WARNUNG_GEFUELLT,
  ICON_WARTEND_GEFUELLT,
  ICON_ZURUECK,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import { fehlerText } from '../../../utils/fehler';
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { useIonRouter } from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import api from '../../../services/api';
import type { ActionSheetButton } from '@ionic/core';
import OfflinePlatzhalter from '../../shared/OfflinePlatzhalter';
import { track } from '../../../services/analytics';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import LoadingSpinner from '../../common/LoadingSpinner';
import { SectionHeader, formatEventDateLong as formatDate, formatEventTime as formatTime, istVergangen } from '../../shared';
import UnregisterModal from '../modals/UnregisterModal';
import QRScannerModal from '../modals/QRScannerModal';
import { Event } from '../../../types/event';
import { useLiveUpdate, useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import { triggerPullHaptic } from '../../../utils/haptics';
import { safeUUID } from '../../../utils/uuid';

interface EventDetailViewProps {
  eventId: number;
  onBack: () => void;
  // Im iPad-Split-View ist die Liste links dauerhaft sichtbar -> kein
  // Zurück-Button nötig.
  hideBackButton?: boolean;
}

// Timeslot importiert aus types/event, lokaler Alias mit registered_count
interface DetailTimeslot {
  id: number;
  start_time: string;
  end_time: string;
  max_participants: number;
  registered_count: number;
  waitlist_count?: number;
}

interface Participant {
  id: number;
  display_name: string;
}

const EventDetailView: React.FC<EventDetailViewProps> = ({ eventId, onBack, hideBackButton }) => {
  const router = useIonRouter();
  const pageRef = useRef<HTMLElement>(null);
  const { setSuccess, setError, isOnline, user } = useApp();
  const { triggerRefresh } = useLiveUpdate();
  const [presentAlert] = useIonAlert();
  const [presentActionSheet] = useIonActionSheet();

  // Event-Daten über useOfflineQuery mit 10min TTL Cache
  // DERSELBE Cache-Schluessel wie die Terminliste (KonfiEventsPage.tsx:92) —
  // beide laden dieselbe vollstaendige Liste von /konfi/events.
  const { data: allEvents, loading, refresh: refreshEvents, refreshLive: refreshEventsLive } = useOfflineQuery<Event[]>(
    'konfi:events:' + user?.id,
    () => api.get('/konfi/events').then(r => r.data),
    { ttl: 10 * 60 * 1000 }
  );

  const eventData = allEvents?.find((e: Event) => e.id === eventId) || null;

  const [hasExistingKonfirmation, setHasExistingKonfirmation] = useState(false);
  const [timeslots, setTimeslots] = useState<DetailTimeslot[]>([]);
  // Konnten die Zeitfenster nicht geladen werden? Dann darf NICHT angemeldet
  // werden — sonst landet der Konfi ohne Zeitfenster im Event.
  const [timeslotsLoadFailed, setTimeslotsLoadFailed] = useState(false);
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
      } catch (err) {
        setError(fehlerText(err, 'Fehler bei der Abmeldung'));
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
    } catch (err) {
      setError(fehlerText(err, 'Fehler bei der Wiederanmeldung'));
    }
  };

  const handleUnregister = async (reason: string) => {
    if (!eventData || !reason.trim()) {
      setError('Bitte gib einen Grund für die Abmeldung an');
      return;
    }

    // Wie beim Opt-out: Ohne Verbindung in die Warteschlange, statt den Knopf
    // zu sperren. Eine Abmeldung gibt einen Platz FREI — es gibt
    // nichts zu pruefen, was offline unbekannt waere. Das unterscheidet sie
    // vom Anmelden, das wegen der begrenzten Plaetze gesperrt bleibt.
    const clientId = safeUUID();

    if (!networkMonitor.isOnline) {
      await writeQueue.enqueue({
        method: 'DELETE',
        url: `/konfi/events/${eventData.id}/register`,
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
      return;
    }

    try {
      await api.delete(`/konfi/events/${eventData.id}/register`, {
        data: { reason: reason.trim(), client_id: clientId }
      });

      // Kein Erfolgs-Toast: der Server schickt bereits einen Push.
      await refreshEvents();
      triggerRefresh('events');
    } catch (err) {
      setError(fehlerText(err, 'Fehler bei der Abmeldung'));
    }
  };

  const [presentUnregisterModal, dismissUnregisterModal] = useIonModal(UnregisterModal, {
    eventName: eventData?.name || '',
    onUnregister: handleUnregister,
    dismiss: (data?: string, role?: string) => {
      dismissUnregisterModal(data, role);
      refreshEvents();
    }
  });

  const [presentOptOutModal, dismissOptOutModal] = useIonModal(UnregisterModal, {
    eventName: eventData?.name || '',
    mandatory: true,
    onUnregister: handleOptOut,
    dismiss: (data?: string, role?: string) => {
      dismissOptOutModal(data, role);
    }
  });

  const [presentScannerModal, dismissScannerModal] = useIonModal(QRScannerModal, {
    onClose: () => dismissScannerModal(),
    onSuccess: (_eventId: number, _eventName: string) => {
      dismissScannerModal();
      refreshEvents();
      setSuccess('Erfolgreich eingecheckt!');
    }
  });

  // Zaehler fuer das Nachladen der Detaildaten (Zeitfenster, Teilnehmerliste).
  // Live-Ereignisse erhoehen ihn; der Effekt unten haengt daran. Ohne das blieb
  // die Teilnehmerliste stehen, wenn sich jemand anderes an- oder abmeldete
  // 
  const [detailEpoch, setDetailEpoch] = useState(0);

  // Welcher Termin gerade gelten soll. Antworten, die zu einem vorher
  // geoeffneten Termin gehoeren, duerfen den Stand nicht mehr ueberschreiben.
  const aktuelleEventId = useRef(eventId);

  // Beim Wechsel des Termins den Stand des VORIGEN leeren.
  //
  // Dieselbe Ursache wie in der Leitungsansicht (admin/views/EventDetailView):
  // Der IonRouterOutlet behaelt gemountete Seiten im Speicher, ParamSeite
  // (MainTabs.tsx) reicht nur eine neue eventId in DIESELBE Instanz. eventData
  // wird aus der Liste abgeleitet und stimmt sofort — die nachgeladenen Werte
  // aber nicht: Zeitfenster, Teilnehmerliste und der Konfirmations-Check
  // blieben die des vorigen Termins. Online sah man sie, bis die neue Antwort
  // eintraf; OFFLINE dauerhaft, denn der Effekt unten bricht ohne Verbindung
  // vor dem Laden ab und laesst die alten Werte stehen.
  useEffect(() => {
    aktuelleEventId.current = eventId;
    setTimeslots([]);
    setParticipants([]);
    setHasExistingKonfirmation(false);
    setTimeslotsLoadFailed(false);
  }, [eventId]);

  useLiveRefresh(['events'], useCallback(() => {
    refreshEventsLive();
    setDetailEpoch((n) => n + 1);
  }, [refreshEventsLive]));

  // Timeslots, Participants und Konfirmations-Check separat laden (nicht gecacht).
  // Ein Fehler beim Laden der ZEITFENSTER wird gemerkt: ohne sie wäre
  // timeslots=[] und die Anmeldung wuerde unten am Zeitfenster-Dialog
  // vorbeilaufen — der Konfi landete ohne Slot im Event.
  useEffect(() => {
    if (!eventData) return;
    const fuerEventId = eventId;
    // Eine Antwort gilt nur, solange sie zum aktuell geoeffneten Termin
    // gehoert. Bei schnellem Wechsel kann die Antwort fuer den ERSTEN nach der
    // des zweiten eintreffen und dessen Liste sonst falsch ueberschreiben.
    const gilt = () => aktuelleEventId.current === fuerEventId;
    const loadDetails = async () => {
      // Das ist KEIN stilles Scheitern im Sinne von offlineAktion.ts: Hier
      // bricht keine Nutzeraktion ab, sondern ein Lade-Effekt laesst den
      // vorhandenen Stand stehen. Eine Fehlermeldung waere hier falsch — die
      // Seite zeigt den Termin ja. Was offline fehlt, sagen die Platzhalter
      // in den betroffenen Abschnitten.
      const offline = !networkMonitor.isOnline;
      if (offline) return;
      setTimeslotsLoadFailed(false);
      try {
        if (eventData.has_timeslots) {
          const tsRes = await api.get(`/konfi/events/${fuerEventId}/timeslots`);
          if (gilt()) setTimeslots(tsRes.data || []);
        } else if (gilt()) {
          setTimeslots([]);
        }
      } catch {
        if (gilt()) {
          setTimeslots([]);
          setTimeslotsLoadFailed(true);
        }
      }
      // Teilnehmerliste und Konfirmations-Check sind für die Anmeldung nicht
      // kritisch — sie duerfen weiterhin still fehlschlagen.
      try {
        const partRes = await api.get(`/konfi/events/${fuerEventId}/participants`);
        if (gilt()) setParticipants(partRes.data || []);
      } catch {
        // Teilnehmerliste ist nur Anzeige
      }
      try {
        const hasKonf = await checkExistingKonfirmation();
        if (gilt()) setHasExistingKonfirmation(hasKonf);
      } catch {
        // Konfirmations-Check wird bei der Anmeldung erneut geprüft
      }
    };
    loadDetails();
  }, [eventData?.id, eventId, detailEpoch]);

  const canUnregister = (event: Event) => {
    if (!event.is_registered) return false;
    const eventDate = new Date(event.event_date);
    const now = new Date();
    const twoDaysBeforeEvent = new Date(eventDate.getTime() - (2 * 24 * 60 * 60 * 1000));
    return now < twoDaysBeforeEvent;
  };

  // Konfirmations-Event über das is_konfirmation-Flag (Phase 117, Migration 091).
  const isKonfirmationEvent = (event: Event) => {
    return event.is_konfirmation === true;
  };

  const checkExistingKonfirmation = async () => {
    try {
      const response = await api.get('/konfi/events');
      // Andere, bereits gebuchte Konfirmation (nicht dieses Event selbst).
      const myEvents = response.data.filter((e: Event) => e.is_registered && e.id !== eventData?.id);
      return myEvents.some((e: Event) => isKonfirmationEvent(e));
    } catch {
      return false;
    }
  };

  const doRegister = async (timeslotId?: number) => {
    if (!eventData) return;

    try {
      const payload: { timeslot_id?: number } = {};
      if (timeslotId) {
        payload.timeslot_id = timeslotId;
      }
      const res = await api.post(`/konfi/events/${eventData.id}/register`, payload);
      // Anonyme Messung: kommen Anmeldungen durch oder landen sie auf der
      // Warteliste, und werden Zeitfenster genutzt? Kein Event-Name, keine ID.
      track('event-angemeldet', {
        status: res.data?.status === 'waitlist' ? 'warteliste' : 'bestaetigt',
        mit_zeitfenster: !!timeslotId
      });
      // Bei Warteliste braucht der Konfi eine sichtbare Rueckmeldung (der Server
      // schickt zwar Push, aber die Buchung kann eben confirmed ODER waitlist sein).
      if (res.data?.status === 'waitlist') {
        setSuccess('Du bist auf der Warteliste. Wird ein Platz frei, rückst du automatisch nach.');
      }
      await refreshEvents();
      triggerRefresh('events');
    } catch (err) {
      setError(fehlerText(err, 'Fehler bei der Anmeldung'));
    }
  };

  const handleRegister = async () => {
    if (!eventData) return;

    // Zeitfenster-Event, dessen Zeitfenster nicht geladen werden konnten:
    // hier abbrechen statt ohne Zeitfenster anzumelden.
    if (eventData.has_timeslots && timeslots.length === 0) {
      presentAlert({
        header: 'Zeitfenster nicht geladen',
        message: timeslotsLoadFailed
          ? 'Die Zeitfenster konnten nicht geladen werden. Zieh die Seite nach unten, um es erneut zu versuchen.'
          : 'Für dieses Event sind noch keine Zeitfenster eingetragen. Melde dich bei deinem Team.',
        buttons: ['OK']
      });
      return;
    }

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
      const waitlistEnabled = !!eventData.waitlist_enabled;
      const maxWaitlist = eventData.max_waitlist_size || 0;

      const timeslotButtons: ActionSheetButton[] = timeslots.map((slot) => {
        const isFull = slot.max_participants > 0 && parseInt(String(slot.registered_count || 0)) >= slot.max_participants;
        const slotWaitlist = parseInt(String(slot.waitlist_count || 0));
        // Auf einen vollen Slot kann man sich auf die Warteliste setzen, solange
        // die Warteliste aktiv und nicht voll ist. Nur dann bleibt der Slot
        // buchbar; sonst ist er wirklich dicht.
        const waitlistPossible = isFull && waitlistEnabled && (maxWaitlist === 0 || slotWaitlist < maxWaitlist);
        const blocked = isFull && !waitlistPossible;

        const startTime = formatTime(slot.start_time);
        const endTime = formatTime(slot.end_time);
        const spotsLeft = Math.max(0, slot.max_participants - (slot.registered_count || 0));

        let label;
        if (waitlistPossible) {
          label = `${startTime} - ${endTime} (voll — auf Warteliste${slotWaitlist > 0 ? `, ${slotWaitlist} warten` : ''})`;
        } else if (blocked) {
          label = `${startTime} - ${endTime} (ausgebucht)`;
        } else {
          label = `${startTime} - ${endTime} (${spotsLeft} frei)`;
        }

        return {
          text: label,
          handler: () => {
            if (blocked) {
              setError('Dieser Zeitslot ist ausgebucht und hat keine Warteliste.');
              return false;
            }
            doRegister(slot.id);
          },
          cssClass: blocked ? 'action-sheet-disabled' : ''
        };
      });

      timeslotButtons.push({
        text: 'Abbrechen',
        role: 'cancel',
        handler: () => {}
      });

      presentActionSheet({
        header: 'Zeitslot auswählen',
        buttons: timeslotButtons
      });
      return;
    }

    doRegister();
  };

  // Status-Farben für SectionHeader — alle aus globalen Tokens
  const getStatusColors = (): { primary: string; secondary: string } => {
    const events = { primary: 'var(--app-color-events)', secondary: 'var(--app-color-events)' };
    const danger = { primary: 'var(--app-color-danger)', secondary: 'var(--app-color-danger)' };
    const info = { primary: 'var(--app-color-info)', secondary: 'var(--app-color-info)' }; // Konfirmation=blau, Pflicht-angemeldet=blau
    const success = { primary: 'var(--app-color-success)', secondary: 'var(--app-color-success)' };
    const bonus = { primary: 'var(--app-color-bonus)', secondary: 'var(--app-color-bonus)' };
    const past = { primary: FARBEN.neutral, secondary: FARBEN.neutral };

    if (!eventData) return events;

    const isPastEvent = istVergangen(eventData);
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
    const isPastEvent = istVergangen(eventData);
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
            {!hideBackButton && (
              <IonButtons slot="start">
                <IonButton aria-label="Zurück" onClick={onBack}>
                  <IonIcon icon={ICON_ZURUECK} />
                </IonButton>
              </IonButtons>
            )}
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
            {!hideBackButton && (
              <IonButtons slot="start">
                <IonButton aria-label="Zurück" onClick={onBack}>
                  <IonIcon icon={ICON_ZURUECK} />
                </IonButton>
              </IonButtons>
            )}
            <IonTitle>Event nicht gefunden</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent fullscreen />
      </IonPage>
    );
  }

  // Freie Plaetze aus KONFI-Sicht: Teamer haben ein eigenes Kontingent und
  // duerfen hier nicht mitzaehlen. max_participants = 0 heißt unbegrenzt —
  // dort ergab die Rechnung negative Werte und zeigte faelschlich "0 Frei".
  const konfiRegistered = (eventData.registered_count || 0);
  const isUnlimited = (eventData.max_participants || 0) === 0;
  const spotsLeft = isUnlimited ? null : eventData.max_participants - konfiRegistered;

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent>
        <IonToolbar>
          {!hideBackButton && (
            <IonButtons slot="start">
              <IonButton aria-label="Zurück" onClick={onBack}>
                <IonIcon icon={ICON_ZURUECK} />
              </IonButton>
            </IonButtons>
          )}
          <IonTitle>{eventData.name}</IonTitle>
          {/* Einstieg in den Event-Chat — bisher hatte ihn nur die Leitung
              (`admin/views/EventDetailView.tsx`), obwohl Konfis beim Buchen
              ohnehin Mitglied des Raums werden (`addToEventChat`). Sie fanden
              ihn nur ueber die Chat-Uebersicht.
              Der Knopf erscheint nur, wenn es einen Raum gibt UND diese Konfi
              darin Mitglied ist: `chat_room_id` kommt aus `/konfi/events` und
              ist sonst null (konfi.js). Erstellen bleibt der Leitung
              vorbehalten (`POST /events/:id/chat` verlangt requireTeamer). */}
          {eventData.chat_room_id && (
            <IonButtons slot="end">
              <IonButton
                aria-label="Event-Chat öffnen"
                onClick={() => router.push(`/konfi/chat/room/${eventData.chat_room_id}`, 'root')}
              >
                <IonIcon icon={ICON_CHAT} slot="icon-only" />
              </IonButton>
            </IonButtons>
          )}
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
          icon={ICON_TERMIN_GEFUELLT}
          colors={getStatusColors()}
          stats={[
            // Unbegrenzt -> "∞ Frei" statt einer irrefuehrenden 0.
            { value: isUnlimited ? '∞' : Math.max(0, spotsLeft ?? 0), label: 'Frei' },
            // Punkte-Kachel nur, wenn es welche gibt (Pflicht/Konfirmation: 0).
            ...((eventData.points || 0) > 0 && !eventData.mandatory && !eventData.is_konfirmation
              ? [{ value: eventData.points, label: 'Punkte' }]
              : []),
            { value: konfiRegistered, label: 'Dabei' }
          ]}
        />

        {/* QR Check-in Status / Button */}
        {eventData.attendance_status === 'present' ? (
          <div className="app-status-box app-status-box--success" style={{ margin: '0 var(--app-abstand-basis) var(--app-abstand-eng) var(--app-abstand-basis)' }}>
            <IonIcon icon={ICON_ZUSAGE_GEFUELLT} style={{ fontSize: 'var(--app-text-titel)' }} />
            Anwesend
          </div>
        ) : (eventData.booking_status === 'confirmed' && !eventData.attendance_status) && (
          <div style={{ padding: '0 var(--app-abstand-basis)', marginBottom: 'var(--app-abstand-eng)' }}>
            <IonButton
              expand="block"
              fill="outline"
              color="primary"
              onClick={() => presentScannerModal({
                presentingElement: pageRef.current || undefined
              })}
            >
              <IonIcon icon={ICON_QRCODE} slot="start" />
              Einchecken
            </IonButton>
          </div>
        )}

        {/* Event Details - 1:1 wie Admin */}
        <IonList className="app-section-inset" inset={true}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events">
              <IonIcon icon={ICON_TERMIN_GEFUELLT} />
            </div>
            <IonLabel>Details</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent className="app-card-content">
              {/* Datum */}
              <div className="app-info-row">
                <IonIcon icon={ICON_TERMIN_GEFUELLT} className="app-info-row__icon app-icon-color--events" />
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
              {eventData.has_timeslots && timeslots.length === 0 && !isOnline && (
                <OfflinePlatzhalter was="Die Zeitfenster-Auswahl" />
              )}
              {eventData.has_timeslots && timeslots.length > 0 && (
                <div className="app-info-row app-info-row--top">
                  <IonIcon icon={ICON_UHRZEIT_GEFUELLT} className="app-info-row__icon app-icon-color--time app-event-detail__icon--align-top" />
                  <div className="app-event-detail__timeslot-list">
                    <div className="app-info-row__label">Zeitfenster</div>
                    {timeslots.map((slot, idx) => (
                      <div key={slot.id || idx} className="app-info-row__value app-event-detail__timeslot-entry">
                        {formatTime(slot.start_time)} – {formatTime(slot.end_time)} ({slot.registered_count || 0}/{slot.max_participants} TN{(slot.waitlist_count || 0) > 0 ? ` · ${slot.waitlist_count} Warteliste` : ''})
                      </div>
                    ))}
                    {/* Gebuchter Timeslot hervorheben wenn angemeldet */}
                    {eventData.is_registered && eventData.booked_timeslot_start && (
                      <div className="app-icon-color--success app-event-detail__booked-slot">
                        Dein Slot: {formatTime(eventData.booked_timeslot_start)}
                        {eventData.booked_timeslot_end && ` - ${formatTime(eventData.booked_timeslot_end)}`}
                      </div>
                    )}
                    {/* Warteliste fuer einen bestimmten Slot */}
                    {eventData.booking_status === 'waitlist' && eventData.booked_timeslot_start && (
                      <div className="app-icon-color--waitlist app-event-detail__booked-slot">
                        Auf der Warteliste für {formatTime(eventData.booked_timeslot_start)}
                        {eventData.booked_timeslot_end && ` - ${formatTime(eventData.booked_timeslot_end)}`}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Anmeldezeitraum — wie Zeitfenster aufgebaut, nicht bei Pflicht-Events */}
              {!eventData.mandatory && (
                <div className="app-info-row app-info-row--top">
                  <IonIcon icon={ICON_ENTSPERRT} className="app-info-row__icon app-icon-color--events app-event-detail__icon--align-top" />
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
                <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-info-row__icon app-icon-color--participants" />
                <div>
                  <div className="app-info-row__label">Teilnehmer:innen</div>
                  <div className="app-info-row__value">{(eventData.registered_count || 0)} / {eventData.max_participants > 0 ? eventData.max_participants : <IonIcon icon={ICON_UNENDLICH} style={{ verticalAlign: 'middle', fontSize: 'var(--app-icon-inline)' }} />}</div>
                </div>
              </div>

              {/* Warteliste */}
              {eventData.waitlist_enabled && (
                <div className="app-info-row">
                  <IonIcon icon={ICON_LISTE} className="app-info-row__icon app-icon-color--waitlist" />
                  <div>
                    <div className="app-info-row__label">Warteliste</div>
                    <div className="app-info-row__value">
                      {eventData.waitlist_count || 0} / {eventData.max_waitlist_size || 10}
                      {eventData.waitlist_position && ` (Du: Platz ${eventData.waitlist_position})`}
                    </div>
                  </div>
                </div>
              )}

              {/* Punkte und Typ nur, wenn es welche gibt. Pflicht-Events und
                  Konfirmationen geben keine Punkte (Backend erzwingt 0) — dort
                  stand bisher "Punkte 0 / Typ Gemeinde". Die Konfi-LISTE
                  blendet das schon korrekt aus, das Detail nicht. */}
              {(eventData.points || 0) > 0 && !eventData.mandatory && !eventData.is_konfirmation && (
                <>
                  <div className="app-info-row">
                    <IonIcon icon={ICON_POKAL_GEFUELLT} className="app-info-row__icon app-icon-color--points" />
                    <div>
                      <div className="app-info-row__label">Punkte</div>
                      <div className="app-info-row__value">{eventData.points}</div>
                    </div>
                  </div>
                  <div className="app-info-row">
                    <IonIcon
                      icon={eventData.point_type === 'gottesdienst' ? ICON_GOTTESDIENST_GEFUELLT : ICON_GEMEINDE_GEFUELLT}
                      className={`app-info-row__icon ${eventData.point_type === 'gottesdienst' ? 'app-icon-color--gottesdienst' : 'app-icon-color--gemeinde'}`}
                    />
                    <div>
                      <div className="app-info-row__label">Typ</div>
                      <div className="app-info-row__value">{eventData.point_type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde'}</div>
                    </div>
                  </div>
                </>
              )}

              {/* Kategorien */}
              {eventData.categories && eventData.categories.length > 0 && (
                <div className="app-info-row">
                  <IonIcon icon={ICON_KATEGORIE_GEFUELLT} className="app-info-row__icon app-icon-color--category" />
                  <div>
                    <div className="app-info-row__label">Kategorien</div>
                    <div className="app-info-row__value">{eventData.categories.map(c => c.name).join(', ')}</div>
                  </div>
                </div>
              )}

              {/* Ort */}
              {eventData.location && (
                <div className="app-info-row">
                  <IonIcon icon={ICON_ORT_GEFUELLT} className="app-info-row__icon app-icon-color--location" />
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
                  <IonIcon icon={ICON_SCHUTZ_GEFUELLT} className="app-info-row__icon app-icon-color--events" />
                  <div>
                    <div className="app-info-row__label">Pflicht-Event</div>
                    <div className="app-info-row__value">Teilnahme erforderlich</div>
                  </div>
                </div>
              )}

              {/* Serien-Kennzeichnung — sah bisher nur die Leitung, und nur in ihrer
                  Liste (`admin/EventsView.tsx:403`). Konfis und Teamer:innen konnten
                  nicht erkennen, dass ein Termin Teil einer Reihe ist. Die WEITEREN
                  Termine der Serie bleiben der Leitung vorbehalten: sie kommen aus
                  `series_events` in `GET /events/:id`, und diese beiden Ansichten
                  lesen ihren Termin aus der Liste. */}
              {eventData.is_series && (
                <div className="app-info-row">
                  <IonIcon icon={ICON_KOPIEREN_GEFUELLT} className="app-info-row__icon app-icon-color--events" />
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
              {eventData.checkin_window && (
                <div className="app-info-row app-info-row--top">
                  <IonIcon icon={ICON_QRCODE} className="app-info-row__icon app-icon-color--events app-event-detail__icon--align-top" />
                  <div>
                    <div className="app-info-row__label">Check-in-Fenster</div>
                    <div className="app-info-row__value">
                      QR-Code {eventData.checkin_window} Min. (vor/nach Beginn)
                    </div>
                  </div>
                </div>
              )}

              {/* Was mitbringen */}
              {eventData.bring_items && (
                <div className="app-info-row app-info-row--top">
                  <IonIcon icon={ICON_MATERIAL} className="app-info-row__icon app-icon-color--bring app-event-detail__icon--align-top" />
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
                <IonIcon icon={ICON_INFO_GEFUELLT} />
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

        <IonList className="app-section-inset" inset={true}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events">
              <IonIcon icon={ICON_GRUPPE_GEFUELLT} />
            </div>
            <IonLabel>Bist du dabei?</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent className="app-card-content">
              {eventData.mandatory ? (
                (() => {
                  const isPastEvent = istVergangen(eventData);
                  const isOptedOut = eventData.is_opted_out || eventData.booking_status === 'opted_out';

                  if (isPastEvent) {
                    return (
                      <IonNote color="medium" style={{ display: 'block', textAlign: 'center', fontSize: 'var(--app-text-betont)' }}>
                        <IonIcon icon={ICON_SCHUTZ_GEFUELLT} style={{ verticalAlign: 'middle', marginRight: 'var(--app-abstand-kompakt)' }} />
                        Pflicht-Event (vergangen)
                      </IonNote>
                    );
                  }

                  if (isOptedOut) {
                    return (
                      <div style={{ textAlign: 'center' }}>
                        <div className="app-status-box app-status-box--events" style={{ marginBottom: 'var(--app-abstand-mittel)' }}>
                          <IonIcon icon={ICON_ABSAGE} />
                          Du hast dich abgemeldet
                        </div>
                        <IonButton
                          className="app-action-button"
                          expand="block"
                          color="success"
                          onClick={handleOptIn}
                        >
                          <IonIcon icon={ICON_ZUSAGE_GEFUELLT} slot="start" />
                          Wieder anmelden
                        </IonButton>
                      </div>
                    );
                  }

                  if (eventData.is_registered) {
                    return (
                      <div style={{ textAlign: 'center' }}>
                        <IonNote color="medium" style={{ display: 'block', marginBottom: 'var(--app-abstand-mittel)', fontSize: 'var(--app-text-betont)' }}>
                          <IonIcon icon={ICON_SCHUTZ_GEFUELLT} style={{ verticalAlign: 'middle', marginRight: 'var(--app-abstand-kompakt)' }} />
                          Du bist automatisch angemeldet
                        </IonNote>
                        <IonButton
                          className="app-action-button"
                          expand="block"
                          fill="outline"
                          color="danger"
                          onClick={() => presentOptOutModal({
                            presentingElement: pageRef.current || undefined
                          })}
                        >
                          <IonIcon icon={ICON_ABSAGE} slot="start" />
                          {!isOnline
                            ? <><IonIcon icon={ICON_OFFLINE} style={{ marginRight: 'var(--app-abstand-mini)'}} /> Abmelden (wird gesendet)</>
                            : 'Abmelden'}
                        </IonButton>
                      </div>
                    );
                  }

                  // Nicht angemeldet bei Pflicht-Event -- nur Hinweis, kein Button
                  return (
                    <IonNote color="medium" style={{ display: 'block', textAlign: 'center', fontSize: 'var(--app-text-betont)' }}>
                      <IonIcon icon={ICON_SCHUTZ_GEFUELLT} style={{ verticalAlign: 'middle', marginRight: 'var(--app-abstand-kompakt)' }} />
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
                      onClick={() => presentUnregisterModal({
                        presentingElement: pageRef.current || undefined
                      })}
                    >
                      <IonIcon icon={ICON_ABSAGE} slot="start" />
                      {!isOnline
                        ? <><IonIcon icon={ICON_OFFLINE} style={{ marginRight: 'var(--app-abstand-mini)'}} /> Abmelden (wird gesendet)</>
                        : 'Abmelden'}
                    </IonButton>
                  ) : (
                    <IonButton
                      className="app-action-button"
                      expand="block"
                      fill="outline"
                      color="medium"
                      disabled
                    >
                      <IonIcon icon={ICON_WARNUNG_GEFUELLT} slot="start" />
                      {/* Grund nennen statt nur zu sperren: abmelden geht bis
                          2 Tage vor dem Termin (siehe canUnregister). */}
                      Abmelden geht nur bis 2 Tage vorher
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
                  <IonIcon icon={ICON_WARNUNG_GEFUELLT} slot="start" />
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
                  <IonIcon icon={ICON_ZUSAGE_GEFUELLT} slot="start" />
                  {!isOnline ? <><IonIcon icon={ICON_OFFLINE} style={{ marginRight: 'var(--app-abstand-mini)'}} /> Du bist offline</> : `Anmelden (${eventData.registered_count}/${eventData.max_participants})`}
                </IonButton>
              ) : eventData.waitlist_enabled && eventData.max_participants > 0 && eventData.registered_count >= eventData.max_participants && eventData.registration_status === 'open' ? (
                <IonButton
                  className="app-action-button"
                  expand="block"
                  color="warning"
                  disabled={!isOnline}
                  onClick={handleRegister}
                >
                  <IonIcon icon={ICON_WARTEND_GEFUELLT} slot="start" />
                  {!isOnline ? <><IonIcon icon={ICON_OFFLINE} style={{ marginRight: 'var(--app-abstand-mini)'}} /> Du bist offline</> : `Warteliste offen (${eventData.waitlist_count || 0}/${eventData.max_waitlist_size || 0})`}
                </IonButton>
              ) : (
                <IonButton
                  className="app-action-button"
                  expand="block"
                  disabled
                  color="medium"
                >
                  <IonIcon icon={ICON_INFO_GEFUELLT} slot="start" />
                  {eventData.registration_status === 'closed' ? 'Anmeldung geschlossen' : 'Nicht verfügbar'}
                </IonButton>
              )}
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Teilnehmer-Liste */}
        {participants.length === 0 && !isOnline && (
          <OfflinePlatzhalter was="Die Teilnehmerliste" />
        )}
        {participants.length > 0 && (
          <IonList className="app-section-inset" inset={true}>
            <IonListHeader>
              <div className="app-section-icon app-section-icon--events">
                <IonIcon icon={ICON_GRUPPE_GEFUELLT} />
              </div>
              <IonLabel>Teilnehmer:innen ({participants.length})</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {participants.map((participant) => (
                    <div
                      key={participant.id}
                      className="app-list-item app-list-item--events"
                    >
                      <div className="app-list-item__row">
                        <div className="app-list-item__main">
                          <div className="app-icon-circle app-icon-circle--events">
                            <IonIcon icon={ICON_PERSON} />
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


      </IonContent>
    </IonPage>
  );
};

export default EventDetailView;
