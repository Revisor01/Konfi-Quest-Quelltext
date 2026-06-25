import React, { useState, useEffect } from 'react';
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
  useIonModal,
  useIonAlert
} from '@ionic/react';
import {
  arrowBack,
  key,
  close
} from 'ionicons/icons';
import api from '../../../services/api';
import { useApp } from '../../../contexts/AppContext';
import ActivityModal from '../modals/ActivityModal';
import BonusModal from '../modals/BonusModal';
import CertificateAssignModal from '../modals/CertificateAssignModal';
import AttendanceMatrixModal from '../modals/AttendanceMatrixModal';
import { useLiveUpdate } from '../../../contexts/LiveUpdateContext';
import {
  KonfiHeaderCard, BonusSection, EventPointsSection,
  TeamerEventsSection, ActivitiesSection, CertificatesSection,
  TeamerSinceSection, KonfiHistorySection, PromoteSection, KonfispruchSection
} from './KonfiDetailSections';
import type { Konfi, Activity } from './KonfiDetailSections';
import { triggerPullHaptic } from '../../../utils/haptics';

interface KonfiDetailViewProps {
  konfiId: number;
  onBack: () => void;
}

const KonfiDetailView: React.FC<KonfiDetailViewProps> = ({ konfiId, onBack }) => {
  const { setSuccess, setError, isOnline } = useApp();
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
            <IonButton onClick={onClose}>
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

  // Anwesenheitsmatrix-Modal (geoeffnet aus der Konfirmations-Karte, auf den Jahrgang des Konfis vorausgewaehlt)
  const konfiJahrgang = currentKonfi?.jahrgang_id
    ? [{ id: currentKonfi.jahrgang_id, name: currentKonfi.jahrgang_name || 'Jahrgang' }]
    : [];
  const [presentMatrixModal, dismissMatrixModal] = useIonModal(AttendanceMatrixModal, {
    jahrgaenge: konfiJahrgang,
    initialJahrgangId: currentKonfi?.jahrgang_id,
    onClose: () => dismissMatrixModal()
  });

  useEffect(() => {
    loadKonfiData();
  }, [konfiId]);

  useEffect(() => {
    setPresentingElement(pageRef.current);
  }, []);

  const loadKonfiData = async () => {
    setLoading(true);
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

      // Teamer-Daten aus dem Detail-Response
      if (konfiData.role_name === 'teamer') {
        if (konfiData.certificates) setCertificates(konfiData.certificates);
        if (konfiData.teamerEvents) setTeamerEvents(konfiData.teamerEvents);
        if (konfiData.konfiHistory) setKonfiHistory(konfiData.konfiHistory);
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
          name: `${req.activity_name} (Antrag)`,
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
    if (!isOnline) return;
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
    if (!isOnline) return;
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
    if (!isOnline) return;
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
        setSelectedPhoto(photoUrl);
        presentPhotoModalHook({
          presentingElement: presentingElement || undefined
        });
      } catch (error) {
        setError('Foto konnte nicht geladen werden');
      }
    }
  };

  const handleAssignCertificate = () => {
    if (!isOnline) return;

    if (availableTypes.length === 0) {
      setError('Keine verfügbaren Zertifikat-Typen mehr');
      return;
    }

    presentCertModal({ presentingElement: presentingElement || undefined });
  };

  const handleDeleteCertificate = (cert: { id: number; name: string }) => {
    if (!isOnline) return;
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
    if (!isOnline) return;
    if (!currentKonfi) return;
    presentAlert({
      header: 'Zur Teamer:in befördern',
      message: `<strong>${currentKonfi.name}</strong> wirklich zur Teamer:in befördern?<br><br>` +
        `<strong>Punkte:</strong> ${getGottesdienstPoints()} Gottesdienst, ${getGemeindePoints()} Gemeinde<br>` +
        `<strong>Badges:</strong> ${currentKonfi.badgeCount || 0}<br><br>` +
        `Konfi-Punkte und Badges bleiben als Historie erhalten. ` +
        `Event-Buchungen und offene Anträge werden gelöscht.<br><br>` +
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
          <IonButtons slot="start">
            <IonButton onClick={onBack}>
              <IonIcon icon={arrowBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>{currentKonfi?.name || (isTeamer ? 'Teamer:in Details' : 'Konfi Details')}</IonTitle>
          <IonButtons slot="end">
            <IonButton disabled={!isOnline} onClick={handlePasswordAction}>
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


        {/* Teamer Events */}
        {isTeamer && teamerEvents.length > 0 && (
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
