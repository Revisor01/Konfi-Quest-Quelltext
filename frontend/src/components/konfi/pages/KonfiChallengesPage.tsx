import React, { useState, useCallback } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  useIonModal
} from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import api from '../../../services/api';
import LoadingSpinner from '../../common/LoadingSpinner';
import ChallengesView from '../views/ChallengesView';
import ChallengeSubmitModal from '../modals/ChallengeSubmitModal';
import ChallengeDetailModal from '../modals/ChallengeDetailModal';
import { triggerPullHaptic } from '../../../utils/haptics';
import type { KonfiChallenge, KonfiChallengesResponse } from '../../../types/challenges';

const EMPTY_RESPONSE: KonfiChallengesResponse = { active: [], archive: [], marks: [] };

const KonfiChallengesPage: React.FC = () => {
  const { user } = useApp();
  const { pageRef, presentingElement } = useModalPage('konfi-challenges');

  const { data, loading, refresh, refreshLive } = useOfflineQuery<KonfiChallengesResponse>(
    'konfi:challenges:' + user?.id,
    () => api.get('/challenges/konfi').then((r) => r.data),
    { ttl: CACHE_TTL.REQUESTS }
  );

  // Defensive: bei kaputten/alten Cache-Eintraegen auf leere Listen fallen.
  const response = data && typeof data === 'object' ? data : EMPTY_RESPONSE;
  const active = Array.isArray(response.active) ? response.active : [];
  const archive = Array.isArray(response.archive) ? response.archive : [];
  const marks = Array.isArray(response.marks) ? response.marks : [];

  const [selectedChallenge, setSelectedChallenge] = useState<KonfiChallenge | null>(null);

  const modalPresenting = () => pageRef.current || presentingElement || undefined;

  const [presentSubmitModal, dismissSubmitModal] = useIonModal(ChallengeSubmitModal, {
    challenge: selectedChallenge,
    // selectedChallenge wird beim Schliessen bewusst NICHT zurückgesetzt: das
    // Modal ist während der Dismiss-Animation noch gemountet und wuerde bei
    // null kurz den Ladezustand aufblitzen lassen. Der nächste Aufruf setzt die
    // Challenge ohnehin neu.
    onClose: () => dismissSubmitModal(),
    onSuccess: () => {
      dismissSubmitModal();
      refresh();
    }
  });

  const [presentDetailModal, dismissDetailModal] = useIonModal(ChallengeDetailModal, {
    challenge: selectedChallenge,
    onClose: () => dismissDetailModal(),
    onSubmit: (challenge: KonfiChallenge) => {
      // Aus dem Detail heraus einreichen: Detail schliessen, dann das
      // Einreich-Modal auf der Seite praesentieren (kein Modal-im-Modal).
      dismissDetailModal();
      setSelectedChallenge(challenge);
      setTimeout(() => {
        presentSubmitModal({ presentingElement: modalPresenting() });
      }, 300);
    }
  });

  useLiveRefresh('challenges', refreshLive);

  const handleSelectChallenge = useCallback((challenge: KonfiChallenge) => {
    setSelectedChallenge(challenge);
    presentDetailModal({ presentingElement: modalPresenting() });
    // presentDetailModal ist stabil; pageRef/presentingElement werden lazy gelesen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentDetailModal]);

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonTitle>Challenges</IonTitle>
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
          onIonRefresh={async (e) => {
            await refresh();
            e.detail.complete();
          }}
          onIonPull={triggerPullHaptic}
        >
          <IonRefresherContent />
        </IonRefresher>

        {loading && !data ? (
          <LoadingSpinner message="Challenges werden geladen..." />
        ) : (
          <ChallengesView
            active={active}
            archive={archive}
            marks={marks}
            onSelectChallenge={handleSelectChallenge}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default KonfiChallengesPage;
