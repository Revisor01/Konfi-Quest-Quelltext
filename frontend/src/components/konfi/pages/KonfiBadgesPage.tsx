import React, { useState, useEffect } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent
} from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import { useBadge } from '../../../contexts/BadgeContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import BadgesView from '../views/BadgesView';
import LoadingSpinner from '../../common/LoadingSpinner';
import { triggerPullHaptic } from '../../../utils/haptics';
import { safeUUID } from '../../../utils/uuid';
import type { AnzeigeBadge, ApiBadge, BadgeUebersicht } from '../../../types/dashboard';

/**
 * Nur die Punktefelder aus GET /konfi/profile, die diese Seite braucht —
 * sie dienen als Rueckfallebene fuer Abzeichen ohne Server-Fortschritt.
 */
interface KonfiPunkte {
  total_points?: number;
  gottesdienst_points?: number;
  gemeinde_points?: number;
}

const KonfiBadgesPage: React.FC = () => {
  const { user } = useApp();
  const { refreshAllCounts } = useBadge();
  const { pageRef } = useModalPage('konfi-badges');
  const [selectedFilter, setSelectedFilter] = useState('alle');

  // --- useOfflineQuery: Badges ---
  const { data: badgeData, loading: badgesLoading, refresh: refreshBadges, refreshLive: refreshBadgesLive } = useOfflineQuery<BadgeUebersicht>(
    // Abzeichen-Generation v2: gleiche Huelle wie bisher, aber
    // ohne die Verwaltungsfelder. Neuer Schluessel, weil im Zwischenspeicher
    // noch Eintraege MIT diesen Feldern liegen koennen.
    'konfi:badges:v2:' + user?.id,
    () => api.get('/konfi/badges/v2').then(r => r.data),
    { ttl: CACHE_TTL.BADGES }
  );

  // --- useOfflineQuery: Profile (für Punkte-Progress) ---
  const { data: konfiData, refresh: refreshProfile, refreshLive: refreshProfileLive } = useOfflineQuery<KonfiPunkte>(
    'konfi:profile:' + user?.id,
    () => api.get('/konfi/profile').then(r => r.data),
    { ttl: CACHE_TTL.PROFILE }
  );

  const loading = badgesLoading;

  // Subscribe to live updates for badges
  const refreshAll = () => {
    refreshBadgesLive();
    refreshProfileLive();
  };
  useLiveRefresh('badges', refreshAll);

  const lastMarkedRef = React.useRef<string>('');
  useEffect(() => {
    if (badgeData) {
      const unseenIds = badgeData.earned
        .filter((badge) => !badge.seen)
        .map((badge) => badge.id)
        .sort((a: number, b: number) => a - b)
        .join(',');
      const hasUnseenBadges = unseenIds.length > 0 && unseenIds !== lastMarkedRef.current;
      if (hasUnseenBadges) {
        lastMarkedRef.current = unseenIds;
        if (!networkMonitor.isOnline) {
          writeQueue.enqueue({
            method: 'POST',
            url: '/konfi/badges/mark-seen',
            maxRetries: 3,
            hasFileUpload: false,
            metadata: { type: 'fire-and-forget', clientId: safeUUID(), label: 'Badges gesehen' },
          });
        } else {
          api.post('/konfi/badges/mark-seen')
            .then(() => {
              refreshAllCounts();
            })
            .catch((markError) => {
              console.warn('Badges konnten nicht als gesehen markiert werden:', markError);
            });
        }
      }
    }
  }, [badgeData]);

  // Derive processed badges from cached data
  const badgeStats = badgeData?.stats || { totalVisible: 0, totalSecret: 0 };

  const processedBadges: AnzeigeBadge[] = (() => {
    if (!badgeData || !konfiData) return [];

    // Punkte direkt aus konfi_profiles verwenden
    const currentGottesdienstPoints = konfiData.gottesdienst_points || 0;
    const currentGemeindePoints = konfiData.gemeinde_points || 0;
    const currentTotalPoints = konfiData.total_points || (currentGottesdienstPoints + currentGemeindePoints);

    // Process ALL badges (available + earned)
    const allBadges = [...badgeData.available, ...badgeData.earned];

    // Remove duplicates and process
    const uniqueBadges = allBadges.reduce((acc: ApiBadge[], current) => {
      const existingIndex = acc.findIndex(badge => badge.id === current.id);
      if (existingIndex === -1) {
        acc.push(current);
      } else {
        if (current.earned && !acc[existingIndex].earned) {
          acc[existingIndex] = current;
        }
      }
      return acc;
    }, []);

    return uniqueBadges.map((badge) => {
      const isEarned = badgeData.earned.some((earned) => earned.id === badge.id);
      const earnedBadge = badgeData.earned.find((earned) => earned.id === badge.id);

      let progressPoints = badge.progress?.current || 0;
      let progressPercentage = badge.progress?.percentage || 0;

      if (!badge.progress && !isEarned) {
        if (badge.criteria_type === 'total_points') {
          progressPoints = Math.min(currentTotalPoints, badge.criteria_value);
          progressPercentage = (progressPoints / badge.criteria_value) * 100;
        } else if (badge.criteria_type === 'gottesdienst_points') {
          progressPoints = Math.min(currentGottesdienstPoints, badge.criteria_value);
          progressPercentage = (progressPoints / badge.criteria_value) * 100;
        } else if (badge.criteria_type === 'gemeinde_points') {
          progressPoints = Math.min(currentGemeindePoints, badge.criteria_value);
          progressPercentage = (progressPoints / badge.criteria_value) * 100;
        } else if (badge.criteria_type === 'both_categories') {
          const gottesdienstProgress = Math.min(currentGottesdienstPoints, badge.criteria_value);
          const gemeindeProgress = Math.min(currentGemeindePoints, badge.criteria_value);
          progressPoints = Math.min(gottesdienstProgress, gemeindeProgress);
          progressPercentage = (progressPoints / badge.criteria_value) * 100;
        }
      }

      return {
        id: badge.id,
        name: badge.name,
        description: badge.description,
        icon: badge.icon,
        criteria_type: badge.criteria_type,
        criteria_value: badge.criteria_value,
        criteria_extra: badge.criteria_extra,
        is_hidden: badge.is_hidden,
        is_active: badge.is_active,
        color: badge.color,
        is_earned: isEarned,
        earned_at: earnedBadge?.earned_at,
        progress_points: progressPoints,
        progress_percentage: progressPercentage
      };
    });
  })();

  if (loading) {
    return <LoadingSpinner message="Badges werden geladen..." />;
  }

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonTitle>Badges</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Badges</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          await Promise.all([refreshBadges(), refreshProfile()]);
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        {loading ? (
          <LoadingSpinner message="Badges werden geladen..." />
        ) : (
          <BadgesView
            badges={processedBadges}
            badgeStats={badgeStats}
            selectedFilter={selectedFilter}
            onFilterChange={setSelectedFilter}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default KonfiBadgesPage;
