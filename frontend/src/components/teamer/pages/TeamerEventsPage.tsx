import {
  ICON_ABSAGE,
  ICON_ANHANG,
  ICON_CHAT,
  ICON_DATEI_GEFUELLT,
  ICON_ENTSPERRT,
  ICON_FILTER,
  ICON_GEMEINDE_GEFUELLT,
  ICON_GOTTESDIENST_GEFUELLT,
  ICON_GRUPPE_GEFUELLT,
  ICON_HINZUFUEGEN_GEFUELLT,
  ICON_INFO_GEFUELLT,
  ICON_JAHRGANG,
  ICON_KATEGORIE_GEFUELLT,
  ICON_KOPIEREN_GEFUELLT,
  ICON_LINK,
  ICON_LISTE,
  ICON_MATERIAL,
  ICON_OFFLINE,
  ICON_ORT_GEFUELLT,
  ICON_POKAL_GEFUELLT,
  ICON_QRCODE,
  ICON_SCANNEN,
  ICON_SCHUTZ_GEFUELLT,
  ICON_SUCHE_GEFUELLT,
  ICON_TERMIN,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT_GEFUELLT,
  ICON_UNENDLICH,
  ICON_WARTEND_GEFUELLT,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import { fehlerDaten, fehlerStatus, fehlerText } from '../../../utils/fehler';
import { konfisInReihenfolge } from '../../../utils/teilnehmerReihenfolge';
import { hatAbgesagt, zusageBeschriftung, absageBeschriftung, absageBrauchtGrund } from '../../../utils/zusageKnoepfe';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAppLocation } from '../../../navigation/useAppLocation';
import { IonPage, IonContent, IonRefresher, IonRefresherContent, IonIcon, IonSegment, IonSegmentButton, IonLabel, IonButton, IonList, IonListHeader, IonCard, IonCardContent, IonItem, IonItemGroup, IonInput, IonNote, useIonModal, useIonAlert, useIonViewWillEnter } from '@ionic/react';
import AppKopfzeile, { AppKopfzeileGross } from '../../shared/AppKopfzeile';
import { useIonRouter } from '@ionic/react';

// useLocation bleibt für Query-Parameter Auswertung (React Router v5 API)
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { datumKurz } from '../../../utils/dateUtils';

/** Ein Eintrag aus GET /material/by-event/:eventId (material.js). */
interface EventMaterial {
  id: number;
  title: string;
  description?: string | null;
  created_at: string;
  created_by_name?: string | null;
  /** Serverseitig bereits als Zahl geliefert. */
  file_count: number;
  link_url?: string | null;
}
import { writeQueue } from '../../../services/writeQueue';
import { useWartendeVorgaenge } from '../../../hooks/useWartendeVorgaenge';
import WartendeVorgaengeKarte from '../../shared/WartendeVorgaengeKarte';
import { networkMonitor } from '../../../services/networkMonitor';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import { removeDeliveredForEvents } from '../../../services/notifications';
import { SectionHeader, ListSection, EmptyState, EventLegendModal, EventCornerBadges, AbsageBlock, formatEventDate as formatDate, formatEventTime as formatTime, zeitraumText, istVergangen, istAbgesagt, titelDekoration, zaehltAlsMeiner, kategorienText, zeigtPunkteart, punkteartText } from '../../shared';
import { getStatusIcon } from '../../shared/StatusBadge';
import LoadingSpinner from '../../common/LoadingSpinner';
import QRScannerModal from '../../konfi/modals/QRScannerModal';
import QRDisplayModal from '../../shared/QRDisplayModal';
import RequestsView from '../../konfi/views/RequestsView';
import TeamerActivityRequestModal from '../modals/TeamerActivityRequestModal';
import TeamerAbsageModal from '../modals/TeamerAbsageModal';
// TerminAbsagenModal (Leitungsansicht) wird hier NICHT mehr eingebunden --
// siehe den Block "TERMINVERWALTUNG IST LEITUNGSSACHE" weiter unten.
import RequestDetailModal from '../../konfi/modals/RequestDetailModal';
import TeamerMaterialDetailPage from './TeamerMaterialDetailPage';
import { Event, Participant } from '../../../types/event';
// EINE Quelle fuer "wie heisst und wie faerbt sich eine Zeile der
// Teilnehmerliste" -- dieselbe, aus der schon beide Leitungs-Listen lesen
// (utils/teilnahmeStatus.ts). Die Teamer-Liste rechnet das nicht noch einmal
// nach; sonst hiesse dieselbe Abmeldung hier anders als dort.
import { teilnahmeDarstellung, listItemKlasse, iconKreisKlasse, eckBadgeKlasse } from '../../../utils/teilnahmeStatus';
import { urheberZeile, notizUrheberZeile, checkinZeile } from '../../../utils/anwesenheitUrheber';
import { triggerPullHaptic } from '../../../utils/haptics';
import { safeUUID } from '../../../utils/uuid';
import { sendenOderEinreihen } from '../../../utils/sendenOderEinreihen';
// Kein eigener ActivityRequest mehr: Die Seite reicht die Antraege an
// RequestDetailModal weiter, und zwei gleichnamige Typen mit
// unterschiedlicher Nullbarkeit haben genau dort gebissen. Der Modal-Typ ist
// der genauere — er kennt Teamer-Antraege ohne Punkte und ohne Typ.
import type { ActivityRequest } from '../../konfi/modals/RequestDetailModal';
import { tastaturKlick } from '../../../utils/tastatur';
import { trackMitmachenAnsicht } from '../../../services/analytics';
import { linkOeffnen } from '../../../services/systemDialoge';

// Einmaliger Hinweis nach dem Tab-Umbau: die Aktivitäten/Anträge sind aus
// ihrem eigenen Tab in dieses Segment gewandert (analog zu Admin/Konfi).


const TeamerEventsPage: React.FC = () => {
  const { user, setSuccess, setError, isOnline } = useApp();
  const { pageRef, presentingElement } = useModalPage('teamer-events');
  const routerLocation = useAppLocation();
  const router = useIonRouter();
  const queryEventId = new URLSearchParams(routerLocation.search).get('eventId');
  const [presentAlert] = useIonAlert();

  // Oberste Segment-Ebene: Events oder Aktivitäten.
  const [mainSegment, setMainSegment] = useState<'events' | 'antraege'>('events');
  // Umschalten an der Leiste „Events | Aktivitäten" zählt als eigener
  // Bereich -- die Seite hat für beide Ansichten denselben Pfad
  // (services/analytics.ts, trackMitmachenAnsicht).
  const mitmachenAnsichtWechseln = (ansicht: 'events' | 'antraege') => {
    if (ansicht !== mainSegment) trackMitmachenAnsicht(ansicht);
    setMainSegment(ansicht);
  };

  const [activeTab, setActiveTab] = useState<'meine' | 'alle' | 'team'>('meine');
  const [searchText, setSearchText] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  /** Kennung des zuletzt per ?eventId= geoeffneten Termins, siehe Effekt unten. */
  const [handledEventId, setHandledEventId] = useState<string | null>(null);
  /**
   * Der per ?eventId= angeforderte Termin gehoert zu einem Jahrgang, dem
   * diese Person nicht zugewiesen ist (GET /events/:id -> 403, error_code
   * jahrgang_nicht_zugewiesen). Dann zeigt die Seite statt der Liste den
   * Grund und den Weg hinaus -- siehe Effekt unten und renderJahrgangHinweis.
   */
  const [jahrgangHinweis, setJahrgangHinweis] = useState(false);
  const [eventMaterials, setEventMaterials] = useState<EventMaterial[]>([]);
  const [eventTimeslots, setEventTimeslots] = useState<Array<{ id: number; start_time: string; end_time: string; max_participants: number; registered_count: number; waitlist_count?: number }>>([]);
  /** Teilnehmerliste aus GET /events/:id -- nur zum Lesen, siehe Effekt unten. */
  const [eventTeilnehmer, setEventTeilnehmer] = useState<Participant[]>([]);
  const materialIdRef = useRef<number | null>(null);

  // Query-Parameter ?segment=antraege auswerten — kommt vom Redirect der alten
  // Route /teamer/requests und damit aus bestehenden Deep-Links.
  useEffect(() => {
    const segment = new URLSearchParams(routerLocation.search).get('segment');
    if (segment === 'antraege') {
      setMainSegment('antraege');
      // Einstieg per Link (Push, alte Route /konfi/requests) direkt in die
      // Aktivitäten -- die Pfad-Messung zählt ihn sonst als „events".
      trackMitmachenAnsicht('antraege');
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
  // Die Warteschlange meldet ihre Aenderungen jetzt selbst — vorher aktuali-
  // sierte sich die Anzeige nur, wenn die Antragsliste neu lud. Leerte sich
  // die Queue im Hintergrund, blieb "Wird gesendet..." stehen.
  const { wartend, gescheitert, vergessen } = useWartendeVorgaenge();

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
    return datumKurz(dateString);
  };

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
            } catch (error) {
              setError(fehlerText(error, 'Fehler beim Löschen der Aktivität'), { ort: 'antrag-loeschen-teamer', fehler: error });
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
    // Der Ref wird beim Antippen gesetzt (Zeile ~1054), BEVOR das Modal
    // geoeffnet wird — beim Rendern ist er null, beim Anzeigen nie.
    get materialId() { return materialIdRef.current as number; },
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

  // WARUM SIE GEFEHLT HAT: Diese Ansicht las ihren Termin ausschliesslich aus
  // der LISTE (GET /events). Die traegt nur Zahlen (registered_count,
  // teamer_count) -- die Namen stehen allein in der Detailantwort
  // GET /events/:id, und die hat diese Seite nie abgerufen. Am Backend lag es
  // nicht: routes/events/lesen.js liefert `participants: istKonfi ? [] :
  // participants` -- Teamer:innen bekommen die Liste also seit jeher, es hat
  // sie nur niemand angezeigt.
  //
  // Der Effekt unten haengt an `[selectedEvent?.id]`. Nach einer Zu-/Absage
  // tauschte die Seite nur das Event-OBJEKT aus -- die id blieb dieselbe,
  // der Effekt feuerte nicht, und die Teilnehmerliste blieb auf dem alten
  // Stand stehen. Nachgeladen wurde ausserdem nur die LISTE (GET /events),
  // und die traegt gar keine `participants`.
  //
  // `stand` sorgt dafuer, dass die Zahlen der LISTE nicht verloren gehen:
  // Die Detailantwort kennt einige Felder der Listenantwort nicht
  // (teamer_registration_status etwa), deshalb wird sie ueber den
  // vorhandenen Stand gelegt und ersetzt ihn nicht.
  const ladeTerminDetail = async (eventId: number) => {
    try {
      const res = await api.get(`/events/${eventId}`);
      setEventTeilnehmer(res.data?.participants || []);
      setSelectedEvent(stand => (stand && stand.id === eventId
        ? { ...stand, ...res.data }
        : stand));
    } catch {
      setEventTeilnehmer([]);
    }
  };

  useEffect(() => {
    if (selectedEvent) {
      void ladeTerminDetail(selectedEvent.id);
    } else {
      setEventTeilnehmer([]);
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

  // Gemerkt wird die KENNUNG, nicht ein Ja/Nein. Der alte Schalter
  // (initialEventHandled) stand nach dem ersten Deep-Link fuer immer auf
  // "erledigt": Die Seite bleibt im Tab montiert, ein zweiter Link auf einen
  // ANDEREN Termin lief deshalb ins Leere und zeigte weiter die Liste. Jetzt
  // oeffnet jede neue Kennung ihren Termin. Dieselbe Kennung oeffnet ihn
  // NICHT erneut -- sonst spraenge der Zurueck-Knopf (setSelectedEvent(null))
  // sofort wieder hinein, weil die Adresse den Parameter behaelt. Faellt der
  // Parameter aus der Adresse (Tab angetippt), wird der Merker geloescht,
  // damit derselbe Termin spaeter wieder per Link aufgeht.
  //
  // Ausgewaehlt wird aus der LISTE (GET /events), nicht per Detailabruf: Die
  // Liste ist bereits nach den zugewiesenen Jahrgaengen gefiltert. Ein
  // Termin, den diese Teamer:in nicht sehen darf, steht nicht darin -- und
  // geht damit auch ueber einen Link nicht auf. GET /events/:id folgt erst
  // danach, und nur fuer einen Termin aus der Liste.
  //
  // Die Liste darf dabei leer sein: Genau die Person OHNE jeden Jahrgang hat
  // oft gar keinen sichtbaren Termin -- und ist zugleich die, um die es geht.
  useEffect(() => {
    if (!queryEventId) {
      setHandledEventId(null);
      setJahrgangHinweis(false);
      return;
    }
    if (loading || !events || queryEventId === handledEventId) return;
    const eventToSelect = events.find(e => e.id === parseInt(queryEventId, 10));
    if (eventToSelect) {
      setSelectedEvent(eventToSelect);
    } else {
      void pruefeJahrgangsgrund(queryEventId);
    }
    setHandledEventId(queryEventId);
  }, [loading, events, queryEventId, handledEventId]);

  const pruefeJahrgangsgrund = async (eventId: string) => {
    try {
      await api.get(`/events/${eventId}`);
    } catch (err) {
      if (fehlerStatus(err) === 403 && fehlerDaten(err)?.error_code === 'jahrgang_nicht_zugewiesen') {
        setJahrgangHinweis(true);
      }
    }
  };

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
  //
  // zaehltAlsMeiner() statt einer eigenen Regel: Die Regel, wer unter "Meine"
  // gehoert, stand hier, in KonfiEventsPage und in der Konfi-EventsView in drei
  // Varianten nebeneinander — und genau dadurch fehlte an jeder Stelle etwas
  // anderes. Hier war es gleich doppelt: `is_registered` setzt das Backend nur
  // bei status = 'confirmed', also fielen sowohl ein Wartelistenplatz
  // ('waitlist') als auch die eigene Absage ('opted_out') aus dem Reiter
  // heraus. Die Kartendarstellung weiter unten kannte beide Zustaende laengst
  // und faerbte sie ein — nur der Filter davor nicht.
  const meineEvents = useMemo(() =>
    sortEvents(safeEvents.filter(zaehltAlsMeiner)),
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
      const meineImTeam = teamEvents.filter(zaehltAlsMeiner).length;
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
      { value: alleEvents.filter(zaehltAlsMeiner).length, label: 'Meine' }
    ];
  }, [activeTab, safeEvents, meineEvents, alleEvents, teamEvents]);

  const handleZusage = async (event: Event, dabei: boolean, reason?: string) => {
    setBookingLoading(true);
    const body = reason && reason.trim() ? { dabei, reason: reason.trim() } : { dabei };
    try {
      // Offline -- oder online, aber das Netz reisst ab: in die Warteschlange
      // Ein zweiter
      // Eingang ist harmlos: Die Zusage setzt einen Zustand, eine wiederholte
      // Absage laesst Grund und Kennzeichen stehen (setzeTeamerZusage).
      const versand = await sendenOderEinreihen({
        online: networkMonitor.isOnline,
        methode: 'POST',
        idempotent: true,
        senden: () => api.post(`/teamer/events/${event.id}/zusage`, body),
        einreihen: () => writeQueue.enqueue({
          method: 'POST',
          url: `/teamer/events/${event.id}/zusage`,
          body,
          maxRetries: 5,
          hasFileUpload: false,
          metadata: {
            type: 'teamer',
            clientId: safeUUID(),
            label: dabei ? 'Zusage' : 'Absage',
          },
        }),
      });
      if (versand.weg === 'eingereiht') {
        setSuccess('Wird gesendet, sobald du wieder online bist');
      } else {
        const res = versand.ergebnis;
        // Termin UND Teilnehmerliste frisch aus der Detailantwort -- die
        // Liste (GET /events) traegt keine `participants`, und ein blosser
        // Objekttausch liess den Lade-Effekt kalt (Begruendung oben bei
        // ladeTerminDetail).
        await ladeTerminDetail(event.id);
        // Die Warteliste braucht eine eigene Rueckmeldung: Zugesagt hat man,
        // aber einen Platz hat man noch nicht.
        if (dabei && res.data?.status === 'waitlist') {
          setSuccess('Du stehst auf der Warteliste. Wird ein Platz frei, rückst du automatisch nach.');
        } else {
          setSuccess(dabei ? 'Du bist dabei' : 'Absage gespeichert');
        }
      }
      refreshLive();
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Speichern'));
    } finally {
      setBookingLoading(false);
    }
  };

  // Nimmt DIESE Absage eine Zusage zurueck? Dann verlangt das Backend einen
  // Grund. Die Regel steht in utils/zusageKnoepfe.ts -- dieselbe Stelle, aus
  // der sich auch die Leitungssicht bedient.
  const [presentAbsageModal, dismissAbsageModal] = useIonModal(TeamerAbsageModal, {
    eventName: selectedEvent?.name || '',
    grundPflicht: selectedEvent ? absageBrauchtGrund(selectedEvent.booking_status) : false,
    onAbsage: (reason: string) => {
      if (selectedEvent) handleZusage(selectedEvent, false, reason);
    },
    dismiss: (data?: string, role?: string) => dismissAbsageModal(data, role)
  });

  const oeffneAbsage = () => {
    presentAbsageModal({ presentingElement: presentingElement || pageRef.current || undefined });
  };

  // Woertlich: "teamer erstellen keine veranstaltungen fertig. das machen
  // admins und org admins. das ist einfach nicht der weg. ich halte das fuer
  // zu komplex. lass es uns rausnehmen. also auch nicht loeschen und absagen"
  //
  // HIER STAND BIS ZUM SELBEN TAG das Gegenteil: ein eingebundenes
  // TerminAbsagenModal, handleTerminAbsagen(), handleAbsageZuruecknehmen(),
  // ein "Event absagen"-Knopf in der Detailansicht und drei Wisch-Aktionen an
  // der Liste. Das war am Vormittag gebaut worden und ist am Nachmittag wieder
  // herausgenommen worden -- keine Fehlkorrektur, sondern eine geaenderte
  // Anforderung.
  //
  // GESPERRT IST ES IN BEIDEN EBENEN: Das Backend laesst POST /events,
  // PUT /events/:id, DELETE /events/:id, PUT /events/:id/cancel,
  // /absagegrund und /reaktivieren seither nur noch mit requireAdmin durch
  // (org_admin, admin) und antwortet einer Teamer:in mit 403. Eine Sperre nur
  // in der Oberflaeche waere keine.
  //
  // WAS DEM TEAM BLEIBT: die eigene Zu- und Absage der TEILNAHME (oeffneAbsage
  // oben, POST /teamer/events/:id/zusage), der QR-Code zum Einchecken, der
  // Termin-Chat und alles Lesende. Ein abgesagter Termin ist weiterhin als
  // solcher zu SEHEN -- der AbsageBlock steht unveraendert im Detail und an
  // der Zeile, samt Grund. Nur aendern laesst er sich hier nicht mehr.

  /**
   * Die Zusage/Absage-Knoepfe. EINE Stelle fuer alle vier Faelle, in denen
   * sie vorkommen (frei, Warteliste offen, kein Platz mehr, bereits dabei) --
   * vorher stand die Logik viermal im JSX und lief auseinander.
   *
   * Also:
   *   noch nichts gewaehlt -> zwei Knoepfe: "Dabei" (gruen) / "Nicht dabei" (rot)
   *   zugesagt             -> EIN Knopf, rot:  "Nicht mehr dabei"
   *   abgesagt             -> EIN Knopf, gruen: "Doch dabei"
   *
   * Immer fill="outline". Der eigene Stand steht im Eck-Zeichen der Karte und
   * in den Eckdaten, nicht in einem gefuellten Knopf.
   *
   * Welcher Zustand welche Knoepfe zeigt und wie sie heissen, entscheidet
   * utils/zusageKnoepfe.ts -- dieselbe Stelle bedient die Leitungssicht
   * (admin/views/EventDetailView.tsx), damit beide nicht auseinanderlaufen.
   */
  const ZusageKnoepfe: React.FC<{
    event: Event;
    /** Beschriftung der Zusage, wenn es um die Warteliste geht. */
    zusageText?: string;
    /** Kein Platz mehr frei: Zusagen geht nicht, absagen schon. */
    zusageMoeglich?: boolean;
  }> = ({ event, zusageText, zusageMoeglich = true }) => {
    // is_registered statt hatZugesagt(booking_status): Die Listen-Route
    // setzt das Flag, und es deckt auch Buchungen ab, die ueber den
    // regulaeren Weg (/events/:id/book) entstanden sind.
    const abgesagt = hatAbgesagt(event.booking_status);
    const zugesagt = event.is_registered;

    const zusageKnopf = (
      <IonButton
        className="app-action-button"
        expand="block"
        fill="outline"
        color="success"
        onClick={() => handleZusage(event, true)}
        disabled={bookingLoading || !isOnline || !zusageMoeglich}
      >
        <IonIcon icon={bookingLoading || isOnline ? ICON_ZUSAGE_GEFUELLT : ICON_OFFLINE} slot="start" />
        {bookingLoading
          ? 'Wird verarbeitet...'
          : !isOnline
            ? 'Du bist offline'
            : zusageBeschriftung(abgesagt ? 'opted_out' : null, zusageText)}
      </IonButton>
    );

    const absageKnopf = (
      <IonButton
        className="app-action-button"
        expand="block"
        fill="outline"
        color="danger"
        onClick={oeffneAbsage}
        disabled={bookingLoading}
      >
        <IonIcon icon={ICON_ABSAGE} slot="start" />
        {bookingLoading
          ? 'Wird verarbeitet...'
          : absageBeschriftung(zugesagt ? 'confirmed' : null)}
      </IonButton>
    );

    // Bereits entschieden -> nur der Gegenknopf.
    if (zugesagt) return <div className="app-button-row app-button-row--in-card">{absageKnopf}</div>;
    if (abgesagt) return <div className="app-button-row app-button-row--in-card">{zusageKnopf}</div>;

    // Noch nichts gesagt -> beide nebeneinander.
    return (
      <div className="app-button-row app-button-row--in-card">
        {zusageKnopf}
        {absageKnopf}
      </div>
    );
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
      past: 'var(--app-color-neutral)',
      neutral: 'var(--app-color-neutral-hell)',
    };
    // Default: reines Konfi-Event, zu dem der Teamer sich NICHT anmelden kann.
    // Das ist NICHT gruen, sondern neutral ("Nur Info"), damit keine Anmeldung
    // suggeriert wird.
    let statusColor = C.neutral;
    let statusText = 'Nur Info';

    if (istAbgesagt(event)) {
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
    } else if (event.booking_status === 'opted_out') {
      // Eigene Absage: eigener Zustand statt "Offen"/"Ausgebucht" — die
      // Absage ist eine abgegebene Rueckmeldung, kein offener Termin.
      // Umentscheiden geht weiterhin ueber "Ich bin dabei" im Detail.
      statusColor = C.danger;
      statusText = 'Abgesagt von dir';
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
    const statusIcon = getStatusIcon(statusText) || ICON_INFO_GEFUELLT;
    const shouldGrayOut = isPastEvent && !event.is_registered;

    return { statusColor, statusText, statusIcon, isPastEvent, shouldGrayOut };
  };

  // KEIN handleBook (POST /events/:id/book) und kein handleUnbook
  // (DELETE /events/:id/book) mehr. BEIDE RICHTUNGEN NEHMEN DIESELBE ROUTE:
  // POST /teamer/events/:id/zusage (handleZusage, dabei=true/false).
  //
  // GEPRUEFT, dass die Zusage-Route alles kann, was /book konnte
  // (backend/utils/bookingUtils.js): Kontingent und Warteliste rechnet
  // setzeTeamerZusage mit denselben Bausteinen wie bucheTermin
  // (zaehleBuchungen/determineBookingStatus auf der Team-Seite), die
  // Jahrgangsgrenze prueft sie ebenso (darfTeamerAnDiesenTermin), einen
  // abgesagten Termin sperrt sie ebenso. Ein Anmeldefenster gilt fuer das
  // Team auf KEINEM der beiden Wege, Zeitfenster hat eine Teamer-Buchung
  // nie. Die Antwort traegt wie /book ein `status` ('confirmed' oder
  // 'waitlist') — daran haengt die Wartelisten-Meldung.
  //
  // Die DELETE-Route selbst bleibt im Backend — Store-Apps rufen sie noch.

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
    const past = { primary: 'var(--app-color-neutral)', secondary: 'var(--app-color-neutral)' };
    const neutral = { primary: 'var(--app-color-neutral-hell)', secondary: 'var(--app-color-neutral-hell)' };

    const isPastEvent = istVergangen(event);
    const isOnWaitlist = event.booking_status === 'waitlist' || event.booking_status === 'pending';

    // Logik 1:1 wie Konfi (EventDetailView) — EINZIGER Unterschied: ein "offenes"
    // Event, zu dem sich der Teamer NICHT anmelden kann, wird NICHT gruen, sondern
    // neutral ("Nur Info"), damit keine Anmeldung suggeriert wird.
    if (istAbgesagt(event)) return danger;
    if (isPastEvent && event.attendance_status === 'present') return success;
    if (isPastEvent && event.attendance_status === 'absent') return danger;
    if (isPastEvent && event.is_registered && !event.attendance_status) return bonus;
    if (isOnWaitlist) return bonus;
    if (event.is_registered && !isPastEvent) return info; // angemeldet = blau
    if (isPastEvent) return past;
    if (event.booking_status === 'opted_out') return danger; // eigene Absage
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

    if (istAbgesagt(event)) return 'Abgesagt';
    if (isPastEvent && event.attendance_status === 'present') return 'Anwesend';
    if (isPastEvent && event.attendance_status === 'absent') return 'Abwesend';
    if (isPastEvent && event.is_registered && !event.attendance_status) return 'Ausstehend';
    if (isOnWaitlist) return 'Warteliste';
    if (event.is_registered && !isPastEvent) return 'Dabei';
    if (isPastEvent) return 'Vergangen';
    if (event.booking_status === 'opted_out') return 'Abgesagt von dir';
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
      case 'team': return 'Keine Events fürs Team verfügbar';
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
        <AppKopfzeile
          titel={selectedEvent.name}
          onZurueck={hideBackButton ? undefined : () => setSelectedEvent(null)}
          gemeindeUmschalter={false}
          rechts={(
            <>
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
                  <IonIcon icon={ICON_CHAT} slot="icon-only" />
                </IonButton>
              )}
              <IonButton
                aria-label="QR-Code zum Einchecken anzeigen"
                onClick={() => presentQRDisplayModal({
                  presentingElement: pageRef.current || presentingElement || undefined
                })}
              >
                <IonIcon icon={ICON_QRCODE} slot="icon-only" />
              </IonButton>
            </>
          )}
        />

        <IonContent className="app-gradient-background" fullscreen>
          <AppKopfzeileGross titel={selectedEvent.name} />

          {/* HERUNTERZIEHEN HOLT DEN TERMIN, NICHT DIE LISTE.
              Hier stand vorher `safeEvents.find(...)` -- gelesen aus der
              Render-Closure, also aus dem Stand VOR `await refresh()`. Das
              Herunterziehen schrieb damit genau den alten Wert zurueck, den
              es auffrischen sollte. Jetzt dieselbe Quelle wie ueberall
              sonst auf dieser Seite: die Detailantwort, samt
              Teilnehmerliste. */}
          <IonRefresher slot="fixed" onIonRefresh={async (e) => {
            await refresh();
            await ladeTerminDetail(selectedEvent.id);
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
                icon={ICON_TERMIN_GEFUELLT}
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

          {/*
              NICHT zu verwechseln mit "Abgesagt von dir" weiter oben: Das
              meint die eigene Teilnahme, hier geht es um den TERMIN. */}
          <AbsageBlock
            event={selectedEvent}
            variante="kasten"
          />

          {/* Details Card - wie Admin EventDetailView */}
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
                      {zeitraumText(selectedEvent)}
                    </div>
                  </div>
                </div>

                {/* Konfis \u2014 entfaellt bei reinen Teamer-Events (dort gibt es
                    keine Konfi-Teilnahme, die Zeile zeigte "0 / \u221E") */}
                {!selectedEvent.teamer_only && (
                  <div className="app-info-row">
                    <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-info-row__icon app-icon-color--participants" />
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
                    <IonIcon icon={ICON_UHRZEIT_GEFUELLT} className="app-info-row__icon app-icon-color--time app-event-detail__icon--align-top" />
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
                    <IonIcon icon={ICON_ENTSPERRT} className="app-info-row__icon app-icon-color--events app-event-detail__icon--align-top" />
                    <div>
                      <div className="app-info-row__label">Anmeldung</div>
                      {selectedEvent.registration_opens_at ? (
                        <>
                          <div className="app-info-row__value">
                            von {datumKurz(selectedEvent.registration_opens_at)} – {formatTime(selectedEvent.registration_opens_at)}
                          </div>
                          {selectedEvent.registration_closes_at && (
                            <div className="app-info-row__value">
                              bis {datumKurz(selectedEvent.registration_closes_at)} – {formatTime(selectedEvent.registration_closes_at)}
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
                    <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-info-row__icon app-icon-color--team" />
                    <div>
                      <div className="app-info-row__label">Team</div>
                      <div className="app-info-row__value">
                        {(selectedEvent.teamer_count || 0)} / {(selectedEvent.teamer_max_participants || 0) > 0 ? selectedEvent.teamer_max_participants : '∞'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Teamer-Warteliste — nur bei begrenztem Kontingent + aktiver Warteliste */}
                {(selectedEvent.teamer_max_participants || 0) > 0 && selectedEvent.teamer_waitlist_enabled && (
                  <div className="app-info-row">
                    <IonIcon icon={ICON_LISTE} className="app-info-row__icon app-icon-color--waitlist" />
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
                      <IonIcon icon={ICON_POKAL_GEFUELLT} className="app-info-row__icon app-icon-color--points" />
                      <div>
                        <div className="app-info-row__label">Punkte</div>
                        <div className="app-info-row__value">{selectedEvent.points}</div>
                      </div>
                    </div>
                    <div className="app-info-row">
                      <IonIcon
                        icon={selectedEvent.point_type === 'gottesdienst' ? ICON_GOTTESDIENST_GEFUELLT : ICON_GEMEINDE_GEFUELLT}
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
                    <IonIcon icon={ICON_KATEGORIE_GEFUELLT} className="app-info-row__icon app-icon-color--category" />
                    <div>
                      <div className="app-info-row__label">Kategorien</div>
                      <div className="app-info-row__value">{selectedEvent.category_names}</div>
                    </div>
                  </div>
                )}

                {/* Ort */}
                {selectedEvent.location && (
                  <div className="app-info-row">
                    <IonIcon icon={ICON_ORT_GEFUELLT} className="app-info-row__icon app-icon-color--location" />
                    <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
                      onClick={() => {
                        if (selectedEvent.location_maps_url) {
                          linkOeffnen(selectedEvent.location_maps_url);
                        } else if (selectedEvent.location) {
                          linkOeffnen(`https://maps.apple.com/?q=${encodeURIComponent(selectedEvent.location)}`);
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
                    <IonIcon icon={ICON_SCHUTZ_GEFUELLT} className="app-info-row__icon app-icon-color--events" />
                    <div>
                      <div className="app-info-row__label">Pflicht-Event</div>
                      <div className="app-info-row__value">Teilnahme erforderlich</div>
                    </div>
                  </div>
                )}

                {/* Team gesucht */}
                {isTeamerEvent && (
                  <div className="app-info-row">
                    <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-info-row__icon app-icon-color--team" />
                    <div>
                      <div className="app-info-row__label">Team-Zugang</div>
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
                    <IonIcon icon={ICON_KOPIEREN_GEFUELLT} className="app-info-row__icon app-icon-color--events" />
                    <div>
                      <div className="app-info-row__label">Event-Serie</div>
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
                    <IonIcon icon={ICON_QRCODE} className="app-info-row__icon app-icon-color--events app-event-detail__icon--align-top" />
                    <div>
                      <div className="app-info-row__label">Check-in-Fenster</div>
                      <div className="app-info-row__value">
                        QR-Code {selectedEvent.checkin_window} Min. (vor/nach Beginn)
                      </div>
                    </div>
                  </div>
                )}

                {/* Was mitbringen */}
                {selectedEvent.bring_items && (
                  <div className="app-info-row app-info-row--top">
                    <IonIcon icon={ICON_MATERIAL} className="app-info-row__icon app-icon-color--bring app-event-detail__icon--align-top" />
                    <div>
                      <div className="app-info-row__label">Mitbringen</div>
                      <div className="app-info-row__value">{selectedEvent.bring_items}</div>
                    </div>
                  </div>
                )}

                {eventMaterials.length > 0 && (
                  <div className="app-info-row">
                    <IonIcon icon={ICON_DATEI_GEFUELLT} className="app-info-row__icon app-icon-color--material" />
                    <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
                      onClick={() => {
                        if (eventMaterials.length === 1) {
                          materialIdRef.current = eventMaterials[0].id;
                          presentMaterialModal({ presentingElement: presentingElement || pageRef.current || undefined });
                          return;
                        }
                        document.getElementById('teamer-material-abschnitt')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                    >
                      <div className="app-info-row__label">Material</div>
                      <div className="app-info-row__value app-event-detail__material-link">
                        {eventMaterials.length === 1
                          ? eventMaterials[0].title
                          : `${eventMaterials.length} Materialien`}
                      </div>
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
                  <IonIcon icon={ICON_INFO_GEFUELLT} />
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

          {(() => {
            const zusageKarteInhalt = istAbgesagt(selectedEvent) ? (
              // NUR HIER: Der Termin bleibt in der LISTE rot, in beiden
              // Rollen, ebenso das rote Eck-Badge und die gemeinsame Legende.
              // Rot heisst dort "Absage" als Zustand des Termins; hier steht
              // ein Hinweis an der Stelle, wo sonst ein Knopf waere.
              <IonNote color="medium" style={{ display: 'block', textAlign: 'center', fontSize: 'var(--app-text-betont)' }}>
                <IonIcon icon={ICON_ABSAGE} style={{ verticalAlign: 'middle', marginRight: 'var(--app-abstand-kompakt)' }} />
                Dieses Event ist abgesagt
              </IonNote>
            ) : isPast ? (
                  selectedEvent.is_registered ? (
                    <div style={{ textAlign: 'center' }}>
                      {selectedEvent.attendance_status === 'present' && (
                        <div className="app-status-box app-status-box--success">
                          <IonIcon icon={ICON_ZUSAGE_GEFUELLT} />
                          Anwesend
                        </div>
                      )}
                      {selectedEvent.attendance_status === 'absent' && (
                        <div className="app-status-box app-status-box--danger">
                          <IonIcon icon={ICON_ABSAGE} />
                          Abwesend
                        </div>
                      )}
                      {!selectedEvent.attendance_status && (
                        <div className="app-status-box app-status-box--bonus">
                          <IonIcon icon={ICON_WARTEND_GEFUELLT} />
                          Anwesenheit ausstehend
                        </div>
                      )}
                    </div>
                  ) : null
                ) : (
                  selectedEvent.is_registered ? (
                    <ZusageKnoepfe event={selectedEvent} />
                  ) : teamerCanRegister(selectedEvent) ? (
                    (() => {
                      const teamerMax = selectedEvent.teamer_max_participants || 0;
                      const teamerCount = selectedEvent.teamer_count || 0;
                      const teamerFull = teamerMax > 0 && teamerCount >= teamerMax;

                      if (!teamerFull) {
                        // Kontingent frei (oder unbegrenzt).
                        return <ZusageKnoepfe event={selectedEvent} />;
                      }

                      const teamerWaitlistMax = selectedEvent.teamer_max_waitlist_size || 0;
                      const teamerWaitlistCount = selectedEvent.teamer_waitlist_count || 0;
                      const waitlistOpen = !!selectedEvent.teamer_waitlist_enabled &&
                        (teamerWaitlistMax === 0 || teamerWaitlistCount < teamerWaitlistMax);

                      if (waitlistOpen) {
                        // Kontingent voll, aber Warteliste offen. Der
                        // Absage-Knopf gehoert AUCH hierher: Gerade wenn kein
                        // Platz frei ist, will die Leitung wissen, wer
                        // nachruecken wuerde und wer nicht.
                        return (
                          <ZusageKnoepfe
                            event={selectedEvent}
                            zusageText={`Warteliste (${teamerWaitlistCount}/${teamerWaitlistMax || '∞'})`}
                          />
                        );
                      }

                      // Kontingent voll und Warteliste voll/deaktiviert. Zusagen
                      // geht nicht mehr -- absagen schon: Die Leitung sieht so,
                      // dass diese Person auch bei einem frei werdenden Platz
                      // nicht einspringt.
                      return <ZusageKnoepfe event={selectedEvent} zusageMoeglich={false} />;
                    })()
                  ) : (
                    // Reines Konfi-Event: Teamer kann sich NICHT anmelden -> nur Hinweis.
                    <div
                      className="app-status-box"
                      style={{
                        backgroundColor: 'rgba(var(--app-color-neutral-hell-rgb), 0.12)',
                        color: 'var(--app-color-neutral)',
                        borderColor: 'rgba(var(--app-color-neutral-hell-rgb), 0.35)'
                      }}
                    >
                      <IonIcon icon={ICON_INFO_GEFUELLT} />
                      Nur zur Info - keine Anmeldung
                    </div>
                  )
                );

            // GAR KEINE KARTE, wenn es nichts zu zeigen gibt: ein vergangener
            // Termin, bei dem man nicht dabei war, hat unter "Bist du dabei?"
            // nichts zu sagen. Frueher blieb hier der leere weisse Rahmen
            // stehen.
            if (!zusageKarteInhalt) return null;

            return (
              <IonList className="app-section-inset" inset={true}>
                <IonListHeader>
                  <div className="app-section-icon app-section-icon--events">
                    <IonIcon icon={ICON_GRUPPE_GEFUELLT} />
                  </div>
                  <IonLabel>Bist du dabei?</IonLabel>
                </IonListHeader>
                <IonCard className="app-card">
                  <IonCardContent className="app-card-content">
                    {zusageKarteInhalt}
                  </IonCardContent>
                </IonCard>
              </IonList>
            );
          })()}

          {eventTeilnehmer.length > 0 && (() => {
            const konfis = konfisInReihenfolge(
              eventTeilnehmer.filter(p => p.role_name === 'konfi'),
              selectedEvent.mandatory
            );
            const team = eventTeilnehmer.filter(p => p.role_name !== 'konfi');

            const Zeile = (p: Participant) => {
              const darstellung = teilnahmeDarstellung(p);
              return (
                <div
                  key={p.id}
                  className={`app-list-item ${listItemKlasse(darstellung)}`}
                  style={{ marginBottom: 'var(--app-abstand-eng)' }}
                >
                  <div className="app-corner-badges">
                    <div
                      className={`app-corner-badge ${eckBadgeKlasse(darstellung)}`}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--app-abstand-mini) var(--app-abstand-eng)' }}
                      title={darstellung.statusText}
                      role="img"
                      aria-label={darstellung.statusText}
                    >
                      <IonIcon icon={getStatusIcon(darstellung.statusText) || ICON_GRUPPE_GEFUELLT} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
                    </div>
                  </div>
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className={`app-icon-circle ${iconKreisKlasse(darstellung)}`}>
                        <IonIcon icon={darstellung.istAbgemeldet ? ICON_ABSAGE : ICON_GRUPPE_GEFUELLT} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title">{p.participant_name}</div>
                        <div className="app-list-item__meta">
                          <span className="app-list-item__meta-item">{darstellung.statusText}</span>
                          {p.jahrgang_name && (
                            <span className="app-list-item__meta-item">{p.jahrgang_name}</span>
                          )}
                        </div>
                        {/*
                            Bis hierher standen hier nur Name, Status und
                            Jahrgang. Eine Notiz erreichte damit ausgerechnet
                            die Leute NICHT, die am Termin vor Ort sind.

                            Dieselben Hilfsfunktionen und derselbe Aufbau wie
                            in der Leitungsansicht (admin/views/
                            EventDetailView) -- eine Regel, ein Ort. Nur
                            LESEN: Verbucht wird weiter von der Leitung
                            (requireAdmin), deshalb gibt es hier keine
                            Knoepfe. */}
                        {darstellung.istAbgemeldet && p.excuse_reason && (
                          <div style={{ color: 'var(--app-text-secondary)', fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
                            <strong>Abgemeldet: </strong>{p.excuse_reason}
                          </div>
                        )}
                        {urheberZeile(p) && (
                          <div style={{ color: 'var(--app-text-tertiary)', fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
                            {urheberZeile(p)}
                          </div>
                        )}
                        {checkinZeile(p) && (
                          <div style={{ color: 'var(--app-text-tertiary)', fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
                            {checkinZeile(p)}
                          </div>
                        )}
                        {p.attendance_note && (
                          <div style={{ color: 'var(--app-text-secondary)', fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
                            <strong>Notiz: </strong>{p.attendance_note}
                          </div>
                        )}
                        {notizUrheberZeile(p) && (
                          <div style={{ color: 'var(--app-text-tertiary)', fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
                            {notizUrheberZeile(p)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            };

            return (
              <IonList className="app-section-inset" inset={true}>
                <IonListHeader>
                  <div className="app-section-icon app-section-icon--events">
                    <IonIcon icon={ICON_GRUPPE_GEFUELLT} />
                  </div>
                  <IonLabel>Wer kommt ({eventTeilnehmer.length})</IonLabel>
                </IonListHeader>
                <IonCard className="app-card">
                  <IonCardContent className="app-card-content">
                    {konfis.length > 0 && (
                      <>
                        <div className="app-list-item__meta" style={{ marginBottom: 'var(--app-abstand-eng)' }}>
                          Konfis ({konfis.length})
                        </div>
                        {konfis.map(Zeile)}
                      </>
                    )}
                    {team.length > 0 && (
                      <>
                        <div className="app-list-item__meta" style={{ marginTop: konfis.length > 0 ? 'var(--app-abstand-basis)' : 0, marginBottom: 'var(--app-abstand-eng)' }}>
                          Team ({team.length})
                        </div>
                        {team.map(Zeile)}
                      </>
                    )}
                  </IonCardContent>
                </IonCard>
              </IonList>
            );
          })()}

          {/* Material — die id ist das Sprungziel des Material-Hinweises in
              den Eckdaten: bei mehreren Materialien scrollt der
              Tipp hierher statt eines zu raten. */}
          {eventMaterials.length > 0 && (
            <IonList id="teamer-material-abschnitt" className="app-section-inset" inset={true}>
              <IonListHeader>
                <div className="app-section-icon app-section-icon--events">
                  <IonIcon icon={ICON_DATEI_GEFUELLT} />
                </div>
                <IonLabel>Material ({eventMaterials.length})</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent className="app-card-content">
                  {eventMaterials.map((mat) => (
                    <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
                      key={mat.id}
                      className="app-list-item app-list-item--material"
                      style={{ cursor: 'pointer', marginBottom: 'var(--app-abstand-eng)' }}
                      onClick={() => {
                        materialIdRef.current = mat.id;
                        presentMaterialModal({ presentingElement: presentingElement || pageRef.current || undefined });
                      }}
                    >
                      <div className="app-list-item__row">
                        <div className="app-list-item__main">
                          <div className="app-icon-circle app-icon-circle--material">
                            <IonIcon icon={mat.link_url ? ICON_LINK : ICON_DATEI_GEFUELLT} />
                          </div>
                          <div className="app-list-item__content">
                            <div className="app-list-item__title">{mat.title}</div>
                            <div className="app-list-item__meta">
                              {mat.link_url ? (
                                <span className="app-list-item__meta-item">
                                  <IonIcon icon={ICON_LINK} className="app-icon-color--material" />
                                  Link
                                </span>
                              ) : (
                                <span className="app-list-item__meta-item">
                                  <IonIcon icon={ICON_ANHANG} className="app-icon-color--material" />
                                  {mat.file_count || 0} {(mat.file_count || 0) === 1 ? 'Datei' : 'Dateien'}
                                </span>
                              )}
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
          onIonChange={(e) => mitmachenAnsichtWechseln(e.detail.value as 'events' | 'antraege')}
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
      <AppKopfzeile
        titel={pageTitle}
        rechts={(
          <>
            {isAntraege && (
              <IonButton onClick={handleAddRequest} aria-label="Neue Aktivität melden">
                <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} />
              </IonButton>
            )}
            {!isAntraege && (
              <IonButton onClick={() => presentScannerModal()} aria-label="QR-Code scannen">
                <IonIcon icon={ICON_SCANNEN} />
              </IonButton>
            )}
          </>
        )}
      />

      <IonContent className="app-gradient-background" fullscreen>
        <AppKopfzeileGross titel={pageTitle} />

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          if (isAntraege) {
            await refreshRequests();
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
              teamerMode={true}
              headerSlot={
                <>
                  {mainSegmentSlot}

                  {/* Offline-Warteschlange: was noch aussteht und was scheiterte */}
                  <WartendeVorgaengeKarte
                    wartend={wartend}
                    gescheitert={gescheitert}
                    onVergessen={vergessen}
                  />
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
              subtitle="Gottesdienste, Konfi-Tage und Fahrten"
              icon={ICON_TERMIN_GEFUELLT}
              preset="events"
              stats={statsData}
              onInfo={() => presentLegend({ presentingElement: presentingElement || pageRef.current || undefined })}
            />

            {mainSegmentSlot}

            {/* Reiter ZUERST, Suche darunter: erst
                eingrenzen, dann darin suchen -- wie im Chat. */}
            <div className="app-segment-wrapper">
              <IonSegment
                value={activeTab}
                onIonChange={(e) => setActiveTab(e.detail.value as 'meine' | 'alle' | 'team')}
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

            {/* Suche -- steht UNTER den Reitern, siehe Kommentar oben */}
            <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
              <IonListHeader>
                <div className="app-section-icon app-section-icon--events">
                  <IonIcon icon={ICON_FILTER} />
                </div>
                <IonLabel>Suche</IonLabel>
              </IonListHeader>
              <IonItemGroup>
                <IonItem>
                  <IonIcon icon={ICON_SUCHE_GEFUELLT} slot="start" className="app-icon-color--system" style={{ fontSize: 'var(--app-text-standard)' }} />
                  <IonInput aria-label="Events durchsuchen"
                    value={searchText}
                    onIonInput={(e) => setSearchText(e.detail.value || '')}
                    placeholder="Events durchsuchen..."
                  />
                </IonItem>
              </IonItemGroup>
            </IonList>

            {/* Events Liste */}
            <ListSection
              icon={ICON_TERMIN}
              title="Events"
              count={filteredEvents.length}
              iconColorClass="events"
              isEmpty={filteredEvents.length === 0}
              emptyIcon={ICON_TERMIN}
              emptyTitle="Keine Events"
              emptyMessage={getEmptyMessage()}
              emptyIconColor="var(--app-color-events)"
            >
              {filteredEvents.map((event, index) => {
                const { statusColor, statusText, statusIcon, isPastEvent, shouldGrayOut } = getEventStatusInfo(event);
                const showBadge = !isPastEvent || event.is_registered;

                // LOESCHEN FEHLT hier bewusst: Das nimmt Chat, Anmeldungen und
                // ausgedruckte QR-Codes mit und ist keine Absage.
                const zeile = (
                    <IonItem
                      key={event.id}
                      button
                      onClick={() => setSelectedEvent(event)}
                      detail={false}
                      lines="none"
                      style={{
                        marginBottom: index < filteredEvents.length - 1 ? 'var(--app-abstand-eng)' : '0',
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
                                  color: istAbgesagt(event) || shouldGrayOut ? 'var(--app-text-muted)' : undefined,
                                  textDecoration: titelDekoration('liste', event),
                                  paddingRight: showBadge ? 'var(--app-freiraum-aktion-l)' : '0',
                                  paddingTop: showBadge ? 'var(--app-abstand-mini)' : '0'
                                }}
                              >
                                {event.name}
                              </div>
                              {event.jahrgang_names && (
                                <div className="app-list-item__subtitle" style={{ color: shouldGrayOut ? 'var(--app-text-muted)' : undefined }}>
                                  {event.jahrgang_names.split(',').join(' · ')}
                                </div>
                              )}

                              <AbsageBlock event={event} variante="zeile" />

                              <div className="app-list-item__meta">
                                {event.teamer_only ? (
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={ICON_GRUPPE_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--team'} />
                                    {Math.max(0, event.teamer_count || 0)}
                                    {(event.teamer_max_participants || 0) > 0
                                      ? `/${event.teamer_max_participants}`
                                      : <>/<IonIcon icon={ICON_UNENDLICH} style={{ verticalAlign: 'middle', fontSize: 'var(--app-icon-inline)' }} /></>} Team
                                  </span>
                                ) : null}
                                {event.teamer_only && (event.teamer_waitlist_count ?? 0) > 0 && (
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={ICON_LISTE} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--waitlist'} />
                                    {event.teamer_waitlist_count}
                                    {(event.teamer_max_waitlist_size || 0) > 0 ? `/${event.teamer_max_waitlist_size}` : ''}
                                  </span>
                                )}
                                {!event.teamer_only && (
                                  <>
                                    <span className="app-list-item__meta-item">
                                      <IonIcon icon={ICON_GRUPPE_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--participants'} />
                                      {Math.max(0, event.registered_count || 0)}{event.max_participants > 0 ? `/${event.max_participants}` : <>/<IonIcon icon={ICON_UNENDLICH} style={{ verticalAlign: 'middle', fontSize: 'var(--app-icon-inline)' }} /></>}
                                    </span>
                                    {(event.teamer_count !== undefined && event.teamer_count > 0) && (
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={ICON_GRUPPE_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--team'} />
                                        {event.teamer_count} Team
                                      </span>
                                    )}
                                    {(event.teamer_waitlist_count ?? 0) > 0 && (
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={ICON_LISTE} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--waitlist'} />
                                        {event.teamer_waitlist_count}
                                        {(event.teamer_max_waitlist_size || 0) > 0 ? `/${event.teamer_max_waitlist_size}` : ''} wartet
                                      </span>
                                    )}
                                    {event.points > 0 && (
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={ICON_POKAL_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--points'} />
                                        {event.points}P
                                      </span>
                                    )}
                                    {/* Punkteart direkt hinter den Punkten.
                                        Gleiche Regel wie im Detail: keine
                                        Konfi-Punkte, keine Art. */}
                                    {zeigtPunkteart(event) && (
                                      <span className="app-list-item__meta-item">
                                        <IonIcon
                                          icon={event.point_type === 'gottesdienst' ? ICON_GOTTESDIENST_GEFUELLT : ICON_GEMEINDE_GEFUELLT}
                                          className={shouldGrayOut ? 'app-icon-color--muted' : (event.point_type === 'gottesdienst' ? 'app-icon-color--gottesdienst' : 'app-icon-color--gemeinde')}
                                        />
                                        {punkteartText(event)}
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>

                              {/* Datum + Uhrzeit */}
                              <div className="app-list-item__meta" style={{ marginTop: 'var(--app-abstand-mini)' }}>
                                <span className="app-list-item__meta-item">
                                  <IonIcon icon={ICON_TERMIN_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--events'} />
                                  {formatDate(event.event_date)}
                                </span>
                                <span className="app-list-item__meta-item">
                                  <IonIcon icon={ICON_UHRZEIT_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--time'} />
                                  {formatTime(event.event_date)}
                                </span>
                              </div>

                              {/* Ort */}
                              {event.location && (
                                <div className="app-list-item__meta" style={{ marginTop: 'var(--app-abstand-mini)' }}>
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={ICON_ORT_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--location'} />
                                    {event.location}
                                  </span>
                                </div>
                              )}

                              {/* Kategorien */}
                              {kategorienText(event) && (
                                <div className="app-list-item__meta" style={{ marginTop: 'var(--app-abstand-mini)' }}>
                                  <span className="app-list-item__meta-item app-list-item__meta-item--multiline">
                                    <IonIcon icon={ICON_KATEGORIE_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--category'} />
                                    {kategorienText(event)}
                                  </span>
                                </div>
                              )}

                              {/* Was mitbringen */}
                              {event.bring_items && (
                                <div className="app-list-item__meta" style={{ marginTop: 'var(--app-abstand-mini)' }}>
                                  <span className="app-list-item__meta-item app-list-item__meta-item--multiline">
                                    <IonIcon icon={ICON_MATERIAL} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--bring'} />
                                    {event.bring_items}
                                  </span>
                                </div>
                              )}
                              {/* Material */}
                              {(event.material_count || 0) > 0 && (
                                <div className="app-list-item__meta" style={{ marginTop: 'var(--app-abstand-mini)' }}>
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={ICON_ANHANG} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--material'} />
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

                return zeile;
              })}
            </ListSection>

          </>
        )}
      </IonContent>
    </IonPage>
  );

  // Termin aus einem fremden Jahrgang (Push oder Link): Grund und Ausweg
  // statt der stummen Liste. Dieselbe Seite wie in der Leitungsansicht
  // (admin/views/EventDetailView.tsx, jahrgangFehlt) -- gleicher Wortlaut,
  // damit beide Rollen dasselbe lesen. Zurueck fuehrt zur Liste; der Merker
  // handledEventId verhindert, dass der Effekt oben sofort wieder nachfragt.
  const renderJahrgangHinweis = () => (
    <IonPage ref={pageRef}>
      {/* Dieselbe Seite wie die Detailansicht -- ohne Gemeinde-Umschalter. */}
      <AppKopfzeile titel="Event" onZurueck={() => setJahrgangHinweis(false)} gemeindeUmschalter={false} />
      <IonContent className="app-gradient-background" fullscreen>
        <EmptyState
          icon={ICON_JAHRGANG}
          title="Nicht deinem Jahrgang zugeordnet"
          message="Dieses Event gehört zu einem Jahrgang, dem du nicht zugewiesen bist. Die Leitung deiner Gemeinde kann das in den Einstellungen ändern."
          iconColor="var(--app-color-events)"
        />
      </IonContent>
    </IonPage>
  );

  // Detail ersetzt die Liste (selectedEvent-State steuert die Ansicht).
  if (jahrgangHinweis) return renderJahrgangHinweis();
  return selectedEvent ? renderDetail() : renderList();
};

export default TeamerEventsPage;
