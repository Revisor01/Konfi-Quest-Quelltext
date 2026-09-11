import { fehlerText } from '../../../utils/fehler';
import React, { useState, useEffect, useCallback } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  useIonPopover,
  useIonModal,
  useIonRouter
} from '@ionic/react';
import {
  ICON_ANKUENDIGUNG,
  ICON_CHALLENGE,
  ICON_FUNKELN_GEFUELLT,
  ICON_HILFE_GEFUELLT,
  ICON_MATERIAL,
  ICON_ORT_GEFUELLT,
  ICON_SCHLIESSEN,
  ICON_SICHTBAR,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT,
  ICON_UHRZEIT_GEFUELLT,
  ICON_VERBORGEN_GEFUELLT,
  ICON_WEITER_GEFUELLT,
  ICON_WERKZEUG,
} from '../../shared/icons';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren
import { Preferences } from '@capacitor/preferences';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import type { KonfiChallenge } from '../../../types/challenges';
import BibleTranslationModal, { getTranslationName } from '../../shared/BibleTranslationModal';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { normalisiereTeamerBadges } from '../teamerBadges';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import { CACHE_TTL } from '../../../services/offlineCache';
import LoadingSpinner from '../../common/LoadingSpinner';
import WrappedModal from '../../wrapped/WrappedModal';
import { ProfileHeaderButton, TrialBanner, StoreUpdateBanner } from '../../shared';
import { triggerPullHaptic } from '../../../utils/haptics';
import { mergeSectionOrder, DEFAULT_TEAMER_SECTION_ORDER } from '../../../utils/sectionOrder';
import KonfispruchSelectModal from '../../konfi/modals/KonfispruchSelectModal';
import TeamerOnboardingModal from '../modals/TeamerOnboardingModal';
import TeamerUpdate211WalkthroughModal from '../modals/TeamerUpdate211WalkthroughModal';
import { useOnboardingWithUpdateOnce } from '../../../hooks/useOnboardingOnce';
import NeuerungenBanner from '../../shared/NeuerungenBanner';
import MitmachenErklaerungModal from '../../shared/MitmachenErklaerungModal';
import { getIconFromString } from '../../../utils/badgeIcons';
import BadgePopoverContent, { BadgePopoverData, getBadgeColor } from '../../shared/BadgePopoverContent';
import { formatTimeUntil, kalendertag } from '../../shared/eventFormatting';



interface TeamerBadgeFull {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  criteria_type?: string;
  criteria_value?: number;
  is_hidden?: boolean;
  earned: boolean;
  earned_at?: string;
}

interface TeamerBadgeResponse {
  available: TeamerBadgeFull[];
  earned: TeamerBadgeFull[];
  stats: { totalVisible: number; totalSecret: number };
}

// Geaendert dabei: Nicht erreichte Abzeichen zeigten hier '???'
// statt Name und Beschreibung. Jetzt sind sie lesbar, wie auf der
// Konfi-Startseite — man soll sehen, was es zu holen gibt. ECHTE
// Geheim-Abzeichen bleiben unkenntlich, dafuer sorgt die Komponente selbst.

interface Certificate {
  id: number;
  name: string;
  icon: string;
  issued_date: string | null;
  expiry_date: string | null;
  status: 'valid' | 'expired' | 'not_earned';
}

// DashboardEvent kommt aus types/event über types/dashboard Re-Export
type DashboardEvent = import('../../../types/event').Event;

interface Badge {
  id: number;
  name: string;
  icon?: string;
  awarded_date?: string;
}

interface DashboardConfig {
  show_zertifikate: boolean;
  show_challenges?: boolean;
  show_konfispruch?: boolean;
  show_events: boolean;
  show_badges: boolean;
  show_losung: boolean;
  section_order?: string[];
}

/** Gespeicherter Konfispruch (aus konfi_profiles, wie bei Konfis). */
interface Konfspruch {
  source: 'liste' | 'freitext';
  id?: number;
  reference?: string;
  text?: string;
  translation?: string;
}

/** Teaser-Daten einer laufenden Challenge für die Dashboard-Karte. */
interface ChallengeTeaser {
  id: number;
  title: string;
  ends_at: string;
  challenge_type?: string;
}

// Icon je Challenge-Typ — gleiches Mapping wie im Konfi-Dashboard.
const CHALLENGE_TYPE_ICON: Record<string, string> = {
  wahrnehmung: ICON_SICHTBAR,
  beitrag: ICON_ANKUENDIGUNG,
  praxis: ICON_WERKZEUG,
  frei: ICON_CHALLENGE
};
const getChallengeTypeIcon = (type?: string): string =>
  CHALLENGE_TYPE_ICON[type || ''] || ICON_CHALLENGE;

const DEFAULT_TEAMER_ORDER = DEFAULT_TEAMER_SECTION_ORDER;

interface DashboardData {
  greeting: { display_name: string; hour: number };
  certificates: Certificate[];
  events: DashboardEvent[];
  badges: { recent: Badge[]; earned_count: number; total_count: number };
  config: DashboardConfig;
  has_wrapped?: boolean;
  // Wie im Konfi-Dashboard: Id der Ausgabe, damit sich der Hinweis PRO
  // Ausgabe wegklicken laesst. Aeltere Antworten liefern sie nicht.
  wrapped_ausgabe_id?: number | null;
  konfspruch?: Konfspruch | null;
}

interface DailyVerse {
  losungstext: string;
  losungsvers: string;
  lehrtext: string;
  lehrtextvers: string;
  translation?: string;
}

// Certificate Popover Content
const CertPopoverContent: React.FC<{
  dataRef: React.RefObject<Certificate | null>;
}> = ({ dataRef }) => {
  const cert = dataRef.current;
  if (!cert) return null;

  const statusLabel = cert.status === 'valid' ? 'Gültig' : cert.status === 'expired' ? 'Abgelaufen' : 'Nicht erhalten';
  const statusColor = cert.status === 'valid' ? 'var(--app-color-success-strong)' : cert.status === 'expired' ? 'var(--app-color-danger)' : 'var(--app-color-neutral-hell)';

  return (
    <div style={{ padding: 'var(--app-abstand-mittel)', background: 'white', minWidth: '200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-schmal)', marginBottom: 'var(--app-abstand-schmal)' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: 'var(--app-radius-kreis)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: statusColor, color: 'white'
        }}>
          <IonIcon icon={getIconFromString(cert.icon)} style={{ fontSize: 'var(--app-text-untertitel)' }} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: 'var(--app-text-betont)', fontWeight: 'var(--app-schrift-fett)' }}>{cert.name}</h3>
          <span style={{ fontSize: 'var(--app-text-klein)', color: statusColor, fontWeight: 'var(--app-schrift-halbfett)' }}>{statusLabel}</span>
        </div>
      </div>
      {cert.issued_date && (
        <div style={{ fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-secondary)', marginBottom: 'var(--app-abstand-mini)' }}>
          Ausgestellt: {new Date(cert.issued_date).toLocaleDateString('de-DE')}
        </div>
      )}
      {cert.expiry_date && (
        <div style={{ fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-secondary)' }}>
          Ablauf: {new Date(cert.expiry_date).toLocaleDateString('de-DE')}
        </div>
      )}
    </div>
  );
};

const TeamerDashboardPage: React.FC = () => {
  const router = useIonRouter();
  const { user, setError } = useApp();
  const [showLosung] = useState(() => Math.random() > 0.5);
  // Onboarding-Tour einmal pro Teamer-Account (beim ersten Betreten der
  // Startseite) — bzw. für Bestandsnutzer die Neuigkeiten-Karte "Was ist neu
  // in Version 2.0". Nie beides gleichzeitig; der Walkthrough öffnet sich
  // über die Karte oder dauerhaft über "Was ist neu?" im Profil.
  const {
    showOnboarding, closeOnboarding,
    showUpdateHinweis, markUpdateHinweisGesehen,
    showMitmachenHinweis, markMitmachenHinweisGesehen
  } = useOnboardingWithUpdateOnce('teamer_onboarding_seen', user?.id);
  const [showUpdateWalkthrough, setShowUpdateWalkthrough] = useState(false);
  const [showMitmachenErklaerung, setShowMitmachenErklaerung] = useState(false);

  // Certificate Popover
  const certPopoverRef = React.useRef<Certificate | null>(null);
  const [presentCertPopover] = useIonPopover(CertPopoverContent, {
    dataRef: certPopoverRef
  });

  // Badge Popover
  const badgePopoverRef = React.useRef<BadgePopoverData | null>({ badge: null, isEarned: false });
  const [presentBadgePopover] = useIonPopover(BadgePopoverContent, {
    dataRef: badgePopoverRef
  });

  // Offline-Query: Dashboard
  const { data: dashboardData, loading, refresh: refreshDashboard, refreshLive: refreshDashboardLive } = useOfflineQuery<DashboardData>(
    'teamer:dashboard:' + user?.id,
    async () => { const res = await api.get('/teamer/dashboard'); return res.data; },
    { ttl: CACHE_TTL.DASHBOARD }
  );

  // Offline-Query: Alle Teamer-Badges (für vollstaendige Badge-Sektion).
  // Schluessel mit v2: Im Zwischenspeicher koennen noch flache Arrays der
  // alten Antwortform liegen — die sollen nicht als neue Form gelesen werden.
  const { data: badgeData, refresh: refreshBadges, refreshLive: refreshBadgesLive } = useOfflineQuery<TeamerBadgeResponse>(
    'teamer:all-badges:v3:' + user?.id,
    async () => {
      // Abzeichen-Generation v2 — gleiche Huelle wie beim Konfi.
      const res = await api.get('/teamer/badges/v2');
      return normalisiereTeamerBadges<TeamerBadgeFull>(res.data, res.headers);
    },
    { ttl: CACHE_TTL.BADGES }
  );

  // Live-Ereignisse empfangen. Das Teamer-Dashboard hoerte auf nichts, obwohl
  // das Backend 'badges' gezielt an Teamer:innen sendet (routes/teamer.js:796).
  // Die Tageslosung bleibt bewusst aussen vor — sie wechselt taeglich, nicht
  // durch Nutzeraktionen.
  useLiveRefresh(['dashboard', 'points', 'badges', 'events', 'challenges'], useCallback(() => {
    refreshDashboardLive();
    refreshBadgesLive();
  }, [refreshDashboardLive, refreshBadgesLive]));

  const losungAktiv = dashboardData?.config?.show_losung !== false;

  const { data: dailyVerse, loading: loadingVerse, refresh: refreshVerse } = useOfflineQuery<DailyVerse | null>(
    'teamer:tageslosung:' + kalendertag(),
    async () => {
      const response = await api.get('/teamer/tageslosung');
      if (response.data && response.data.success) {
        const { losung, lehrtext } = response.data.data;
        return {
          losungstext: losung?.text,
          losungsvers: losung?.reference,
          lehrtext: lehrtext?.text,
          lehrtextvers: lehrtext?.reference,
          translation: response.data.translation
        };
      }
      return null;
    },
    { ttl: CACHE_TTL.TAGESLOSUNG, enabled: losungAktiv }
  );

  const [activeChallenges, setActiveChallenges] = useState<ChallengeTeaser[]>([]);
  useEffect(() => {
    if (!dashboardData) return;
    if (dashboardData.config?.show_challenges === false) {
      setActiveChallenges([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/challenges/konfi');
        if (cancelled) return;
        const liste = Array.isArray(res.data?.active) ? res.data.active : [];
        setActiveChallenges(
          liste
            .filter((c: KonfiChallenge) => c.ends_at)
            .map((c: KonfiChallenge) => ({
              id: c.id,
              title: c.title,
              ends_at: c.ends_at,
              challenge_type: c.challenge_type
            }))
            .sort((a: ChallengeTeaser, b: ChallengeTeaser) =>
              new Date(a.ends_at).getTime() - new Date(b.ends_at).getTime())
        );
      } catch {
        // Zusatzkarte — ein Fehler darf das Dashboard nicht stören.
        if (!cancelled) setActiveChallenges([]);
      }
    })();
    return () => { cancelled = true; };
  }, [dashboardData, dashboardData?.config?.show_challenges]);

  // Bibeluebersetzung (Tageslosung) — Anzeige + Auswahl
  const [selectedTranslation, setSelectedTranslation] = useState<string>('LUT');
  useEffect(() => {
    if (dailyVerse?.translation) setSelectedTranslation(dailyVerse.translation);
  }, [dailyVerse?.translation]);

  const handleTranslationChange = async (code: string) => {
    try {
      await api.put('/teamer/bible-translation', { translation: code });
      setSelectedTranslation(code);
      await refreshVerse();
    } catch (err) {
      // Siehe DashboardView (Konfi): stiller Fehlschlag bei bewusster Auswahl.
      console.error('Bibeluebersetzung speichern fehlgeschlagen:', err);
      setError(fehlerText(err, 'Übersetzung konnte nicht gespeichert werden'));
    }
  };

  const [presentBibleModal, dismissBibleModal] = useIonModal(BibleTranslationModal, {
    currentTranslation: selectedTranslation,
    accentColor: 'var(--app-color-teamer)',
    itemVariant: 'teamer',
    sectionIconVariant: 'teamer',
    onClose: () => dismissBibleModal(),
    onSelect: (code: string) => { handleTranslationChange(code); dismissBibleModal(); },
  });

  // Wrapped Modal
  const [presentWrappedModal, dismissWrappedModal] = useIonModal(WrappedModal, {
    onClose: () => dismissWrappedModal(),
    displayName: dashboardData?.greeting?.display_name || '',
    wrappedType: 'teamer' as const
  });

  // Weggeklickter Rueckblick-Hinweis, gemerkt PRO AUSGABE -- wie im
  // Konfi-Dashboard: Der naechste Rueckblick meldet sich wieder.
  const [wrappedHinweisWeg, setWrappedHinweisWeg] = useState(false);
  const wrappedHinweisKey = `wrapped_hinweis_t_${user?.id ?? 'x'}_${dashboardData?.wrapped_ausgabe_id ?? 'alt'}`;

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

  const openWrapped = () => {
    presentWrappedModal({ cssClass: 'wrapped-modal-fullscreen' });
  };

  // Konfispruch-Modal — dieselbe Auswahl wie bei Konfis, nur gegen die
  // Teamer-Endpunkte (GET /teamer/konfsprueche, PATCH /teamer/profile).
  const [presentKonfispruchModal, dismissKonfispruchModal] = useIonModal(KonfispruchSelectModal, {
    onClose: () => dismissKonfispruchModal(),
    onSuccess: () => {
      dismissKonfispruchModal();
      refreshDashboard();
    },
    current: dashboardData?.konfspruch ?? null,
    apiBasePath: '/teamer' as const,
    variant: 'teamer' as const
  });

  const openKonfispruch = () => {
    presentKonfispruchModal();
  };

  const getFirstName = (name: string) => name.split(' ')[0];

  const getGreeting = (displayName: string): string => {
    const firstName = getFirstName(displayName);
    if (Math.random() < 0.2) {
      return `Moin, ${firstName}!`;
    }

    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) return `Guten Morgen, ${firstName}!`;
    if (hour >= 11 && hour < 14) return `Guten Mittag, ${firstName}!`;
    if (hour >= 14 && hour < 18) return `Guten Tag, ${firstName}!`;
    if (hour >= 18 && hour < 22) return `Guten Abend, ${firstName}!`;
    return `Gute Nacht, ${firstName}!`;
  };


  const formatEventTime = (dateString: string | undefined) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatEventDate = (dateString: string | undefined) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('de-DE', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    });
  };

  const config = dashboardData?.config;

  // Badge-Berechnungen aus der Antwort { available, earned, stats }
  const earnedBadges = badgeData?.earned || [];
  const earnedIds = new Set(earnedBadges.map((b) => b.id));
  const visibleBadges = [
    ...earnedBadges.filter((b) => !b.is_hidden),
    ...(badgeData?.available || []).filter((b) => !b.is_hidden)
  ];
  const secretEarned = earnedBadges.filter((b) => b.is_hidden);
  // Aus stats, nicht aus der Liste gezaehlt: Der Server kennt auch die
  // zurueckgehaltenen (unverdienten geheimen) Abzeichen.
  const secretTotal = badgeData?.stats?.totalSecret ?? 0;
  const secretNotEarnedCount = secretTotal - secretEarned.length;
  const visibleEarned = earnedBadges.filter((b) => !b.is_hidden).length;
  const visibleTotal = badgeData?.stats?.totalVisible ?? 0;

  // "Neu"-Erkennung: earned_at < 7 Tage
  const isRecent = (badge: TeamerBadgeFull) => {
    if (!badge.earned_at) return false;
    const diff = Date.now() - new Date(badge.earned_at).getTime();
    return diff < 7 * 24 * 60 * 60 * 1000;
  };

  const recentVisibleCount = visibleBadges.filter((b) => earnedIds.has(b.id) && isRecent(b)).length;
  const recentSecretCount = secretEarned.filter((b) => isRecent(b)).length;

  if (loading) {
    return <LoadingSpinner fullScreen message="Dashboard wird geladen..." />;
  }

  return (
    <IonPage>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonTitle>Konfi Quest</IonTitle>
          <ProfileHeaderButton href="/teamer/profile" variant="teamer" />
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Konfi Quest</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e) => {
            await Promise.all([refreshDashboard(), refreshVerse(), refreshBadges()]);
            e.detail.complete();
          }}
          onIonPull={triggerPullHaptic}
        >
          <IonRefresherContent />
        </IonRefresher>

        <TrialBanner style={{ marginTop: 'var(--app-abstand-eng)' }} />

        {/* Dezenter Hinweis, wenn im Store eine neuere Version liegt.
            Prueft selbst und rendert sonst nichts (StoreUpdateBanner). */}
        <StoreUpdateBanner style={{ margin: 'var(--app-abstand-eng) var(--app-abstand-basis) 0' }} />

        <NeuerungenBanner
          style={{ margin: 'var(--app-abstand-eng) var(--app-abstand-basis) 0' }}
          updateSichtbar={showUpdateHinweis}
          mitmachenSichtbar={showMitmachenHinweis}
          onUpdateOeffnen={() => { markUpdateHinweisGesehen(); setShowUpdateWalkthrough(true); }}
          onUpdateAusblenden={markUpdateHinweisGesehen}
          onMitmachenOeffnen={() => { markMitmachenHinweisGesehen(); setShowMitmachenErklaerung(true); }}
          onMitmachenAusblenden={markMitmachenHinweisGesehen}
        />

        <div style={{ padding: 'var(--app-abstand-basis)' }}>
          {/* Begruessung */}
          {dashboardData && (
            // Der gemeinsame Teamer-Verlauf statt eines eigenen: Auch dieser
            // Kopf startete auf einem helleren Rot (#e11d48) und stach heraus
            // Damit ziehen Kopf, Profil und
            // Wrapped-Kachel aus derselben Variablen.
            <div className="app-dashboard-header" style={{
              background: 'var(--app-gradient-teamer)'
            }}>
              <div className="app-dashboard-header__circle" style={{
                top: '-40px', right: '-40px', width: '140px', height: '140px',
                background: 'rgba(255, 255, 255, 0.08)'
              }}/>
              <div className="app-dashboard-header__circle" style={{
                top: '60px', right: '30px', width: '60px', height: '60px'
              }}/>
              <div className="app-dashboard-header__circle" style={{
                bottom: '-30px', left: '-30px', width: '100px', height: '100px'
              }}/>
              <div className="app-dashboard-header__circle" style={{
                bottom: '40px', left: '40px', width: '40px', height: '40px'
              }}/>

              <div style={{ position: 'relative', zIndex: 1 }}>
                <h2 className="app-dashboard-greeting">
                  {getGreeting(dashboardData.greeting.display_name)}
                </h2>
                <p className="app-dashboard-subtitle">Teamer:in</p>
              </div>
            </div>
          )}

          {/* Wrapped Card */}
          {dashboardData?.has_wrapped && !wrappedHinweisWeg && (
            <div onClick={openWrapped} style={{
              marginBottom: 'var(--app-abstand-basis)',
              padding: 'var(--app-abstand-gross)',
              borderRadius: 'var(--app-radius-gross)',
              background: 'var(--app-gradient-teamer)',
              color: 'white',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mittel)' }}>
                <IonIcon icon={ICON_FUNKELN_GEFUELLT} style={{ fontSize: 'var(--app-anzeige-zahl)' }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: 'var(--app-text-gross)', fontWeight: 'var(--app-schrift-fett)' }}>Dein Team-Jahr Wrapped ist da!</h3>
                  <p style={{ margin: 'var(--app-abstand-mini) 0 0', fontSize: 'var(--app-text-sekundaer)', opacity: 0.9 }}>Schau dir deinen Jahresrückblick an</p>
                </div>
                {/* X statt Chevron: Das Chevron verdeckte
                    den Ausblenden-Knopf. Jetzt wie die uebrigen Info-Karten --
                    nur in der Farbe dieser Karte. */}
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

          {/* Dynamische Sektionen basierend auf section_order */}
          {mergeSectionOrder(config?.section_order, DEFAULT_TEAMER_ORDER).map(sectionKey => {
            // Zertifikate
            if (sectionKey === 'zertifikate') {
              // Nur die WIRKLICH erhaltenen zeigen.
              //
              // Die Route liefert per LEFT JOIN alle aktiven Zertifikatstypen
              // der Gemeinde, auch die nicht erworbenen ('not_earned'). Damit
              // war certificates.length nie 0, sobald die Gemeinde ueberhaupt
              // Typen angelegt hat -- der Block stand mit lauter leeren
              // Platzhaltern da. Auf Produktion nachgemessen: 15 von 17
              // Teamer:innen haben null Zertifikate, sehen aber vier
              // Platzhalter, weil ihre Gemeinde vier Typen fuehrt.
              //
              // Hier gefiltert, NICHT in der Route: Die Antwortform bleibt so
              // unveraendert, und ausgelieferte App-Versionen zeigen ihre
              // gewohnte Ansicht weiter.
              const erhalteneZertifikate = (dashboardData?.certificates ?? [])
                .filter(c => c.status !== 'not_earned');
              if (!(config?.show_zertifikate !== false && erhalteneZertifikate.length > 0)) return null;
              return (
            <div key="zertifikate" className="app-dashboard-section app-dashboard-section--zertifikate">
              <div className="app-dashboard-section__bg-text">
                <h2 className="app-dashboard-section__bg-label">DEINE</h2>
                <h2 className="app-dashboard-section__bg-label">ZERTIFIKATE</h2>
              </div>

              <div className="app-dashboard-glass-chip" style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                fontSize: 'var(--app-text-meta)',
                fontWeight: 'var(--app-schrift-fett)',
                zIndex: 3
              }}>
                {/* Ohne die nicht erworbenen ergibt "1/1 ERHALTEN" keinen
                    Sinn mehr. Der Bruch bleibt nur, wenn etwas abgelaufen ist
                    -- dann sagt er etwas aus. */}
                {erhalteneZertifikate.some(c => c.status === 'expired')
                  ? `${erhalteneZertifikate.filter(c => c.status === 'valid').length}/${erhalteneZertifikate.length} GÜLTIG`
                  : `${erhalteneZertifikate.length} ERHALTEN`}
              </div>

              <div className="app-dashboard-section__content" style={{ padding: 'var(--app-freiraum-kopf-m) var(--app-abstand-basis) var(--app-abstand-gross) var(--app-abstand-basis)' }}>
                {/* Bei genau einem Zertifikat eine Spalte statt zwei: Sonst
                    stand die Karte auf halber Breite neben einer leeren
                    Haelfte. */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: erhalteneZertifikate.length === 1 ? '1fr' : 'repeat(2, 1fr)',
                  gap: 'var(--app-abstand-schmal)'
                }}>
                  {erhalteneZertifikate.map((cert) => {
                    const isValid = cert.status === 'valid';
                    const isExpired = cert.status === 'expired';
                    const isNotEarned = cert.status === 'not_earned';

                    return (
                      <div
                        key={cert.id}
                        className="app-cert-card"
                        onClick={(e) => {
                          certPopoverRef.current = cert;
                          presentCertPopover({ event: e.nativeEvent });
                        }}
                        style={{
                          borderRadius: 'var(--app-radius-karte)',
                          padding: 'var(--app-abstand-mittel) var(--app-abstand-schmal)',
                          background: isNotEarned
                            ? 'rgba(255, 255, 255, 0.1)'
                            : isValid
                              ? 'rgba(255, 255, 255, 0.22)'
                              : 'rgba(var(--app-color-danger-rgb), 0.3)',
                          border: isNotEarned
                            ? '2px dashed rgba(255, 255, 255, 0.2)'
                            : isValid
                              ? '2px solid rgba(255, 255, 255, 0.55)'
                              : '2px solid rgba(var(--app-color-danger-rgb), 0.5)',
                          boxShadow: isValid ? '0 4px 16px rgba(255, 255, 255, 0.15)' : 'none',
                          opacity: isNotEarned ? 0.5 : 1,
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 'var(--app-abstand-kompakt)',
                          transition: 'transform 0.2s ease'
                        }}
                      >
                        <div style={{
                          width: '36px', height: '36px', borderRadius: 'var(--app-radius-kreis)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: isNotEarned
                            ? 'rgba(255, 255, 255, 0.15)'
                            : isValid
                              ? 'rgba(255, 255, 255, 0.4)'
                              : 'rgba(var(--app-color-danger-rgb), 0.5)',
                          color: 'white'
                        }}>
                          <IonIcon
                            icon={getIconFromString(cert.icon)}
                            style={{ fontSize: 'var(--app-text-gross)', opacity: isNotEarned ? 0.5 : 1 }}
                          />
                        </div>
                        <span style={{
                          fontSize: 'var(--app-text-meta)',
                          fontWeight: 'var(--app-schrift-halbfett)',
                          color: 'white',
                          textAlign: 'center',
                          lineHeight: '1.15',
                          opacity: isNotEarned ? 0.6 : 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical' as const
                        }}>
                          {cert.name}
                        </span>
                        {isValid && cert.issued_date && (
                          <span style={{ fontSize: 'var(--app-text-mini)', color: 'rgba(255,255,255,0.7)' }}>
                            Seit {new Date(cert.issued_date).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}
                          </span>
                        )}
                        {isExpired && (
                          <span style={{ fontSize: 'var(--app-text-mini)', color: 'rgba(255,255,255,0.7)', fontWeight: 'var(--app-schrift-halbfett)' }}>
                            Abgelaufen
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
              );
            }
            // Challenges — laufende Challenges als Teaser, wie im Konfi-Dashboard.
            // Ohne laufende Challenge verschwindet die Karte ganz.
            if (sectionKey === 'challenges') {
              if (config?.show_challenges === false) return null;
              const remainingFor = (endsAt: string) => {
                const diff = new Date(endsAt).getTime() - Date.now();
                if (isNaN(diff) || diff <= 0) return 'Zeit abgelaufen';
                const days = Math.floor(diff / 86400000);
                if (days >= 1) return days === 1 ? '1 Tag' : `${days} Tage`;
                const hours = Math.floor(diff / 3600000);
                if (hours >= 1) return hours === 1 ? '1 Stunde' : `${hours} Stunden`;
                return 'endet heute';
              };
              const visibleChallenges = activeChallenges.slice(0, 3);
              return (
            <div key="challenges" className="app-dashboard-section app-dashboard-section--challenges">
              <div className="app-dashboard-section__bg-text">
                <h2 className="app-dashboard-section__bg-label">DEINE</h2>
                <h2 className="app-dashboard-section__bg-label">CHALLENGE</h2>
              </div>
              <div className="app-dashboard-section__content app-dashboard-section__content--compact">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-mittel)' }}>
                  {visibleChallenges.map((challenge) => (
                    <div
                      key={challenge.id}
                      className="app-dashboard-glass-card"
                      onClick={() => router.push('/teamer/challenges')}
                      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mittel)' }}
                    >
                      <div style={{
                        width: '40px', height: '40px', borderRadius: 'var(--app-radius-kreis)',
                        background: 'rgba(255, 255, 255, 0.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <IonIcon icon={getChallengeTypeIcon(challenge.challenge_type)} style={{ fontSize: 'var(--app-text-untertitel)', color: 'white' }} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="app-headline" style={{
                          fontSize: 'var(--app-text-standard)', fontWeight: 'var(--app-schrift-fett)', color: 'white',
                          marginBottom: 'var(--app-abstand-mini)', lineHeight: 1.25
                        }}>
                          {challenge.title}
                        </div>
                        <div className="app-dashboard-meta">
                          <IonIcon icon={ICON_UHRZEIT} style={{ fontSize: 'var(--app-text-basis)' }} />
                          <span>{remainingFor(challenge.ends_at)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {visibleChallenges.length === 0 && (
                    <div
                      className="app-dashboard-glass-card"
                      onClick={() => router.push('/teamer/challenges')}
                      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mittel)' }}
                    >
                      <div style={{
                        width: '40px', height: '40px', borderRadius: 'var(--app-radius-kreis)',
                        background: 'rgba(255, 255, 255, 0.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <IonIcon icon={ICON_CHALLENGE} style={{ fontSize: 'var(--app-text-untertitel)', color: 'white' }} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="app-headline" style={{
                          fontSize: 'var(--app-text-standard)', fontWeight: 'var(--app-schrift-fett)', color: 'white',
                          marginBottom: 'var(--app-abstand-mini)', lineHeight: 1.25
                        }}>
                          Gerade läuft keine Challenge
                        </div>
                        <div className="app-dashboard-meta">
                          <span>Aufgaben stellen und Beiträge begleiten</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div
                    className="app-dashboard-glass-chip"
                    onClick={() => router.push('/teamer/challenges')}
                    style={{
                      alignSelf: 'center',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--app-abstand-mini)'
                    }}
                  >
                    Alle Challenges anzeigen <IonIcon icon={ICON_WEITER_GEFUELLT} />
                  </div>
                </div>
              </div>
            </div>
              );
            }
            // Konfispruch — vorhandener Spruch (aus der Konfi-Zeit oder selbst
            // eingetragen) wird gezeigt; ohne Spruch lädt die Karte zum
            // Eintragen ein.
            if (sectionKey === 'konfispruch') {
              if (config?.show_konfispruch === false) return null;
              const spruch = dashboardData?.konfspruch;
              const spruchText = spruch?.text?.trim();
              const spruchReference = spruch?.reference?.trim();
              return (
            <div
              key="konfispruch"
              className="app-dashboard-section app-dashboard-section--konfispruch"
              onClick={openKonfispruch}
              style={{ cursor: 'pointer' }}
            >
              <div className="app-dashboard-section__bg-text">
                <h2 className="app-dashboard-section__bg-label">DEIN</h2>
                <h2 className="app-dashboard-section__bg-label">KONFISPRUCH</h2>
              </div>
              <div className="app-dashboard-section__content">
                {spruchReference || spruchText ? (
                  <>
                    {spruchText && (
                      <p className="app-dashboard-quote">{spruchText}</p>
                    )}
                    {spruchReference && (
                      <span className="app-dashboard-cite">{spruchReference}</span>
                    )}
                  </>
                ) : (
                  <div style={{ color: 'rgba(255, 255, 255, 0.9)' }}>
                    <div className="app-headline" style={{ fontSize: 'var(--app-text-titel)', fontWeight: 'var(--app-schrift-extrafett)', color: 'white', marginBottom: 'var(--app-abstand-eng)' }}>
                      Dein Konfispruch
                    </div>
                    <div style={{ fontSize: 'var(--app-text-betont)' }}>
                      Tippe, um deinen Konfirmationsspruch einzutragen
                    </div>
                  </div>
                )}
              </div>
            </div>
              );
            }
            // Events
            if (sectionKey === 'events') {
              if (!(config?.show_events !== false && dashboardData)) return null;
              return (
            <div key="events" className="app-dashboard-section app-dashboard-section--events">
              <div className="app-dashboard-section__bg-text">
                <h2 className="app-dashboard-section__bg-label">DEINE</h2>
                <h2 className="app-dashboard-section__bg-label">EVENTS</h2>
              </div>

              <div className="app-dashboard-glass-chip" style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                fontSize: 'var(--app-text-meta)',
                fontWeight: 'var(--app-schrift-fett)',
                zIndex: 3
              }}>
                {dashboardData.events.length === 1 ? 'DEIN EVENT' : `DEINE ${dashboardData.events.length} EVENTS`}
              </div>

              <div className="app-dashboard-section__content app-dashboard-section__content--compact">
                {dashboardData.events.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-mittel)' }}>
                    <div
                      className="app-dashboard-glass-card"
                      onClick={() => router.push('/teamer/events')}
                      style={{ cursor: 'pointer', textAlign: 'center', padding: 'var(--app-abstand-gross) var(--app-abstand-basis)' }}
                    >
                      <div style={{ fontSize: 'var(--app-text-standard)', fontWeight: 'var(--app-schrift-halbfett)', color: 'white', marginBottom: 'var(--app-abstand-mini)' }}>
                        Noch kein Event gebucht
                      </div>
                      <div style={{ fontSize: 'var(--app-text-sekundaer)', color: 'rgba(255, 255, 255, 0.7)' }}>
                        Tippe hier um verfügbare Events zu sehen
                      </div>
                    </div>
                    <div
                      className="app-dashboard-glass-chip"
                      onClick={() => router.push('/teamer/events')}
                      style={{ alignSelf: 'center', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mini)' }}
                    >
                      Alle Events anzeigen <IonIcon icon={ICON_WEITER_GEFUELLT} />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-mittel)' }}>
                    {dashboardData.events.map((event) => {
                      const isWaitlist = event.booking_status === 'waitlist' || event.booking_status === 'pending';
                      return (
                        <div
                          key={event.id}
                          className="app-dashboard-glass-card"
                          onClick={() => router.push(`/teamer/events?eventId=${event.id}`)}
                          style={{
                            background: isWaitlist
                              ? 'rgba(var(--app-wrapped-gold-rgb), 0.25)'
                              : undefined,
                            position: 'relative',
                            overflow: 'hidden',
                            border: event.cancelled
                              ? '2px dashed rgba(255,255,255,0.3)'
                              : isWaitlist
                                ? '2px solid rgba(var(--app-wrapped-gold-rgb), 0.5)'
                                : 'none',
                            cursor: 'pointer',
                            transition: 'transform 0.2s ease, background 0.2s ease'
                          }}
                        >
                          {/* Eselsohr oben rechts - 1:1 wie Konfi */}
                          <div style={{
                            position: 'absolute',
                            top: '0',
                            right: '0',
                            background: event.cancelled
                              ? 'rgba(255,255,255,0.3)'
                              : isWaitlist
                                ? 'var(--app-gradient-badges)'
                                : 'rgba(255,255,255,0.25)',
                            borderRadius: 'var(--app-radius-band)',
                            padding: 'var(--app-abstand-mini) var(--app-abstand-schmal)',
                            fontSize: 'var(--app-text-mini)',
                            fontWeight: 'var(--app-schrift-halbfett)',
                            color: 'white',
                            whiteSpace: 'nowrap',
                            textTransform: 'uppercase',
                            letterSpacing: '0.3px'
                          }}>
                            {event.cancelled ? 'ABGESAGT' :
                             isWaitlist ?
                               'Warteliste' :
                               formatTimeUntil(event.event_date)}
                          </div>
                          <div>
                            <div style={{
                              fontSize: 'var(--app-text-standard)',
                              fontWeight: 'var(--app-schrift-fett)',
                              color: 'white',
                              marginBottom: 'var(--app-abstand-mini)',
                              paddingRight: 'var(--app-freiraum-aktion-xl)',
                              textDecoration: event.cancelled ? 'line-through' : 'none'
                            }}>
                              {event.title}
                            </div>
                            <div className="app-dashboard-meta" style={{ flexWrap: 'wrap' }}>
                              <IonIcon icon={ICON_TERMIN_GEFUELLT} style={{ fontSize: 'var(--app-text-basis)' }} />
                              <span>{formatEventDate(event.event_date)}</span>
                              <span className="app-dashboard-dot" />
                              <IonIcon icon={ICON_UHRZEIT_GEFUELLT} style={{ fontSize: 'var(--app-text-basis)' }} />
                              <span>{formatEventTime(event.event_date)}</span>
                              {event.location && (
                                <>
                                  <span className="app-dashboard-dot" />
                                  <IonIcon icon={ICON_ORT_GEFUELLT} style={{ fontSize: 'var(--app-text-basis)' }} />
                                  <span>{event.location}</span>
                                </>
                              )}
                            </div>
                            {event.bring_items && (
                              <div className="app-dashboard-meta" style={{ marginTop: 'var(--app-abstand-mini)', color: 'rgba(255,255,255,0.9)' }}>
                                <IonIcon icon={ICON_MATERIAL} style={{ fontSize: 'var(--app-text-basis)', color: 'var(--app-color-wrapped-hell)' }} />
                                <span style={{ fontWeight: 'var(--app-schrift-halbfett)' }}>Mitbringen: {event.bring_items}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div
                      className="app-dashboard-glass-chip"
                      onClick={() => router.push('/teamer/events')}
                      style={{
                        alignSelf: 'center',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--app-abstand-mini)'
                      }}
                    >
                      Alle Events anzeigen <IonIcon icon={ICON_WEITER_GEFUELLT} />
                    </div>
                  </div>
                )}
              </div>
            </div>
              );
            }
            // Tageslosung
            if (sectionKey === 'losung') {
              if (!(config?.show_losung !== false && !loadingVerse && dailyVerse && (dailyVerse.losungstext || dailyVerse.lehrtext))) return null;
              return (
            <div key="losung" className="app-dashboard-section app-dashboard-section--tageslosung">
              <div className="app-dashboard-section__bg-text">
                <h2 className="app-dashboard-section__bg-label">TAGES</h2>
                <h2 className="app-dashboard-section__bg-label">LOSUNG</h2>
              </div>
              <div className="app-dashboard-section__content">
                {(() => {
                  const hasLosung = dailyVerse.losungstext;
                  const hasLehrtext = dailyVerse.lehrtext;

                  let text, reference;
                  if (hasLosung && hasLehrtext) {
                    text = showLosung ? dailyVerse.losungstext : dailyVerse.lehrtext;
                    reference = showLosung ? dailyVerse.losungsvers : dailyVerse.lehrtextvers;
                  } else {
                    text = hasLosung ? dailyVerse.losungstext : dailyVerse.lehrtext;
                    reference = hasLosung ? dailyVerse.losungsvers : dailyVerse.lehrtextvers;
                  }

                  return (
                    <div onClick={() => presentBibleModal()} style={{ cursor: 'pointer' }}>
                      <blockquote className="app-dashboard-quote">
                        "{text}"
                      </blockquote>
                      <cite className="app-dashboard-cite">
                        {reference}
                      </cite>
                      <div className="app-dashboard-translation-hint">
                        {getTranslationName(selectedTranslation)} · zum Ändern tippen
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
              );
            }
            // Badges
            if (sectionKey === 'badges') {
              if (!(config?.show_badges !== false && (visibleBadges.length > 0 || secretEarned.length > 0 || secretNotEarnedCount > 0))) return null;
              return (
            <div key="badges" className="app-dashboard-section app-dashboard-section--badges">
              <div className="app-dashboard-section__bg-text">
                <h2 className="app-dashboard-section__bg-label">DEINE</h2>
                <h2 className="app-dashboard-section__bg-label">BADGES</h2>
              </div>

              <div className="app-dashboard-section__content" style={{ padding: 'var(--app-freiraum-kopf-m) var(--app-abstand-gross) var(--app-abstand-weit) var(--app-abstand-gross)' }}>
                {/* Sichtbare Badges Stats */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--app-abstand-schmal)', marginBottom: 'var(--app-abstand-gross)', flexWrap: 'wrap' }}>
                  <div className="app-dashboard-glass-chip" style={{ display: 'flex', alignItems: 'center', fontSize: 'var(--app-text-basis)' }}>
                    <span style={{ fontWeight: 'var(--app-schrift-extrafett)' }}>{visibleEarned}/{visibleTotal}</span>
                    <span style={{ opacity: 0.8, marginLeft: 'var(--app-abstand-mini)' }}>sichtbar</span>
                    {recentVisibleCount > 0 && (
                      <>
                        <span className="app-dashboard-dot" />
                        <span style={{ fontWeight: 'var(--app-schrift-extrafett)' }}>{recentVisibleCount} {recentVisibleCount === 1 ? 'neuer' : 'neue'}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Sichtbare Badges Grid */}
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 'var(--app-abstand-schmal)', justifyContent: 'center',
                  marginBottom: secretEarned.length > 0 || secretNotEarnedCount > 0 ? 'var(--app-abstand-basis)' : '0'
                }}>
                  {visibleBadges.map((badge) => {
                    const isEarned = earnedIds.has(badge.id);
                    const recent = isRecent(badge) && isEarned;
                    const badgeClr = getBadgeColor(badge);
                    return (
                      <div
                        key={badge.id}
                        onClick={(e) => {
                          badgePopoverRef.current = { badge, isEarned };
                          presentBadgePopover({ event: e.nativeEvent, side: 'top', alignment: 'center' });
                        }}
                        style={{
                          width: '44px', height: '44px', borderRadius: 'var(--app-radius-kreis)',
                          background: isEarned ? `linear-gradient(135deg, ${badgeClr} 0%, ${badgeClr}dd 100%)` : 'rgba(255, 255, 255, 0.15)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: isEarned ? (recent ? `0 0 0 3px var(--app-color-success-fresh), 0 0 20px rgba(var(--app-color-success-fresh-rgb), 0.6)` : `0 4px 12px ${badgeClr}50`) : 'none',
                          border: recent ? '3px solid var(--app-color-success-fresh)' : isEarned ? '2px solid rgba(255, 255, 255, 0.3)' : '2px dashed rgba(255, 255, 255, 0.25)',
                          transition: 'all 0.3s ease', opacity: isEarned ? 1 : 0.5, cursor: 'pointer',
                          position: 'relative', animation: recent ? 'badgePulse 2s ease-in-out infinite' : 'none'
                        }}
                      >
                        <IonIcon
                          icon={isEarned ? getIconFromString(badge.icon) : ICON_VERBORGEN_GEFUELLT}
                          style={{ fontSize: isEarned ? 'var(--app-text-titel-gross)' : 'var(--app-text-standard)', color: isEarned ? 'white' : 'rgba(255, 255, 255, 0.4)', filter: isEarned ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' : 'none' }}
                        />
                        {recent && (
                          <div style={{ position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px', borderRadius: 'var(--app-radius-kreis)', background: 'var(--app-gradient-success)', border: '2px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--app-schatten-punkt-erfolg)' }}>
                            <span style={{ fontSize: 'var(--app-text-hinweispunkt)', fontWeight: 'var(--app-schrift-extrafett)', color: 'white' }}>!</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Geheime Badges */}
                {(secretEarned.length > 0 || secretNotEarnedCount > 0) && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--app-abstand-mittel)' }}>
                      <div className="app-dashboard-glass-chip" style={{ fontSize: 'var(--app-text-basis)', display: 'flex', alignItems: 'center' }}>
                        <span style={{ fontWeight: 'var(--app-schrift-extrafett)' }}>{secretEarned.length}/{secretTotal}</span>
                        <span style={{ opacity: 0.8, marginLeft: 'var(--app-abstand-mini)' }}>geheim</span>
                        {recentSecretCount > 0 && (
                          <>
                            <span className="app-dashboard-dot" />
                            <span style={{ fontWeight: 'var(--app-schrift-extrafett)' }}>{recentSecretCount} {recentSecretCount === 1 ? 'neuer' : 'neue'}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--app-abstand-schmal)', justifyContent: 'center', marginBottom: 'var(--app-abstand-basis)' }}>
                      {secretEarned.map((badge) => {
                        const recent = isRecent(badge);
                        const badgeClr = getBadgeColor(badge);
                        return (
                          <div key={badge.id}
                            onClick={(e) => {
                              badgePopoverRef.current = { badge, isEarned: true };
                              presentBadgePopover({ event: e.nativeEvent, side: 'top', alignment: 'center' });
                            }}
                            style={{
                              width: '44px', height: '44px', borderRadius: 'var(--app-radius-kreis)',
                              background: `linear-gradient(135deg, ${badgeClr} 0%, ${badgeClr}dd 100%)`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              boxShadow: recent ? `0 0 0 3px var(--app-color-success-fresh), 0 0 20px rgba(var(--app-color-success-fresh-rgb), 0.6)` : `0 4px 12px ${badgeClr}50`,
                              border: recent ? '3px solid var(--app-color-success-fresh)' : '2px solid rgba(255, 255, 255, 0.3)',
                              cursor: 'pointer', position: 'relative',
                              animation: recent ? 'badgePulse 2s ease-in-out infinite' : 'none'
                            }}
                          >
                            <IonIcon icon={getIconFromString(badge.icon)} style={{ fontSize: 'var(--app-text-titel-gross)', color: 'white', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }} />
                            {recent && (
                              <div style={{ position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px', borderRadius: 'var(--app-radius-kreis)', background: 'var(--app-gradient-success)', border: '2px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--app-schatten-punkt-erfolg)' }}>
                                <span style={{ fontSize: 'var(--app-text-hinweispunkt)', fontWeight: 'var(--app-schrift-extrafett)', color: 'white' }}>!</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {Array.from({ length: secretNotEarnedCount }).map((_, index) => (
                        <div key={`secret-placeholder-${index}`} style={{ width: '44px', height: '44px', borderRadius: 'var(--app-radius-kreis)', background: 'rgba(255, 255, 255, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed rgba(255, 255, 255, 0.35)', opacity: 0.6 }}>
                          <IonIcon icon={ICON_HILFE_GEFUELLT} style={{ fontSize: 'var(--app-text-untertitel)', color: 'rgba(255, 255, 255, 0.5)' }} />
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Alle Badges Link */}
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--app-abstand-basis)' }}>
                  <div
                    className="app-dashboard-glass-chip"
                    onClick={() => router.push('/teamer/profile/badges')}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mini)' }}
                  >
                    Alle Badges anzeigen <IonIcon icon={ICON_WEITER_GEFUELLT} />
                  </div>
                </div>
              </div>

              <style>{`
                @keyframes badgePulse {
                  0%, 100% { transform: scale(1); }
                  50% { transform: scale(1.08); }
                }
              `}</style>
            </div>
              );
            }
            return null;
          })}
        </div>

        <div className="ion-padding-bottom" />
      </IonContent>

      {showOnboarding && (
        <TeamerOnboardingModal
          onClose={closeOnboarding}
          displayName={(user?.display_name || '').split(' ')[0]}
        />
      )}

      {/* "Was ist neu"-Walkthrough — geöffnet über die Neuigkeiten-Karte */}
      {showUpdateWalkthrough && (
        <TeamerUpdate211WalkthroughModal onClose={() => setShowUpdateWalkthrough(false)} />
      )}

      {showMitmachenErklaerung && (
        <MitmachenErklaerungModal
          rolle="teamer"
          onClose={() => setShowMitmachenErklaerung(false)}
        />
      )}
    </IonPage>
  );
};

export default TeamerDashboardPage;
