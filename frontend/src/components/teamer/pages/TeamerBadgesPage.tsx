import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonRefresher,
  IonRefresherContent
} from '@ionic/react';
import { arrowBack } from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import { useBadge } from '../../../contexts/BadgeContext';
import { CACHE_TTL } from '../../../services/offlineCache';
import LoadingSpinner from '../../common/LoadingSpinner';
import BadgesView from '../../konfi/views/BadgesView';
import { triggerPullHaptic } from '../../../utils/haptics';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';

interface TeamerBadgeAPI {
  id: number;
  name: string;
  description?: string;
  icon: string;
  criteria_type: string;
  criteria_value: number;
  criteria_extra?: string;
  is_hidden: boolean;
  is_active: boolean;
  color?: string;
  earned: boolean;
  earned_at?: string;
  progress?: { current: number; target: number; percentage: number };
}

interface TeamerBadgeResponse {
  available: TeamerBadgeAPI[];
  earned: TeamerBadgeAPI[];
  stats: { totalVisible: number; totalSecret: number };
}

const TeamerBadgesPage: React.FC = () => {
  const { user } = useApp();
  const [selectedFilter, setSelectedFilter] = useState('alle');

  // Schluessel mit v2: Im Zwischenspeicher koennen noch flache Arrays der
  // alten Antwortform liegen — die sollen nicht als neue Form gelesen werden.
  const { data: badgesData, loading, refresh, refreshLive } = useOfflineQuery<TeamerBadgeResponse>(
    'teamer:badges:v2:' + user?.id,
    async () => {
      const res = await api.get('/teamer/badges');
      return res.data;
    },
    { ttl: CACHE_TTL.BADGES }
  );

  // Das Backend sendet 'badges' gezielt an Teamer:innen (routes/teamer.js:796),
  // es fehlte nur der Empfaenger.
  useLiveRefresh(['badges'], useCallback(() => { refreshLive(); }, [refreshLive]));

  // Anders als bei den Konfis liefert die Teamer-Liste kein 'seen' je Abzeichen
  // mit -- markiert wird deshalb pauschal beim Oeffnen, genau dafuer ist der
  // schlanke Endpunkt gedacht. Der Ref verhindert, dass jedes Neuladen
  // (Live-Update, Pull-to-Refresh) einen weiteren Aufruf ausloest.
  // Seit der Zaehler-Konsolidierung kommt die Zahl aus dem
  // BadgeContext -- refreshAllCounts() ist jetzt der richtige und einzige Weg.
  // Vorher brauchte es hier triggerRefresh('badges'), weil der Zaehler als
  // einziger an einem anderen Mechanismus hing.
  const { refreshAllCounts } = useBadge();
  const bereitsMarkiert = useRef(false);
  useEffect(() => {
    if (bereitsMarkiert.current) return;
    bereitsMarkiert.current = true;

    if (!networkMonitor.isOnline) {
      writeQueue.enqueue({
        method: 'PUT',
        url: '/teamer/badges/mark-seen',
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'fire-and-forget', clientId: safeUUID(), label: 'Abzeichen gesehen' },
      });
      return;
    }
    api.put('/teamer/badges/mark-seen')
      .then(() => { refreshAllCounts(); })
      .catch((markError) => {
        console.warn('Abzeichen konnten nicht als gesehen markiert werden:', markError);
      });
  }, [refreshAllCounts]);

  // Wie beim Konfi: verdiente und offene Abzeichen kommen getrennt und
  // werden fuer die Ansicht zusammengefuehrt.
  const badges = [...(badgesData?.earned || []), ...(badgesData?.available || [])];

  // Normalisierung: API-Felder (earned/progress) auf BadgesView-Felder
  // (is_earned/progress_points) — identisch zum Konfi-Weg (KonfiBadgesPage).
  const processedBadges = badges.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    icon: b.icon,
    criteria_type: b.criteria_type,
    criteria_value: b.criteria_value,
    criteria_extra: b.criteria_extra,
    is_hidden: b.is_hidden,
    is_active: b.is_active,
    color: b.color,
    is_earned: b.earned,
    earned_at: b.earned_at,
    progress_points: b.progress?.current ?? 0,
    progress_percentage: b.progress?.percentage ?? 0
  }));

  // Direkt aus der Antwort statt selbst gezaehlt: Der Server kennt auch die
  // zurueckgehaltenen (unverdienten geheimen) Abzeichen.
  const badgeStats = badgesData?.stats || { totalVisible: 0, totalSecret: 0 };

  if (loading) {
    return <LoadingSpinner message="Badges werden geladen..." />;
  }

  return (
    <IonPage>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => window.history.back()} aria-label="Zurück">
              <IonIcon icon={arrowBack} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>Teamer-Badges</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Teamer-Badges</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          await refresh();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        <BadgesView
          badges={processedBadges}
          badgeStats={badgeStats}
          selectedFilter={selectedFilter}
          onFilterChange={setSelectedFilter}
        />
      </IonContent>
    </IonPage>
  );
};

export default TeamerBadgesPage;
