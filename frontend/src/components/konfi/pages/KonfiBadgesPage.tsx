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

interface Badge {
  id: number;
  name: string;
  description?: string;
  icon: string;
  criteria_type: string;
  criteria_value: number;
  criteria_extra?: string;
  is_hidden: boolean;
  is_active: boolean;
  color?: string; // Badge color from database
  // Calculated fields
  is_earned: boolean;
  earned_at?: string;
  progress_points?: number;
  progress_percentage?: number;
}

interface BadgeData {
  earned: any[];
  available: any[];
  stats: {
    totalVisible: number;
    totalSecret: number;
  };
}

const KonfiBadgesPage: React.FC = () => {
  const { user, setError } = useApp();
  const { pageRef, presentingElement } = useModalPage('konfi-badges');
  const [selectedFilter, setSelectedFilter] = useState('alle');

  // --- useOfflineQuery: Badges ---
  const { data: badgeData, loading: badgesLoading, refresh: refreshBadges } = useOfflineQuery<BadgeData>(
    'konfi:badges:' + user?.id,
    () => api.get('/konfi/badges').then(r => r.data),
    { ttl: CACHE_TTL.BADGES }
  );

  // --- useOfflineQuery: Profile (für Punkte-Progress) ---
  const { data: konfiData, refresh: refreshProfile } = useOfflineQuery<any>(
    'konfi:profile:' + user?.id,
    () => api.get('/konfi/profile').then(r => r.data),
    { ttl: CACHE_TTL.PROFILE }
  );

  const loading = badgesLoading;

  // Subscribe to live updates for badges
  const refreshAll = () => {
    refreshBadges();
    refreshProfile();
  };
  useLiveRefresh('badges', refreshAll);

  // Mark badges as seen (Write-Aktion, nicht cachen)
  useEffect(() => {
    if (badgeData) {
      const hasUnseenBadges = badgeData.earned.some((badge: any) => !badge.seen);
      if (hasUnseenBadges) {
        if (!networkMonitor.isOnline) {
          writeQueue.enqueue({
            method: 'POST',
            url: '/konfi/badges/mark-seen',
            maxRetries: 3,
            hasFileUpload: false,
            metadata: { type: 'fire-and-forget', clientId: safeUUID(), label: 'Badges gesehen' },
          });
        } else {
          api.post('/konfi/badges/mark-seen').catch((markError) => {
            console.warn('Badges konnten nicht als gesehen markiert werden:', markError);
          });
        }
      }
    }
  }, [badgeData]);

  // Derive processed badges from cached data
  const badgeStats = badgeData?.stats || { totalVisible: 0, totalSecret: 0 };

  const processedBadges: Badge[] = (() => {
    if (!badgeData || !konfiData) return [];

    // Punkte direkt aus konfi_profiles verwenden
    const currentGottesdienstPoints = konfiData.gottesdienst_points || 0;
    const currentGemeindePoints = konfiData.gemeinde_points || 0;
    const currentTotalPoints = konfiData.total_points || (currentGottesdienstPoints + currentGemeindePoints);

    // Process ALL badges (available + earned)
    const allBadges = [...badgeData.available, ...badgeData.earned];

    // Remove duplicates and process
    const uniqueBadges = allBadges.reduce((acc: any[], current: any) => {
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

    return uniqueBadges.map((badge: any) => {
      const isEarned = badgeData.earned.some((earned: any) => earned.id === badge.id);
      const earnedBadge = badgeData.earned.find((earned: any) => earned.id === badge.id);

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
