import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  IonPage,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonIcon,
  IonButton,
  useIonModal,
  useIonRouter
} from '@ionic/react';
import { ICON_FUNKELN_GEFUELLT, ICON_PROFIL, ICON_SCHLIESSEN } from '../../shared/icons';
import AppKopfzeile, { AppKopfzeileGross } from '../../shared/AppKopfzeile';
import KonfiOnboardingModal from '../modals/KonfiOnboardingModal';
import KonfiUpdate230WalkthroughModal from '../modals/KonfiUpdate230WalkthroughModal';
import { useOnboardingWithUpdateOnce } from '../../../hooks/useOnboardingOnce';
import NeuerungenBanner from '../../shared/NeuerungenBanner';
import MitmachenErklaerungModal from '../../shared/MitmachenErklaerungModal';
import { Preferences } from '@capacitor/preferences';
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
import type { AlleAbzeichen, Badge, BadgeUebersicht, DashboardEvent, RankingEntry } from '../../../types/dashboard';
import { triggerPullHaptic } from '../../../utils/haptics';
import { mergeSectionOrder, DEFAULT_KONFI_SECTION_ORDER } from '../../../utils/sectionOrder';
import { TrialBanner, StoreUpdateBanner, istVergangen } from '../../shared';
import WartungsHinweis from '../../shared/WartungsHinweis';
import { track } from '../../../services/analytics';
import { tastaturKlick } from '../../../utils/tastatur';

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
  recent_badges: Badge[];
  badge_count: number;
  recent_events: DashboardEvent[];
  event_count: number;
  ranking: RankingEntry[];
  days_to_confirmation?: number;
  confirmation_date?: string;
  point_config?: PointConfig;
  dashboard_config?: DashboardConfig;
  has_wrapped?: boolean;
  wrapped_ausgabe_id?: number | null;
  wrapped_titel?: string | null;
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



const KonfiDashboardPage: React.FC = () => {
  const { user } = useApp();
  const router = useIonRouter();
  const pageRef = useRef<HTMLElement>(null);

  // Anonyme Messung der Scroll-Tiefe: Sehen die Konfis die unteren Abschnitte
  // des Dashboards überhaupt? Je Sitzung wird jede Marke NUR EINMAL gemeldet
  // (Ref statt State, damit das Scrollen kein Rendern ausloest).
  const scrollMarken = useRef<Set<number>>(new Set());
  const handleScrollTiefe = useCallback((ev: CustomEvent) => {
    const el = ev.target as HTMLIonContentElement & { scrollHeight?: number; clientHeight?: number };
    // ion-content liefert im scroll-Ereignis { scrollTop, scrollLeft };
    // ein eigener Ionic-Typ dafuer ist nicht exportiert.
    const detail = (ev.detail || {}) as { scrollTop?: number };
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
      // istVergangen(): Ein laufender mehrtaegiger Termin bleibt im Teaser,
      // bis er wirklich vorbei ist (event_end_time), nicht nur bis zum Start.
      select: (events) => events.filter((event) =>
        !istVergangen({ event_date: event.event_date || event.date || '', event_end_time: event.event_end_time }) &&
        (event.is_registered || event.booking_status === 'confirmed' || event.booking_status === 'waitlist')
      )
    }
  );

  // Die Abzeichen-Sektion der Startseite braucht die Daten wirklich (sie
  // zeichnet jedes Abzeichen als Kreis, nicht nur eine Zahl) — ersatzlos
  // streichen geht also nicht. Stattdessen wartet die Anfrage, bis die
  // Startseite steht: `enabled` springt erst nach dem ersten Rendern der
  // fertigen Startseite auf true. Aus dem Cache (30 Min TTL) ist die Sektion
  // beim naechsten Oeffnen ohnehin sofort da; nur beim allerersten Start
  // erscheint sie einen Wimpernschlag spaeter.
  const [abzeichenAktiv, setAbzeichenAktiv] = useState(false);
  const { data: badgesRaw, refresh: refreshBadges, refreshLive: refreshBadgesLive } = useOfflineQuery<BadgeUebersicht>(
    // Abzeichen-Generation v2 — siehe KonfiBadgesPage.
    'konfi:badges:v2:' + user?.id,
    () => api.get('/konfi/badges/v2').then(r => r.data),
    { ttl: CACHE_TTL.BADGES, enabled: abzeichenAktiv }
  );

  // Erst wenn die Startseite ihre eigenen Daten hat, die Abzeichen nachholen.
  // dashboardData ist der Marker: bis dahin zeigt die Seite den Ladebildschirm,
  // die Abzeichen-Sektion ist also noch gar nicht sichtbar.
  useEffect(() => {
    if (dashboardData && !abzeichenAktiv) setAbzeichenAktiv(true);
  }, [dashboardData, abzeichenAktiv]);

  // Derived state from badges
  const badgeStats: BadgeStats = (() => {
    if (!badgesRaw) return { totalAvailable: 0, totalEarned: 0, secretAvailable: 0, secretEarned: 0 };
    const { earned, stats } = badgesRaw;
    const visibleEarned = earned?.filter((badge) => !badge.is_hidden).length || 0;
    const visibleTotal = stats?.totalVisible || 0;
    const secretEarned = earned?.filter((badge) => badge.is_hidden === true).length || 0;
    const secretTotal = stats?.totalSecret || 0;
    return { totalAvailable: visibleTotal, totalEarned: visibleEarned, secretAvailable: secretTotal, secretEarned: secretEarned };
  })();

  const allBadges: AlleAbzeichen = {
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

  // Weggeklickter Rueckblick-Hinweis, gemerkt PRO AUSGABE: Der naechste
  // Rueckblick meldet sich wieder. Alt-Snapshots ohne Ausgabe-Id bekommen
  // den Schluessel "alt", damit auch sie sich wegklicken lassen.
  const [wrappedHinweisWeg, setWrappedHinweisWeg] = useState(false);
  const wrappedHinweisKey = `wrapped_hinweis_${user?.id ?? 'x'}_${dashboardData?.wrapped_ausgabe_id ?? 'alt'}`;

  useEffect(() => {
    if (!dashboardData?.has_wrapped) return;
    Preferences.get({ key: wrappedHinweisKey })
      .then(({ value }) => setWrappedHinweisWeg(value === '1'))
      .catch(() => { /* Preferences nicht verfuegbar -> Hinweis zeigen */ });
  }, [wrappedHinweisKey, dashboardData?.has_wrapped]);

  const wrappedHinweisAusblenden = () => {
    setWrappedHinweisWeg(true);
    Preferences.set({ key: wrappedHinweisKey, value: '1' })
      .catch(() => { /* beim naechsten Start erneut */ });
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

  // --- Onboarding-Tour (Neuinstallation) bzw. Änderungsanzeige nach einem
  // Update (Bestandsnutzer) — nie beides, dafür sorgt der Hook. Die Anzeige
  // meldet sich genau einmal je Minor-Version von selbst; dauerhaft
  // erreichbar bleibt sie über "Was ist neu?" im Profil.
  const {
    showOnboarding, closeOnboarding,
    showNeuerungen, schliesseNeuerungen,
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

  // Bis hierher standen an dieser Stelle zwei fruehe Ausstiege, die je eine
  // EIGENE IonPage zurueckgaben -- der Ladebildschirm sogar seine eigene aus
  // LoadingSpinner. Die Startseite rendert dann nacheinander ZWEI verschiedene
  // IonPage-ELEMENTE, und daran haengt der weisse Start:
  //
  //   1. Ladebildschirm -> Element A. Ionic haengt im ref-Callback synchron
  //      `ion-page-invisible` an (@ionic/react, IonPage.stableMergedRefs).
  //      Der Wechsel in den Tab laeuft als Uebergang und nimmt die Klasse ab.
  //   2. Daten da, `loading` faellt -> React wirft A weg und baut Element B.
  //      Dessen ref-Callback haengt `ion-page-invisible` ERNEUT an. Nur: Die
  //      Route hat sich nicht geaendert, es laeuft kein zweiter Uebergang,
  //      und niemand nimmt die Klasse je wieder ab.
  //
  // Ergebnis ist genau das beobachtete Bild: Die Tab-Leiste steht (sie haengt
  // ausserhalb des Router-Outlets), der Seiteninhalt ist unsichtbar -- weiss.
  // Wegnavigieren und zurueck loest einen echten Uebergang aus, der die Klasse
  // abnimmt; deshalb war "danach alles da".
  //
  // Deshalb haelt die Seite ueber ALLE drei Zustaende (laedt / kein Ergebnis /
  // Daten da) EINE einzige IonPage. Die Leitungsseiten machen das schon immer
  // so -- deshalb war die Leitung als einzige Rolle nicht betroffen.
  if (loading || !dashboardData) {
    return (
      <IonPage ref={pageRef}>
        <AppKopfzeile titel="Konfi Quest" />
        <IonContent className="app-gradient-background" fullscreen>
          {loading ? (
            <LoadingSpinner message="Konfi Quest wird geladen..." />
          ) : (
            <p style={{ textAlign: 'center', marginTop: 'var(--app-freiraum-kopf-m)' }}>
              Deine Startseite konnte nicht geladen werden. Zieh die Seite nach unten, um es erneut zu versuchen.
            </p>
          )}
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
      <AppKopfzeile
        titel="Konfi Quest"
        rechts={(
          <IonButton onClick={() => router.push('/konfi/profile')} aria-label="Profil öffnen">
            <IonIcon slot="icon-only" icon={ICON_PROFIL} style={{ color: 'var(--app-text-wrapped)', fontSize: 'var(--app-anzeige-basis)' }} />
          </IonButton>
        )}
      />

      <IonContent
        fullscreen
        scrollEvents={true}
        onIonScroll={handleScrollTiefe}
        style={{
          '--background': 'var(--app-surface-soft)'
        }}
      >
        <AppKopfzeileGross titel="Konfi Quest" />

        <IonRefresher slot="fixed" onIonRefresh={handleRefresh} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        <TrialBanner style={{ marginTop: 'var(--app-abstand-eng)' }} />

        {/* Dezenter Hinweis, wenn im Store eine neuere Version liegt.
            Prueft selbst und rendert sonst nichts (StoreUpdateBanner). */}
        <StoreUpdateBanner style={{ margin: 'var(--app-abstand-eng) var(--app-abstand-basis) 0' }} />

        {/* Wartungshinweis des Betriebs: steht, solange der Server ihn
            meldet; liest nur den Stand und rendert sonst nichts. */}
        <WartungsHinweis />

        <NeuerungenBanner
          style={{ margin: 'var(--app-abstand-eng) var(--app-abstand-basis) 0' }}
          updateSichtbar={showUpdateHinweis}
          mitmachenSichtbar={showMitmachenHinweis}
          onUpdateOeffnen={() => { markUpdateHinweisGesehen(); setShowUpdateWalkthrough(true); }}
          onUpdateAusblenden={markUpdateHinweisGesehen}
          onMitmachenOeffnen={() => { markMitmachenHinweisGesehen(); setShowMitmachenErklaerung(true); }}
          onMitmachenAusblenden={markMitmachenHinweisGesehen}
        />

        {/* Hinweis auf den Jahresrueckblick:
            - "Wrapped" heisst in der Oberflaeche ueberall "Jahresrueckblick";
              der Name der Ausgabe ("Zwischenstand September") kommt aus
              wrapped_titel, den die Leitung vergibt. Fehlt er (Alt-Snapshots
              ohne Ausgabe), bleibt es beim allgemeinen Text.
            - Wegklickbar wie die uebrigen Hinweiskarten. Gemerkt wird PRO
              AUSGABE (wrapped_ausgabe_id): Der naechste Rueckblick meldet
              sich wieder, ein weggeklickter bleibt weg. Erreichbar bleibt er
              im Profil unter "Meine Rueckblicke". */}
        {dashboardData.has_wrapped && !wrappedHinweisWeg && (
          <div role="presentation" onClick={openWrapped} style={{
            margin: '0 var(--app-abstand-basis) var(--app-abstand-basis)',
            padding: 'var(--app-abstand-gross)',
            borderRadius: 'var(--app-radius-gross)',
            background: 'var(--app-gradient-wrapped)',
            color: 'white',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden'
          }}>
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mittel)' }}>
              <IonIcon icon={ICON_FUNKELN_GEFUELLT} style={{ fontSize: 'var(--app-anzeige-zahl)' }} />
              <div role="button" tabIndex={0} onKeyDown={tastaturKlick} style={{ minWidth: 0 }}>
                <h3 className="app-headline" style={{ margin: 0, fontSize: 'var(--app-text-gross)', fontWeight: 'var(--app-schrift-fett)' }}>
                  {dashboardData.wrapped_titel || 'Dein Jahresrückblick ist da!'}
                </h3>
                <p style={{ margin: 'var(--app-abstand-mini) 0 0', fontSize: 'var(--app-text-sekundaer)', opacity: 0.9 }}>
                  {/* "Dein Rückblick - bis jetzt!" statt "Jahresrückblick":
                      Eine Ausgabe kann ein Zwischenstand
                      mitten im Jahr sein, kein Jahresabschluss. */}
                  {dashboardData.wrapped_titel
                    ? 'Dein Rückblick - bis jetzt! Hier tippen.'
                    : 'Schau ihn dir an'}
                </p>
              </div>
              <button
                type="button"
                aria-label="Hinweis ausblenden"
                onClick={(e) => { e.stopPropagation(); wrappedHinweisAusblenden(); }}
                style={{
                  marginLeft: 'auto',
                  background: 'rgba(255,255,255,0.18)',
                  border: 'none',
                  borderRadius: 'var(--app-radius-kreis)',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                <IonIcon icon={ICON_SCHLIESSEN} style={{ fontSize: 'var(--app-text-gross)' }} aria-hidden="true" />
              </button>
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

      {/* Änderungsanzeige nach einem Update — meldet sich VON SELBST, genau
          einmal je Minor-Version (useOnboardingWithUpdateOnce). Sie und die
          Onboarding-Tour schließen sich gegenseitig aus; die Neuigkeiten-
          Karte bleibt weg, solange sie offen ist. */}
      {showNeuerungen && (
        <KonfiUpdate230WalkthroughModal onClose={schliesseNeuerungen} />
      )}

      {/* Derselbe Walkthrough — hier über die Neuigkeiten-Karte geöffnet. */}
      {showUpdateWalkthrough && (
        <KonfiUpdate230WalkthroughModal
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
