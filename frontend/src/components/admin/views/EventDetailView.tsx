import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonButton, IonIcon, IonCard, IonCardContent,
  IonItem, IonLabel, IonList, IonListHeader,
  IonRefresher, IonRefresherContent, useIonModal,
  IonItemSliding, IonItemOptions, IonItemOption,
  useIonActionSheet, useIonAlert, useIonRouter
} from '@ionic/react';
import {
  arrowBack, createOutline, calendar, people, ban,
  personAdd, checkmarkCircle, closeCircle, checkmark, trash,
  returnUpBack, qrCodeOutline, chatbubbleOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { SectionHeader, formatEventDateLong as formatDate, formatEventTime as formatTime, istVergangen } from '../../shared';
import { getStatusIcon } from '../../shared/StatusBadge';
import EventModal from '../modals/EventModal';
import ParticipantManagementModal from '../modals/ParticipantManagementModal';
import QRDisplayModal from '../../shared/QRDisplayModal';
import TeamerMaterialDetailPage from '../../teamer/pages/TeamerMaterialDetailPage';
import { useLiveUpdate, useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import {
  EventInfoCard, DescriptionSection, SeriesEventsSection,
  UnregistrationsSection, EventMaterialSection, EventActionsSection,
  TimeslotsSection
} from './EventDetailSections';
import type { Participant, Unregistration } from './EventDetailSections';
import { triggerPullHaptic } from '../../../utils/haptics';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';

interface Category {
  id: number;
  name: string;
}

interface Event {
  id: number;
  name: string;
  description?: string;
  event_date: string;
  event_end_time?: string;
  location?: string;
  location_maps_url?: string;
  points: number;
  point_type?: 'gottesdienst' | 'gemeinde';
  categories?: Category[];
  jahrgaenge?: Jahrgang[];
  type: string;
  max_participants: number;
  registration_opens_at?: string;
  registration_closes_at?: string;
  registered_count: number;
  registration_status: 'upcoming' | 'open' | 'closed';
  available_spots: number;
  participants: Participant[];
  timeslots?: Timeslot[];
  has_timeslots?: boolean;
  mandatory?: boolean;
  is_konfirmation?: boolean;
  bring_items?: string;
  teamer_needed?: boolean;
  teamer_only?: boolean;
  teamer_max_participants?: number;
  teamer_waitlist_enabled?: boolean;
  teamer_max_waitlist_size?: number;
  teamer_waitlist_count?: number;
  is_series?: boolean;
  series_id?: string;
  series_events?: Event[];
  created_at: string;
  chat_room_id?: number | null;
  cancelled?: boolean;
}

interface Jahrgang {
  id: number;
  name: string;
}

interface Timeslot {
  id: number;
  start_time: string;
  end_time: string;
  max_participants: number;
  registered_count: number;
}

interface EventDetailViewProps {
  eventId: number;
  onBack: () => void;
  // Im iPad-Split-View ist die Liste links dauerhaft sichtbar -> kein
  // Zurück-Button nötig.
  hideBackButton?: boolean;
}

const EventDetailView: React.FC<EventDetailViewProps> = ({ eventId, onBack, hideBackButton }) => {
  const pageRef = useRef<HTMLElement>(null);
  const slidingRefs = useRef<Map<number, HTMLIonItemSlidingElement>>(new Map());
  const { setSuccess, setError, isOnline } = useApp();
  const router = useIonRouter();
  const { triggerRefresh } = useLiveUpdate();
  const [presentActionSheet] = useIonActionSheet();
  const [presentAlert] = useIonAlert();

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [unregistrations, setUnregistrations] = useState<Unregistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventData, setEventData] = useState<Event | null>(null);
  const [eventMaterials, setEventMaterials] = useState<any[]>([]);
  const [presentingElement, setPresentingElement] = useState<HTMLElement | null>(null);

  // Material Detail Modal (wie Teamer)
  const materialIdRef = useRef<number | null>(null);
  const [presentMaterialModal, dismissMaterialModal] = useIonModal(TeamerMaterialDetailPage, {
    get materialId() { return materialIdRef.current; },
    onClose: () => dismissMaterialModal()
  });

  // Event Modal mit useIonModal Hook
  // Haelt den "ungespeicherte Änderungen"-Stand des EventModals für canDismiss.
  const eventModalDirtyRef = useRef(false);

  const [presentEventModalHook, dismissEventModalHook] = useIonModal(EventModal, {
    event: eventData,
    onDirtyChange: (dirty: boolean) => { eventModalDirtyRef.current = dirty; },
    onClose: () => dismissEventModalHook(),
    onSuccess: () => {
      dismissEventModalHook();
      handleEditSuccess();
    },
    dismiss: () => dismissEventModalHook()
  });

  // Faengt JEDEN Schliess-Weg ab (Swipe, Backdrop): bei ungespeicherten
  // Änderungen erst nachfragen, sonst direkt schliessen lassen.
  const eventModalCanDismiss = async (): Promise<boolean> => {
    if (!eventModalDirtyRef.current) return true;
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
        // Fallback: schließt der Alert ohne Button, Promise nie hängen lassen.
        onDidDismiss: () => { if (!decided) resolve(false); }
      });
    });
  };

  // QR Display Modal
  const [presentQRDisplayModal, dismissQRDisplayModal] = useIonModal(QRDisplayModal, {
    eventId: eventId,
    eventName: eventData?.name || '',
    eventDate: eventData?.event_date || '',
    onClose: () => dismissQRDisplayModal()
  });

  // Participant Management Modal
  const [presentParticipantModalHook, dismissParticipantModalHook] = useIonModal(ParticipantManagementModal, {
    eventId: eventId,
    onClose: () => dismissParticipantModalHook(),
    onSuccess: () => {
      dismissParticipantModalHook();
      loadEventData();
    },
    dismiss: () => dismissParticipantModalHook()
  });

  // Teamer Modal (filterRole: 'teamer')
  const [presentTeamerModal, dismissTeamerModal] = useIonModal(ParticipantManagementModal, {
    eventId: eventId,
    onClose: () => dismissTeamerModal(),
    onSuccess: () => {
      dismissTeamerModal();
      loadEventData();
    },
    dismiss: () => dismissTeamerModal(),
    filterRole: 'teamer'
  });

  // Konfi Modal (filterRole: 'konfi')
  const [presentKonfiModal, dismissKonfiModal] = useIonModal(ParticipantManagementModal, {
    eventId: eventId,
    onClose: () => dismissKonfiModal(),
    onSuccess: () => {
      dismissKonfiModal();
      loadEventData();
    },
    dismiss: () => dismissKonfiModal(),
    filterRole: 'konfi'
  });

  useEffect(() => {
    loadEventData();
  }, [eventId]);

  useEffect(() => {
    setPresentingElement(pageRef.current);
  }, []);

  // Live-Ereignisse empfangen. Die Termin-Detailseite hoerte bisher auf nichts,
  // obwohl das Backend fuer Termine 32 Ereignisse sendet — darunter jeder
  // QR-Check-in (events.js): Der Zaehler auf dem offenen QR-Code stand still
  // 
  useLiveRefresh(['events', 'konfis'], useCallback(() => {
    loadEventData(true);
  }, [eventId]));

  const loadEventData = async (stillLaden = false) => {
    // stillLaden: bei Live-Ereignissen ohne Ladebalken nachladen, sonst
    // flackert die Teilnehmerliste bei jedem QR-Scan.
    if (!stillLaden) setLoading(true);
    try {
      const eventRes = await api.get(`/events/${eventId}`);
      setEventData(eventRes.data);
      setParticipants(eventRes.data.participants || []);
      setUnregistrations(eventRes.data.unregistrations || []);
      try {
        const matRes = await api.get(`/material/by-event/${eventId}`);
        setEventMaterials(matRes.data || []);
      } catch {
        setEventMaterials([]);
      }
    } catch (error) {
      setError('Fehler beim Laden der Event-Daten');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async (event: CustomEvent) => {
    await loadEventData();
    (event.target as HTMLIonRefresherElement).complete();
  };

  // Wert vom Backend, wie in der Leitungs-Liste (`admin/EventsView.tsx`).
  // Vorher rechnete das Detail selbst und wich in drei Faellen von der Liste
  // ab: ein Pflichttermin galt hier als 'open' statt 'mandatory', ein
  // abgesagter ebenfalls als 'open' (nur die Zeilen darueber fingen
  // 'cancelled' vorher ab), und ein ausgebuchter Termin MIT freier Warteliste
  // galt als 'closed', obwohl die Anmeldung auf die Warteliste offen ist.
  // Die Berechnung steht in `events.js:124-133`.
  const calculateRegistrationStatus = (event: Event): 'upcoming' | 'open' | 'closed' | 'cancelled' | 'mandatory' =>
    event.registration_status as 'upcoming' | 'open' | 'closed' | 'cancelled' | 'mandatory';

  const handleEditSuccess = () => { onBack(); };

  const getStatusColors = (): { primary: string; secondary: string } => {
    // Alle Status-Farben kommen aus globalen CSS-Token (--app-color-*).
    // Änderung der Domain-Farbe im CSS wirkt hier automatisch.
    const events = { primary: 'var(--app-color-events)', secondary: 'var(--app-color-events)' };
    const danger = { primary: 'var(--app-color-danger)', secondary: 'var(--app-color-danger)' };
    const konfirm = { primary: 'var(--app-color-konfis)', secondary: 'var(--app-color-konfis)' }; // Konfirmation = lila
    const info = { primary: 'var(--app-color-info)', secondary: 'var(--app-color-info)' };
    const past = { primary: '#6c757d', secondary: '#6c757d' };
    const waitlist = { primary: 'var(--app-color-bonus)', secondary: 'var(--app-color-bonus)' };
    const success = { primary: 'var(--app-color-success)', secondary: 'var(--app-color-success)' };
    const upcoming = { primary: 'var(--app-color-bonus)', secondary: 'var(--app-color-bonus)' };

    if (!eventData) return events;
    const isPastEvent = istVergangen(eventData);
    const isKonfirmationEvent = eventData.is_konfirmation;
    const isCancelledStatus = eventData.registration_status === 'cancelled' as string;
    const hasUnprocessedBookings = isPastEvent && eventData.registered_count > 0 &&
      participants.some(p => p.status === 'confirmed' && !p.attendance_status);

    if (isCancelledStatus) return danger;
    if (isKonfirmationEvent && !isPastEvent) return konfirm;
    if (hasUnprocessedBookings) return info;
    if (isPastEvent) return past;

    const regStatus = calculateRegistrationStatus(eventData);
    // Pflichttermine: Anmeldung entfaellt, die Farbe der Domain passt.
    if (regStatus === 'mandatory') return events;
    // Ausgebucht wird an der Kapazitaet erkannt, nicht am Status: das Backend
    // meldet bei freier Warteliste weiterhin 'open' (`events.js:129-131`).
    const istVoll = eventData.max_participants > 0
      && eventData.registered_count >= eventData.max_participants;
    if (istVoll && (eventData as any).waitlist_enabled) return waitlist;
    if (istVoll) return danger;
    if (regStatus === 'open') return success;
    if (regStatus === 'upcoming') return upcoming;
    return events;
  };

  const getStatusText = () => {
    if (!eventData) return 'Event';
    const isPastEvent = istVergangen(eventData);
    const isKonfirmationEvent = eventData.is_konfirmation;
    const isCancelledStatus = eventData.registration_status === 'cancelled' as string;
    const hasUnprocessedBookings = isPastEvent && eventData.registered_count > 0 &&
      participants.some(p => p.status === 'confirmed' && !p.attendance_status);

    if (isCancelledStatus) return 'Abgesagt';
    if (isKonfirmationEvent && !isPastEvent) return 'Konfirmation';
    if (hasUnprocessedBookings) return 'Verbuchen';
    if (isPastEvent && !hasUnprocessedBookings) return 'Verbucht';

    const regStatus = calculateRegistrationStatus(eventData);
    if (regStatus === 'mandatory') return 'Pflichttermin';
    const istVoll = eventData.max_participants > 0
      && eventData.registered_count >= eventData.max_participants;
    if (istVoll && (eventData as any).waitlist_enabled) return 'Warteliste';
    if (istVoll) return 'Ausgebucht';
    if (regStatus === 'open') return 'Offen';
    if (regStatus === 'upcoming') return 'Bald';
    return 'Geschlossen';
  };

  const handleAttendanceUpdate = async (participant: Participant, status: 'present' | 'absent') => {
    if (!isOnline) return;
    setParticipants(prev => prev.map(p =>
      p.id === participant.id ? { ...p, attendance_status: status } : p
    ));
    try {
      const response = await api.put(`/events/${eventId}/participants/${participant.id}/attendance`, {
        attendance_status: status
      });
      triggerRefresh('events');
    } catch (error) {
      setParticipants(prev => prev.map(p =>
        p.id === participant.id ? { ...p, attendance_status: participant.attendance_status } : p
      ));
      setError('Fehler beim Aktualisieren der Anwesenheit');
    }
  };

  const showAttendanceActionSheet = (participant: Participant) => {
    if (!isOnline) return;
    const buttons: any[] = [];
    if (participant.attendance_status !== 'present') {
      buttons.push({ text: 'Anwesend', icon: checkmarkCircle, handler: () => handleAttendanceUpdate(participant, 'present') });
    }
    if (participant.attendance_status !== 'absent') {
      buttons.push({ text: 'Abwesend', icon: closeCircle, handler: () => handleAttendanceUpdate(participant, 'absent') });
    }
    buttons.push({ text: 'Abbrechen', role: 'cancel' });
    presentActionSheet({ header: participant.participant_name, subHeader: 'Anwesenheit verwalten', buttons });
  };

  const showWaitlistActionSheet = (participant: Participant) => {
    if (!isOnline) return;
    presentActionSheet({
      header: participant.participant_name,
      subHeader: 'Warteliste verwalten',
      buttons: [
        { text: 'Bestätigen', icon: checkmark, handler: () => handlePromoteParticipant(participant) },
        { text: 'Entfernen', icon: trash, role: 'destructive', handler: () => handleRemoveParticipant(participant) },
        { text: 'Abbrechen', role: 'cancel' }
      ]
    });
  };

  const handlePromoteParticipant = async (participant: Participant) => {
    try {
      await api.put(`/events/${eventId}/participants/${participant.id}/status`, { status: 'confirmed' });
      await loadEventData();
      triggerRefresh('events');
    } catch (error) {
 console.error('Promote participant error:', error);
      setError('Fehler beim Bestätigen des Teilnehmers');
    }
  };

  const handleConfirmAllAttendance = async (
    unprocessedCount: number,
    waitlistCount: number,
    rolle: 'konfi' | 'teamer' = 'konfi'
  ) => {
    if (!isOnline) return;
    const waitlistHint = waitlistCount > 0
      ? ` Die Warteliste (${waitlistCount}) bleibt unberührt.`
      : '';
    const wen = rolle === 'teamer' ? 'Teamer:in(nen)' : 'Teilnehmer:in(nen)';
    // Punkte gibt es nur bei Konfis -- das gehoert in die Rueckfrage, sonst
    // erwartet die Leitung bei Teamer:innen eine Punktevergabe, die ausbleibt.
    const punkteHinweis = rolle === 'teamer'
      ? ' Teamer:innen bekommen dabei keine Punkte.'
      : ' (inkl. Punktevergabe)';
    presentAlert({
      header: 'Alle bestätigen?',
      message: `${unprocessedCount} angemeldete ${wen} werden als anwesend verbucht${punkteHinweis}. Bereits Verbuchte bleiben unverändert.${waitlistHint}`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Alle bestätigen',
          handler: async () => {
            try {
              const res = await api.put(`/events/${eventId}/participants/attendance-all`, { rolle });
              await loadEventData();
              triggerRefresh('events');
              setSuccess(res.data?.message || 'Teilnahmen verbucht');
            } catch (error) {
              console.error('Attendance-all error:', error);
              setError('Fehler beim Verbuchen der Teilnahmen');
            }
          }
        }
      ]
    });
  };

  const demoteParticipant = async (participant: Participant) => {
    try {
      await api.put(`/events/${eventId}/participants/${participant.id}/status`, { status: 'waitlist' });
      const slidingItem = slidingRefs.current.get(participant.id);
      if (slidingItem) await slidingItem.close();
      await loadEventData();
      triggerRefresh('events');
    } catch (error: any) {
      console.error('Demote participant error:', error);
      setError(error.response?.data?.error || 'Fehler beim Verschieben auf Warteliste');
    }
  };

  // Rueckfrage vor dem Verschieben auf die Warteliste: ausgelöst wird das per
  // Wisch-Geste, ein Fehlwisch hätte sonst still eine Anmeldung zurueckgestuft
  // Das Absagen des Events fragt hier laengst nach.
  const handleDemoteParticipant = (participant: Participant) => {
    presentAlert({
      header: 'Auf die Warteliste setzen?',
      message: `${participant.participant_name || 'Diese Person'} verliert den festen Platz und rückt auf die Warteliste.`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel', handler: () => { slidingRefs.current.get(participant.id)?.close(); } },
        { text: 'Auf Warteliste', handler: () => { demoteParticipant(participant); } }
      ]
    });
  };

  const removeParticipant = async (participant: Participant) => {
    try {
      await api.delete(`/events/${eventId}/bookings/${participant.id}`);
      const slidingItem = slidingRefs.current.get(participant.id);
      if (slidingItem) await slidingItem.close();
      await loadEventData();
      triggerRefresh('events');
    } catch (error: any) {
      console.error('Delete participant error:', error);
      setError(error.response?.data?.error || 'Fehler beim Entfernen des Teilnehmers');
    }
  };

  // Ebenfalls per Wisch-Geste erreichbar und nicht umkehrbar -> Rueckfrage.
  const handleRemoveParticipant = (participant: Participant) => {
    if (!isOnline) return;
    presentAlert({
      header: 'Anmeldung entfernen?',
      message: `${participant.participant_name || 'Diese Person'} wird von diesem Event abgemeldet. Ein frei werdender Platz geht an die Warteliste.`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel', handler: () => { slidingRefs.current.get(participant.id)?.close(); } },
        { text: 'Entfernen', role: 'destructive', handler: () => { removeParticipant(participant); } }
      ]
    });
  };

  const isCancelled = eventData?.cancelled || eventData?.registration_status === ('cancelled' as string);

  const handleCancelEvent = async () => {
    if (!isOnline || !eventData) return;
    const eventDate = new Date(eventData.event_date).toLocaleDateString('de-DE', {
      weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
    });
    const konfiCount = participants.filter(p => p.role_name !== 'teamer').length;
    presentActionSheet({
      header: `"${eventData.name}" absagen?`,
      subHeader: `${eventDate} | ${konfiCount} Konfis angemeldet`,
      buttons: [
        {
          text: 'Event absagen',
          role: 'destructive',
          icon: ban,
          handler: async () => {
            try {
              await api.put(`/events/${eventData.id}/cancel`, {
                notification_message: 'Das Event wurde leider abgesagt.'
              });
              setSuccess('Event wurde abgesagt');
              onBack();
            } catch (error: any) {
              setError(error.response?.data?.error || 'Fehler beim Absagen');
            }
          }
        },
        { text: 'Abbrechen', role: 'cancel' }
      ]
    });
  };

  const handleCreateEventChat = async () => {
    if (!isOnline) return;
    try {
      const res = await api.post(`/events/${eventData?.id}/chat`);
      setSuccess('Chat erstellt');
      router.push(`/admin/chat/room/${res.data.chat_room_id}`, 'root');
    } catch (error: any) {
      setError(error.response?.data?.error || 'Fehler beim Erstellen des Chats');
    }
  };

  const handleNavigateToChat = () => {
    if (!eventData?.chat_room_id) return;
    // routerDirection 'root' verhindert schwarzen Screen beim Tab-Wechsel
    router.push(`/admin/chat/room/${eventData.chat_room_id}`, 'root');
  };

  const handleChatButtonClick = () => {
    if (eventData?.chat_room_id) {
      handleNavigateToChat();
    } else {
      presentAlert({
        header: 'Chat erstellen?',
        message: `Möchtest du einen Chat für "${eventData?.name}" erstellen?`,
        buttons: [
          { text: 'Abbrechen', role: 'cancel' },
          { text: 'Erstellen', handler: () => handleCreateEventChat() }
        ]
      });
    }
  };

  const handleMaterialClick = (materialId: number) => {
    materialIdRef.current = materialId;
    presentMaterialModal({ presentingElement: presentingElement || pageRef.current || undefined });
  };

  // Helper: Einzelnen Teilnehmer rendern
  const renderParticipant = (participant: Participant) => {
    const isWaitlist = participant.status === 'waitlist';
    const isOptedOut = participant.status === 'opted_out';
    const listItemClass = isOptedOut ? 'app-list-item--danger' :
                          participant.attendance_status === 'present' ? 'app-list-item--success' :
                          participant.attendance_status === 'absent' ? 'app-list-item--danger' :
                          isWaitlist ? 'app-list-item--warning' : 'app-list-item--info';
    const iconCircleClass = isOptedOut ? 'app-icon-circle--danger' :
                            participant.attendance_status === 'present' ? 'app-icon-circle--success' :
                            participant.attendance_status === 'absent' ? 'app-icon-circle--danger' :
                            isWaitlist ? 'app-icon-circle--warning' : 'app-icon-circle--info';
    const statusIcon = isOptedOut ? closeCircle :
                       participant.attendance_status === 'present' ? checkmarkCircle :
                       participant.attendance_status === 'absent' ? closeCircle : people;
    const statusText = isOptedOut ? 'Abgemeldet' :
                       participant.attendance_status === 'present' ? 'Anwesend' :
                       participant.attendance_status === 'absent' ? 'Abwesend' :
                       isWaitlist ? 'Warteliste' : 'Gebucht';
    const cornerBadgeClass = isOptedOut ? 'app-corner-badge--danger' :
                             participant.attendance_status === 'present' ? 'app-corner-badge--success' :
                             participant.attendance_status === 'absent' ? 'app-corner-badge--danger' :
                             isWaitlist ? 'app-corner-badge--warning' : 'app-corner-badge--info';

    return (
      <IonItemSliding
        key={participant.id}
        ref={(el) => {
          if (el) { slidingRefs.current.set(participant.id, el); }
          else { slidingRefs.current.delete(participant.id); }
        }}
        className="app-event-detail__sliding-item"
      >
        <IonItem
          className="app-item-transparent"
          button detail={false} lines="none"
          onClick={() => {
            if (participant.status === 'confirmed') showAttendanceActionSheet(participant);
            else if (participant.status === 'waitlist') showWaitlistActionSheet(participant);
          }}
        >
          <div className={`app-list-item ${listItemClass} app-event-detail__list-item-flush`}>
            <div className="app-corner-badges">
              <div
                className={`app-corner-badge ${cornerBadgeClass}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                title={statusText}
              >
                <IonIcon icon={getStatusIcon(statusText) || people} style={{ color: '#fff', fontSize: '0.85rem' }} />
              </div>
            </div>
            <div className="app-list-item__row">
              <div className="app-list-item__main">
                <div className={`app-icon-circle ${iconCircleClass}`}>
                  <IonIcon icon={statusIcon} />
                </div>
                <div className="app-list-item__content">
                  <div className="app-list-item__title app-list-item__title--badge-space-lg">
                    {participant.participant_name}
                  </div>
                  <div className="app-list-item__subtitle">
                    {participant.jahrgang_name && <>{participant.jahrgang_name}</>}
                    {participant.timeslot_start_time && participant.timeslot_end_time && (
                      <>{participant.jahrgang_name ? ' | ' : ''}{formatTime(participant.timeslot_start_time)} - {formatTime(participant.timeslot_end_time)}</>
                    )}
                  </div>
                  {isOptedOut && participant.opt_out_reason && (
                    <div style={{ color: '#666', fontSize: '0.8rem', marginTop: '2px' }}>
                      {participant.opt_out_reason}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </IonItem>
        {(participant.role_name === 'teamer' || !eventData?.mandatory) && (
        <IonItemOptions className="app-swipe-actions" side="end">
          {participant.role_name !== 'teamer' && participant.status === 'confirmed' && (
            <IonItemOption className="app-swipe-action" onClick={() => { closeOpenSlidingItems(); handleDemoteParticipant(participant); }} aria-label="Auf Warteliste setzen">
              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--warning">
                <IonIcon icon={returnUpBack} />
              </div>
            </IonItemOption>
          )}
          <IonItemOption className="app-swipe-action" onClick={() => { closeOpenSlidingItems(); handleRemoveParticipant(participant); }} aria-label="Teilnahme entfernen">
            <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
              <IonIcon icon={trash} />
            </div>
          </IonItemOption>
        </IonItemOptions>
        )}
      </IonItemSliding>
    );
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          {!hideBackButton && (
            <IonButtons slot="start">
              <IonButton aria-label="Zurück" onClick={onBack}><IonIcon icon={arrowBack} /></IonButton>
            </IonButtons>
          )}
          <IonTitle>{eventData?.name || 'Event Details'}</IonTitle>
          <IonButtons slot="end">
            <IonButton aria-label="Event-Chat öffnen" onClick={handleChatButtonClick}>
              <IonIcon icon={chatbubbleOutline} />
            </IonButton>
            <IonButton aria-label="QR-Code anzeigen" onClick={() => presentQRDisplayModal({ presentingElement: presentingElement || undefined })}>
              <IonIcon icon={qrCodeOutline} />
            </IonButton>
            <IonButton aria-label="Event bearbeiten" onClick={() => presentEventModalHook({ presentingElement: presentingElement || undefined, canDismiss: eventModalCanDismiss, backdropDismiss: false })}>
              <IonIcon icon={createOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">{eventData?.name || 'Event Details'}</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={handleRefresh} onIonPull={triggerPullHaptic}>
          <IonRefresherContent refreshingSpinner="crescent" />
        </IonRefresher>

        {/* Event Header */}
        <SectionHeader
          title={eventData?.name || 'Event'}
          subtitle={getStatusText()}
          icon={calendar}
          colors={getStatusColors()}
          stats={(() => {
            const konfiOnly = participants.filter(p => p.role_name !== 'teamer');
            const teamerOnly = participants.filter(p => p.role_name === 'teamer');
            const teamerConfirmedCount = teamerOnly.filter(p => p.status === 'confirmed').length;
            const teamerWaitlistCount = teamerOnly.filter(p => p.status === 'waitlist').length;
            // Teamer-Kontingent gilt, sobald das Event Teamer zulaesst \u2014 NICHT
            // erst, wenn sich schon jemand angemeldet hat (sonst zeigt ein
            // frisches "Nur Teamer"-Event Konfi-Zahlen).
            const teamerMax = (eventData?.teamer_max_participants || 0) > 0
              ? eventData?.teamer_max_participants : '\u221E';
            const presentCount = konfiOnly.filter(p => p.attendance_status === 'present').length;
            const konfiConfirmed = konfiOnly.filter(p => p.status === 'confirmed').length;
            const konfiOptedOut = konfiOnly.filter(p => p.status === 'opted_out').length;

            // "Nur Teamer:innen": es gibt gar keine Konfi-Teilnahme -> die
            // Kacheln müssen komplett vom Team erzaehlen (vorher stand hier
            // "0 von 0 TN" und die Teamer tauchten nirgends auf).
            if (eventData?.teamer_only) {
              const teamerPresent = teamerOnly.filter(p => p.attendance_status === 'present').length;
              return [
                { value: teamerConfirmedCount, label: `von ${teamerMax} Team` },
                { value: teamerPresent, label: 'Anwesend' },
                { value: teamerWaitlistCount, label: 'Warteliste' }
              ];
            }

            const hasTeamer = !!eventData?.teamer_needed;
            if (eventData?.mandatory) {
              return [
                { value: konfiConfirmed, label: `von ${konfiConfirmed + konfiOptedOut} TN` },
                { value: presentCount, label: 'Anwesend' },
                hasTeamer
                  ? { value: teamerConfirmedCount, label: 'Team' }
                  : { value: konfiOptedOut, label: 'Abgemeldet' }
              ];
            }
            const maxP = (eventData?.max_participants || 0) > 0 ? eventData?.max_participants : '\u221E';
            return [
              { value: konfiConfirmed, label: `von ${maxP} TN` },
              // Ohne Team-Kontingent zeigt die mittlere Kachel die Punkte —
              // aber nur, wenn es welche gibt. Bei Pflichtterminen und
              // Konfirmationen stand hier sonst "Punkte 0"; Konfi- und
              // Teamer-Ansicht blenden ihre Punkte-Kachel dort aus. Statt der
              // Null die Abgemeldeten, wie bei vergangenen Terminen.
              hasTeamer
                ? { value: teamerConfirmedCount, label: `von ${teamerMax} Team` }
                : ((eventData?.points || 0) > 0
                    ? { value: eventData?.points || 0, label: 'Punkte' }
                    : { value: konfiOptedOut, label: 'Abgemeldet' }),
              { value: konfiOnly.filter(p => p.status === 'waitlist').length, label: 'Warteliste' }
            ];
          })()}
        />

        {/* Event Details */}
        {eventData && (
          <EventInfoCard
            eventData={eventData as any}
            participants={participants}
            formatDate={formatDate}
            formatTime={formatTime}
          />
        )}

        {/* Beschreibung */}
        {eventData?.description && (
          <DescriptionSection description={eventData.description} />
        )}

        {/* Timeslots mit Teilnehmern */}
        {eventData?.has_timeslots && eventData?.timeslots && eventData.timeslots.length > 0 && (
          <TimeslotsSection
            timeslots={eventData.timeslots}
            participants={participants}
            eventMandatory={eventData?.mandatory}
            formatTime={formatTime}
            showAttendanceActionSheet={showAttendanceActionSheet}
            handleDemoteParticipant={handleDemoteParticipant}
            handleRemoveParticipant={handleRemoveParticipant}
            showWaitlistActionSheet={showWaitlistActionSheet}
          />
        )}

        {/* Series Events */}
        {eventData?.is_series && eventData?.series_events && eventData.series_events.length > 0 && (
          <SeriesEventsSection
            seriesEvents={eventData.series_events as any}
            formatDate={formatDate}
            formatTime={formatTime}
            onNavigate={(eventId) => router.push(`/admin/events/${eventId}`, 'forward')}
          />
        )}

        {/* Participants List */}
        {(() => {
          const konfiParticipants = participants.filter(p => p.role_name !== 'teamer');
          const teamerParticipants = participants.filter(p => p.role_name === 'teamer');
          const confirmedParticipants = konfiParticipants.filter(p => p.status === 'confirmed');
          const allWaitlistParticipants = konfiParticipants.filter(p => p.status === 'waitlist');
          const unassignedParticipants = eventData?.has_timeslots
            ? confirmedParticipants.filter(p => !(p as any).timeslot_id && !p.timeslot_start_time) : [];
          // Bei Timeslot-Events werden slot-zugeordnete Wartelistler bereits in der
          // TimeslotsSection unter ihrem Slot angezeigt -> hier nur die OHNE Slot,
          // damit sie nicht doppelt erscheinen.
          const waitlistParticipants = eventData?.has_timeslots
            ? allWaitlistParticipants.filter(p => !(p as any).timeslot_id && !p.timeslot_start_time)
            : allWaitlistParticipants;
          const displayParticipants = eventData?.has_timeslots
            ? [...unassignedParticipants, ...waitlistParticipants] : konfiParticipants;
          const hasWaitlist = (eventData as any)?.waitlist_enabled && waitlistParticipants.length > 0;
          const hasUnassigned = unassignedParticipants.length > 0;

          // Noch niemand angemeldet: nur die Hinzufuegen-Buttons zeigen — aber
          // die passenden. Bei "Nur Teamer:innen" gibt es keine Konfi-Teilnahme
          // (vorher stand hier ausschliesslich "Konfi hinzufügen", und die
          // Teamer-Sektion darunter wurde durch den Return nie erreicht).
          if (displayParticipants.length === 0 && teamerParticipants.length === 0) {
            const teamerErlaubt = !!(eventData?.teamer_needed || eventData?.teamer_only);
            return (
              <IonList className="app-section-inset" inset={true}>
                <IonCard className="app-card">
                  <IonCardContent className="app-card-content">
                    {!eventData?.teamer_only && (
                      <IonButton expand="block" fill="outline"
                        onClick={() => presentKonfiModal({ presentingElement: presentingElement || undefined })}>
                        <IonIcon icon={personAdd} className="app-event-detail__icon-gap" />
                        Konfi hinzufügen
                      </IonButton>
                    )}
                    {teamerErlaubt && (
                      <IonButton expand="block" fill="outline"
                        onClick={() => presentTeamerModal({ presentingElement: presentingElement || undefined })}>
                        <IonIcon icon={personAdd} className="app-event-detail__icon-gap" />
                        Teamer:in hinzufügen
                      </IonButton>
                    )}
                  </IonCardContent>
                </IonCard>
              </IonList>
            );
          }

          let konfiHeaderText = '';
          if (eventData?.has_timeslots) {
            if (hasUnassigned && hasWaitlist) konfiHeaderText = `Nicht zugeordnet (${unassignedParticipants.length}) + Warteliste (${waitlistParticipants.length})`;
            else if (hasUnassigned) konfiHeaderText = `Nicht zugeordnet (${unassignedParticipants.length})`;
            else konfiHeaderText = `Warteliste (${waitlistParticipants.length})`;
          } else if (eventData?.mandatory) {
            konfiHeaderText = `Konfis (${confirmedParticipants.length}/${konfiParticipants.length})`;
          } else {
            konfiHeaderText = `Konfis (${confirmedParticipants.length}${waitlistParticipants.length > 0 ? ` + ${waitlistParticipants.length}` : ''})`;
          }

          const teamerConfirmed = teamerParticipants.filter(p => p.status === 'confirmed');
          const teamerWaitlist = teamerParticipants.filter(p => p.status === 'waitlist');
          const teamerAbgesagt = teamerParticipants.filter(p => p.status === 'opted_out');
          const teamerHeaderText = `Teamer:innen (${teamerConfirmed.length}`
            + (teamerWaitlist.length > 0 ? ` + ${teamerWaitlist.length}` : '')
            + (teamerAbgesagt.length > 0 ? `, ${teamerAbgesagt.length} abgesagt` : '')
            + ')';

          // Bei "Nur Teamer:innen" gibt es keine Konfi-Teilnahme — dann darf
          // weder die Konfi-Liste noch ein "Konfi hinzufügen" erscheinen.
          const isTeamerOnlyEvent = !!eventData?.teamer_only;

          return (
            <>
              {!isTeamerOnlyEvent && displayParticipants.length > 0 && (
                <IonList className="app-section-inset" inset={true}>
                  <IonListHeader>
                    <div className="app-section-icon app-section-icon--events"><IonIcon icon={people} /></div>
                    <IonLabel>{konfiHeaderText}</IonLabel>
                    {(() => {
                      // Button nur, wenn es unverbuchte Angemeldete gibt (Konfis mit
                      // Status bestätigt, aber ohne Anwesenheits-Status).
                      const unprocessed = confirmedParticipants.filter(p => !p.attendance_status).length;
                      if (unprocessed === 0) return null;
                      return (
                        <IonButton fill="clear" size="small" disabled={!isOnline}
                          onClick={() => handleConfirmAllAttendance(unprocessed, waitlistParticipants.length)}>
                          <IonIcon icon={checkmark} slot="start" />
                          Alle bestätigen ({unprocessed})
                        </IonButton>
                      );
                    })()}
                  </IonListHeader>
                  <IonCard className="app-card">
                    <IonCardContent style={{ padding: displayParticipants.length === 0 ? '16px' : '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {displayParticipants.map(renderParticipant)}
                      </div>
                      <div className="app-event-detail__add-button-wrapper">
                        <IonButton expand="block" fill="outline"
                          onClick={() => presentKonfiModal({ presentingElement: presentingElement || undefined })}>
                          <IonIcon icon={personAdd} className="app-event-detail__icon-gap" />
                          Konfi hinzufügen
                        </IonButton>
                      </div>
                    </IonCardContent>
                  </IonCard>
                </IonList>
              )}
              {(teamerParticipants.length > 0 || eventData?.teamer_needed || eventData?.teamer_only) && (
                <IonList className="app-section-inset" inset={true}>
                  <IonListHeader>
                    <div className="app-section-icon app-section-icon--events"><IonIcon icon={people} /></div>
                    <IonLabel>{teamerHeaderText}</IonLabel>
                    {(() => {
                      // Gleiches Muster wie bei den Konfis oben, aber mit
                      // rolle='teamer': nur angemeldete Teamer:innen ohne
                      // Anwesenheits-Status. Ohne diesen Knopf musste die
                      // Leitung sie einzeln verbuchen, und der Termin blieb
                      // im "Verbuchen"-Reiter stehen -- pending_bookings_count
                      // zaehlt beide Rollen (events.js:270-274).
                      const unprocessedTeamer = teamerConfirmed.filter(p => !p.attendance_status).length;
                      if (unprocessedTeamer === 0) return null;
                      return (
                        <IonButton fill="clear" size="small" disabled={!isOnline}
                          onClick={() => handleConfirmAllAttendance(unprocessedTeamer, teamerWaitlist.length, 'teamer')}>
                          <IonIcon icon={checkmark} slot="start" />
                          Alle bestätigen ({unprocessedTeamer})
                        </IonButton>
                      );
                    })()}
                  </IonListHeader>
                  <IonCard className="app-card">
                    <IonCardContent style={{ padding: teamerParticipants.length === 0 ? '16px' : '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {teamerParticipants.map(renderParticipant)}
                      </div>
                      <div className="app-event-detail__add-button-wrapper">
                        <IonButton expand="block" fill="outline"
                          onClick={() => presentTeamerModal({ presentingElement: presentingElement || undefined })}>
                          <IonIcon icon={personAdd} className="app-event-detail__icon-gap" />
                          Teamer:in hinzufügen
                        </IonButton>
                      </div>
                    </IonCardContent>
                  </IonCard>
                </IonList>
              )}
              {!isTeamerOnlyEvent && displayParticipants.length === 0 && teamerParticipants.length > 0 && (
                <IonList className="app-section-inset" inset={true}>
                  <IonCard className="app-card">
                    <IonCardContent className="app-card-content">
                      <IonButton expand="block" fill="outline"
                        onClick={() => presentKonfiModal({ presentingElement: presentingElement || undefined })}>
                        <IonIcon icon={personAdd} className="app-event-detail__icon-gap" />
                        Konfi hinzufügen
                      </IonButton>
                    </IonCardContent>
                  </IonCard>
                </IonList>
              )}
            </>
          );
        })()}

        {/* Abmeldungen */}
        {unregistrations.length > 0 && (
          <UnregistrationsSection unregistrations={unregistrations} />
        )}

        {/* Material */}
        {eventMaterials.length > 0 && (
          <EventMaterialSection
            eventMaterials={eventMaterials}
            onMaterialClick={handleMaterialClick}
          />
        )}

        {/* Event absagen */}
        {eventData && (
          <EventActionsSection
            eventData={eventData as any}
            isCancelled={!!isCancelled}
            isOnline={isOnline}
            handleCancelEvent={handleCancelEvent}
          />
        )}

      </IonContent>
    </IonPage>
  );
};

export default EventDetailView;
