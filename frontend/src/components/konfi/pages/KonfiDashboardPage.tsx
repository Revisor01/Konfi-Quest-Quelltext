import React, { useState, useCallback, useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonIcon,
  IonButtons,
  IonButton,
  useIonModal,
  useIonRouter
} from '@ionic/react';
import { sparkles, chevronForward, personCircleOutline } from 'ionicons/icons';
import KonfiOnboardingModal from '../modals/KonfiOnboardingModal';
import KonfiUpdateWalkthroughModal from '../modals/KonfiUpdateWalkthroughModal';
import { useOnboardingWithUpdateOnce } from '../../../hooks/useOnboardingOnce';
import NeuerungenBanner from '../../shared/NeuerungenBanner';
import MitmachenErklaerungModal from '../../shared/MitmachenErklaerungModal';
import { useApp } from '../../../contexts/AppContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import api from '../../../services/api';
import LoadingSpinner from '../../common/LoadingSpinner';
import DashboardView from '../views/DashboardView';
import PointsHistoryModal from '../modals/PointsHistoryModal';
import KonfispruchSelectModal from '../modals/KonfispruchSelectModal';
import WrappedModal from '../../wrapped/WrappedModal';
import { Event } from '../../../types/event';
import { triggerPullHaptic } from '../../../utils/haptics';
import { mergeSectionOrder, DEFAULT_KONFI_SECTION_ORDER } from '../../../utils/sectionOrder';
import { TrialBanner } from '../../shared';
import { track } from '../../../services/analytics';

interface PointConfig {
  gottesdienst_enabled: boolean;
  gemeinde_enabled: boolean;
  target_gottesdienst: number;
  target_gemeinde: number;
}

interface DashboardConfig {
  show_konfirmation: boolean;
  show_events: boolean;
  show_losung: boolean;
  show_badges: boolean;
  show_ranking: boolean;
  show_challenges?: boolean;
  section_order?: string[];
}

interface DashboardData {
  konfi: {
    id: number;
    display_name: string;
    jahrgang_name: string;
    gottesdienst_points: number;
    gemeinde_points: number;
    confirmation_date?: string;
    confirmation_location?: string;
  };
  total_points: number;
  recent_badges: any[];
  badge_count: number;
  recent_events: any[];
  event_count: number;
  ranking: any[];
  days_to_confirmation?: number;
  confirmation_date?: string;
  point_config?: PointConfig;
  dashboard_config?: DashboardConfig;
  has_wrapped?: boolean;
  konfspruch_visible?: boolean;
  konfspruch?: {
    source: 'liste' | 'freitext';
    id?: number;
    reference?: string;
    text?: string;
    translation?: string;
  } | null;
}

interface KonfiProfile {
  konfspruch?: {
    source: 'liste' | 'freitext';
    id?: number;
    reference?: string;
    text?: string;
    translation?: string;
  } | null;
}

// Event-Typ importiert aus types/event

interface BadgeStats {
  totalAvailable: number;
  totalEarned: number;
  secretAvailable: number;
  secretEarned: number;
}

interface AllBadgesData {
  available: any[];
  earned: any[];
}

interface DailyVerse {
  losungstext: string;
  losungsvers: string;
  lehrtext: string;
  lehrtextvers: string;
  date?: string;
  translation?: string;
  fallback?: boolean;
  cached?: boolean;
}

const KonfiDashboardPage: React.FC = () => {
  const { user, setError } = useApp();
  const router = useIonRouter();
  const [showLehrtext, setShowLehrtext] = useState(false);
  const pageRef = useRef<HTMLElement>(null);

  // Anonyme Messung der Scroll-Tiefe: Sehen die Konfis die unteren Abschnitte
  // des Dashboards überhaupt? Je Sitzung wird jede Marke NUR EINMAL gemeldet
  // (Ref statt State, damit das Scrollen kein Rendern ausloest).
  const scrollMarken = useRef<Set<number>>(new Set());
  const handleScrollTiefe = useCallback((ev: CustomEvent) => {
    const el = ev.target as HTMLIonContentElement & { scrollHeight?: number; clientHeight?: number };
    const detail: any = ev.detail || {};
    const hoehe = (el?.scrollHeight || 0) - (el?.clientHeight || 0);
    if (hoehe <= 0) return;
    const anteil = Math.round(((detail.scrollTop || 0) / hoehe) * 100);
    for (const marke of [25, 50, 75, 100]) {
      if (anteil >= marke && !scrollMarken.current.has(marke)) {
        scrollMarken.current.add(marke);
        track('dashboard-gescrollt', { tiefe: marke });
      }
    }
  }, []);

  // --- useOfflineQuery: Dashboard ---
  const { data: dashboardData, loading: dashLoading, refresh: refreshDashboard, refreshLive: refreshDashboardLive } = useOfflineQuery<DashboardData>(
    'konfi:dashboard:' + user?.id,
    () => api.get('/konfi/dashboard').then(r => r.data),
    { ttl: CACHE_TTL.DASHBOARD }
  );

  // --- useOfflineQuery: Profil (für gewaehlten Konfispruch) ---
  const { data: konfiProfile, refresh: refreshProfile } = useOfflineQuery<KonfiProfile>(
    'konfi:profile:' + user?.id,
    () => api.get('/konfi/profile').then(r => r.data),
    { ttl: CACHE_TTL.PROFILE }
  );



  // --- useOfflineQuery: Events ---
  const { data: upcomingEvents, refresh: refreshEvents, refreshLive: refreshEventsLive } = useOfflineQuery<Event[]>(
    'konfi:events:' + user?.id,
    () => api.get('/konfi/events').then(r => r.data),
    {
      ttl: CACHE_TTL.EVENTS,
      select: (events) => events.filter((event: any) =>
        new Date(event.event_date || event.date) >= new Date() &&
        (event.is_registered || event.booking_status === 'confirmed' || event.booking_status === 'waitlist')
      )
    }
  );

  // --- useOfflineQuery: Badges ---
  const { data: badgesRaw, refresh: refreshBadges, refreshLive: refreshBadgesLive } = useOfflineQuery<any>(
    'konfi:badges:' + user?.id,
    () => api.get('/konfi/badges').then(r => r.data),
    { ttl: CACHE_TTL.BADGES }
  );

  // Derived state from badges
  const badgeStats: BadgeStats = (() => {
    if (!badgesRaw) return { totalAvailable: 0, totalEarned: 0, secretAvailable: 0, secretEarned: 0 };
    const { available, earned, stats } = badgesRaw;
    const visibleEarned = earned?.filter((badge: any) => !badge.is_hidden).length || 0;
    const visibleTotal = stats?.totalVisible || 0;
    const secretEarned = earned?.filter((badge: any) => badge.is_hidden === true).length || 0;
    const secretTotal = stats?.totalSecret || 0;
    return { totalAvailable: visibleTotal, totalEarned: visibleEarned, secretAvailable: secretTotal, secretEarned: secretEarned };
  })();

  const allBadges: AllBadgesData = {
    available: badgesRaw?.available || [],
    earned: badgesRaw?.earned || []
  };

  // Loading nur vom Dashboard-Query bestimmt
  const loading = dashLoading;

  // Points History Modal
  const [presentPointsHistoryModal, dismissPointsHistoryModal] = useIonModal(PointsHistoryModal, {
    onClose: () => dismissPointsHistoryModal(),
    pointConfig: dashboardData?.point_config
  });

  const openPointsHistory = () => {
    presentPointsHistoryModal({
      presentingElement: pageRef.current || undefined
    });
  };

  // Wrapped Modal
  const [presentWrappedModal, dismissWrappedModal] = useIonModal(WrappedModal, {
    onClose: () => dismissWrappedModal(),
    displayName: dashboardData?.konfi?.display_name || '',
    jahrgangName: dashboardData?.konfi?.jahrgang_name || '',
    wrappedType: 'konfi' as const
  });

  const openWrapped = () => {
    presentWrappedModal({ cssClass: 'wrapped-modal-fullscreen' });
  };

  // Konfispruch Modal
  const [presentKonfispruchModal, dismissKonfispruchModal] = useIonModal(KonfispruchSelectModal, {
    onClose: () => dismissKonfispruchModal(),
    onSuccess: () => {
      dismissKonfispruchModal();
      refreshProfile();
      refreshDashboard();
    },
    current: konfiProfile?.konfspruch ?? null
  });

  const openKonfispruch = () => {
    presentKonfispruchModal({
      presentingElement: pageRef.current || undefined
    });
  };

  // --- Onboarding-Tour (frische Accounts) bzw. Neuigkeiten-Karte
  // "Was ist neu in Version 2.0" (Bestandsnutzer) — nie beides. Der
  // Walkthrough poppt nicht mehr von selbst auf, sondern öffnet sich über
  // die Karte oder dauerhaft über "Was ist neu?" im Profil.
  const {
    showOnboarding, closeOnboarding,
    showUpdateHinweis, markUpdateHinweisGesehen,
    showMitmachenHinweis, markMitmachenHinweisGesehen
  } = useOnboardingWithUpdateOnce('konfi_onboarding_seen', user?.id);
  const [showUpdateWalkthrough, setShowUpdateWalkthrough] = useState(false);
  const [showMitmachenErklaerung, setShowMitmachenErklaerung] = useState(false);

  // Memoized refresh function for live updates
  const refreshAllData = useCallback(() => {
    refreshDashboardLive();
    refreshEventsLive();
    refreshBadgesLive();
  }, [refreshDashboardLive, refreshEventsLive, refreshBadgesLive]);

  // Subscribe to live updates for dashboard and events
  // 'points' MUSS mit dabei sein: genehmigte Aktivitäten melden 'points',
  // nicht 'dashboard' — ohne das blieben Punkte und Level auf der Startseite
  // stehen, bis man die App neu oeffnete.
  useLiveRefresh(['dashboard', 'points', 'events', 'badges'], refreshAllData);

  const handleRefresh = async (event: CustomEvent) => {
    await Promise.all([refreshDashboard(), refreshEvents(), refreshBadges()]);
    event.detail.complete();
  };

  if (loading) {
    return <LoadingSpinner fullScreen message="Konfi Quest wird geladen..." />;
  }

  if (!dashboardData) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Konfi Quest</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <p style={{ textAlign: 'center', marginTop: '50px' }}>
            Deine Startseite konnte nicht geladen werden. Zieh die Seite nach unten, um es erneut zu versuchen.
          </p>
        </IonContent>
      </IonPage>
    );
  }

  const pointConfig = dashboardData.point_config;
  const targetGottesdienst = pointConfig?.target_gottesdienst || 10;
  const targetGemeinde = pointConfig?.target_gemeinde || 10;
  const gottesdienstEnabled = pointConfig?.gottesdienst_enabled !== false;
  const gemeindeEnabled = pointConfig?.gemeinde_enabled !== false;

  const dashboardConfig: DashboardConfig = {
    show_konfirmation: dashboardData.dashboard_config?.show_konfirmation !== false,
    show_events: dashboardData.dashboard_config?.show_events !== false,
    show_losung: dashboardData.dashboard_config?.show_losung !== false,
    show_badges: dashboardData.dashboard_config?.show_badges !== false,
    show_ranking: dashboardData.dashboard_config?.show_ranking !== false,
    // Ohne dieses Durchreichen lief der Challenges-Abruf in der View immer —
    // der Schalter der Leitung blieb wirkungslos.
    show_challenges: dashboardData.dashboard_config?.show_challenges !== false,
  };

  // Gespeicherte Reihenfolge mit der Default-Reihenfolge MERGEN: Bestands-Orgs
  // haben eine dashboard_section_order ohne die neueren Keys (z.B. 'challenges')
  // gespeichert. Wuerde nur die gespeicherte Liste gerendert, fällt jede neu
  // hinzugekommene Sektion bei ihnen stillschweigend unter den Tisch. Fehlende
  // Keys werden deshalb an ihrer Default-Position wieder eingefuegt.
  const sectionOrder: string[] = mergeSectionOrder(
    dashboardData.dashboard_config?.section_order,
    DEFAULT_KONFI_SECTION_ORDER
  );

  // Gewaehlten Konfispruch (aus Profil-Query) in die Dashboard-Daten mergen,
  // damit die Card den Spruch anzeigt. Dashboard-Endpoint trägt ihn nicht.
  const dashboardDataWithKonfspruch: DashboardData = {
    ...dashboardData,
    konfspruch: konfiProfile?.konfspruch ?? null
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonTitle>Konfi Quest</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => router.push('/konfi/profile')} aria-label="Profil öffnen">
              <IonIcon slot="icon-only" icon={personCircleOutline} style={{ color: '#7c3aed', fontSize: '1.7rem' }} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent
        fullscreen
        scrollEvents={true}
        onIonScroll={handleScrollTiefe}
        style={{
          '--background': '#f8f9fa'
        }}
      >
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">
              Konfi Quest
            </IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={handleRefresh} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        <TrialBanner style={{ marginTop: '8px' }} />

        <NeuerungenBanner
          style={{ margin: '8px 16px 0' }}
          updateSichtbar={showUpdateHinweis}
          mitmachenSichtbar={showMitmachenHinweis}
          onUpdateOeffnen={() => { markUpdateHinweisGesehen(); setShowUpdateWalkthrough(true); }}
          onUpdateAusblenden={markUpdateHinweisGesehen}
          onMitmachenOeffnen={() => { markMitmachenHinweisGesehen(); setShowMitmachenErklaerung(true); }}
          onMitmachenAusblenden={markMitmachenHinweisGesehen}
        />

        {dashboardData.has_wrapped && (
          <div onClick={openWrapped} style={{
            margin: '0 16px 16px',
            padding: '20px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #c084fc 100%)',
            color: 'white',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden'
          }}>
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
              <IonIcon icon={sparkles} style={{ fontSize: '2rem' }} />
              <div>
                <h3 className="app-headline" style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700' }}>Dein Wrapped ist da!</h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', opacity: 0.9 }}>Schau dir deinen Konfi-Jahresrückblick an</p>
              </div>
              <IonIcon icon={chevronForward} style={{ fontSize: '1.2rem', marginLeft: 'auto' }} />
            </div>
          </div>
        )}

        <DashboardView
          dashboardData={dashboardDataWithKonfspruch}
          badgeStats={badgeStats}
          allBadges={allBadges}
          upcomingEvents={upcomingEvents || []}
          targetGottesdienst={targetGottesdienst}
          targetGemeinde={targetGemeinde}
          gottesdienstEnabled={gottesdienstEnabled}
          gemeindeEnabled={gemeindeEnabled}
          onOpenPointsHistory={openPointsHistory}
          onOpenKonfispruch={openKonfispruch}
          dashboardConfig={dashboardConfig}
          sectionOrder={sectionOrder}
        />
      </IonContent>

      {/* Onboarding-Walkthrough als Vollbild-Overlay (kein Modal) */}
      {showOnboarding && (
        <KonfiOnboardingModal
          onClose={closeOnboarding}
          displayName={(user?.display_name || '').split(' ')[0]}
        />
      )}

      {/* "Was ist neu"-Walkthrough — geöffnet über die Neuigkeiten-Karte */}
      {showUpdateWalkthrough && (
        <KonfiUpdateWalkthroughModal
          onClose={() => setShowUpdateWalkthrough(false)}
        />
      )}

      {showMitmachenErklaerung && (
        <MitmachenErklaerungModal
          rolle="konfi"
          onClose={() => setShowMitmachenErklaerung(false)}
        />
      )}
    </IonPage>
  );
};

export default KonfiDashboardPage;
