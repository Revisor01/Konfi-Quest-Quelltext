import {
  ICON_ABSAGE,
  ICON_ANTWORTEN,
  ICON_BEARBEITEN,
  ICON_KOPIEREN_GEFUELLT,
  ICON_CHAT,
  ICON_ENTFERNEN_GEFUELLT,
  ICON_GRUPPE_GEFUELLT,
  ICON_HAKEN_GEFUELLT,
  ICON_JAHRGANG,
  ICON_LOESCHEN_GEFUELLT,
  ICON_PERSON_HINZUFUEGEN_GEFUELLT,
  ICON_QRCODE,
  ICON_RUECKGAENGIG,
  ICON_TERMIN_GEFUELLT,
  ICON_TEXTDOKUMENT,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import AppKopfzeile, { AppKopfzeileGross } from '../../shared/AppKopfzeile';
import { fehlerDaten, fehlerStatus, fehlerText } from '../../../utils/fehler';
import { konfisInReihenfolge } from '../../../utils/teilnehmerReihenfolge';
import { bestaetigenMitRueckfrage, type UeberbuchenFrage } from '../../../utils/ueberbuchen';
import { darfTermineVerwalten } from '../../../utils/terminRechte';
import { kopiereTermin } from '../../../utils/terminVorbelegung';
import { welcheKnoepfe, zusageBeschriftung, absageBeschriftung, absageBrauchtGrund } from '../../../utils/zusageKnoepfe';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  IonPage, IonContent,
  IonButton, IonIcon, IonCard, IonCardContent,
  IonItem, IonLabel, IonList, IonListHeader,
  IonRefresher, IonRefresherContent, useIonModal,
  IonItemSliding, IonItemOptions, IonItemOption,
  useIonActionSheet, useIonAlert, useIonRouter
} from '@ionic/react';
import type { ActionSheetButton } from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import { offlineCache } from '../../../services/offlineCache';
import { offlineBlockiert } from '../../../utils/offlineAktion';
import { absageZuruecknehmenFragen } from '../../../utils/absageZuruecknehmen';
import OfflinePlatzhalter from '../../shared/OfflinePlatzhalter';
import api from '../../../services/api';
import { SectionHeader, AbsageBlock, EmptyState, formatEventDateLong as formatDate, formatEventTime as formatTime, istVergangen, istAbgesagt } from '../../shared';
import { getStatusIcon } from '../../shared/StatusBadge';
import EventModal from '../modals/EventModal';
import ParticipantManagementModal from '../modals/ParticipantManagementModal';
import QRDisplayModal from '../../shared/QRDisplayModal';
import TeamerMaterialDetailPage from '../../teamer/pages/TeamerMaterialDetailPage';
import TeamerAbsageModal from '../../teamer/modals/TeamerAbsageModal';
import { useLiveUpdate, useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import {
  EventInfoCard, DescriptionSection, SeriesEventsSection,
  UnregistrationsSection, EventMaterialSection, EventActionsSection,
  TimeslotsSection
} from './EventDetailSections';
import type { Participant, Unregistration, EventData } from './EventDetailSections';
import type { EventMaterial, Timeslot, Event as VollerEvent } from '../../../types/event';
import { triggerPullHaptic } from '../../../utils/haptics';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';
import { urheberZeile, notizUrheberZeile, checkinZeile } from '../../../utils/anwesenheitUrheber';
import { teilnahmeDarstellung, zaehltAlsAbgemeldet, listItemKlasse, iconKreisKlasse, eckBadgeKlasse } from '../../../utils/teilnahmeStatus';
import AnwesenheitNotizModal from '../modals/AnwesenheitNotizModal';
import AbmeldungNachtragenModal from '../modals/AbmeldungNachtragenModal';
import TerminAbsagenModal from '../modals/TerminAbsagenModal';
import LoadingSpinner from '../../common/LoadingSpinner';
import { trackHandlung } from '../../../services/analytics';
import { datumLang } from '../../../utils/dateUtils';

// Ionic 9 gibt bei ref an IonItemSliding die React-Komponente zurueck, nicht
// mehr das DOM-Element. Gebraucht wird hier nur close() — das haben beide.
type SlidingRef = { close: () => Promise<void> };

type Event = EventData;

interface EventDetailViewProps {
  eventId: number;
  onBack: () => void;
  // Im iPad-Split-View ist die Liste links dauerhaft sichtbar -> kein
  // Zurück-Button nötig.
  hideBackButton?: boolean;
}

const EventDetailView: React.FC<EventDetailViewProps> = ({ eventId, onBack, hideBackButton }) => {
  const pageRef = useRef<HTMLElement>(null);
  const slidingRefs = useRef<Map<number, SlidingRef>>(new Map());
  const { user, setSuccess, setError, isOnline } = useApp();
  const router = useIonRouter();
  const { triggerRefresh } = useLiveUpdate();
  const [presentActionSheet] = useIonActionSheet();
  const [presentAlert] = useIonAlert();

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [unregistrations, setUnregistrations] = useState<Unregistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventData, setEventData] = useState<Event | null>(null);
  const [jahrgangFehlt, setJahrgangFehlt] = useState(false);

  // ====================================================================
  // EIGENE AN-/ABMELDUNG
  // ====================================================================
  //
  // "Ich hab Teamer die auch Admins sind. Die muessen sich auch an oder
  // abmelden koennen fuer Events. Eigentlich sollten das einfach alle machen
  // koennen die einem Jahrgang zugeordnet sind. Ob Admin, orgadmin oder
  // Teamer."
  //
  // DAS BACKEND KONNTE DAS SCHON: POST /teamer/events/:id/zusage haengt an
  // requireTeamer, und das erlaubt org_admin, admin UND teamer
  // (rbac.js:274). Die Platzzaehlung unterscheidet ohnehin nur 'konfi' gegen
  // 'team', wobei team = "alles ausser konfi" ist (bookingUtils.js,
  // rollenBedingung) -- Admins zaehlen also laengst zur Team-Seite.
  //
  // ES FEHLTE ALLEIN DIE OBERFLAECHE: Die Zusage gab es nur unter
  // /teamer/events. Wer Admin ist, landet auf /admin/events und sah dort nur
  // die Absagen ANDERER, ohne sich selbst melden zu koennen.
  const [zusageLaeuft, setZusageLaeuft] = useState(false);

  /**
   * Der eigene Zusage-Stand an diesem Termin.
   *
   * HIER STAND BIS DAHIN:
   *   participants.find(p => p.user_id === user?.id)
   *
   * Gegen Produktion gemessen: Nach einer Zusage der Leitung ueber
   * POST /teamer/events/:id/zusage liefert GET /events/:id zwar
   * booking_status 'confirmed' -- die Leitung steht aber NICHT in
   * participants, weder nach der Zusage noch nach der Absage (beide Male
   * leeres Array). find() gab also immer undefined, welcheKnoepfe(undefined)
   * heisst 'beide', und deshalb standen dauerhaft beide Knoepfe da, egal was
   * gewaehlt war -- ununterscheidbar von "noch nichts entschieden".
   *
   * booking_status ist derselbe Wert, aus dem auch die Teamer-Seite ihre
   * Knoepfe ableitet (TeamerEventsPage, ZusageKnoepfe). Damit ist die
   * Entscheidung nicht nur in derselben Funktion, sondern auf derselben
   * Datengrundlage -- vorher war nur die halbe Angleichung passiert.
   */
  const eigeneZusage = eventData?.booking_status;

  /** Nimmt dieses Event ueberhaupt Team-Anmeldungen? */
  const nimmtTeamAn = !!(eventData?.teamer_needed || eventData?.teamer_only);

  /** Darf die angemeldete Person sich selbst melden? Alle ausser Konfis. */
  const darfSichMelden = user?.role_name !== 'konfi' && nimmtTeamAn
    && !istAbgesagt(eventData) && !istVergangen(eventData);

  /**
   * Darf hier ueberhaupt noch jemand eingetragen werden?
   *
   * ZWEI GRUENDE, WARUM NICHT:
   *
   * 2. Als Teamer:in. Teilnehmerverwaltung haengt im Backend an
   *    requireAdmin. Diese Ansicht steht auch dem Team offen, bot aber
   *    "Konfi hinzufuegen", "Team hinzufuegen" und "Leitung hinzufuegen" an —
   *    das Auswahl-Fenster lud sogar sauber und brach erst beim Speichern mit
   *    403 ab, also nach getaner Arbeit.
   *
   * istAbgesagt() statt eventData.cancelled von Hand: Es prueft beide Felder,
   * weil die Listen- und die Detail-Route verschiedene liefern.
   */
  const darfEintragen = !istAbgesagt(eventData) && darfTermineVerwalten(user);

  /**
   * Darf diese Person den Termin verwalten — absagen, Anwesenheit verbuchen,
   * Teilnehmende verschieben oder entfernen? Im Backend alles requireAdmin.
   * Anders als darfEintragen gilt das auch an abgesagten Terminen: Die Absage
   * zuruecknehmen ist ja gerade dort die Aufgabe.
   */
  const darfVerwalten = darfTermineVerwalten(user);

  const setzeEigeneZusage = async (dabei: boolean, grund?: string) => {
    if (!eventData || zusageLaeuft) return;
    setZusageLaeuft(true);
    const body = grund && grund.trim() ? { dabei, reason: grund.trim() } : { dabei };
    try {
      await api.post(`/teamer/events/${eventData.id}/zusage`, body);
      setSuccess(dabei ? 'Du bist dabei' : 'Absage gespeichert');
      loadEventData();
    } catch (err) {
      // Das Backend lehnt eine Absage nach Zusage ohne Grund mit
      // error_code 'grund_erforderlich' ab -- die Meldung durchreichen.
      setError(fehlerText(err, 'Anmeldung fehlgeschlagen'));
    } finally {
      setZusageLaeuft(false);
    }
  };

  const [eventMaterials, setEventMaterials] = useState<EventMaterial[]>([]);
  const [presentingElement, setPresentingElement] = useState<HTMLElement | null>(null);

  // HIER STAND BIS DAHIN window.prompt() -- das einzige im ganzen Frontend.
  // In der nativen App ist das ein System-Dialog ausserhalb des App-Designs,
  // ohne mitwachsendes Feld und ohne den Hinweis, warum ein Grund noetig ist.
  // Jetzt derselbe Dialog wie beim Team: TeamerAbsageModal, mit derselben
  // Grund-Regel aus utils/zusageKnoepfe.ts.
  // Namen mit "Eigene": presentAbsageModal weiter unten sagt den TERMIN ab
  // (TerminAbsagenModal, Leitungssache). Hier geht es nur um die eigene
  // Teilnahme -- zwei verschiedene Dinge am selben Termin.
  const [presentEigeneAbsageModal, dismissEigeneAbsageModal] = useIonModal(TeamerAbsageModal, {
    eventName: eventData?.name || '',
    grundPflicht: absageBrauchtGrund(eigeneZusage),
    onAbsage: (grund: string) => { setzeEigeneZusage(false, grund); },
    dismiss: (data?: string, role?: string) => dismissEigeneAbsageModal(data, role)
  });

  const oeffneEigeneAbsage = () => {
    presentEigeneAbsageModal({ presentingElement: presentingElement || undefined });
  };

  // Material Detail Modal (wie Teamer)
  const materialIdRef = useRef<number | null>(null);
  const [presentMaterialModal, dismissMaterialModal] = useIonModal(TeamerMaterialDetailPage, {
    // Der Ref wird in handleMaterialClick gesetzt, BEVOR das Modal geoeffnet
    // wird — beim Rendern ist er null, beim Anzeigen nie. Ionic 9 typisiert
    // useIonModal strenger und sieht nur die Deklaration.
    get materialId() { return materialIdRef.current as number; },
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

  // KOPIEREN braucht ein EIGENES Modal: Das Hook oben ist fest an
  // eventData gebunden und wuerde diesen Termin BEARBEITEN. Die Kopie ist eine
  // Neuanlage (id 0), deshalb ein zweiter Einstieg mit der Vorlage.
  const [kopierVorlage, setKopierVorlage] = useState<VollerEvent | null>(null);
  const [kopierteTimeslots, setKopierteTimeslots] = useState<Timeslot[]>([]);

  const [presentKopierModal, dismissKopierModal] = useIonModal(EventModal, {
    event: kopierVorlage,
    vorbelegteTimeslots: kopierteTimeslots,
    onDirtyChange: (dirty: boolean) => { eventModalDirtyRef.current = dirty; },
    onClose: () => dismissKopierModal(),
    onSuccess: () => {
      dismissKopierModal();
      onBack();
    },
    dismiss: () => dismissKopierModal()
  });

  /**
   * Termin kopieren: oeffnet das Anlege-Formular vorbefuellt. Angelegt wird
   * nichts, bis gespeichert wird. Regel siehe utils/terminVorbelegung.ts.
   */
  const handleKopieren = async () => {
    if (!eventData) return;
    if (offlineBlockiert(isOnline, setError)) return;

    let slots: Timeslot[] = [];
    if (eventData.has_timeslots) {
      try {
        const res = await api.get(`/events/${eventData.id}/timeslots`);
        slots = res.data || [];
      } catch {
        setError('Die Zeitfenster konnten nicht geladen werden — die Kopie hat keine.');
      }
    }

    const { event: vorlage, timeslots: neueSlots } = kopiereTermin(eventData as unknown as VollerEvent, slots);
    setKopierteTimeslots(neueSlots);
    setKopierVorlage(vorlage);
    presentKopierModal({
      presentingElement: presentingElement || undefined,
      canDismiss: eventModalCanDismiss,
      backdropDismiss: false
    });
  };

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

  // Vorher lief die Notiz-Eingabe ueber useIonAlert und fiel damit aus dem
  // Muster: Der Absagegrund der Konfi laeuft ueber UnregisterModal, alle
  // Texteingaben der Leitung sind Modals. Der Alert bot ausserdem keinen
  // Loeschen-Knopf.
  //
  // Ref-Getter wie beim Material-Modal darueber: Welche Person gemeint ist,
  // steht erst beim Oeffnen fest, die Props werden aber schon beim Rendern
  // deklariert.
  const notizTeilnehmerRef = useRef<Participant | null>(null);
  const [presentNotizModal, dismissNotizModal] = useIonModal(AnwesenheitNotizModal, {
    get teilnehmerName() { return notizTeilnehmerRef.current?.participant_name ?? ''; },
    get notiz() { return notizTeilnehmerRef.current?.attendance_note ?? null; },
    onSave: async (neueNotiz: string) => {
      const teilnehmer = notizTeilnehmerRef.current;
      if (!teilnehmer?.attendance_status) return;
      await handleAttendanceUpdate(teilnehmer, teilnehmer.attendance_status, {
        // Der Grund bleibt, was er war: Bei 'excused' wuerde ein fehlendes
        // Feld ihn sonst loeschen (die Route setzt ihn bei jedem
        // 'excused'-Schreiben neu).
        ...(teilnehmer.attendance_status === 'excused'
          ? { excuse_reason: teilnehmer.excuse_reason || '' }
          : {}),
        // Leerer String heisst loeschen — die Route unterscheidet "Feld
        // fehlt" (Notiz bleibt) von "Feld ist leer" (Notiz weg).
        attendance_note: neueNotiz
      });
    },
    dismiss: () => dismissNotizModal()
  });

  // ABMELDUNGS-MODAL
  //
  // WO ALERT, WO MODAL — die Linie, damit sie nicht wieder auseinanderlaeuft:
  //
  //   TEXTEINGABE  -> Modal. Grund und Notiz sind Freitext, der bleibt und den
  //     andere lesen. Ein Modal gibt ihm ein mitwachsendes Feld, eine
  //     Kopfzeile mit Schliessen links und Speichern rechts, und auf kleinen
  //     Geraeten genug Platz. So laufen alle Texteingaben in dieser App
  //     (UnregisterModal, BonusModal, MaterialFormModal).
  //
  //   JA/NEIN-RUECKFRAGE -> Alert. "Alle bestätigen?", "Auf die Warteliste
  //     setzen?", "Anmeldung entfernen?" fragen nichts ab, sie holen eine
  //     Bestaetigung fuer etwas, das sonst still passiert waere (die beiden
  //     letzten haengen an einer Wisch-Geste, ein Fehlwisch soll nicht
  //     durchgehen). Daraus ein Modal zu machen, waere ein Seitenwechsel fuer
  //     eine Frage, die in zwei Zeilen beantwortet ist — und zwei der drei
  //     muessen die Wisch-Geste beim Abbrechen wieder zurueckfahren, was im
  //     Alert-Handler direkt danebensteht.
  //
  // Kurz: Wer etwas SCHREIBT, bekommt ein Modal. Wer nur BESTAETIGT, einen
  // Alert.
  const abmeldungTeilnehmerRef = useRef<Participant | null>(null);
  const [presentAbmeldungModal, dismissAbmeldungModal] = useIonModal(AbmeldungNachtragenModal, {
    get teilnehmerName() { return abmeldungTeilnehmerRef.current?.participant_name ?? ''; },
    get grund() { return abmeldungTeilnehmerRef.current?.excuse_reason ?? null; },
    get notiz() { return abmeldungTeilnehmerRef.current?.attendance_note ?? null; },
    onSave: async (neuerGrund: string, neueNotiz: string) => {
      const teilnehmer = abmeldungTeilnehmerRef.current;
      if (!teilnehmer) return;
      await handleAttendanceUpdate(teilnehmer, 'excused', {
        excuse_reason: neuerGrund,
        attendance_note: neueNotiz
      });
    },
    dismiss: () => dismissAbmeldungModal()
  });

  // Kein Ref-Getter noetig wie bei den Teilnehmer-Modals: Welcher Termin
  // gemeint ist, steht in dieser Ansicht von vornherein fest.
  const [presentAbsageModal, dismissAbsageModal] = useIonModal(TerminAbsagenModal, {
    get terminName() { return eventData?.name ?? ''; },
    get terminDatum() {
      if (!eventData?.event_date) return '';
      return datumLang(eventData.event_date);
    },
    // DIESELBE REGEL WIE UEBERALL SONST: Abgemeldete sind keine
    // Teilnehmenden -- weder die Selbstabmeldung ('opted_out') noch die
    // Abmeldung durch die Leitung ('excused'). `status === 'confirmed'` deckt
    // beide ab, weil beide Vorgaenge den Buchungsstatus verlassen; es ist
    // genau die Bedingung, aus der die View konfi_confirmed bildet, und
    // dieselbe, die die Kachel darueber benutzt.
    get konfiAnzahl() {
      return participants.filter(p => p.role_name === 'konfi' && p.status === 'confirmed').length;
    },
    onSave: async (grund: string) => {
      if (!eventData) return;
      await api.put(`/events/${eventData.id}/cancel`, {
        notification_message: 'Das Event wurde leider abgesagt.',
        cancelled_reason: grund
      });
      setSuccess('Event wurde abgesagt');
      onBack();
    },
    dismiss: () => dismissAbsageModal()
  });

  // Der ABSAGEGRUND wird nur ueber den Wisch an der Zeile in der Terminliste
  // (AdminEventsPage) bearbeitet -- die Absage-Karte hier bleibt reine
  // Auskunft.

  // QR Display Modal
  const [presentQRDisplayModal, dismissQRDisplayModal] = useIonModal(QRDisplayModal, {
    eventId: eventId,
    eventName: eventData?.name || '',
    eventDate: eventData?.event_date || '',
    onClose: () => dismissQRDisplayModal()
  });

  // Participant Management Modal
  const [, dismissParticipantModalHook] = useIonModal(ParticipantManagementModal, {
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

  // Leitungs-Modal (filterRole: 'leitung') — Admins/Org-Admins bewusst pro
  // Termin zuordnen. Wer zugeordnet ist, kommt in den Chat zum Termin; ein
  // automatisches Hineinrutschen in jeden Event-Chat gibt es ausdruecklich nicht.
  const [presentLeitungModal, dismissLeitungModal] = useIonModal(ParticipantManagementModal, {
    eventId: eventId,
    onClose: () => dismissLeitungModal(),
    onSuccess: () => {
      dismissLeitungModal();
      loadEventData();
    },
    dismiss: () => dismissLeitungModal(),
    filterRole: 'leitung'
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

  // Welcher Termin gerade gelten soll. Eine Antwort, die zu einer aelteren
  // Anfrage gehoert, darf den Stand nicht mehr ueberschreiben (siehe unten).
  const aktuelleEventId = useRef(eventId);

  // Beim Wechsel des Termins den Stand des VORIGEN leeren.
  //
  // Ursache: Der IonRouterOutlet behaelt gemountete Seiten im Speicher, und
  // ParamSeite (MainTabs.tsx) reicht die ID als Prop durch, ohne die Seite
  // beim Wechsel neu einzuhaengen. Dieselbe Instanz bekommt also nur eine
  // neue eventId — participants, unregistrations, eventData und die
  // Materialien behielten die Werte des vorigen Termins. Online sah man sie,
  // bis die neue Antwort eintraf; OFFLINE blieben sie dauerhaft stehen, denn
  // der Offline-Zweig unten setzt Teilnehmer und Abmeldungen gar nicht.
  useEffect(() => {
    aktuelleEventId.current = eventId;
    setParticipants([]);
    setUnregistrations([]);
    setEventData(null);
    setEventMaterials([]);
    setJahrgangFehlt(false);
    setError('');
    setLoading(true);
  }, [eventId]);

  // isOnline in den Abhaengigkeiten: Kommt die Verbindung zurueck, muss der
  // aus dem Cache gezeigte Grundstand durch die vollen Detaildaten
  // (Teilnehmer, Abmeldungen) ersetzt werden. Ohne das bliebe die Seite auf
  // dem Offline-Stand stehen, bis man sie verlaesst und neu oeffnet.
  useEffect(() => {
    loadEventData(eventId);
  }, [eventId, isOnline]);

  useEffect(() => {
    setPresentingElement(pageRef.current);
  }, []);

  // Live-Ereignisse empfangen. Die Termin-Detailseite hoerte bisher auf nichts,
  // obwohl das Backend fuer Termine 32 Ereignisse sendet — darunter jeder
  // QR-Check-in (events.js): Der Zaehler auf dem offenen QR-Code stand still
  // 
  useLiveRefresh(['events', 'konfis'], useCallback(() => {
    loadEventData(eventId);
  }, [eventId]));

  const loadEventData = async (fuerEventId: number = eventId) => {
    // Eine Antwort gilt nur, solange sie zum aktuell geoeffneten Termin
    // gehoert. Wechselt man schnell zwischen zwei Terminen, kann die Antwort
    // fuer den ERSTEN nach der des zweiten eintreffen — ohne diesen Riegel
    // schriebe sie dessen Teilnehmerliste wieder mit der falschen zu
    // (dasselbe Bild wie der Fehler oben, nur seltener).
    const gilt = () => aktuelleEventId.current === fuerEventId;

    // Die Liste liefert nur den Grundstand: Teilnehmerliste und Abmeldungen
    // haengen an GET /events/:id und bleiben offline leer. Besser der Titel
    // mit Datum als gar nichts.
    if (!isOnline) {
      try {
        const gecacht = await offlineCache.get<Event[]>('admin:events:' + user?.organization_id);
        const ausListe = gecacht?.data?.find((e) => e.id === fuerEventId) || null;
        if (!gilt()) return;
        if (ausListe) {
          setEventData(ausListe);
          setError('');
        } else {
          setError('Dieses Event wurde noch nicht geladen — dafür brauchst du eine Verbindung.');
        }
      } catch {
        if (gilt()) setError('Dieses Event wurde noch nicht geladen — dafür brauchst du eine Verbindung.');
      } finally {
        if (gilt()) setLoading(false);
      }
      return;
    }

    try {
      const eventRes = await api.get(`/events/${fuerEventId}`);
      if (!gilt()) return;
      setJahrgangFehlt(false);
      setEventData(eventRes.data);
      setParticipants(eventRes.data.participants || []);
      setUnregistrations(eventRes.data.unregistrations || []);
      try {
        const matRes = await api.get(`/material/by-event/${fuerEventId}`);
        if (gilt()) setEventMaterials(matRes.data || []);
      } catch {
        if (gilt()) setEventMaterials([]);
      }
    } catch (err) {
      if (!gilt()) return;
      // Kein Fehler der App, sondern eine Antwort mit Grund: Der Termin
      // gehoert zu einem Jahrgang, dem dieser Zugang nicht zugewiesen ist
      // (lesen.js). Dann KEIN roter Kasten und keine Fehlermessung --
      // stattdessen die Erklaerung auf der Seite (siehe jahrgangFehlt).
      if (fehlerStatus(err) === 403 && fehlerDaten(err)?.error_code === 'jahrgang_nicht_zugewiesen') {
        setJahrgangFehlt(true);
        return;
      }
      setError('Fehler beim Laden der Event-Daten', { ort: 'event-detail-laden', fehler: err });
    } finally {
      if (gilt()) setLoading(false);
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
  // Die Berechnung steht in `backend/utils/terminAnmeldeStatus.js`
  // (`anmeldeStatusSql`).
  //
  // Bei "Nur Team"- und "Team gesucht"-Terminen zaehlt ohnehin das
  // TEAMER-Kontingent: registration_status rechnet ausschliesslich mit
  // Konfi-Zahlen (Migration 120), deshalb hat das Backend dafuer einen
  // zweiten Wert. 'waitlist' gibt es nur dort und heisst fuers Anmelden:
  // offen, nur eben auf die Warteliste.
  const calculateRegistrationStatus = (event: Event): 'upcoming' | 'open' | 'closed' | 'cancelled' | 'mandatory' | undefined => {
    const nurTeam = !!(event.teamer_only || event.teamer_needed);
    if (nurTeam && event.teamer_registration_status && event.teamer_registration_status !== 'none') {
      const t = event.teamer_registration_status;
      return t === 'waitlist' ? 'open' : t;
    }
    return event.registration_status as 'upcoming' | 'open' | 'closed' | 'cancelled' | 'mandatory' | undefined;
  };

  const handleEditSuccess = () => { onBack(); };

  const getStatusColors = (): { primary: string; secondary: string } => {
    // Alle Status-Farben kommen aus globalen CSS-Token (--app-color-*).
    // Änderung der Domain-Farbe im CSS wirkt hier automatisch.
    const events = { primary: 'var(--app-color-events)', secondary: 'var(--app-color-events)' };
    const danger = { primary: 'var(--app-color-danger)', secondary: 'var(--app-color-danger)' };
    const konfirm = { primary: 'var(--app-color-konfis)', secondary: 'var(--app-color-konfis)' }; // Konfirmation = lila
    const info = { primary: 'var(--app-color-info)', secondary: 'var(--app-color-info)' };
    const past = { primary: 'var(--app-color-neutral)', secondary: 'var(--app-color-neutral)' };
    const waitlist = { primary: 'var(--app-color-bonus)', secondary: 'var(--app-color-bonus)' };
    const success = { primary: 'var(--app-color-success)', secondary: 'var(--app-color-success)' };
    const upcoming = { primary: 'var(--app-color-bonus)', secondary: 'var(--app-color-bonus)' };

    if (!eventData) return events;
    const isPastEvent = istVergangen(eventData);
    const isKonfirmationEvent = eventData.is_konfirmation;
    const isCancelledStatus = istAbgesagt(eventData);
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
    // meldet bei freier Warteliste weiterhin 'open' (`anmeldeStatusSql` in
    // `backend/utils/terminAnmeldeStatus.js`).
    const istVoll = eventData.max_participants > 0
      && eventData.registered_count >= eventData.max_participants;
    if (istVoll && eventData.waitlist_enabled) return waitlist;
    if (istVoll) return danger;
    if (regStatus === 'open') return success;
    if (regStatus === 'upcoming') return upcoming;
    return events;
  };

  const getStatusText = () => {
    if (!eventData) return 'Event';
    const isPastEvent = istVergangen(eventData);
    const isKonfirmationEvent = eventData.is_konfirmation;
    const isCancelledStatus = istAbgesagt(eventData);
    const hasUnprocessedBookings = isPastEvent && eventData.registered_count > 0 &&
      participants.some(p => p.status === 'confirmed' && !p.attendance_status);

    if (isCancelledStatus) return 'Abgesagt';
    if (isKonfirmationEvent && !isPastEvent) return 'Konfirmation';
    if (hasUnprocessedBookings) return 'Verbuchen';
    if (isPastEvent && !hasUnprocessedBookings) return 'Verbucht';

    const regStatus = calculateRegistrationStatus(eventData);
    if (regStatus === 'mandatory') return 'Pflicht-Event';
    const istVoll = eventData.max_participants > 0
      && eventData.registered_count >= eventData.max_participants;
    if (istVoll && eventData.waitlist_enabled) return 'Warteliste';
    if (istVoll) return 'Ausgebucht';
    if (regStatus === 'open') return 'Offen';
    if (regStatus === 'upcoming') return 'Bald';
    if (regStatus === 'closed') return 'Geschlossen';
    // Kein Status vom Backend: neutral bleiben statt "Geschlossen" behaupten.
    return 'Event';
  };

  // Grund und Notiz gehen mit derselben Route mit. Der Grund gehoert zu
  // 'excused' und wird vom Backend beim Wechsel auf einen anderen Status
  // geleert; die Notiz ("ging um 14 Uhr") haengt NICHT am Status und bleibt
  // stehen, solange nichts Neues geschickt wird. Kommt sie LEER mit, wird sie
  // geloescht — die Route unterscheidet "Feld fehlt" von "Feld ist leer".
  //
  // status = null setzt den Eintrag ZURUECK: Die Person steht danach wieder
  // als unverbucht in der Liste, Grund und Urheber sind weg, Punkte kommen
  // zurueck. Die NOTIZ bleibt -- sie haengt nicht am Status (dieselbe Regel
  // wie beim Wechsel zwischen anwesend und abwesend) und wird ueber ihren
  // eigenen Weg geloescht.
  const handleAttendanceUpdate = async (
    participant: Participant,
    status: 'present' | 'absent' | 'excused' | null,
    texte?: { excuse_reason?: string; attendance_note?: string }
  ) => {
    if (offlineBlockiert(isOnline, setError)) return;
    const grund = status === 'excused' ? (texte?.excuse_reason || null) : null;
    const notizMitgeschickt = texte?.attendance_note !== undefined;
    const notiz = notizMitgeschickt
      ? (texte!.attendance_note!.trim() || null)
      : (participant.attendance_note ?? null);
    setParticipants(prev => prev.map(p =>
      p.id === participant.id
        ? {
            ...p,
            attendance_status: status,
            excuse_reason: grund,
            attendance_note: notiz,
            // Die Urheber-Zeilen zeigen ab sofort die eigene Person: Der
            // Status wird bei jedem Aufruf geschrieben, die Notiz nur, wenn
            // sie mitkam. Der genaue Zeitstempel kommt mit dem naechsten
            // Laden nach; hier zaehlt, dass die Zeile nicht weiter jemand
            // anderen nennt, waehrend gerade die eigene Aenderung dasteht.
            // Beim Zuruecksetzen faellt die Urheber-Zeile mit weg: Es gibt
            // keinen Eintrag mehr, dessen Urheberschaft festzuhalten waere.
            attendance_set_by_name: status === null ? null : (user?.display_name ?? p.attendance_set_by_name),
            attendance_set_at: status === null ? null : new Date().toISOString(),
            ...(status === null ? { excuse_reason: null } : {}),
            ...(notizMitgeschickt
              ? {
                  note_set_by_name: notiz ? (user?.display_name ?? null) : null,
                  note_set_at: notiz ? new Date().toISOString() : null
                }
              : {})
          }
        : p
    ));
    try {
      await api.put(`/events/${eventId}/participants/${participant.id}/attendance`, {
        attendance_status: status,
        ...(texte?.excuse_reason !== undefined ? { excuse_reason: texte.excuse_reason } : {}),
        ...(notizMitgeschickt ? { attendance_note: texte!.attendance_note } : {})
      });
      // Anonyme Messung NACH der erfolgreichen Antwort: die Anwesenheit ist
      // wirklich verbucht. Nur Umfang und Gruppe — keine Person, kein Termin,
      // kein Status-Detail, kein Grund und keine Notiz.
      trackHandlung('anwesenheit-erfasst', {
        umfang: 'einzeln',
        gruppe: participant.role_name === 'konfi' ? 'konfi' : 'teamer'
      });
      triggerRefresh('events');
    } catch {
      setParticipants(prev => prev.map(p =>
        p.id === participant.id
          ? {
              ...p,
              attendance_status: participant.attendance_status,
              excuse_reason: participant.excuse_reason,
              attendance_note: participant.attendance_note,
              attendance_set_by_name: participant.attendance_set_by_name,
              attendance_set_at: participant.attendance_set_at,
              note_set_by_name: participant.note_set_by_name,
              note_set_at: participant.note_set_at
            }
          : p
      ));
      setError('Fehler beim Aktualisieren der Anwesenheit');
    }
  };

  // Ein MODAL, kein Alert: siehe AbmeldungNachtragenModal. Die
  // Abmeldung war beim Umbau der Notiz als Alert stehengeblieben — dieselbe
  // Begruendung traegt hier genauso, und mit zwei Textfeldern erst recht.
  const showAbmeldungModal = (participant: Participant) => {
    abmeldungTeilnehmerRef.current = participant;
    presentAbmeldungModal({ presentingElement: presentingElement || undefined });
  };

  // Notiz allein aendern, ohne am Status zu ruehren. Der Status wird dabei
  // mitgeschickt, weil die Route ihn verlangt — es ist derselbe wie zuvor.
  const showNotizModal = (participant: Participant) => {
    if (!participant.attendance_status) {
      setError('Erst die Anwesenheit setzen, dann die Notiz eintragen');
      return;
    }
    notizTeilnehmerRef.current = participant;
    presentNotizModal({ presentingElement: presentingElement || undefined });
  };

  const showAttendanceActionSheet = (participant: Participant) => {
    // Anwesenheit verbuchen ist Leitungssache (requireAdmin). Der Riegel sitzt
    // hier UND am Zeilen-Tipp: Die Zeitfenster-Liste ruft dieselbe Funktion
    // ueber ein Prop auf, dort gaebe es sonst einen zweiten Weg herein.
    if (!darfVerwalten) return;
    if (offlineBlockiert(isOnline, setError)) return;
    const buttons: ActionSheetButton[] = [];
    if (participant.attendance_status !== 'present') {
      buttons.push({ text: 'Anwesend', icon: ICON_ZUSAGE_GEFUELLT, handler: () => handleAttendanceUpdate(participant, 'present') });
    }
    if (participant.attendance_status !== 'absent') {
      buttons.push({ text: 'Abwesend', icon: ICON_ABSAGE, handler: () => handleAttendanceUpdate(participant, 'absent') });
    }
    // Immer angeboten, auch wenn schon 'excused': dann ist es das Bearbeiten
    // des Grundes.
    buttons.push({
      text: participant.attendance_status === 'excused' ? 'Abmeldung bearbeiten' : 'Abgemeldet',
      icon: ICON_ENTFERNEN_GEFUELLT,
      handler: () => showAbmeldungModal(participant)
    });
    if (participant.attendance_status) {
      buttons.push({
        text: participant.attendance_note ? 'Notiz bearbeiten' : 'Notiz hinzufügen',
        icon: ICON_TEXTDOKUMENT,
        handler: () => showNotizModal(participant)
      });
    }
    // Nur sichtbar, wenn ueberhaupt etwas eingetragen ist -- bei einer
    // unverbuchten Person gaebe es nichts zurueckzusetzen, und der Eintrag
    // waere ein Knopf ohne Wirkung.
    //
    // WORTLAUT: "Eintrag zuruecksetzen" und nicht "Loeschen". Geloescht wird
    // im Repo, was verschwindet (Teilnehmer:in entfernen, Notiz loeschen);
    // hier bleibt die Buchung bestehen, nur die Verbuchung faellt weg. Der
    // Satz beschreibt genau das, was passiert: die Person steht danach wieder
    // da, wo sie vor dem Eintrag stand.
    //
    // ROLLE: 'destructive'. Der Eintrag nimmt Punkte zurueck und loescht den
    // Abmeldegrund samt Urheber -- dieselbe Art von Folge wie beim Entfernen
    // eines Teilnehmers, das im Wartelisten-Sheet ebenfalls rot steht. Ein
    // neutraler Eintrag stuende gleichrangig neben "Anwesend" und "Abwesend"
    // und liesse sich im Vorbeitippen treffen.
    if (participant.attendance_status) {
      buttons.push({
        text: 'Eintrag zurücksetzen',
        icon: ICON_RUECKGAENGIG,
        role: 'destructive',
        handler: () => handleAttendanceUpdate(participant, null)
      });
    }
    buttons.push({ text: 'Abbrechen', role: 'cancel' });
    presentActionSheet({ header: participant.participant_name, subHeader: 'Anwesenheit verwalten', buttons });
  };

  const showWaitlistActionSheet = (participant: Participant) => {
    if (!darfVerwalten) return;
    if (offlineBlockiert(isOnline, setError)) return;
    presentActionSheet({
      header: participant.participant_name,
      subHeader: 'Warteliste verwalten',
      buttons: [
        { text: 'Bestätigen', icon: ICON_HAKEN_GEFUELLT, handler: () => handlePromoteParticipant(participant) },
        { text: 'Entfernen', icon: ICON_LOESCHEN_GEFUELLT, role: 'destructive', handler: () => handleRemoveParticipant(participant) },
        { text: 'Abbrechen', role: 'cancel' }
      ]
    });
  };

  const frageUeberbuchen = (frage: UeberbuchenFrage) => new Promise<boolean>((resolve) => {
    presentAlert({
      header: frage.header,
      message: frage.message,
      buttons: [
        { text: 'Abbrechen', role: 'cancel', handler: () => resolve(false) },
        { text: 'Trotzdem bestätigen', handler: () => resolve(true) }
      ],
      // Tippen neben den Dialog ist ein Nein; ein zweites resolve nach dem
      // Button-Handler bleibt wirkungslos.
      onDidDismiss: () => resolve(false)
    });
  });

  const handlePromoteParticipant = async (participant: Participant) => {
    try {
      const ergebnis = await bestaetigenMitRueckfrage(
        (ueberbuchen) => api.put(
          `/events/${eventId}/participants/${participant.id}/status`,
          ueberbuchen ? { status: 'confirmed', ueberbuchen: true } : { status: 'confirmed' }
        ).then(() => undefined),
        frageUeberbuchen,
        participant.participant_name
      );
      if (ergebnis === 'abgebrochen') return;
      await loadEventData();
      triggerRefresh('events');
    } catch (error) {
      console.error('Promote participant error:', error);
      setError(fehlerText(error, 'Fehler beim Bestätigen des Teilnehmers'));
    }
  };

  const handleConfirmAllAttendance = async (
    unprocessedCount: number,
    waitlistCount: number,
    rolle: 'konfi' | 'teamer' = 'konfi'
  ) => {
    if (offlineBlockiert(isOnline, setError)) return;
    const waitlistHint = waitlistCount > 0
      ? ` Die Warteliste (${waitlistCount}) bleibt unberührt.`
      : '';
    const wen = rolle === 'teamer' ? 'Team' : 'Teilnehmer:in(nen)';
    // Punkte gibt es nur bei Konfis -- das gehoert in die Rueckfrage, sonst
    // erwartet die Leitung bei Teamer:innen eine Punktevergabe, die ausbleibt.
    const punkteHinweis = rolle === 'teamer'
      ? ' Das Team bekommt dabei keine Punkte.'
      : ' (inkl. Punktevergabe)';
    // ALERT, kein Modal: reine Ja/Nein-Rueckfrage ohne Eingabe. Die Linie
    // steht beim Abmeldungs-Modal weiter oben.
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
              // Anonyme Messung NACH der erfolgreichen Antwort. Bewusst OHNE
              // die Anzahl: bei einer kleinen Gemeinde waere die Gruppengroesse
              // ein Fingerabdruck.
              trackHandlung('anwesenheit-erfasst', {
                umfang: 'alle',
                gruppe: rolle === 'teamer' ? 'teamer' : 'konfi'
              });
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
    } catch (error) {
      console.error('Demote participant error:', error);
      setError(fehlerText(error, 'Fehler beim Verschieben auf Warteliste'));
    }
  };

  // Rueckfrage vor dem Verschieben auf die Warteliste: ausgelöst wird das per
  // Wisch-Geste, ein Fehlwisch hätte sonst still eine Anmeldung zurueckgestuft
  // Das Absagen des Events fragt hier laengst nach.
  //
  // ALERT, kein Modal: nichts einzugeben, nur zu bestaetigen — und der
  // Abbrechen-Zweig muss die Wisch-Geste wieder zufahren, was hier direkt
  // danebensteht. Die Linie steht beim Abmeldungs-Modal weiter oben.
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
    } catch (error) {
      console.error('Delete participant error:', error);
      setError(fehlerText(error, 'Fehler beim Entfernen des Teilnehmers'));
    }
  };

  // Ebenfalls per Wisch-Geste erreichbar und nicht umkehrbar -> Rueckfrage.
  // ALERT, kein Modal: Bestaetigung ohne Eingabe, siehe oben.
  const handleRemoveParticipant = (participant: Participant) => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Anmeldung entfernen?',
      message: `${participant.participant_name || 'Diese Person'} wird von diesem Event abgemeldet. Ein frei werdender Platz geht an die Warteliste.`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel', handler: () => { slidingRefs.current.get(participant.id)?.close(); } },
        { text: 'Entfernen', role: 'destructive', handler: () => { removeParticipant(participant); } }
      ]
    });
  };

  const isCancelled = istAbgesagt(eventData);

  // Absagen oeffnet das Modal mit dem optionalen Grund — bis
  // hierher ein Action Sheet, was richtig war, solange es nur zu bestaetigen
  // gab. Mit dem Freitext gilt die Linie aus AbmeldungNachtragenModal: Wer
  // etwas SCHREIBT, bekommt ein Modal.
  const handleCancelEvent = async () => {
    if (!isOnline || !eventData) return;
    presentAbsageModal({ presentingElement: presentingElement || undefined });
  };

  // ABSAGE ZURUECKNEHMEN, der Knopf ganz unten:
  // "Könnten wir diesen Button genau so bauen, ganz unten bei einem Event
  // [...] sodass wir da eine Symmetrie haben?" Am aktiven Termin steht dort
  // "Event absagen", am abgesagten stattdessen dieser hier.
  //
  // DIESELBE RUECKFRAGE WIE DER WISCH IN DER LISTE: Sie steht in
  // utils/absageZuruecknehmen.ts, damit es sie nur einmal gibt. Heute wurde
  // hier schon einmal eine zweite Rueckfrage entfernt -- eine Kopie waere der
  // Rueckweg dorthin.
  //
  // DIE ZAHL STIMMT AUCH HIER: durch_absage_abgemeldet_count liefert GET
  // /events/:id mit (lesen.js), nicht nur die beiden Listen.
  const handleAbsageZuruecknehmen = () => {
    if (offlineBlockiert(isOnline, setError) || !eventData) return;
    absageZuruecknehmenFragen(eventData, {
      presentAlert,
      setSuccess,
      setError,
      onErfolg: () => loadEventData()
    });
  };

  const handleCreateEventChat = async () => {
    if (offlineBlockiert(isOnline, setError)) return;
    try {
      const res = await api.post(`/events/${eventData?.id}/chat`);
      setSuccess('Chat erstellt');
      router.push(`/admin/chat/room/${res.data.chat_room_id}`, 'root');
    } catch (error) {
      setError(fehlerText(error, 'Fehler beim Erstellen des Chats'));
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

  const handleMaterialHinweisClick = () => {
    if (eventMaterials.length === 1) {
      handleMaterialClick(eventMaterials[0].id);
      return;
    }
    document.getElementById('event-material-abschnitt')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Zugeordnete Leitung (Admin/Org-Admin). Sie steht in der Team-Liste,
  // hat aber keinen Jahrgang und ist deshalb eigens zu kennzeichnen.
  const istLeitung = (p: Participant) =>
    p.role_name === 'admin' || p.role_name === 'org_admin';

  // Helper: Einzelnen Teilnehmer rendern
  const renderParticipant = (participant: Participant) => {
    const darstellung = teilnahmeDarstellung(participant);
    const isOptedOut = darstellung.istAbgemeldet;
    const isExcused = darstellung.istNachgetragen;
    const listItemClass = listItemKlasse(darstellung);
    const iconCircleClass = iconKreisKlasse(darstellung);
    const cornerBadgeClass = eckBadgeKlasse(darstellung);
    const statusText = darstellung.statusText;
    const statusIcon = isOptedOut ? ICON_ABSAGE :
                       isExcused ? ICON_ENTFERNEN_GEFUELLT :
                       participant.attendance_status === 'present' ? ICON_ZUSAGE_GEFUELLT :
                       participant.attendance_status === 'absent' ? ICON_ABSAGE : ICON_GRUPPE_GEFUELLT;

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
          // Ohne Verwaltungsrecht ist die Zeile reine Anzeige: kein `button`,
          // damit kein Tipp ins Leere geht.
          button={darfVerwalten} detail={false} lines="none"
          onClick={() => {
            // 'opted_out' oeffnet DASSELBE Anwesenheits-Menue wie 'confirmed'
            // "Ich als Admin will eine Selbstabmeldung
            // bearbeiten koennen. Doch anwesend. Vermerk etc." Wer sich
            // vorher abgemeldet hat und dann doch kommt, muss verbucht werden
            // koennen -- vorher passierte auf den Tipp gar nichts, ohne jeden
            // Hinweis warum. Das Backend liess das ohnehin zu; die Sperre sass
            // allein hier.
            if (participant.status === 'confirmed' || participant.status === 'opted_out' || participant.status === 'excused') showAttendanceActionSheet(participant);
            else if (participant.status === 'waitlist') showWaitlistActionSheet(participant);
          }}
        >
          <div className={`app-list-item ${listItemClass} app-event-detail__list-item-flush`}>
            <div className="app-corner-badges">
              <div
                className={`app-corner-badge ${cornerBadgeClass}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--app-abstand-mini) var(--app-abstand-eng)' }}
                title={statusText}
                role="img"
                aria-label={statusText}
              >
                <IonIcon icon={getStatusIcon(statusText) || ICON_GRUPPE_GEFUELLT} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
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
                    {/* Zugeordnete Leitung steht in derselben Liste wie die
                        Teamer:innen und hat keinen Jahrgang — ohne Label
                        bliebe die Zeile ohne Unterzeile und waere von einer
                        Teamer:in nicht zu unterscheiden. */}
                    {istLeitung(participant) && <>Leitung</>}
                    {!istLeitung(participant) && participant.jahrgang_name && <>{participant.jahrgang_name}</>}
                    {participant.timeslot_start_time && participant.timeslot_end_time && (
                      <>{(istLeitung(participant) || participant.jahrgang_name) ? ' | ' : ''}{formatTime(participant.timeslot_start_time)} - {formatTime(participant.timeslot_end_time)}</>
                    )}
                  </div>
                  {/* Absage-Details: Grund wie bisher; NEU das
                      Kennzeichen aus Migration 141 — eine Absage, die eine
                      Zusage zurueckgenommen hat, heisst fuer die Leitung
                      "kurzfristig umplanen" und wird eigens benannt. */}
                  {/* Am BUCHUNGSSTATUS, nicht an isOptedOut: Hat die Leitung
                      eine Selbstabmeldung nachtraeglich verbucht ("kam doch"),
                      faerbt die Zeile oben nach dem Anwesenheits-Status um —
                      die Absage samt Grund bleibt aber die Vorgeschichte, die
                      erklaert, warum ueberhaupt jemand nachgetragen hat. */}
                  {participant.status === 'opted_out' && (participant.opt_out_reason || participant.absage_nach_zusage) && (
                    <div style={{ color: 'var(--app-text-secondary)', fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
                      {participant.absage_nach_zusage && (
                        <strong>Nach Zusage abgesagt{participant.opt_out_reason ? ': ' : ''}</strong>
                      )}
                      {!participant.absage_nach_zusage && participant.attendance_status && (
                        <strong>Hatte sich abgemeldet{participant.opt_out_reason ? ': ' : ''}</strong>
                      )}
                      {participant.opt_out_reason}
                    </div>
                  )}
                  {isExcused && participant.excuse_reason && (
                    <div style={{ color: 'var(--app-text-secondary)', fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
                      <strong>Abgemeldet: </strong>{participant.excuse_reason}
                    </div>
                  )}
                  {/* Wer den Status samt Grund gesetzt hat. Fehlt der Urheber
                      — Altbestand oder Selbst-Check-in per QR-Code —, faellt
                      die Zeile weg statt "unbekannt" zu behaupten. */}
                  {urheberZeile(participant) && (
                    <div style={{ color: 'var(--app-text-tertiary)', fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
                      {urheberZeile(participant)}
                    </div>
                  )}
                  {/* Beim Selbst-Check-in gibt es keinen Namen (Migration 148)
                      — stattdessen sagt die Quelle, WOHER die Anwesenheit kam
                      (Migration 151). Die beiden Zeilen schliessen einander
                      aus: checkinZeile() liefert nur bei 'qr' etwas, und wer
                      danach von Hand eintraegt, setzt die Quelle auf
                      'manuell'. Sonst stuende hier "eingecheckt" unter einem
                      Namen, der etwas anderes eingetragen hat. */}
                  {checkinZeile(participant) && (
                    <div style={{ color: 'var(--app-text-tertiary)', fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
                      {checkinZeile(participant)}
                    </div>
                  )}
                  {participant.attendance_note && (
                    <div style={{ color: 'var(--app-text-secondary)', fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
                      <strong>Notiz: </strong>{participant.attendance_note}
                    </div>
                  )}
                  {/* Wer die Notiz geschrieben hat — eigener Urheber, eigener
                      Wortlaut ("Notiz von ..."), damit bei zwei Zeilen
                      untereinander klar bleibt, welcher Name wozu gehoert. */}
                  {participant.attendance_note && notizUrheberZeile(participant) && (
                    <div style={{ color: 'var(--app-text-tertiary)', fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
                      {notizUrheberZeile(participant)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </IonItem>
        {darfVerwalten && (participant.role_name !== 'konfi' || !eventData?.mandatory) && (
        <IonItemOptions className="app-swipe-actions" side="end">
          {participant.role_name === 'konfi' && participant.status === 'confirmed' && (
            <IonItemOption className="app-swipe-action" onClick={() => { closeOpenSlidingItems(); handleDemoteParticipant(participant); }} aria-label="Auf Warteliste setzen">
              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--warning">
                <IonIcon icon={ICON_ANTWORTEN} />
              </div>
            </IonItemOption>
          )}
          <IonItemOption className="app-swipe-action" onClick={() => { closeOpenSlidingItems(); handleRemoveParticipant(participant); }} aria-label="Teilnahme entfernen">
            <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
              <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
            </div>
          </IonItemOption>
        </IonItemOptions>
        )}
      </IonItemSliding>
    );
  };

  // Solange geladen wird, den Spinner zeigen statt ein leeres Geruest mit
  // Platzhaltertitel - so wie es die Konfi-Ansicht desselben Events macht.
  if (loading) {
    return (
      <IonPage ref={pageRef}>
        <AppKopfzeile titel="Event-Details" onZurueck={hideBackButton ? undefined : onBack} gemeindeUmschalter={false} />
        <IonContent fullscreen>
          <LoadingSpinner message="Event wird geladen..." />
        </IonContent>
      </IonPage>
    );
  }

  // Termin aus einem fremden Jahrgang (Push oder Link): den Grund nennen und
  // den Weg hinaus, statt der leeren Seite mit Platzhaltertitel. Dieselbe
  // Seite gibt es fuer Teamer:innen in TeamerEventsPage (renderJahrgangHinweis)
  // -- gleicher Wortlaut, damit beide Rollen dasselbe lesen.
  if (jahrgangFehlt) {
    return (
      <IonPage ref={pageRef}>
        <AppKopfzeile titel="Event" onZurueck={hideBackButton ? undefined : onBack} gemeindeUmschalter={false} />
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
  }

  return (
    <IonPage ref={pageRef}>
      <AppKopfzeile
        titel={eventData?.name || 'Event-Details'}
        onZurueck={hideBackButton ? undefined : onBack}
        gemeindeUmschalter={false}
        rechts={(
          <>
            {/* Einen BESTEHENDEN Chat oeffnen darf auch das Team — das ist
                reine Navigation. Ihn ANZULEGEN ist requireAdmin
                (verwaltung.js). Gibt es noch keinen, fuehrte der Knopf
                Teamer:innen deshalb ueber eine Rueckfrage in einen 403;
                dann steht er jetzt gar nicht erst da. */}
            {(eventData?.chat_room_id || darfVerwalten) && (
              <IonButton aria-label="Event-Chat öffnen" onClick={handleChatButtonClick}>
                <IonIcon icon={ICON_CHAT} />
              </IonButton>
            )}
            <IonButton aria-label="QR-Code anzeigen" onClick={() => presentQRDisplayModal({ presentingElement: presentingElement || undefined })}>
              <IonIcon icon={ICON_QRCODE} />
            </IonButton>
            {darfVerwalten && (
              <IonButton aria-label="Event kopieren" onClick={handleKopieren}>
                <IonIcon icon={ICON_KOPIEREN_GEFUELLT} />
              </IonButton>
            )}
            {darfVerwalten && (
              <IonButton aria-label="Event bearbeiten" onClick={() => presentEventModalHook({ presentingElement: presentingElement || undefined, canDismiss: eventModalCanDismiss, backdropDismiss: false })}>
                <IonIcon icon={ICON_BEARBEITEN} />
              </IonButton>
            )}
          </>
        )}
      />

      <IonContent className="app-gradient-background" fullscreen>
        <AppKopfzeileGross titel={eventData?.name || 'Event-Details'} />

        <IonRefresher slot="fixed" onIonRefresh={handleRefresh} onIonPull={triggerPullHaptic}>
          <IonRefresherContent refreshingSpinner="crescent" />
        </IonRefresher>

        {/* Event Header */}
        <SectionHeader
          title={eventData?.name || 'Event'}
          subtitle={getStatusText()}
          icon={ICON_TERMIN_GEFUELLT}
          colors={getStatusColors()}
          stats={(() => {
            const konfiOnly = participants.filter(p => p.role_name === 'konfi');
            // Team-Seite: Teamer:innen UND zugeordnete Leitung.
            const teamerOnly = participants.filter(p => p.role_name !== 'konfi');
            const teamerConfirmedCount = teamerOnly.filter(p => p.status === 'confirmed').length;
            const teamerWaitlistCount = teamerOnly.filter(p => p.status === 'waitlist').length;
            // Teamer-Kontingent gilt, sobald das Event Teamer zulaesst \u2014 NICHT
            // erst, wenn sich schon jemand angemeldet hat (sonst zeigt ein
            // frisches "Nur Teamer"-Event Konfi-Zahlen).
            const teamerMax = (eventData?.teamer_max_participants || 0) > 0
              ? eventData?.teamer_max_participants : '\u221E';
            const presentCount = konfiOnly.filter(p => p.attendance_status === 'present').length;
            const konfiConfirmed = konfiOnly.filter(p => p.status === 'confirmed').length;
            const konfiOptedOut = konfiOnly.filter(zaehltAlsAbgemeldet).length;

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

        <AbsageBlock
          event={eventData}
          variante="kasten"
        />

        {/* Event Details */}
        {eventData && (
          <EventInfoCard
            eventData={eventData}
            participants={participants}
            formatTime={formatTime}
            eventMaterials={eventMaterials}
            onMaterialHinweisClick={handleMaterialHinweisClick}
          />
        )}

        {eventData && participants.length === 0 && !isOnline && (
          <OfflinePlatzhalter was="Die Teilnehmerliste" />
        )}

        {/* Beschreibung */}
        {eventData?.description && (
          <DescriptionSection description={eventData.description} />
        )}

        {darfSichMelden && (
          <IonList className="app-section-inset" inset={true}>
            <IonListHeader>
              <div className="app-section-icon app-section-icon--events"><IonIcon icon={ICON_GRUPPE_GEFUELLT} /></div>
              <IonLabel>Bist du dabei?</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent className="app-card-content">
                {/* GENAU WIE BEIM TEAM: "erste abfrage
                    beide danach im wechsel". Solange nichts entschieden ist,
                    stehen beide Knoepfe da; danach nur noch der GEGENTEILIGE
                    Weg. Welcher das ist und wie er heisst, entscheidet
                    utils/zusageKnoepfe.ts -- dieselbe Stelle wie in
                    teamer/pages/TeamerEventsPage.tsx.
                    */}
                <div className="app-button-row app-button-row--in-card">
                  {welcheKnoepfe(eigeneZusage) !== 'absage' && (
                    <IonButton
                      expand="block"
                      fill="outline"
                      color="success"
                      disabled={zusageLaeuft || !isOnline}
                      onClick={() => setzeEigeneZusage(true)}
                    >
                      <IonIcon icon={ICON_ZUSAGE_GEFUELLT} slot="start" />
                      {zusageBeschriftung(eigeneZusage)}
                    </IonButton>
                  )}
                  {welcheKnoepfe(eigeneZusage) !== 'zusage' && (
                    <IonButton
                      expand="block"
                      fill="outline"
                      color="danger"
                      disabled={zusageLaeuft || !isOnline}
                      onClick={oeffneEigeneAbsage}
                    >
                      <IonIcon icon={ICON_ABSAGE} slot="start" />
                      {absageBeschriftung(eigeneZusage)}
                    </IonButton>
                  )}
                </div>
                {!isOnline && (
                  <p className="app-text-sub" style={{ marginTop: 'var(--app-abstand-mittel)', marginBottom: 0 }}>
                    Ohne Netz nicht möglich — versuch es später nochmal.
                  </p>
                )}
              </IonCardContent>
            </IonCard>
          </IonList>
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
            darfVerwalten={darfVerwalten}
          />
        )}

        {/* Series Events */}
        {eventData?.is_series && eventData?.series_events && eventData.series_events.length > 0 && (
          <SeriesEventsSection
            seriesEvents={eventData.series_events}
            formatDate={formatDate}
            formatTime={formatTime}
            onNavigate={(eventId) => router.push(`/admin/events/${eventId}`, 'forward')}
          />
        )}

        {/* Participants List */}
        {(() => {
          const konfiParticipants = konfisInReihenfolge(
            participants.filter(p => p.role_name === 'konfi'),
            eventData?.mandatory
          );
          // Team-Seite: Teamer:innen UND zugeordnete Leitung. Ein '!== konfi'
          // statt '=== teamer', sonst landet zugeordnete Leitung in der
          // Konfi-Liste und wird als Kind gezaehlt.
          const teamerParticipants = participants.filter(p => p.role_name !== 'konfi');
          const confirmedParticipants = konfiParticipants.filter(p => p.status === 'confirmed');
          const allWaitlistParticipants = konfiParticipants.filter(p => p.status === 'waitlist');
          const unassignedParticipants = eventData?.has_timeslots
            ? confirmedParticipants.filter(p => !p.timeslot_id && !p.timeslot_start_time) : [];
          // Bei Timeslot-Events werden slot-zugeordnete Wartelistler bereits in der
          // TimeslotsSection unter ihrem Slot angezeigt -> hier nur die OHNE Slot,
          // damit sie nicht doppelt erscheinen.
          const waitlistParticipants = eventData?.has_timeslots
            ? allWaitlistParticipants.filter(p => !p.timeslot_id && !p.timeslot_start_time)
            : allWaitlistParticipants;
          const displayParticipants = eventData?.has_timeslots
            ? [...unassignedParticipants, ...waitlistParticipants] : konfiParticipants;
          const hasWaitlist = eventData?.waitlist_enabled && waitlistParticipants.length > 0;
          const hasUnassigned = unassignedParticipants.length > 0;

          // Noch niemand angemeldet: nur die Hinzufuegen-Buttons zeigen — aber
          // die passenden. Bei "Nur Teamer:innen" gibt es keine Konfi-Teilnahme
          // (vorher stand hier ausschliesslich "Konfi hinzufügen", und die
          // Teamer-Sektion darunter wurde durch den Return nie erreicht).
          if (displayParticipants.length === 0 && teamerParticipants.length === 0) {
            // An einem abgesagten Termin gibt es nichts einzutragen — und ohne
            // Angemeldete auch nichts anzuzeigen. Dann bleibt der Block leer,
            // statt drei tote Knoepfe zu zeigen.
            if (!darfEintragen) return null;
            const teamerErlaubt = !!(eventData?.teamer_needed || eventData?.teamer_only);
            return (
              <IonList className="app-section-inset" inset={true}>
                <IonCard className="app-card">
                  <IonCardContent className="app-card-content">
                    {!eventData?.teamer_only && (
                      <IonButton expand="block" fill="outline"
                        onClick={() => presentKonfiModal({ presentingElement: presentingElement || undefined })}>
                        <IonIcon icon={ICON_PERSON_HINZUFUEGEN_GEFUELLT} className="app-event-detail__icon-gap" />
                        Konfi hinzufügen
                      </IonButton>
                    )}
                    {teamerErlaubt && (
                      <IonButton expand="block" fill="outline"
                        onClick={() => presentTeamerModal({ presentingElement: presentingElement || undefined })}>
                        <IonIcon icon={ICON_PERSON_HINZUFUEGEN_GEFUELLT} className="app-event-detail__icon-gap" />
                        Team hinzufügen
                      </IonButton>
                    )}
                    {/* Leitung laeuft ueber dasselbe Team-Kontingent wie die
                        Teamer:innen — deshalb auch dieselbe Bedingung. */}
                    {teamerErlaubt && (
                      <IonButton expand="block" fill="outline"
                        onClick={() => presentLeitungModal({ presentingElement: presentingElement || undefined })}>
                        <IonIcon icon={ICON_PERSON_HINZUFUEGEN_GEFUELLT} className="app-event-detail__icon-gap" />
                        Leitung hinzufügen
                      </IonButton>
                    )}
                  </IonCardContent>
                </IonCard>
              </IonList>
            );
          }

          // Ohne Initialisierer: Beide Ketten enden auf einem nackten else,
          // jeder Zweig weist zu. tsc bestaetigt die definitive Zuweisung.
          let konfiHeaderText: string;
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
          // UEBERSCHRIFT "Team", nicht "Teamer:innen":
          // Die Sektion umfasst ohnehin Teamer:innen UND zugeordnete Leitung
          // (Filter '!== konfi'), der alte Titel war also schon falsch.
          const teamerHeaderText = `Team (${teamerConfirmed.length}`
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
                    <div className="app-section-icon app-section-icon--events"><IonIcon icon={ICON_GRUPPE_GEFUELLT} /></div>
                    <IonLabel>{konfiHeaderText}</IonLabel>
                    {(() => {
                      // Button nur, wenn es unverbuchte Angemeldete gibt (Konfis mit
                      // Status bestätigt, aber ohne Anwesenheits-Status).
                      const unprocessed = confirmedParticipants.filter(p => !p.attendance_status).length;
                      if (unprocessed === 0 || !darfVerwalten) return null;
                      return (
                        <IonButton fill="clear" size="small" disabled={!isOnline}
                          title={isOnline ? undefined : "Ohne Internetverbindung nicht möglich"}
                          onClick={() => handleConfirmAllAttendance(unprocessed, waitlistParticipants.length)}>
                          <IonIcon icon={ICON_HAKEN_GEFUELLT} slot="start" />
                          Alle bestätigen ({unprocessed})
                        </IonButton>
                      );
                    })()}
                  </IonListHeader>
                  <IonCard className="app-card">
                    <IonCardContent style={{ padding: displayParticipants.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {displayParticipants.map(renderParticipant)}
                      </div>
                      {darfEintragen && (
                        <div className="app-event-detail__add-button-wrapper">
                          <IonButton expand="block" fill="outline"
                            onClick={() => presentKonfiModal({ presentingElement: presentingElement || undefined })}>
                            <IonIcon icon={ICON_PERSON_HINZUFUEGEN_GEFUELLT} className="app-event-detail__icon-gap" />
                            Konfi hinzufügen
                          </IonButton>
                        </div>
                      )}
                    </IonCardContent>
                  </IonCard>
                </IonList>
              )}
              {(teamerParticipants.length > 0 || eventData?.teamer_needed || eventData?.teamer_only) && (
                <IonList className="app-section-inset" inset={true}>
                  <IonListHeader>
                    <div className="app-section-icon app-section-icon--events"><IonIcon icon={ICON_GRUPPE_GEFUELLT} /></div>
                    <IonLabel>{teamerHeaderText}</IonLabel>
                    {(() => {
                      // Gleiches Muster wie bei den Konfis oben, aber mit
                      // rolle='teamer': nur angemeldete Teamer:innen ohne
                      // Anwesenheits-Status. Ohne diesen Knopf musste die
                      // Leitung sie einzeln verbuchen, und der Termin blieb
                      // im "Verbuchen"-Reiter stehen -- pending_bookings_count
                      // zaehlt beide Rollen (`backend/routes/events/lesen.js`,
                      // `unprocessedCount`).
                      const unprocessedTeamer = teamerConfirmed.filter(p => !p.attendance_status).length;
                      if (unprocessedTeamer === 0 || !darfVerwalten) return null;
                      return (
                        <IonButton fill="clear" size="small" disabled={!isOnline}
                          title={isOnline ? undefined : "Ohne Internetverbindung nicht möglich"}
                          onClick={() => handleConfirmAllAttendance(unprocessedTeamer, teamerWaitlist.length, 'teamer')}>
                          <IonIcon icon={ICON_HAKEN_GEFUELLT} slot="start" />
                          Alle bestätigen ({unprocessedTeamer})
                        </IonButton>
                      );
                    })()}
                  </IonListHeader>
                  <IonCard className="app-card">
                    <IonCardContent style={{ padding: teamerParticipants.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {teamerParticipants.map(renderParticipant)}
                      </div>
                      {darfEintragen && (
                        <div className="app-event-detail__add-button-wrapper">
                          <IonButton expand="block" fill="outline"
                            onClick={() => presentTeamerModal({ presentingElement: presentingElement || undefined })}>
                            <IonIcon icon={ICON_PERSON_HINZUFUEGEN_GEFUELLT} className="app-event-detail__icon-gap" />
                            Team hinzufügen
                          </IonButton>
                          <IonButton expand="block" fill="outline"
                            onClick={() => presentLeitungModal({ presentingElement: presentingElement || undefined })}>
                            <IonIcon icon={ICON_PERSON_HINZUFUEGEN_GEFUELLT} className="app-event-detail__icon-gap" />
                            Leitung hinzufügen
                          </IonButton>
                        </div>
                      )}
                    </IonCardContent>
                  </IonCard>
                </IonList>
              )}
              {darfEintragen && !isTeamerOnlyEvent && displayParticipants.length === 0 && teamerParticipants.length > 0 && (
                <IonList className="app-section-inset" inset={true}>
                  <IonCard className="app-card">
                    <IonCardContent className="app-card-content">
                      <IonButton expand="block" fill="outline"
                        onClick={() => presentKonfiModal({ presentingElement: presentingElement || undefined })}>
                        <IonIcon icon={ICON_PERSON_HINZUFUEGEN_GEFUELLT} className="app-event-detail__icon-gap" />
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

        {eventData && darfVerwalten && (
          <EventActionsSection
            eventData={eventData}
            isCancelled={!!isCancelled}
            isOnline={isOnline}
            handleCancelEvent={handleCancelEvent}
            handleAbsageZuruecknehmen={handleAbsageZuruecknehmen}
          />
        )}

      </IonContent>
    </IonPage>
  );
};

export default EventDetailView;
