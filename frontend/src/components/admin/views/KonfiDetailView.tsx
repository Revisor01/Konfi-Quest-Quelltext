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
import {
  arrowBack,
  key,
  close,
  timeOutline,
  createOutline
} from 'ionicons/icons';
import api from '../../../services/api';
import { useApp } from '../../../contexts/AppContext';
import { offlineBlockiert } from '../../../utils/offlineAktion';
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
import KonfiBadgesSection from './KonfiBadgesSection';
import WrappedModal from '../../wrapped/WrappedModal';
import type { WrappedHistoryEntry } from '../../../types/wrapped';
import { triggerPullHaptic } from '../../../utils/haptics';

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
  const [bonusEntries, setBonusEntries] = useState<any[]>([]);
  const [eventPoints, setEventPoints] = useState<any[]>([]);
  const [currentKonfi, setCurrentKonfi] = useState<Konfi | null>(null);
  const [loading, setLoading] = useState(true);
  const [targetRole, setTargetRole] = useState<string>('konfi');
  // Fuer das Bearbeiten-Modal: alle Jahrgaenge der Organisation (mit ihren
  // Punktearten, damit die Warnung stimmt) und die eigenen Zuweisungen.
  const [alleJahrgaenge, setAlleJahrgaenge] = useState<Array<{
    id: number; name: string; gottesdienst_enabled?: boolean; gemeinde_enabled?: boolean;
  }>>([]);
  const isTeamer = targetRole === 'teamer';
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
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
  const [konfiHistory, setKonfiHistory] = useState<{
    history: Array<{ id: number; title: string; points: number; category: string; date: string; source_type: string }>;
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

  // Photo Modal Component
  const PhotoModal: React.FC<{ onClose: () => void; photoUrl: string }> = ({ onClose, photoUrl }) => (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Foto</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" onClick={onClose}>
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div style={{ padding: '16px', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <img
            src={photoUrl}
            alt="Aktivitätsfoto"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: '8px'
            }}
          />
        </div>
      </IonContent>
    </IonPage>
  );

  // Photo Modal mit useIonModal Hook
  const [presentPhotoModalHook, dismissPhotoModalHook] = useIonModal(PhotoModal, {
    onClose: () => {
      if (selectedPhoto && selectedPhoto.startsWith('blob:')) {
        URL.revokeObjectURL(selectedPhoto);
      }
      setSelectedPhoto(null);
      dismissPhotoModalHook();
    },
    photoUrl: selectedPhoto || ''
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

  const [konfiWrapped, setKonfiWrapped] = useState<WrappedHistoryEntry | null>(null);

  useEffect(() => {
    if (isTeamer) {
      setKonfiWrapped(null);
      return;
    }
    let abgebrochen = false;
    api.get(`/wrapped/history/${konfiId}`)
      .then(res => {
        if (abgebrochen) return;
        const entries: WrappedHistoryEntry[] = res.data || [];
        const konfiEntry = entries.find(e => e.wrapped_type === 'konfi');
        setKonfiWrapped(konfiEntry || null);
      })
      .catch(() => {
        // Kein Wrapped vorhanden oder offline: Die Karte bleibt einfach weg.
        if (!abgebrochen) setKonfiWrapped(null);
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
    wrappedType: 'konfi' as const,
    initialData: wrappedModalData?.data,
    initialYear: wrappedModalData?.year
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
  const [presentBearbeitenModal, dismissBearbeitenModal] = useIonModal(KonfiModal, {
    jahrgaenge: alleJahrgaenge,
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

  useEffect(() => {
    loadKonfiData();
  }, [konfiId]);

  // Jahrgaenge fuer das Bearbeiten-Modal. Einmal beim Oeffnen der Seite; die
  // Liste enthaelt dank SELECT j.* auch die Punktearten, aus denen die Warnung
  // beim Wechsel gebaut wird. Faellt der Abruf aus, bleibt die Liste leer und
  // das Modal zeigt "Keine Jahrgänge verfügbar" — die Seite selbst stoert das
  // nicht.
  useEffect(() => {
    if (isTeamer) return;
    api.get('/jahrgaenge')
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
    loadKonfiData(true);
  }, [konfiId]));

  const loadKonfiData = async (stillLaden = false) => {
    // stillLaden: bei Live-Ereignissen NICHT den Ladebalken zeigen — die
    // Ansicht wuerde bei jeder fremden Punktvergabe kurz leer flackern.
    if (!stillLaden) setLoading(true);
    try {
      const konfiRes = await api.get(`/admin/konfis/${konfiId}`);

      let requestsRes = { data: [] };
      try {
        requestsRes = await api.get('/admin/activities/requests');
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
      } else {
        setCertificates([]);
        setTeamerEvents([]);
        setKonfiHistory(null);
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
      } catch (eventPointsError) {
        setEventPoints([]);
      }

      try {
        const attendanceRes = await api.get(`/admin/konfis/${konfiId}/attendance-stats`);
        setAttendanceStats(attendanceRes.data);
      } catch (attendanceError) {
        setAttendanceStats(null);
      }

      const enhancedActivities = allActivities.map((activity: any) => ({
        ...activity,
        hasPhoto: false
      }));

      const pendingRequests = (requestsRes.data || [])
        .filter((req: any) => req.konfi_id === konfiId && req.status === 'pending')
        .map((req: any) => ({
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
    } catch (err) {
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
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
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
              setError('Fehler beim Löschen der Aktivität');
            }
          }
        }
      ]
    });
  };

  const handleDeleteBonus = async (bonus: any) => {
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
            } catch (err) {
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
      setError('Fehler beim Zurücksetzen des Passworts');
    }
  };

  const handlePhotoClick = async (activity: Activity) => {
    if (activity.hasPhoto && activity.requestId) {
      try {
        const response = await api.get(`/admin/activities/requests/${activity.requestId}/photo`, {
          responseType: 'blob'
        });
        const photoUrl = URL.createObjectURL(response.data);
        // Vorherige Blob-URL freigeben, falls direkt ein weiteres Foto geoeffnet wird
        setSelectedPhoto((prev) => {
          if (prev && prev.startsWith('blob:')) {
            try { URL.revokeObjectURL(prev); } catch {}
          }
          return photoUrl;
        });
        presentPhotoModalHook({
          presentingElement: presentingElement || undefined
        });
      } catch (error) {
        setError('Foto konnte nicht geladen werden');
      }
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
            } catch (err: any) {
              setError(err.response?.data?.error || 'Fehler beim Entfernen');
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
            } catch (err: any) {
              setError(err.response?.data?.error || 'Fehler beim Befördern');
            }
          }
        }
      ]
    });
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          {!hideBackButton && (
            <IonButtons slot="start">
              <IonButton aria-label="Zurück" onClick={onBack}>
                <IonIcon icon={arrowBack} />
              </IonButton>
            </IonButtons>
          )}
          <IonTitle>{currentKonfi?.name || (isTeamer ? 'Teamer:in Details' : 'Konfi Details')}</IonTitle>
          <IonButtons slot="end">
            {/* Bearbeiten nur bei Konfis: Teamer:innen haben keinen einzelnen
                Jahrgang, ihre Stammdaten liegen in der Benutzerverwaltung. */}
            {!isTeamer && (
              <IonButton
                aria-label="Konfi bearbeiten"
                disabled={!isOnline || !currentKonfi}
                onClick={() => presentBearbeitenModal({ presentingElement: presentingElement || undefined })}
              >
                <IonIcon icon={createOutline} />
              </IonButton>
            )}
            <IonButton aria-label="Passwort zurücksetzen" disabled={!isOnline} onClick={handlePasswordAction}>
              <IonIcon icon={key} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

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
          activities={activities}
        />

        {/* Konfirmation (Termin + Spruch + Pflicht-Events, read-only) - nur für Konfis */}
        {!isTeamer && currentKonfi?.role_name === 'konfi' && (
          <KonfispruchSection
            konfspruch={currentKonfi.konfspruch}
            confirmationDate={currentKonfi.confirmation_date}
            confirmationLocation={currentKonfi.confirmation_location}
            attendance={attendanceStats}
            onOpenMatrix={currentKonfi.jahrgang_id ? () => presentMatrixModal({ presentingElement: presentingElement ?? undefined }) : undefined}
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

        {!isTeamer && konfiWrapped && (
          <IonList inset={true} style={{ margin: '16px' }}>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: '16px' }}>
                <div
                  className="app-list-item"
                  style={{ width: '100%', cursor: 'pointer', borderLeftColor: 'var(--app-color-konfis)' }}
                  onClick={() => setWrappedModalData(konfiWrapped)}
                >
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle" style={{ backgroundColor: 'var(--app-color-konfis)' }}>
                        <IonIcon icon={timeOutline} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title">
                          Jahresrückblick {konfiWrapped.year}
                        </div>
                        <div className="app-list-item__meta">
                          <span className="app-list-item__meta-item">
                            Der Rückblick, den diese Konfi sieht
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* Badges der Konfis — bei Teamer:innen steht der Abschnitt weiter
            unten, nach Events und Aktivitaeten (User-Hinweis 11.08.). */}
        {!isTeamer && currentKonfi?.role_name === 'konfi' && (
          <KonfiBadgesSection konfiId={konfiId} />
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

        {/* Badges der Teamer:innen — nach Events und Aktivitaeten, so wie
            die Konfi-Badges auch unter ihren Listen stehen. */}
        {isTeamer && (
          <KonfiBadgesSection konfiId={konfiId} role="teamer" />
        )}

        {/* Zertifikate - nur für Teamer */}
        {isTeamer && (
          <CertificatesSection
            certificates={certificates}
            isOnline={isOnline}
            formatDate={formatDate}
            handleAssignCertificate={handleAssignCertificate}
            handleDeleteCertificate={handleDeleteCertificate}
          />
        )}

        {/* Teamer: Aktiv-seit bearbeiten */}
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
