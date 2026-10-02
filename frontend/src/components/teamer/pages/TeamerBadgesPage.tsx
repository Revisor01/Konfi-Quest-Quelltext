import AppKopfzeile, { AppKopfzeileGross } from '../../shared/AppKopfzeile';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  IonPage,
  IonContent,
  IonRefresher,
  IonRefresherContent
} from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { normalisiereTeamerBadges } from '../teamerBadges';
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

  // Abzeichen-Generation v2: GET /teamer/badges/v2 liefert
  // dieselbe Huelle wie die Konfi-Route — { available, earned, stats } — und
  // ohne die Verwaltungsfelder, die diese Seite nie gelesen hat.
  //
  // Der Zwischenspeicher-Schluessel wandert auf v3, weil dort noch Eintraege
  // der alten Formen liegen koennen (flaches Array bzw. Objekt MIT den
  // Verwaltungsfeldern). normalisiereTeamerBadges bleibt trotzdem davor: Ein
  // alter Eintrag aus dem Zwischenspeicher kaeme sonst ungeprueft durch.
  const { data: badgesData, loading, refresh, refreshLive } = useOfflineQuery<TeamerBadgeResponse>(
    'teamer:badges:v3:' + user?.id,
    async () => {
      const res = await api.get('/teamer/badges/v2');
      return normalisiereTeamerBadges<TeamerBadgeAPI>(res.data, res.headers);
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
        method: 'POST',
        url: '/teamer/badges/mark-seen',
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'fire-and-forget', clientId: safeUUID(), label: 'Badges gesehen' },
      });
      return;
    }
    api.post('/teamer/badges/mark-seen')
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
      <AppKopfzeile titel="Teamer-Badges" onZurueck={() => window.history.back()} gemeindeUmschalter={false} />

      <IonContent className="app-gradient-background" fullscreen>
        <AppKopfzeileGross titel="Teamer-Badges" />

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
