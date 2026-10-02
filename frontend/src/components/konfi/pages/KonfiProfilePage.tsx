import AppKopfzeile, { AppKopfzeileGross } from '../../shared/AppKopfzeile';
import React from 'react';
import {
  IonPage,
  IonContent,
  IonRefresher,
  IonRefresherContent,
} from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import api from '../../../services/api';
import LoadingSpinner from '../../common/LoadingSpinner';
import ProfileView from '../views/ProfileView';
import { triggerPullHaptic } from '../../../utils/haptics';

interface KonfiProfile {
  id: number;
  username: string;
  display_name: string;
  email?: string;
  jahrgang_name: string;
  jahrgang_year: number;
  confirmation_date?: string;
  created_at: string;
  last_login_at?: string;
  bible_translation?: string;
  // Statistics
  total_points: number;
  badge_count: number;
  activity_count: number;
  event_count: number;
  pending_requests: number;
  rank_in_jahrgang?: number;
  total_in_jahrgang?: number;
  progress_overview: ProgressOverview;
}

interface ProgressOverview {
  monthly_points: {
    month: string;
    points: number;
  }[];
  achievements: {
    total_activities: number;
    total_events: number;
    total_badges: number;
    streak_days?: number;
  };
}

const KonfiProfilePage: React.FC = () => {
  const { user } = useApp();
  const { pageRef, presentingElement } = useModalPage('profile');

  // --- useOfflineQuery: Profile ---
  const { data: profile, loading, refresh, refreshLive } = useOfflineQuery<KonfiProfile>(
    'konfi:profile:' + user?.id,
    () => api.get('/konfi/profile').then(r => r.data),
    { ttl: CACHE_TTL.PROFILE }
  );

  // Subscribe to live updates for points and badges
  // 'dashboard' MUSS mit dabei sein: Bonuspunkte und von der Leitung vergebene
  // Aktivitäten melden 'dashboard', nicht 'points' — ohne das blieb das Profil
  // bei genau diesen Vergabewegen stehen.
  useLiveRefresh(['points', 'dashboard', 'badges'], refreshLive);

  if (loading) {
    return <LoadingSpinner message="Profil wird geladen..." />;
  }

  if (!profile) {
    return (
      <IonPage>
        <IonContent>
          <p style={{ textAlign: 'center', marginTop: 'var(--app-freiraum-kopf-m)' }}>
            Fehler beim Laden des Profils
          </p>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage ref={pageRef}>
      <AppKopfzeile titel="Profil" onZurueck={() => window.history.back()} gemeindeUmschalter={false} />

      <IonContent className="app-gradient-background" fullscreen>
        <AppKopfzeileGross titel="Profil" />

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          await refresh();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        <ProfileView profile={profile} onReload={refresh} presentingElement={presentingElement || null} pageRef={pageRef} />
      </IonContent>
    </IonPage>
  );
};

export default KonfiProfilePage;
