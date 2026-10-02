import {
  ICON_ABZEICHEN,
  ICON_BEARBEITEN,
  ICON_SCHLIESSEN_GEFUELLT,
  ICON_SCHLUESSEL_GEFUELLT,
  ICON_UHRZEIT,
} from '../../shared/icons';
import AppKopfzeile from '../../shared/AppKopfzeile';
import { fehlerText } from '../../../utils/fehler';
import React, { useState, useEffect, useCallback } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  IonList,
  IonCard,
  IonCardContent,
  useIonModal,
  useIonAlert
} from '@ionic/react';
import api from '../../../services/api';
import NachweisFoto from '../../shared/NachweisFoto';
import { useApp } from '../../../contexts/AppContext';
import { offlineBlockiert } from '../../../utils/offlineAktion';
import { offlineCache } from '../../../services/offlineCache';
import OfflinePlatzhalter from '../../shared/OfflinePlatzhalter';
import ActivityModal from '../modals/ActivityModal';
import BonusModal from '../modals/BonusModal';
import CertificateAssignModal from '../modals/CertificateAssignModal';
import AttendanceMatrixModal from '../modals/AttendanceMatrixModal';
import { useLiveUpdate, useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import {
  KonfiHeaderCard, BonusSection, EventPointsSection,
  TeamerEventsSection, ActivitiesSection, CertificatesSection,
  TeamerSinceSection, KonfiHistorySection, PromoteSection, KonfispruchSection
} from './KonfiDetailSections';
import KonfiModal from '../modals/KonfiModal';
import type { Konfi, Activity } from './KonfiDetailSections';
import type { BonusEintrag, EventPunkteEintrag } from '../../../types/user';
import { datumKurz } from '../../../utils/dateUtils';

/**
 * Ein Aktivitaets-Antrag aus GET /admin/activities/requests?user_id=,
 * soweit diese Ansicht ihn liest: Die offenen Antraege der Konfi werden als
 * "wartende" Aktivitaeten unter die verbuchten gemischt.
 */
interface OffenerAntrag {
  id: number;
  user_id: number;
  status: 'pending' | 'approved' | 'rejected';
  activity_name: string;
  activity_points: number;
  requested_date: string;
  photo_filename?: string;
}
import KonfiBadgesSection from './KonfiBadgesSection';
import ChallengeStempelSektion from '../../shared/ChallengeStempelSektion';
import { mitBewahrtenStempeln } from '../../../utils/bewahrteStempel';
import KonfiZeitTermine from '../../shared/KonfiZeitTermine';
import { alsKonfiZeit } from '../../../utils/konfiZeit';
import type { KonfiZeit } from '../../../types/konfiZeit';
import type { ChallengeMark } from '../../../types/challenges';
import WrappedModal from '../../wrapped/WrappedModal';
import type { WrappedHistoryEntry } from '../../../types/wrapped';
import { triggerPullHaptic } from '../../../utils/haptics';
import LoadingSpinner from '../../common/LoadingSpinner';
import { tastaturKlick } from '../../../utils/tastatur';

/**
 * Das Nachweisfoto eines Antrags auf ganzer Fläche. Steht außerhalb von
 * KonfiDetailView: Innen definiert, war es bei jedem Zeichnen der Ansicht ein
 * neuer Komponententyp — das Modal hängte seinen Inhalt jedes Mal neu ein, und
 * das Foto hätte jedes Mal neu geladen.
 */
const NachweisFotoAnsicht: React.FC<{ onClose: () => void; antragId: number | null }> = ({ onClose, antragId }) => (
  <IonPage>
    <IonHeader>
      <IonToolbar>
        <IonTitle>Foto</IonTitle>
        <IonButtons slot="start">
          <IonButton aria-label="Schließen" onClick={onClose}>
            <IonIcon icon={ICON_SCHLIESSEN_GEFUELLT} />
          </IonButton>
        </IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent>
      <div style={{ padding: 'var(--app-abstand-basis)', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        {antragId !== null && <NachweisFoto key={antragId} antragId={antragId} leitung vollflaeche />}
      </div>
    </IonContent>
  </IonPage>
);

interface KonfiDetailViewProps {
  konfiId: number;
  onBack: () => void;
  // Im iPad-Split-View ist die Liste links dauerhaft sichtbar -> kein
  // Zurück-Button nötig.
  hideBackButton?: boolean;
}

const KonfiDetailView: React.FC<KonfiDetailViewProps> = ({ konfiId, onBack, hideBackButton }) => {
  const { setSuccess, setError, isOnline, user } = useApp();
  const { triggerRefresh } = useLiveUpdate();
  const [presentAlert] = useIonAlert();
  const pageRef = React.useRef<HTMLElement>(null);
  const [presentingElement, setPresentingElement] = useState<HTMLElement | null>(null);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [bonusEntries, setBonusEntries] = useState<BonusEintrag[]>([]);
  const [eventPoints, setEventPoints] = useState<EventPunkteEintrag[]>([]);
  const [currentKonfi, setCurrentKonfi] = useState<Konfi | null>(null);
  const [loading, setLoading] = useState(true);
  const [targetRole, setTargetRole] = useState<string>('konfi');
  // Fuer das Bearbeiten-Modal: alle Jahrgaenge der Organisation (mit ihren
  // Punktearten, damit die Warnung stimmt) und die eigenen Zuweisungen.
  const [alleJahrgaenge, setAlleJahrgaenge] = useState<Array<{
    id: number; name: string; gottesdienst_enabled?: boolean; gemeinde_enabled?: boolean;
  }>>([]);
  const isTeamer = targetRole === 'teamer';
  const fotoAntragRef = React.useRef<number | null>(null);
  const [teamerEvents, setTeamerEvents] = useState<Array<{
    id: number;
    name: string;
    event_date: string;
    location: string;
    teamer_only: boolean;
    teamer_needed: boolean;
    booking_status: string;
    booking_date: string;
  }>>([]);
  // Stempel einer Teamer:in aus Challenges, die mit ihrem Jahrgang geloescht
  // wurden. GET /admin/konfis/:id leitet challengeMarks aus den
  // lebenden Beitraegen ab -- die bewahrten kommen aus einer eigenen Route.
  const [bewahrteStempel, setBewahrteStempel] = useState<ChallengeMark[]>([]);
  // Die dauerhafte Kopie der Konfi-Zeit einer befoerderten Teamer:in
  // besuchte Termine samt Anwesenheit und Punkten, die mit der
  // Befoerderung bzw. dem Loeschen des alten Jahrgangs sonst verschwunden
  // waeren.
  const [konfiZeit, setKonfiZeit] = useState<KonfiZeit | null>(null);
  const [konfiHistory, setKonfiHistory] = useState<{
    history: Array<{ id: number; title: string; points: number; category: string; date: string; source_type: string; event_date?: string | null }>;
    totals: { gottesdienst: number; gemeinde: number; total: number };
  } | null>(null);
  const [certificates, setCertificates] = useState<Array<{
    id: number;
    certificate_type_id: number;
    name: string;
    icon: string;
    issued_date: string;
    expiry_date: string | null;
    status: string;
  }>>([]);
  const [certificateTypes, setCertificateTypes] = useState<Array<{
    id: number;
    name: string;
    icon: string;
    is_active: boolean;
  }>>([]);
  const [attendanceStats, setAttendanceStats] = useState<{
    total_mandatory: number;
    attended: number;
    percentage: number;
    missed_events: Array<{
      event_id: number;
      event_name: string;
      event_date: string;
      location: string;
      status: 'opted_out' | 'absent';
      opt_out_reason: string | null;
    }>;
  } | null>(null);

  // Activity Modal mit useIonModal Hook
  const [presentActivityModalHook, dismissActivityModalHook] = useIonModal(ActivityModal, {
    konfiId: konfiId,
    targetRole: targetRole,
    // Wie beim BonusModal: ohne die Schalter stuenden auch Aktivitaeten einer
    // abgeschalteten Punkteart zur Auswahl.
    punkteartFlags: currentKonfi
      ? {
          gottesdienst_enabled: currentKonfi.gottesdienst_enabled,
          gemeinde_enabled: currentKonfi.gemeinde_enabled,
        }
      : undefined,
    onClose: () => dismissActivityModalHook(),
    onSave: async () => {
      await loadKonfiData();
      triggerRefresh('konfis');
      dismissActivityModalHook();
    }
  });

  // Bonus Modal mit useIonModal Hook
  const [presentBonusModalHook, dismissBonusModalHook] = useIonModal(BonusModal, {
    konfiId: konfiId,
    // Punktearten-Schalter des Jahrgangs mitgeben: sonst bietet das Modal auch
    // eine abgeschaltete Art an und das Speichern scheitert erst am Server.
    punkteartFlags: currentKonfi
      ? {
          gottesdienst_enabled: currentKonfi.gottesdienst_enabled,
          gemeinde_enabled: currentKonfi.gemeinde_enabled,
        }
      : undefined,
    onClose: () => dismissBonusModalHook(),
    onSave: async () => {
      await loadKonfiData();
      triggerRefresh('konfis');
      dismissBonusModalHook();
    }
  });

  // Foto-Ansicht mit useIonModal. Welcher Antrag gemeint ist, steht im Ref
  // (Getter wie beim Material-Modal in EventDetailView): Er ist gesetzt, BEVOR
  // das Modal aufgeht, so zeigt schon das erste Zeichnen den richtigen Antrag.
  const [presentPhotoModalHook, dismissPhotoModalHook] = useIonModal(NachweisFotoAnsicht, {
    onClose: () => {
      fotoAntragRef.current = null;
      dismissPhotoModalHook();
    },
    get antragId() { return fotoAntragRef.current; }
  });

  // Certificate Assign Modal mit useIonModal Hook
  const availableTypes = certificateTypes.filter(
    ct => ct.is_active && !certificates.some(c => c.certificate_type_id === ct.id)
  );
  const [presentCertModal, dismissCertModal] = useIonModal(CertificateAssignModal, {
    konfiId: konfiId,
    availableTypes: availableTypes,
    onClose: () => dismissCertModal(),
    onSuccess: () => {
      dismissCertModal();
      loadKonfiData();
    }
  });

  const [wrappedListe, setWrappedListe] = useState<WrappedHistoryEntry[]>([]);

  useEffect(() => {
    let abgebrochen = false;
    api.get(`/wrapped/history/${konfiId}`)
      .then(res => {
        if (abgebrochen) return;
        const entries: WrappedHistoryEntry[] = res.data || [];
        // Für Teamer:innen die Teamer-Rückblicke, sonst die der Konfi.
        // Ein Mensch kann beides haben (beförderte Konfi) — gezeigt wird,
        // was zur Rolle in DIESER Ansicht passt.
        const passend = entries.filter(e =>
          e.wrapped_type === (isTeamer ? 'teamer' : 'konfi')
        );
        setWrappedListe(passend);
      })
      .catch(() => {
        // Kein Wrapped vorhanden oder offline: Die Karte bleibt einfach weg.
        if (!abgebrochen) setWrappedListe([]);
      });
    return () => { abgebrochen = true; };
  }, [konfiId, isTeamer]);

  const [wrappedModalData, setWrappedModalData] = useState<WrappedHistoryEntry | null>(null);
  const [presentWrappedModal, dismissWrappedModal] = useIonModal(WrappedModal, {
    onClose: () => {
      setWrappedModalData(null);
      dismissWrappedModal();
    },
    displayName: currentKonfi?.display_name || currentKonfi?.name || '',
    wrappedType: (isTeamer ? 'teamer' : 'konfi') as 'teamer' | 'konfi',
    initialData: wrappedModalData?.data,
    initialYear: wrappedModalData?.year,
    // Der Ausgaben-Titel steht auf der ersten Seite ("Willkommen zu deinem
    // Zwischenstand"). Ohne ihn hiesse dort auch ein Zwischenstand
    // "Konfi-Jahr".
    initialTitel: wrappedModalData?.titel ?? null
  });

  useEffect(() => {
    if (wrappedModalData) {
      presentWrappedModal({ cssClass: 'wrapped-modal-fullscreen' });
    }
  }, [wrappedModalData]);

  // Anwesenheitsmatrix-Modal (geoeffnet aus der Konfirmations-Karte, auf den Jahrgang des Konfis vorausgewaehlt)
  const konfiJahrgang = currentKonfi?.jahrgang_id
    ? [{ id: currentKonfi.jahrgang_id, name: currentKonfi.jahrgang_name || 'Jahrgang' }]
    : [];
  const [presentMatrixModal, dismissMatrixModal] = useIonModal(AttendanceMatrixModal, {
    jahrgaenge: konfiJahrgang,
    initialJahrgangId: currentKonfi?.jahrgang_id,
    onClose: () => dismissMatrixModal()
  });

  // Bearbeiten-Modal. Dasselbe Modal wie beim Anlegen, nur mit `konfi`
  // vorbelegt — zwei Dateien waeren genau die Kopie, die in diesem Projekt
  // regelmaessig auseinanderlaeuft.
  // Der Jahrgang der Konfi muss beim Bearbeiten IMMER sichtbar sein — auch
  // wenn man ihn gar nicht wechseln will. Kommt die Liste nicht an (offline,
  // Serverfehler), stand hier sonst "Keine Jahrgänge verfügbar" und der
  // bestehende Jahrgang war nirgends zu sehen; das Formular liess sich dann
  // nicht einmal speichern, weil ohne Jahrgang nichts gueltig ist.
  //
  // Ist der Jahrgang schon in der geladenen Liste, bleibt es bei der Liste —
  // sonst wird er vorne ergaenzt. Die Punktearten fehlen dem Ersatzeintrag;
  // das ist unschaedlich, weil die Warnung nur beim WECHSEL in einen anderen
  // Jahrgang greift und der eigene nie der Wechsel-Zielwert ist.
  const jahrgaengeFuersModal = (() => {
    const eigenerId = currentKonfi?.jahrgang_id;
    if (!eigenerId) return alleJahrgaenge;
    if (alleJahrgaenge.some((jg) => jg.id === eigenerId)) return alleJahrgaenge;
    return [
      { id: eigenerId, name: currentKonfi?.jahrgang_name || 'Aktueller Jahrgang' },
      ...alleJahrgaenge
    ];
  })();

  const [presentBearbeitenModal, dismissBearbeitenModal] = useIonModal(KonfiModal, {
    jahrgaenge: jahrgaengeFuersModal,
    konfi: currentKonfi ? {
      id: currentKonfi.id,
      display_name: currentKonfi.display_name || currentKonfi.name,
      jahrgang_id: currentKonfi.jahrgang_id ?? null,
      gottesdienst_points: currentKonfi.gottesdienst_points ?? currentKonfi.points?.gottesdienst,
      gemeinde_points: currentKonfi.gemeinde_points ?? currentKonfi.points?.gemeinde
    } : undefined,
    // Nur fuer `admin` von Bedeutung: org_admin sieht ohnehin alle Jahrgaenge,
    // die Warnung waere dort schlicht falsch.
    eigeneJahrgangIds: user?.role_name === 'admin'
      ? (user.assigned_jahrgaenge || []).filter((j) => j.can_view !== false).map((j) => j.id)
      : undefined,
    onClose: () => dismissBearbeitenModal(),
    dismiss: () => dismissBearbeitenModal(),
    onSave: async (daten: { name: string; jahrgang_id: number }) => {
      await api.put(`/admin/konfis/${konfiId}`, daten);
      dismissBearbeitenModal();
      setSuccess('Änderungen gespeichert');
      await loadKonfiData();
      triggerRefresh('konfis');
    }
  });

  // isOnline in den Abhaengigkeiten: Kommt die Verbindung zurueck, muss der
  // aus dem Cache gezeigte Grundstand durch die vollen Detaildaten ersetzt
  // werden (Punkte, Aktivitaeten, Anwesenheit).
  useEffect(() => {
    loadKonfiData();
  }, [konfiId, isOnline]);

  // Jahrgaenge fuer das Bearbeiten-Modal. Einmal beim Oeffnen der Seite; die
  // Liste enthaelt dank SELECT j.* auch die Punktearten, aus denen die Warnung
  // beim Wechsel gebaut wird.
  //
  // Faellt der Abruf trotzdem aus (offline, Serverfehler), faellt die Liste auf
  // den Jahrgang der Konfi zurueck — siehe jahrgaengeFuersModal.
  useEffect(() => {
    if (isTeamer) return;
    api.get('/admin/jahrgaenge')
      .then((res) => setAlleJahrgaenge(res.data || []))
      .catch(() => setAlleJahrgaenge([]));
  }, [isTeamer]);

  useEffect(() => {
    setPresentingElement(pageRef.current);
  }, []);

  // Live-Ereignisse empfangen. Diese Ansicht hatte bisher NUR triggerRefresh
  // (Senden) und hoerte selbst auf nichts — ausgerechnet die Seite, auf der
  // Punkte vergeben werden. Vergab eine zweite Person Punkte oder gab einen
  // Antrag frei, blieb hier der alte Stand stehen.
  useLiveRefresh(['konfis', 'points', 'requests', 'badges'], useCallback(() => {
    loadKonfiData();
  }, [konfiId]));

  const loadKonfiData = async () => {
    // Ohne Verbindung gar nicht erst anfragen, sondern den Grundstand aus dem
    // Listen-Cache zeigen. Vorher lief der Abruf ins Leere und die Ansicht
    // zeigte nur "Fehler beim Laden der Konfi-Daten" — obwohl die Person in
    // der Liste davor sichtbar war, denn AdminKonfisPage haelt sie unter
    // admin:konfis:<org> im Cache (AdminKonfisPage.tsx:105).
    //
    // Punkte, Aktivitaeten und Anwesenheit haengen an der Detail-Route und
    // bleiben offline leer; die Liste traegt Name, Jahrgang und Punktestand.
    // Besser der Name mit Punktestand als ein roter Kasten.
    if (!isOnline) {
      try {
        const gecacht = await offlineCache.get<Konfi[]>('admin:konfis:' + user?.organization_id);
        const ausListe = gecacht?.data?.find((k) => k.id === konfiId) || null;
        if (ausListe) {
          setCurrentKonfi({ ...ausListe });
          // GET /admin/konfis liefert kein role_name (und enthaelt nur
          // Konfis) — der fruehere (as any)-Zugriff war IMMER undefined und
          // fiel still auf 'konfi' zurueck. Ehrlich hingeschrieben:
          setTargetRole('konfi');
          setError('');
        } else {
          setError('Diese Person wurde noch nicht geladen — dafür brauchst du eine Verbindung.');
        }
      } catch {
        setError('Diese Person wurde noch nicht geladen — dafür brauchst du eine Verbindung.');
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const konfiRes = await api.get(`/admin/konfis/${konfiId}`);

      // Nur die OFFENEN Anträge DIESER Person.
      // Vorher lud die Ansicht die ganze Antragsgeschichte der Gemeinde und
      // filterte sie hier nach `konfi_id` — ein Feld, das die Liste seit der
      // Umbenennung in `user_id` nicht mehr trägt. Die offenen Anträge
      // erschienen deshalb nie.
      let requestsRes: { data: OffenerAntrag[] } = { data: [] };
      try {
        requestsRes = await api.get<OffenerAntrag[]>('/admin/activities/requests', {
          params: { user_id: konfiId, status: 'pending' },
        });
      } catch (requestsError) {
 console.warn('Could not load activity requests:', requestsError);
      }

      const konfiData = konfiRes.data;
      const allActivities = konfiData.activities || [];

      // Rolle setzen für bedingte Anzeige
      setTargetRole(konfiData.role_name || 'konfi');

      // Teamer-Daten aus dem Detail-Response. IMMER setzen, auch auf leer:
      // Vorher wurde nur bei vorhandenen Daten geschrieben, nie zurückgesetzt —
      // beim Wechsel zwischen zwei Personen blieben die Werte der vorigen
      // stehen (Teamer ohne Konfi-Zeit erbte die Historie des vorigen).
      if (konfiData.role_name === 'teamer') {
        setCertificates(konfiData.certificates || []);
        setTeamerEvents(konfiData.teamerEvents || []);
        setKonfiHistory(konfiData.konfiHistory || null);
        // Zusatz: ein Fehler (etwa ein aelterer Server ohne die Route) darf
        // die Detailansicht nicht kippen -- dann fehlen nur diese Stempel.
        try {
          const bewahrtRes = await api.get(`/challenges/admin/bewahrte-stempel/${konfiId}`);
          setBewahrteStempel(Array.isArray(bewahrtRes.data) ? bewahrtRes.data : []);
        } catch {
          setBewahrteStempel([]);
        }
        try {
          const konfiZeitRes = await api.get(`/teamer/${konfiId}/konfi-zeit`);
          setKonfiZeit(alsKonfiZeit(konfiZeitRes.data));
        } catch {
          setKonfiZeit(null);
        }
      } else {
        setCertificates([]);
        setTeamerEvents([]);
        setKonfiHistory(null);
        setBewahrteStempel([]);
        setKonfiZeit(null);
      }

      // Zertifikat-Typen laden (für die Zuweisung)
      if (konfiData.role_name === 'teamer') {
        try {
          const certTypesRes = await api.get('/teamer/certificate-types');
          setCertificateTypes(certTypesRes.data || []);
        } catch {
          // Ignorieren
        }
      }

      // bonusPoints vom Backend ist ein Array, nicht eine Zahl!
      const bonusEntriesArray = Array.isArray(konfiData.bonusPoints) ? konfiData.bonusPoints : [];
      setBonusEntries(bonusEntriesArray);

      setCurrentKonfi({
        ...konfiData,
        // Nicht die bonus-Werte aus dem Backend übernehmen - wir berechnen aus bonusEntries
      });

      try {
        const eventPointsRes = await api.get(`/admin/konfis/${konfiId}/event-points`);
        setEventPoints(eventPointsRes.data || []);
      } catch {
        setEventPoints([]);
      }

      try {
        const attendanceRes = await api.get(`/admin/konfis/${konfiId}/attendance-stats`);
        setAttendanceStats(attendanceRes.data);
      } catch {
        setAttendanceStats(null);
      }

      const enhancedActivities: Activity[] = allActivities.map((activity: Activity) => ({
        ...activity,
        hasPhoto: false
      }));

      const pendingRequests: Activity[] = (requestsRes.data || [])
        // Der Server filtert bereits; die Prüfung bleibt als Absicherung.
        .filter((req: OffenerAntrag) => req.user_id === konfiId && req.status === 'pending')
        .map((req: OffenerAntrag) => ({
          id: `request-${req.id}`,
          name: `${req.activity_name} (gemeldet)`,
          points: req.activity_points,
          type: 'pending',
          date: req.requested_date,
          admin: 'Wartend auf Genehmigung',
          isPending: true,
          photo_filename: req.photo_filename,
          requestId: req.id,
          hasPhoto: !!req.photo_filename
        }));

      setActivities([...enhancedActivities, ...pendingRequests]);
    } catch {
      setError('Fehler beim Laden der Konfi-Daten');
    } finally {
      setLoading(false);
    }
  };

  const getGottesdienstPoints = () => {
    if (!currentKonfi) return 0;
    return currentKonfi.gottesdienst_points ?? currentKonfi.points?.gottesdienst ?? 0;
  };

  const getGemeindePoints = () => {
    if (!currentKonfi) return 0;
    return currentKonfi.gemeinde_points ?? currentKonfi.points?.gemeinde ?? 0;
  };

  const getTotalPoints = () => {
    return getGottesdienstPoints() + getGemeindePoints();
  };

  const getBonusPoints = () => {
    // Nur aus den bonusEntries berechnen - das ist die einzige zuverlässige Quelle
    return bonusEntries.reduce((sum, bonus) => sum + (bonus.points || 0), 0);
  };

  const formatDate = (dateString: string) => {
    return datumKurz(dateString);
  };

  const handlePasswordAction = () => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Einmalpasswort generieren',
      message: 'Es wird ein neues temporäres Passwort erstellt. Das aktuelle Passwort wird überschrieben.',
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Generieren',
          handler: () => {
            setTimeout(() => handlePasswordReset(), 300);
          }
        }
      ]
    });
  };

  const handleDeleteActivity = async (activity: Activity) => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Aktivität löschen',
      message: `Aktivität "${activity.name}" wirklich löschen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/admin/konfis/${konfiId}/activities/${activity.id}`);
              await loadKonfiData();
              triggerRefresh('konfis');
            } catch (err) {
              setError('Fehler beim Löschen der Aktivität', { ort: 'aktivitaet-loeschen-konfidetail', fehler: err });
            }
          }
        }
      ]
    });
  };

  const handleDeleteBonus = async (bonus: BonusEintrag) => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Bonuspunkte löschen',
      message: `Bonuspunkte "${bonus.description}" wirklich löschen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/admin/konfis/${konfiId}/bonus-points/${bonus.id}`);
              await loadKonfiData();
              triggerRefresh('konfis');
            } catch {
              setError('Fehler beim Löschen der Bonuspunkte');
            }
          }
        }
      ]
    });
  };

  const handlePasswordReset = async () => {
    try {
      const response = await api.post(`/admin/konfis/${konfiId}/regenerate-password`);
      const tempPassword = response.data.temporaryPassword;
      presentAlert({
        header: 'Einmalpasswort erstellt',
        subHeader: tempPassword,
        message: 'Kopiere das Passwort und gib es dem Konfi weiter.',
        buttons: [
          {
            text: 'Kopieren',
            handler: () => {
              navigator.clipboard.writeText(tempPassword);
              setSuccess('Passwort kopiert');
              return false;
            }
          },
          { text: 'Fertig', role: 'cancel' }
        ]
      });
      triggerRefresh('konfis');
    } catch (err) {
      // Server-Begruendung durchreichen: Bis hierher stand hier
      // ein blosses `catch {` mit fester Meldung. Als die Route
      // Teamer:innen ausschloss, kam ein 404 "Konfi nicht gefunden" zurueck
      // -- die Leitung sah nur "Fehler beim Zuruecksetzen" und konnte nicht
      // wissen, woran es lag.
      setError(fehlerText(err, 'Fehler beim Zurücksetzen des Passworts'));
    }
  };

  // Die Ansicht geht SOFORT auf und lädt darin — mit Fortschritt, "Erneut
  // versuchen" und der Zeile ohne Netz (NachweisFoto). Vorher lud diese Stelle
  // erst still im Hintergrund und öffnete danach; bis dahin passierte beim
  // Antippen sichtbar nichts, bei einem Fehler kam nur "Foto konnte nicht
  // geladen werden".
  const handlePhotoClick = (activity: Activity) => {
    if (activity.hasPhoto && activity.requestId) {
      fotoAntragRef.current = activity.requestId;
      presentPhotoModalHook({
        presentingElement: presentingElement || undefined
      });
    }
  };

  const handleAssignCertificate = () => {
    if (offlineBlockiert(isOnline, setError)) return;

    if (availableTypes.length === 0) {
      setError('Keine verfügbaren Zertifikat-Typen mehr');
      return;
    }

    presentCertModal({ presentingElement: presentingElement || undefined });
  };

  const handleDeleteCertificate = (cert: { id: number; name: string }) => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Zertifikat entfernen',
      message: `"${cert.name}" wirklich entfernen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Entfernen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/teamer/${konfiId}/certificates/${cert.id}`);
              await loadKonfiData();
            } catch (err) {
              setError(fehlerText(err, 'Fehler beim Entfernen'));
            }
          }
        }
      ]
    });
  };

  const handlePromoteToTeamer = async () => {
    if (offlineBlockiert(isOnline, setError)) return;
    if (!currentKonfi) return;
    presentAlert({
      header: 'Zur Teamer:in befördern',
      message: `<strong>${currentKonfi.name}</strong> wirklich zur Teamer:in befördern?<br><br>` +
        `<strong>Punkte:</strong> ${getGottesdienstPoints()} Gottesdienst, ${getGemeindePoints()} Gemeinde<br>` +
        `<strong>Badges:</strong> ${currentKonfi.badgeCount || 0}<br><br>` +
        `Konfi-Punkte und Badges bleiben als Historie erhalten. ` +
        `Event-Buchungen und offene Aktivitäten werden gelöscht.<br><br>` +
        `<strong>Diese Aktion kann nicht rückgängig gemacht werden.</strong>`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Befördern',
          handler: async () => {
            try {
              await api.post(`/admin/konfis/${konfiId}/promote-teamer`);
              setSuccess(`${currentKonfi.name} wurde zur Teamer:in befördert`);
              triggerRefresh('konfis');
              onBack();
            } catch (err) {
              setError(fehlerText(err, 'Fehler beim Befördern'));
            }
          }
        }
      ]
    });
  };

  // Solange geladen wird, den Spinner zeigen statt Kacheln auf 0 und den
  // Platzhaltertitel - dasselbe Muster wie in der Event-Detailansicht.
  if (loading) {
    return (
      <IonPage ref={pageRef}>
        <AppKopfzeile
          titel={isTeamer ? 'Teamer:in Details' : 'Konfi Details'}
          onZurueck={hideBackButton ? undefined : onBack}
          gemeindeUmschalter={false}
        />
        <IonContent fullscreen>
          <LoadingSpinner message={isTeamer ? 'Teamer:in wird geladen...' : 'Konfi wird geladen...'} />
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage ref={pageRef}>
      <AppKopfzeile
        titel={currentKonfi?.name || (isTeamer ? 'Teamer:in Details' : 'Konfi Details')}
        onZurueck={hideBackButton ? undefined : onBack}
        /* Detailansicht EINER Person -- gehoert zu genau einer Gemeinde.
           Ein Wechsel fuehrte auf einen Datensatz, den
           es dort nicht gibt. */
        gemeindeUmschalter={false}
        rechts={(
          <>
            {/* Bearbeiten nur bei Konfis: Teamer:innen haben keinen einzelnen
                Jahrgang, ihre Stammdaten liegen in der Benutzerverwaltung. */}
            {!isTeamer && (
              <IonButton
                aria-label="Konfi bearbeiten"
                disabled={!isOnline || !currentKonfi}
                onClick={() => presentBearbeitenModal({ presentingElement: presentingElement || undefined })}
              >
                <IonIcon icon={ICON_BEARBEITEN} />
              </IonButton>
            )}
            {/* Zertifikat zuweisen: Der Zertifikats-Block
                erscheint nur noch, wenn es welche GIBT -- der Knopf sass aber
                darin. Ohne diesen Weg gaebe es keine Moeglichkeit mehr, das
                erste Zertifikat zuzuweisen. */}
            {isTeamer && (
              <IonButton aria-label="Zertifikat zuweisen" disabled={!isOnline} onClick={handleAssignCertificate}>
                <IonIcon icon={ICON_ABZEICHEN} />
              </IonButton>
            )}
            <IonButton aria-label="Passwort zurücksetzen" disabled={!isOnline} onClick={handlePasswordAction}>
              <IonIcon icon={ICON_SCHLUESSEL_GEFUELLT} />
            </IonButton>
          </>
        )}
      />

      <IonContent className="app-gradient-background" fullscreen>
        <IonRefresher
          slot="fixed"
          onIonRefresh={(e) => {
            loadKonfiData();
            e.detail.complete();
          }}
          onIonPull={triggerPullHaptic}
        >
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        {/* Konfi Header mit Activity Rings */}
        <KonfiHeaderCard
          currentKonfi={currentKonfi}
          isTeamer={isTeamer}
          getTotalPoints={getTotalPoints}
          getGottesdienstPoints={getGottesdienstPoints}
          getGemeindePoints={getGemeindePoints}
          certificates={certificates}
          teamerEvents={teamerEvents}
        />

        {/* Punkte-Historie, Aktivitaeten und Anwesenheit haengen an
            GET /admin/konfis/:id und fehlen offline — Name und Punktestand
            kommen aus dem Listen-Cache. */}
        {currentKonfi && activities.length === 0 && !isOnline && (
          <OfflinePlatzhalter was="Die Aktivitäten- und Punkte-Historie" />
        )}

        {((!isTeamer && currentKonfi?.role_name === 'konfi')
          || (isTeamer && (currentKonfi?.konfspruch || currentKonfi?.confirmation_date))) && (
          <KonfispruchSection
            konfspruch={currentKonfi.konfspruch}
            confirmationDate={currentKonfi.confirmation_date}
            confirmationLocation={currentKonfi.confirmation_location}
            attendance={attendanceStats}
            onOpenMatrix={currentKonfi.jahrgang_id ? () => presentMatrixModal({ presentingElement: presentingElement ?? undefined }) : undefined}
          />
        )}

        {isTeamer && (
          <TeamerSinceSection
            currentKonfi={currentKonfi}
            konfiId={konfiId}
            api={api}
            setCurrentKonfi={setCurrentKonfi}
            setError={setError}
          />
        )}

        {/* Konfi-Historie - nur für promoted Teamer */}
        {isTeamer && konfiHistory && (
          <KonfiHistorySection
            konfiHistory={konfiHistory}
            formatDate={formatDate}
          />
        )}

        {/* Besuchte Termine aus der dauerhaften Kopie der Konfi-Zeit */}
        {isTeamer && konfiZeit && (
          <KonfiZeitTermine termine={konfiZeit.termine} />
        )}

        {wrappedListe.length > 0 && (
          <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
                {wrappedListe.map((eintrag, i) => (
                <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
                  key={eintrag.id}
                  className="app-list-item"
                  style={{
                    width: '100%',
                    cursor: 'pointer',
                    borderLeftColor: isTeamer ? 'var(--app-color-teamer)' : 'var(--app-color-konfis)',
                    marginBottom: i < wrappedListe.length - 1 ? 'var(--app-abstand-eng)' : '0'
                  }}
                  onClick={() => setWrappedModalData(eintrag)}
                >
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle" style={{ backgroundColor: isTeamer ? 'var(--app-color-teamer)' : 'var(--app-color-konfis)' }}>
                        <IonIcon icon={ICON_UHRZEIT} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title">
                          {eintrag.titel || `Jahresrückblick ${eintrag.year}`}
                        </div>
                        <div className="app-list-item__meta">
                          <span className="app-list-item__meta-item">
                            {isTeamer ? 'Der Rückblick, den diese Teamer:in sieht' : 'Der Rückblick, den diese Konfi sieht'}
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

        {isTeamer && certificates.length > 0 && (
          <CertificatesSection
            certificates={certificates}
            isOnline={isOnline}
            formatDate={formatDate}
            handleAssignCertificate={handleAssignCertificate}
            handleDeleteCertificate={handleDeleteCertificate}
          />
        )}

        {/* Bonuspunkte - nur für Konfis */}
        {!isTeamer && (
          <BonusSection
            bonusEntries={bonusEntries}
            currentKonfi={currentKonfi}
            getBonusPoints={getBonusPoints}
            formatDate={formatDate}
            handleDeleteBonus={handleDeleteBonus}
            presentBonusModal={presentBonusModalHook}
            presentingElement={presentingElement}
          />
        )}

        {/* Event Points - nur für Konfis */}
        {!isTeamer && (
          <EventPointsSection
            eventPoints={eventPoints}
            currentKonfi={currentKonfi}
          />
        )}

        {/* Teamer Events — auch leer anzeigen: sonst ist "war bei keinem
            Termin" nicht von "nicht geladen" zu unterscheiden. */}
        {isTeamer && (
          <TeamerEventsSection
            teamerEvents={teamerEvents}
            formatDate={formatDate}
          />
        )}

        {/* Aktivitäten - bei Teamer nur Teamer-Aktivitaeten */}
        <ActivitiesSection
          activities={isTeamer
            ? activities.filter(a => a.target_role === 'teamer')
            : activities}
          currentKonfi={currentKonfi}
          isTeamer={isTeamer}
          formatDate={formatDate}
          handleDeleteActivity={handleDeleteActivity}
          handlePhotoClick={handlePhotoClick}
          presentActivityModal={presentActivityModalHook}
          presentingElement={presentingElement}
        />

        {!isTeamer && currentKonfi?.role_name === 'konfi' && (
          <KonfiBadgesSection konfiId={konfiId} />
        )}

        {/* Badges der Teamer:innen — gleiche Stelle wie bei den Konfis. */}
        {isTeamer && (
          <KonfiBadgesSection konfiId={konfiId} role="teamer" />
        )}

        <ChallengeStempelSektion
          marks={mitBewahrtenStempeln(currentKonfi?.challengeMarks || [], bewahrteStempel)}
          offeneStempel={currentKonfi?.offeneStempel || []}
          titel="Stempel"
        />

        {/* Teamer-Beförderung - nur für Konfis */}
        {!isTeamer && (
          <PromoteSection
            isOnline={isOnline}
            handlePromoteToTeamer={handlePromoteToTeamer}
          />
        )}

      </IonContent>

    </IonPage>
  );
};

export default KonfiDetailView;
