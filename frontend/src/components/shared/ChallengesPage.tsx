import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonButtons,
  IonButton,
  IonIcon,
  useIonModal,
  useIonAlert
} from '@ionic/react';
import { add } from 'ionicons/icons';
import { useBadge } from '../../contexts/BadgeContext';
import { useModalPage } from '../../contexts/ModalContext';
import { useLiveRefresh } from '../../contexts/LiveUpdateContext';
import api from '../../services/api';
import { useOfflineQuery } from '../../hooks/useOfflineQuery';
import { useChallengeDelete } from '../../hooks/useChallengeDelete';
import { CACHE_TTL } from '../../services/offlineCache';
import LoadingSpinner from '../common/LoadingSpinner';
import ChallengesManageView from '../admin/views/ChallengesManageView';
import ChallengeManageModal from '../admin/modals/ChallengeManageModal';
import ChallengeLeitungModal from '../admin/modals/ChallengeLeitungModal';
import { triggerPullHaptic } from '../../utils/haptics';
import type { AdminChallenge } from '../../types/challenges';

// Die beiden Dateien bleiben als duenne Huellen bestehen, damit Routen und
// Importpfade unveraendert sind.
interface ChallengesPageProps {
  // Trennt die Zwischenspeicher der Rollen. Die Teamer-Sicht haengt zusaetzlich
  // an der Person, weil das Backend nach zugewiesenen Jahrgaengen filtert —
  // zwei Teamer:innen derselben Organisation sehen NICHT dasselbe.
  cacheKey: string;
  // Eigene Modal-Seiten-ID je Rolle (useModalPage verwaltet den Stapel).
  modalPageId: string;
}

const ChallengesPage: React.FC<ChallengesPageProps> = ({ cacheKey, modalPageId }) => {
  const { refreshAllCounts } = useBadge();
  const { pageRef, presentingElement } = useModalPage(modalPageId);

  const { data: challenges, loading, refresh: refreshChallenges, refreshLive: refreshChallengesLive } = useOfflineQuery<AdminChallenge[]>(
    cacheKey,
    async () => { const res = await api.get('/challenges/admin'); return res.data; },
    { ttl: CACHE_TTL.REQUESTS }
  );

  const [presentAlert] = useIonAlert();

  // Eigene Stempel aus der EINEN Liste ableiten: has_badge liefert
  // GET /challenges/admin seit der Zusammenlegung mit (11.08.) — dadurch
  // braucht es keinen zweiten Endpunkt für die Teilnehmer-Sicht.
  const marks = useMemo(
    () => (Array.isArray(challenges) ? challenges : [])
      .filter((c) => c.has_badge)
      .map((c) => ({
        challenge_id: c.id,
        badge_icon: c.badge_icon,
        badge_name: c.badge_name,
        title: c.title
      })),
    [challenges]
  );

  // Aktuell im Modal bearbeitete/moderierte Challenge
  const [editChallenge, setEditChallenge] = useState<AdminChallenge | null>(null);
  const [moderationChallenge, setModerationChallenge] = useState<AdminChallenge | null>(null);

  // "Ungespeicherte Änderungen"-Stand des Formular-Modals, damit canDismiss
  // auch Swipe-/Backdrop-Schliessen abfangen kann.
  const manageDirtyRef = useRef(false);

  // WICHTIG: Beim Schliessen wird der Challenge-State NICHT auf null gesetzt.
  // useIonModal rendert das Modal während der Dismiss-Animation weiter — ein
  // null-Render liefe dort in die ErrorBoundary (clearAuth => "Rauswurf zur
  // Anmeldung"). Der State wird beim nächsten Oeffnen ohnehin neu gesetzt.
  const [presentManageModal, dismissManageModal] = useIonModal(ChallengeManageModal, {
    challenge: editChallenge,
    onDirtyChange: (dirty: boolean) => { manageDirtyRef.current = dirty; },
    onClose: () => { dismissManageModal(); },
    onSuccess: () => {
      dismissManageModal();
      refreshChallenges();
    }
  });

  const [presentModerationModal, dismissModerationModal] = useIonModal(ChallengeLeitungModal, {
    challenge: moderationChallenge,
    onEdit: (challenge: AdminChallenge) => openEdit(challenge),
    // Für die Card-Optik des Einreichen-Modals (schiebt die Seite nach hinten).
    get presentingElement() { return pageRef.current || presentingElement; },
    onClose: () => { dismissModerationModal(); },
    onChanged: () => {
      refreshChallenges();
      // Tab-Badge (offene Freigaben) direkt nachziehen.
      refreshAllCounts();
    }
  });

  const manageCanDismiss = async (): Promise<boolean> => {
    if (!manageDirtyRef.current) return true;
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
        onDidDismiss: () => { if (!decided) resolve(false); }
      });
    });
  };

  useLiveRefresh('challenges', refreshChallengesLive);

  // Die geöffnete Beitrags-Ansicht hält ihre Challenge als eigenen State.
  // Nach einem Bearbeiten (oder Live-Refresh) käme sonst weiter der alte
  // Stand (Titel, Beschreibung, Sperr-Urteil) zur Anzeige — deshalb hier mit
  // der frisch geladenen Liste abgleichen.
  useEffect(() => {
    if (!moderationChallenge || !Array.isArray(challenges)) return;
    const fresh = challenges.find((c) => c.id === moderationChallenge.id);
    if (fresh && fresh !== moderationChallenge) setModerationChallenge(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenges]);

  const openCreate = () => {
    setEditChallenge(null);
    presentManageModal({
      presentingElement: presentingElement,
      canDismiss: manageCanDismiss,
      backdropDismiss: false
    });
  };

  const openEdit = (challenge: AdminChallenge) => {
    setEditChallenge(challenge);
    presentManageModal({
      presentingElement: presentingElement,
      canDismiss: manageCanDismiss,
      backdropDismiss: false
    });
  };

  const openModeration = (challenge: AdminChallenge) => {
    setModerationChallenge(challenge);
    presentModerationModal({ presentingElement: presentingElement });
  };

  const { handleDelete } = useChallengeDelete({ onDeleted: refreshChallenges });

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonTitle>Challenges</IonTitle>
          <IonButtons slot="end">
            <IonButton aria-label="Neue Challenge anlegen" onClick={openCreate} title="Neue Challenge">
              <IonIcon icon={add} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Challenges</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher
          slot="fixed"
          onIonRefresh={(e) => { refreshChallenges(); e.detail.complete(); }}
          onIonPull={triggerPullHaptic}
        >
          <IonRefresherContent />
        </IonRefresher>

        {loading ? (
          <LoadingSpinner message="Challenges werden geladen..." />
        ) : (
          <ChallengesManageView
            challenges={challenges || []}
            marks={marks}
            onSelectChallenge={openModeration}
            onEditChallenge={openEdit}
            onDeleteChallenge={handleDelete}
            presentingElement={pageRef.current || presentingElement}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default ChallengesPage;
