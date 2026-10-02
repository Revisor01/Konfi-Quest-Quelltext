import { fehlerDaten, fehlerStatus, fehlerText } from '../../../utils/fehler';
import { absageZuruecknehmenFragen } from '../../../utils/absageZuruecknehmen';
import { darfTermineVerwalten } from '../../../utils/terminRechte';
import { kopiereTermin } from '../../../utils/terminVorbelegung';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAppLocation } from '../../../navigation/useAppLocation';
import { IonPage, IonContent, IonRefresher, IonRefresherContent, IonButton, IonIcon, IonSegment, IonSegmentButton, IonLabel, useIonModal, useIonActionSheet, useIonAlert, useIonRouter } from '@ionic/react';
import type { ActionSheetButton } from '@ionic/react';
import AppKopfzeile, { AppKopfzeileGross } from '../../shared/AppKopfzeile';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren

// useLocation für die Auswertung von ?segment=... (React Router v5 API)
import { ICON_HINZUFUEGEN_GEFUELLT } from '../../shared/icons';
import { useApp } from '../../../contexts/AppContext';
import { offlineBlockiert } from '../../../utils/offlineAktion';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh, useLiveUpdate } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import EventsView from '../EventsView';
import ActivityRequestsView from '../ActivityRequestsView';
import LoadingSpinner from '../../common/LoadingSpinner';
import EventModal from '../modals/EventModal';
import ActivityRequestModal from '../modals/ActivityRequestModal';
import TerminAbsagenModal from '../modals/TerminAbsagenModal';
import { Event, Timeslot } from '../../../types/event';
import { triggerPullHaptic } from '../../../utils/haptics';
import { aktuelleTermine, zuVerbuchendeTermine, vergangeneTermine, istAbgesagt } from '../../shared';
import { datumLang } from '../../../utils/dateUtils';
import { useBadge } from '../../../contexts/BadgeContext';
import SegmentZahl from '../../shared/SegmentZahl';

/**
 * 409-Antwort beim Löschen eines Termins (events/verwaltung.js).
 * Nennt konkret, was beim endgueltigen Löschen verloren geht — die Zahlen
 * stehen in der zweiten Rueckfrage.
 */
interface EventLoeschKonflikt {
  error?: string;
  error_code?: string;
  booking_count?: number;
  message_count?: number;
  points_count?: number;
  points_total?: number;
  [feld: string]: unknown;
}

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

interface AdminEventsPageProps {
  // Im iPad-Split-View setzt der Master die Auswahl als State statt zu
  // navigieren. Fehlt der Callback (iPhone/Portrait), wird wie bisher per
  // Route auf die Event-Detail-Seite navigiert.
  onSelectEvent?: (eventId: number) => void;
  selectedEventId?: number | null;
}

const AdminEventsPage: React.FC<AdminEventsPageProps> = ({ onSelectEvent, selectedEventId }) => {
  const { user, setSuccess, setError, isOnline } = useApp();
  const { pendingEventsCount, pendingRequestsCount } = useBadge();
  const { pageRef, presentingElement } = useModalPage('admin-events');
  const router = useIonRouter();
  const routerLocation = useAppLocation();
  const { triggerRefresh } = useLiveUpdate();
  const [presentActionSheet] = useIonActionSheet();
  const [presentAlert] = useIonAlert();

  // Oberste Segment-Ebene: Events oder Aktivitäten.
  const [mainSegment, setMainSegment] = useState<'events' | 'antraege'>('events');

  // Query-Parameter ?segment=antraege auswerten — kommt vom Redirect der alten
  // Route /admin/requests und damit aus bestehenden Deep-Links.
  useEffect(() => {
    const segment = new URLSearchParams(routerLocation.search).get('segment');
    if (segment === 'antraege') {
      setMainSegment('antraege');
    } else if (segment === 'events') {
      setMainSegment('events');
    }
  }, [routerLocation.search]);

  // Offline-Query: Events
  const { data: allEventsRaw, loading: eventsLoading, refresh: refreshEvents, refreshLive: refreshEventsLive } = useOfflineQuery<Event[]>(
    'admin:events:' + user?.organization_id,
    async () => { const res = await api.get('/events'); return res.data; },
    { ttl: CACHE_TTL.EVENTS }
  );
  const events = allEventsRaw?.filter((e: Event) => e.registration_status !== 'cancelled') || [];

  // Offline-Query: Abgesagte Events
  const { data: cancelledEvents, refresh: refreshCancelled, refreshLive: refreshCancelledLive } = useOfflineQuery<Event[]>(
    'admin:events-cancelled:' + user?.organization_id,
    async () => { const res = await api.get('/events/cancelled'); return res.data; },
    { ttl: CACHE_TTL.SETTINGS }
  );

  // Offline-Query: Jahrgänge
  const { data: jahrgaenge } = useOfflineQuery<Array<{id: number; name: string}>>(
    'admin:jahrgaenge:' + user?.organization_id,
    async () => { const res = await api.get('/admin/jahrgaenge'); return res.data; },
    { ttl: CACHE_TTL.STAMMDATEN }
  );

  const [ohneJahrgang, setOhneJahrgang] = useState(false);

  // Offline-Query: Aktivitäten (aus AdminActivityRequestsPage uebernommen)
  const { data: requests, loading: requestsLoading, refresh: refreshRequests, refreshLive: refreshRequestsLive } = useOfflineQuery<ActivityRequest[]>(
    'admin:requests:' + user?.organization_id,
    async () => {
      const res = await api.get('/admin/activities/requests');
      setOhneJahrgang(res.headers?.['x-kein-jahrgang-zugewiesen'] === 'true');
      return res.data;
    },
    { ttl: CACHE_TTL.REQUESTS }
  );

  // State
  const loading = eventsLoading;
  const [activeTab, setActiveTab] = useState<'aktuell' | 'verbuchen' | 'vergangen'>('aktuell');
  const [selectedJahrgang, setSelectedJahrgang] = useState<number | null>(null);
  const [searchText, setSearchText] = useState('');

  const [editEvent, setEditEvent] = useState<Event | null>(null);
  // Zeitfenster einer Kopie. Das Modal kann sie bei einer Kopie nicht selbst
  // nachladen -- die hat keine id (siehe kopiereTermin).
  const [kopierteTimeslots, setKopierteTimeslots] = useState<Timeslot[]>([]);

  // --- Aktivitäten-State ---
  const [modalRequestId, setModalRequestId] = useState<number | null>(null);

  // Modal mit useIonModal Hook - löst Tab-Navigation Problem
  // Haelt den "ungespeicherte Änderungen"-Stand des EventModals, damit canDismiss
  // auch Swipe-/Backdrop-Schliessen abfangen und nachfragen kann (nicht nur der X-Button).
  const eventModalDirtyRef = useRef(false);

  const [presentEventModalHook, dismissEventModalHook] = useIonModal(EventModal, {
    event: editEvent,
    vorbelegteTimeslots: kopierteTimeslots,
    onDirtyChange: (dirty: boolean) => { eventModalDirtyRef.current = dirty; },
    onClose: () => dismissEventModalHook(),
    onSuccess: () => {
      dismissEventModalHook();
      refreshEvents();
      refreshCancelled();
    }
  });

  // ABSAGE-MODAL: Bis hierher war die Absage ein Action Sheet --
  // richtig, solange sie nur zu bestaetigen war. Mit dem freiwilligen Grund
  // (Migration 150) wird daraus eine Texteingabe, und die laeuft in dieser App
  // ueber ein Modal (dieselbe Linie wie bei AbmeldungNachtragenModal).
  //
  // Ref-Getter wie beim Abmelde-Modal: Welcher Termin gemeint ist, steht erst
  // beim Oeffnen fest, die Props werden aber schon beim Rendern deklariert.
  const absageTerminRef = useRef<Event | null>(null);
  const [presentAbsageModal, dismissAbsageModal] = useIonModal(TerminAbsagenModal, {
    get terminName() { return absageTerminRef.current?.name ?? ''; },
    get terminDatum() {
      const termin = absageTerminRef.current;
      if (!termin) return '';
      return datumLang(termin.event_date);
    },
    get konfiAnzahl() { return absageTerminRef.current?.registered_count || 0; },
    // Ein abgesagter Termin bedeutet: Grund bearbeiten, kein zweites Absagen.
    // Die Entscheidung faellt hier und nicht im Modal, weil hier steht,
    // welcher Termin gemeint ist.
    get modus() { return istAbgesagt(absageTerminRef.current) ? 'grund' as const : 'absagen' as const; },
    get grundVorgabe() { return absageTerminRef.current?.cancelled_reason ?? ''; },
    onSave: async (grund: string) => {
      const termin = absageTerminRef.current;
      if (!termin) return;
      if (istAbgesagt(termin)) {
        // Eigene Route (Migration 152): /cancel lehnt einen bereits abgesagten
        // Termin mit 400 ab und muss das fuer ausgelieferte App-Fassungen auch
        // weiterhin tun.
        await api.put(`/events/${termin.id}/absagegrund`, { cancelled_reason: grund });
        setSuccess(grund ? 'Absagegrund gespeichert' : 'Absagegrund entfernt');
      } else {
        await api.put(`/events/${termin.id}/cancel`, {
          // notification_message bleibt mitgeschickt: Die Route nimmt es
          // weiterhin entgegen, und es hier wegzulassen aendert nichts am
          // Verhalten — aber der Vertrag bleibt so unangetastet.
          notification_message: 'Das Event wurde leider abgesagt.',
          cancelled_reason: grund
        });
        setSuccess(`Event "${termin.name}" wurde abgesagt`);
      }
      await refreshEvents();
      await refreshCancelled();
    },
    dismiss: () => dismissAbsageModal()
  });

  const [presentRequestModalHook, dismissRequestModalHook] = useIonModal(ActivityRequestModal, {
    requestId: modalRequestId,
    onClose: () => {
      dismissRequestModalHook();
      setModalRequestId(null);
    },
    onSuccess: () => {
      dismissRequestModalHook();
      setModalRequestId(null);
      refreshRequests();
      // Genehmigen/Ablehnen ändert die Anzahl offener Anträge -> 'requests'
      // triggern, damit das Events-Tab-Badge (BadgeContext) sofort aktualisiert
      // statt erst beim 30s-Poll.
      triggerRefresh('requests');
      // Genehmigen/Ablehnen ändert Konfi-Punkte -> Admin-Konfi-Liste live
      // aktualisieren, damit man nicht manuell refreshen muss.
      triggerRefresh('konfis');
    }
  });

  // Faengt JEDEN Schliess-Weg ab (Swipe, Backdrop, programmatisch): bei
  // ungespeicherten Änderungen erst nachfragen, sonst direkt schliessen lassen.
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
        // Fallback: schließt der Alert ohne Button (z.B. Hardware-Back),
        // niemals das canDismiss-Promise hängen lassen -> als "nicht verwerfen".
        onDidDismiss: () => { if (!decided) resolve(false); }
      });
    });
  };

  // Memoized refresh function for live updates
  const refreshAllEvents = useCallback(() => {
    refreshEventsLive();
    refreshCancelledLive();
  }, [refreshEventsLive, refreshCancelledLive]);

  // Subscribe to live updates for events + requests
  useLiveRefresh('events', refreshAllEvents);
  useLiveRefresh('requests', refreshRequestsLive);

  const filterByJahrgang = (eventList: Event[]) => {
    if (!selectedJahrgang) return eventList;
    return eventList.filter(event => {
      if (!event.jahrgang_ids) return false;
      const ids = event.jahrgang_ids.split(',').map(id => parseInt(id.trim(), 10));
      return ids.includes(selectedJahrgang);
    });
  };

  // Die drei Reiter rechnen in shared/eventFormatting.ts — dort steht auch,
  // warum abgesagte Termine in "Aktuell" und "Vergangen" stehen, in
  // "Verbuchen" aber nicht.
  const getAktuellEvents = () => aktuelleTermine(events, cancelledEvents || []);
  const getVerbuchenEvents = () => zuVerbuchendeTermine(events);
  const getVergangenEvents = () => vergangeneTermine(events, cancelledEvents || []);

  const handleDeleteEvent = async (event: Event) => {
    if (offlineBlockiert(isOnline, setError)) return;
    // Check if this is part of a series
    if (event.is_series && event.series_id) {
      // Get other events in the series
      const allEvents = [...events, ...(cancelledEvents || [])];
      const seriesEvents = allEvents.filter(e =>
        e.series_id === event.series_id && e.id !== event.id
      );

      if (seriesEvents.length > 0) {
        // Dieser Termin + alle späteren der Serie (für "ab hier löschen", z.B. falsch
        // angelegte Serie oder Reihe, die früher endet)
        const followingEvents = [...seriesEvents, event].filter(e =>
          new Date(e.event_date).getTime() >= new Date(event.event_date).getTime()
        );

        // Show action sheet for series deletion
        const buttons: ActionSheetButton[] = [
          {
            text: 'Nur dieses Event löschen',
            icon: 'trash-outline',
            handler: () => deleteSingleEvent(event)
          }
        ];
        // Nur anbieten, wenn es nach diesem Termin noch weitere gibt und nicht
        // ohnehin die ganze Serie gemeint ist
        if (followingEvents.length > 1 && followingEvents.length < seriesEvents.length + 1) {
          buttons.push({
            text: `Dieses + alle folgenden löschen (${followingEvents.length} Events)`,
            icon: 'trash-outline',
            role: 'destructive',
            handler: () => deleteSeriesEvents(followingEvents, 'dieses und alle folgenden')
          });
        }
        buttons.push(
          {
            text: `Ganze Serie löschen (${seriesEvents.length + 1} Events)`,
            icon: 'warning-outline',
            role: 'destructive',
            handler: () => deleteSeriesEvents([...seriesEvents, event], 'die ganze Serie')
          },
          {
            text: 'Abbrechen',
            role: 'cancel'
          }
        );
        presentActionSheet({
          header: 'Event einer Serie löschen',
          subHeader: `"${event.name}" ist Teil einer Serie mit ${seriesEvents.length + 1} Events.`,
          buttons
        });
        return;
      }
    }

    // Normal single event deletion
    deleteSingleEvent(event);
  };

  // Baut aus der 409-Antwort des Backends die konkrete Verlustliste
  // (Anmeldungen, Chat-Nachrichten, vergebene Punkte).
  const buildVerlustText = (data: EventLoeschKonflikt | undefined): string => {
    const teile: string[] = [];
    const bookings = data?.booking_count || 0;
    const messages = data?.message_count || 0;
    const punkte = data?.points_total || 0;
    if (bookings > 0) teile.push(`${bookings} Anmeldung${bookings === 1 ? '' : 'en'} (alle Angemeldeten werden benachrichtigt)`);
    if (messages > 0) teile.push(`${messages} Chat-Nachricht${messages === 1 ? '' : 'en'} samt Dateien`);
    if (punkte > 0) teile.push(`${punkte} bereits vergebene${punkte === 1 ? 'r' : ''} Punkt${punkte === 1 ? '' : 'e'} (werden den Konfis wieder abgezogen)`);
    return teile.join(', ');
  };

  // WARUM DIE ZWEITE RUECKFRAGE UEBER onDidDismiss LAEUFT:
  // Sie erschien nie. Zwei Mechaniken greifen ineinander —
  //   1. Der Knopf-Handler eines Alerts wird ABGEWARTET, bevor der Alert
  //      schliesst. Der `await api.delete(...)` unten laeuft also im noch
  //      OFFENEN Alert.
  //   2. Ein zweiter Alert, der aufgehen soll, waehrend noch einer offen ist,
  //      wird STILL verworfen — ohne Fehler, ohne Log.
  // Direkt aus dem catch heraus nachzufragen hiess also: Dialog weg, nichts
  // passiert, der Termin bleibt stehen. Deshalb wird die Rueckfrage nur
  // GEMERKT und erst angestossen, wenn der erste Alert wirklich zu ist —
  // dasselbe Muster wie bei eventModalCanDismiss weiter oben.
  // NICHT auf einen Aufruf direkt im catch zurueckdrehen.
  const deleteSingleEvent = async (event: Event) => {
    let nachDemSchliessen: (() => void) | null = null;
    presentAlert({
      header: 'Event löschen',
      message: `Event "${event.name}" wirklich löschen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/events/${event.id}`);
              await refreshEvents();
              await refreshCancelled();
            } catch (error) {
              if (fehlerStatus(error) === 409) {
                const daten = fehlerDaten(error);
                nachDemSchliessen = () => confirmForceDelete(event, daten);
              } else {
                setError(fehlerText(error, 'Fehler beim Löschen des Events'));
              }
            }
          }
        }
      ],
      // setTimeout 0, NICHT direkt aufrufen: @ionic/react ruft
      // onDidDismiss auf, BEVOR es overlayRef.current freigibt --
      //
      //   const handleDismiss = (event) => {
      //     if (onDidDismiss) { onDidDismiss(event); }
      //     overlayRef.current = undefined;
      //   };
      //
      // Ein presentAlert von hier aus liefe also noch gegen ein belegtes
      // overlayRef und wuerde still verworfen. Genau das war der erste,
      // wirkungslose Anlauf dieser Korrektur. Der Timeout laesst den
      // Aufrufstapel zu Ende laufen; die Freigabe steht synchron direkt hinter
      // unserem Callback und ist dann durch.
      onDidDismiss: () => {
        const naechster = nachDemSchliessen;
        nachDemSchliessen = null;
        if (naechster) setTimeout(naechster, 0);
      }
    });
  };

  // Zweite, deutliche Rueckfrage nach 409: nennt konkret, was verloren geht.
  const confirmForceDelete = (event: Event, data: EventLoeschKonflikt | undefined) => {
    const verluste = buildVerlustText(data);
    presentAlert({
      header: 'Wirklich löschen?',
      message: verluste
        ? `Beim Löschen von "${event.name}" geht verloren: ${verluste}. Das lässt sich nicht rückgängig machen.`
        : (data?.error || `"${event.name}" endgültig löschen? Das lässt sich nicht rückgängig machen.`),
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Endgültig löschen',
          role: 'destructive',
          handler: async () => {
            try {
              // force=true: der Nutzer hat die konkreten Verluste gesehen und bestaetigt.
              await api.delete(`/events/${event.id}?force=true`);
              await refreshEvents();
              await refreshCancelled();
            } catch (error) {
              setError(fehlerText(error, 'Fehler beim Löschen des Events'));
            }
          }
        }
      ]
    });
  };

  const deleteSeriesEvents = async (seriesEvents: Event[], label: string) => {
    let nachDemSchliessen: (() => void) | null = null;
    presentAlert({
      header: 'Serie löschen',
      message: `Wirklich ${label} löschen (${seriesEvents.length} Events)?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            const results = await Promise.allSettled(
              seriesEvents.map(event => api.delete(`/events/${event.id}`))
            );
            await refreshEvents();
            await refreshCancelled();

            const konflikte: { event: Event; data: EventLoeschKonflikt | undefined }[] = [];
            const fehler: PromiseRejectedResult[] = [];
            results.forEach((r, i) => {
              if (r.status === 'rejected') {
                if (fehlerStatus(r.reason) === 409) {
                  konflikte.push({ event: seriesEvents[i], data: fehlerDaten(r.reason) });
                } else {
                  fehler.push(r as PromiseRejectedResult);
                }
              }
            });

            if (fehler.length > 0) {
              const firstError = fehlerDaten(fehler[0].reason)?.error;
              setError(
                `${fehler.length} von ${seriesEvents.length} Events konnten nicht gelöscht werden` +
                (firstError ? `: ${firstError}` : '')
              );
            }
            if (konflikte.length > 0) {
              nachDemSchliessen = () => confirmForceDeleteSeries(konflikte);
            }
          }
        }
      ],
      // setTimeout 0 aus demselben Grund wie beim Einzeltermin (siehe dort).
      onDidDismiss: () => {
        const naechster = nachDemSchliessen;
        nachDemSchliessen = null;
        if (naechster) setTimeout(naechster, 0);
      }
    });
  };

  // Zweite Rueckfrage für Serien-Termine, die mit 409 geblockt haben:
  // aufsummierte Verluste über alle betroffenen Termine anzeigen.
  const confirmForceDeleteSeries = (konflikte: { event: Event; data: EventLoeschKonflikt | undefined }[]) => {
    const summe = (feld: keyof EventLoeschKonflikt) =>
      konflikte.reduce((s, k) => {
        const wert = k.data?.[feld];
        return s + (typeof wert === 'number' ? wert : 0);
      }, 0);
    const verluste = buildVerlustText({
      booking_count: summe('booking_count'),
      message_count: summe('message_count'),
      points_total: summe('points_total')
    });
    presentAlert({
      header: 'Wirklich löschen?',
      message: `${konflikte.length} Event${konflikte.length === 1 ? '' : 's'} der Serie ${konflikte.length === 1 ? 'ist' : 'sind'} nicht leer. Beim Löschen geht verloren: ${verluste}. Das lässt sich nicht rückgängig machen.`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Endgültig löschen',
          role: 'destructive',
          handler: async () => {
            const results = await Promise.allSettled(
              konflikte.map(k => api.delete(`/events/${k.event.id}?force=true`))
            );
            await refreshEvents();
            await refreshCancelled();
            const failed = results.filter(r => r.status === 'rejected');
            if (failed.length > 0) {
              const firstError = fehlerDaten((failed[0] as PromiseRejectedResult).reason)?.error;
              setError(
                `${failed.length} von ${konflikte.length} Events konnten nicht gelöscht werden` +
                (firstError ? `: ${firstError}` : '')
              );
            }
          }
        }
      ]
    });
  };

  // Absagen oeffnet jetzt das Modal mit dem optionalen Grund.
  // Eckdaten (Datum, Konfi-Zahl) stehen dort im Kopf, wie vorher im Sheet.
  const handleCancelEvent = async (event: Event) => {
    if (offlineBlockiert(isOnline, setError)) return;
    absageTerminRef.current = event;
    presentAbsageModal({ presentingElement: presentingElement || undefined });
  };

  // ABSAGE ZURUECKNEHMEN
  //
  // Rueckfrage und Aufruf stehen in utils/absageZuruecknehmen.ts, weil es
  // zwei Wege dorthin gibt: den Wisch hier in der Liste und den Knopf ganz
  // unten in der Detailansicht. Zwei Kopien derselben Rueckfrage waeren zwei
  // Stellen, an denen sie auseinanderlaufen koennen.
  const handleAbsageZuruecknehmen = (event: Event) => {
    if (offlineBlockiert(isOnline, setError)) return;
    absageZuruecknehmenFragen(event, {
      presentAlert,
      setSuccess,
      setError,
      onErfolg: async () => {
        await refreshEvents();
        await refreshCancelled();
      }
    });
  };

  const handleSelectEvent = (event: Event) => {
    // Split-View (iPad): Auswahl an den Wrapper melden, KEINE Navigation.
    // Sonst (iPhone/Portrait): wie bisher zur Detail-Route navigieren.
    if (onSelectEvent) {
      onSelectEvent(event.id);
    } else {
      router.push(`/admin/events/${event.id}`);
    }
  };

  const presentEventModal = (eventType: 'single' | 'series' = 'single') => {
    // Zeitfenster einer vorherigen Kopie verwerfen: Sie werden beim Schliessen
    // bewusst nicht zurueckgesetzt (siehe Kommentar am Modal-Hook), sonst
    // brachte "Neuer Termin" direkt nach einem Kopieren dessen Zeitfenster mit.
    setKopierteTimeslots([]);
    if (eventType === 'series') {
      // For series, we need to create a proper "new event" object with is_series flag
      setEditEvent({
        id: 0, // Set to 0 to indicate new event
        name: '',
        description: '',
        event_date: '',
        location: '',
        points: 0,
        type: 'gottesdienst',
        max_participants: 10,
        is_series: true
      } as Event);
    } else {
      setEditEvent(null);
    }
    presentEventModalHook({
      presentingElement: presentingElement,
      canDismiss: eventModalCanDismiss,
      backdropDismiss: false
    });
  };

  /**
   * TERMIN KOPIEREN
   *
   *   "kopieren eröffnet ein modal mit allem voreingetragen."
   *   "es wird ja nur das modal vorausgefüllt und man kann es dann direkt anlegen."
   *
   * Es wird NICHTS angelegt -- das Modal oeffnet sich wie beim Neuanlegen, nur
   * vorbefuellt. Die Regel, was mitkommt und was nicht, steht in
   * utils/terminVorbelegung.ts (kopiereTermin).
   *
   * Die Zeitfenster holt dieser Handler vorher ab: Die Terminliste liefert sie
   * nicht mit, und das Modal kann sie bei einer Kopie nicht nachladen (id 0).
   * Scheitert das Laden, wird trotzdem kopiert -- ohne Zeitfenster, mit
   * Hinweis. Ein stummer Verlust waere schlimmer als ein Hinweis.
   */
  const handleKopiereEvent = async (event: Event) => {
    if (offlineBlockiert(isOnline, setError)) return;

    let timeslots: Timeslot[] = [];
    if (event.has_timeslots) {
      try {
        const res = await api.get(`/events/${event.id}/timeslots`);
        timeslots = res.data || [];
      } catch {
        setError('Die Zeitfenster konnten nicht geladen werden — die Kopie hat keine.');
      }
    }

    const { event: vorlage, timeslots: kopierteSlots } = kopiereTermin(event, timeslots);
    setKopierteTimeslots(kopierteSlots);
    setEditEvent(vorlage);
    presentEventModalHook({
      presentingElement: presentingElement,
      canDismiss: eventModalCanDismiss,
      backdropDismiss: false
    });
  };

  const handleAddEventClick = () => {
    presentEventModal('single');
  };

  // Suchfilter
  const applySearch = (eventList: Event[]) => {
    if (!searchText) return eventList;
    const lower = searchText.toLowerCase();
    return eventList.filter(e =>
      e.name?.toLowerCase().includes(lower) ||
      e.title?.toLowerCase().includes(lower) ||
      e.location?.toLowerCase().includes(lower)
    );
  };

  // --- Aktivitäten-Handler ---
  const handleResetRequest = async (request: ActivityRequest) => {
    // Feminine Endung, seit aus "Antrag" "Aktivität" wurde.
    const statusText = request.status === 'approved' ? 'Genehmigte' : 'Abgelehnte';
    presentAlert({
      header: 'Aktivität zurücksetzen',
      message: `${statusText} Aktivität von "${request.konfi_name}" zurücksetzen und wieder als offen markieren?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Zurücksetzen',
          handler: async () => {
            try {
              await api.put(`/admin/activities/requests/${request.id}/reset`);
              await refreshRequests();
              // Zuruecksetzen macht die Aktivität wieder offen -> Badge muss
              // hochzaehlen; Punkte werden zurückgenommen -> Konfi-Liste.
              triggerRefresh('requests');
              triggerRefresh('konfis');
            } catch (err) {
              setError(fehlerText(err, 'Fehler beim Zurücksetzen der Aktivität'));
            }
          }
        }
      ]
    });
  };

  const handleSelectRequest = (request: ActivityRequest) => {
    setModalRequestId(request.id);
    presentRequestModalHook({
      presentingElement: presentingElement
    });
  };

  // Terminverwaltung ist Leitungssache. Die Regel steht in
  // utils/terminRechte.ts und spiegelt requireAdmin im Backend — vorher zaehlte
  // die Oberflaeche hier 'teamer' mit und bot Knoepfe an, die mit 403 endeten.
  const canManageEvents = darfTermineVerwalten(user);
  const canCreate = canManageEvents;
  const canEdit = canManageEvents;
  const canDelete = canManageEvents;
  const canCancel = canEdit;

  const isAntraege = mainSegment === 'antraege';
  // Der Titel folgt dem Segment — siehe KonfiEventsPage: im iOS-Modus
  // nachgemessen, der Large-Title springt beim Umschalten nicht mehr.
  const pageTitle = isAntraege ? 'Aktivitäten' : 'Events';

  // Oberste Segment-Ebene (Events | Aktivitäten) + einmaliger Umzugs-Hinweis. Wird
  // als headerSlot an die jeweils aktive View gereicht und dort DIREKT UNTER
  // dem Grafik-/Stats-Header gerendert (gleiches Muster wie KonfiEventsPage).
  const mainSegmentSlot = (
    <>
      <div className="app-segment-wrapper">
        <IonSegment
          value={mainSegment}
          onIonChange={(e) => setMainSegment(e.detail.value as 'events' | 'antraege')}
        >
          <IonSegmentButton value="events">
            <IonLabel>Events<SegmentZahl anzahl={pendingEventsCount} label={pendingEventsCount === 1 ? 'Event wartet auf Verbuchung' : 'Events warten auf Verbuchung'} /></IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="antraege">
            <IonLabel>Aktivitäten<SegmentZahl anzahl={pendingRequestsCount} label={pendingRequestsCount === 1 ? 'Antrag wartet auf Entscheidung' : 'Anträge warten auf Entscheidung'} /></IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </div>

    </>
  );

  return (
    <IonPage ref={pageRef}>
      <AppKopfzeile
        titel={pageTitle}
        rechts={!isAntraege && canCreate ? (
          <IonButton aria-label="Neues Event anlegen" onClick={handleAddEventClick}>
            <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} />
          </IonButton>
        ) : undefined}
      />
      <IonContent className="app-gradient-background" fullscreen>
        <AppKopfzeileGross titel={pageTitle} />

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          if (isAntraege) {
            await refreshRequests();
          } else {
            await refreshAllEvents();
          }
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        {/* Oberste Segment-Ebene (Events | Aktivitäten) + Umzugs-Hinweis werden als
            headerSlot an die jeweilige View gereicht und dort DIREKT UNTER dem
            Grafik-/Stats-Header gerendert - passend zur Konfi-Seitenstruktur. */}
        {isAntraege ? (
          requestsLoading ? (
            <LoadingSpinner message="Aktivitäten werden geladen..." />
          ) : (
            <ActivityRequestsView
              requests={requests || []}
              ohneJahrgang={ohneJahrgang}
              offeneAntraege={pendingRequestsCount}
              onSelectRequest={handleSelectRequest}
              onResetRequest={handleResetRequest}
              headerSlot={mainSegmentSlot}
            />
          )
        ) : loading ? (
          <LoadingSpinner message="Events werden geladen..." />
        ) : (
          <EventsView
            events={
              activeTab === 'verbuchen' ? applySearch(filterByJahrgang(getVerbuchenEvents())) :
              activeTab === 'vergangen' ? applySearch(filterByJahrgang(getVergangenEvents())) :
              applySearch(filterByJahrgang(getAktuellEvents()))
            }
            onSelectEvent={handleSelectEvent}
            selectedEventId={selectedEventId}
            onDeleteEvent={canDelete ? handleDeleteEvent : undefined}
            onCancelEvent={canCancel ? handleCancelEvent : undefined}
            // Wer absagen darf, darf auch zuruecknehmen -- dieselbe
            // Berechtigung im Backend (requireTeamer + darfTermin).
            onZuruecknehmen={canCancel ? handleAbsageZuruecknehmen : undefined}
            onKopieren={canCreate ? handleKopiereEvent : undefined}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            wartendVerbuchen={pendingEventsCount}
            eventCounts={{
              aktuell: applySearch(filterByJahrgang(getAktuellEvents())).length,
              verbuchen: applySearch(filterByJahrgang(getVerbuchenEvents())).length,
              vergangen: applySearch(filterByJahrgang(getVergangenEvents())).length
            }}
            jahrgaenge={jahrgaenge || []}
            selectedJahrgang={selectedJahrgang}
            onJahrgangChange={setSelectedJahrgang}
            searchText={searchText}
            onSearchChange={setSearchText}
            presentingElement={presentingElement}
            headerSlot={mainSegmentSlot}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default AdminEventsPage;
