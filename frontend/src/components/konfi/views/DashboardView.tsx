import { fehlerText } from '../../../utils/fehler';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  IonIcon,
  useIonPopover,
  useIonModal,
  useIonRouter
} from '@ionic/react';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren
import ActivityRings from '../../admin/views/ActivityRings';
import {
  ICON_ANKUENDIGUNG,
  ICON_CHALLENGE,
  ICON_HILFE_GEFUELLT,
  ICON_ORT_GEFUELLT,
  ICON_SICHTBAR,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT,
  ICON_VERBORGEN_GEFUELLT,
  ICON_WEITER_GEFUELLT,
  ICON_WERKZEUG,
} from '../../shared/icons';
import { AlleAbzeichen, ApiBadge, Badge, DashboardEvent, RankingEntry } from '../../../types/dashboard';
import { getIconFromString, LevelPopoverContent, DashboardBadgePopoverContent, LevelPopoverData, DashboardLevel, getGreeting, getFirstName, formatTimeUntil, formatEventTime, formatEventDate, getBadgeColor, EventCard, RankingSection, LevelIconsRow, LevelProgress } from './DashboardSections';
import { kalendertag } from '../../shared/eventFormatting';
import { BadgePopoverData } from '../../shared/BadgePopoverContent';
import type { KonfiChallenge } from '../../../types/challenges';
import api from '../../../services/api';
import { useApp } from '../../../contexts/AppContext';
import BibleTranslationModal, { getTranslationName } from '../../shared/BibleTranslationModal';
import { DEFAULT_KONFI_SECTION_ORDER } from '../../../utils/sectionOrder';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import { istVergangen } from '../../shared';

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
  rank_in_jahrgang?: number;
  total_in_jahrgang?: number;
  konfspruch_visible?: boolean;
  konfspruch?: {
    source: 'liste' | 'freitext';
    id?: number;
    reference?: string;
    text?: string;
    translation?: string;
  } | null;
  level_info?: {
    current_level?: {
      id: number;
      name: string;
      title: string;
      icon: string;
      color: string;
      points_required: number;
    };
    next_level?: {
      id: number;
      name: string;
      title: string;
      icon: string;
      color: string;
      points_required: number;
    };
    progress_percentage: number;
    points_to_next_level: number;
    level_index: number;
    total_levels: number;
    all_levels?: Array<{
      id: number;
      name: string;
      title: string;
      icon: string;
      color: string;
      points_required: number;
    }>;
  };
}

interface DailyVerse {
  losungstext: string;
  losungsvers: string;
  lehrtext: string;
  lehrtextvers: string;
  text?: string;
  reference?: string;
  date?: string;
  translation?: string;
  fallback?: boolean;
  cached?: boolean;
}

/** Minimaldaten der Dashboard-Karte für aktive Challenges. */
interface ChallengeTeaser {
  id: number;
  title: string;
  ends_at: string;
  has_submission: boolean;
  challenge_type?: string;
}

interface BadgeStats {
  totalAvailable: number;
  totalEarned: number;
  secretAvailable: number;
  secretEarned: number;
}


interface DashboardConfig {
  show_konfirmation: boolean;
  show_events: boolean;
  show_losung: boolean;
  show_badges: boolean;
  show_ranking: boolean;
  show_challenges?: boolean;
}

const DEFAULT_KONFI_ORDER = DEFAULT_KONFI_SECTION_ORDER;

/** Icon je Challenge-Typ für die Dashboard-Karte (Schlüssel: challenge_type). */
const CHALLENGE_TYPE_ICON: Record<string, string> = {
  wahrnehmung: ICON_SICHTBAR,
  beitrag: ICON_ANKUENDIGUNG,
  praxis: ICON_WERKZEUG,
  frei: ICON_CHALLENGE
};
const getChallengeTypeIcon = (type?: string): string =>
  CHALLENGE_TYPE_ICON[type || ''] || ICON_CHALLENGE;

interface DashboardViewProps {
  dashboardData: DashboardData;
  // Wird von der Page nicht mehr uebergeben — die View laedt selbst
  // (siehe Kommentar in KonfiDashboardPage). Bleibt optional für Aufrufer,
  // die sie noch setzen.
  dailyVerse?: DailyVerse | null;
  badgeStats: BadgeStats;
  allBadges: AlleAbzeichen;
  upcomingEvents: DashboardEvent[];
  targetGottesdienst: number;
  targetGemeinde: number;
  gottesdienstEnabled?: boolean;
  gemeindeEnabled?: boolean;
  onOpenPointsHistory?: () => void;
  onOpenKonfispruch?: () => void;
  dashboardConfig?: DashboardConfig;
  sectionOrder?: string[];
}

const DashboardView: React.FC<DashboardViewProps> = ({
  dashboardData,
  badgeStats,
  allBadges,
  upcomingEvents,
  targetGottesdienst,
  targetGemeinde,
  gottesdienstEnabled = true,
  gemeindeEnabled = true,
  onOpenPointsHistory,
  onOpenKonfispruch,
  dashboardConfig,
  sectionOrder
}) => {
  const router = useIonRouter();
  const { setError } = useApp();
  const [actualDailyVerse, setActualDailyVerse] = useState<DailyVerse | null>(null);
  const [loadingVerse, setLoadingVerse] = useState(true);
  const [selectedTranslation, setSelectedTranslation] = useState<string>('LUT');

  // Tageslosung in der gewaehlten Bibeluebersetzung neu laden (nach Wechsel).
  const reloadTageslosung = async () => {
    try {
      const response = await api.get('/konfi/tageslosung');
      if (response.data?.success) {
        const { losung, lehrtext } = response.data.data;
        const translation = response.data.translation;
        setActualDailyVerse({
          losungstext: losung?.text,
          losungsvers: losung?.reference,
          lehrtext: lehrtext?.text,
          lehrtextvers: lehrtext?.reference,
          translation
        });
        if (translation) setSelectedTranslation(translation);
      }
    } catch (err) {
      console.error('Tageslosung-Reload fehlgeschlagen:', err);
    }
  };

  const handleTranslationChange = async (code: string) => {
    try {
      await api.put('/konfi/bible-translation', { translation: code });
      setSelectedTranslation(code);
      await reloadTageslosung();
    } catch (err) {
      // Vorher nur console.error: Das Modal schloss, der Text blieb der alte —
      // eine bewusste Auswahl blieb sichtbar folgenlos.
      console.error('Bibeluebersetzung speichern fehlgeschlagen:', err);
      setError(fehlerText(err, 'Übersetzung konnte nicht gespeichert werden'));
    }
  };

  const [presentBibleModal, dismissBibleModal] = useIonModal(BibleTranslationModal, {
    currentTranslation: selectedTranslation,
    onClose: () => dismissBibleModal(),
    onSelect: (code: string) => { handleTranslationChange(code); dismissBibleModal(); },
  });
  const [showLosung, setShowLosung] = useState(true);

  // Aktive Challenges für die Dashboard-Karte. Der Dashboard-Endpoint liefert
  // sie nicht mit, deshalb ein eigener, schlanker Abruf — nur wenn die Karte
  // überhaupt eingeschaltet ist.
  const [activeChallenges, setActiveChallenges] = useState<ChallengeTeaser[]>([]);
  useEffect(() => {
    if (dashboardConfig?.show_challenges === false) {
      setActiveChallenges([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/challenges/konfi');
        if (cancelled) return;
        const active = Array.isArray(res.data?.active) ? res.data.active : [];
        setActiveChallenges(
          active
            .map((c: KonfiChallenge) => ({
              id: c.id,
              title: c.title,
              ends_at: c.ends_at,
              has_submission: !!c.has_submission,
              challenge_type: c.challenge_type
            }))
            .sort((a: ChallengeTeaser, b: ChallengeTeaser) =>
              new Date(a.ends_at).getTime() - new Date(b.ends_at).getTime())
        );
      } catch {
        // Challenges sind eine Zusatzkarte — ein Fehler darf das Dashboard nicht stoeren.
        if (!cancelled) setActiveChallenges([]);
      }
    })();
    return () => { cancelled = true; };
  }, [dashboardConfig?.show_challenges]);

  // Level Popover via useIonPopover
  const levelPopoverRef = useRef<LevelPopoverData>({ level: null, isReached: false });
  const [presentLevelPopover] = useIonPopover(LevelPopoverContent, {
    dataRef: levelPopoverRef
  });

  // Badge Popover via useIonPopover
  const badgePopoverRef = useRef<BadgePopoverData | null>({ badge: null, isEarned: false });
  const [presentBadgePopover] = useIonPopover(DashboardBadgePopoverContent, {
    dataRef: badgePopoverRef
  });

  // Tageslosung aus dem Cache statt per Direkt-Abruf: Sie wechselt einmal am
  // Tag, war offline aber gar nicht da — die Teamer-Startseite cachte sie
  // laengst mit 24-Std-TTL, die Konfi-Seite nicht.
  const losungAktiv = dashboardConfig?.show_losung !== false;
  const { data: gecachteLosung, loading: losungLaedt } = useOfflineQuery<DailyVerse | null>(
    'konfi:tageslosung:' + kalendertag(),
    async () => {
      const response = await api.get('/konfi/tageslosung');
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

  useEffect(() => {
    if (!losungAktiv) {
      setLoadingVerse(false);
      setActualDailyVerse(null);
      return;
    }
    setShowLosung(Math.random() > 0.5);
    setLoadingVerse(losungLaedt);
    if (gecachteLosung !== null && gecachteLosung !== undefined) {
      setActualDailyVerse(gecachteLosung);
      if (gecachteLosung.translation) setSelectedTranslation(gecachteLosung.translation);
    }
  }, [losungAktiv, gecachteLosung, losungLaedt]);

  const gottesdienstPoints = dashboardData.konfi.gottesdienst_points || 0;
  const gemeindePoints = dashboardData.konfi.gemeinde_points || 0;
  const totalCurrentPoints = (gottesdienstEnabled ? gottesdienstPoints : 0) + (gemeindeEnabled ? gemeindePoints : 0);

  // Filter nur Events wo Konfi angemeldet ist (confirmed oder waitlist)
  const myRegisteredEvents = useMemo(() => upcomingEvents
    .filter(e => e.is_registered || e.booking_status === 'waitlist')
    // istVergangen(): laufende mehrtaegige Termine bleiben sichtbar.
    .filter(e => !istVergangen({ event_date: e.event_date || e.date || '', event_end_time: e.event_end_time }))
    .sort((a, b) => new Date(a.event_date || a.date || '').getTime() - new Date(b.event_date || b.date || '').getTime()),
  [upcomingEvents]);

  // Konfirmations-Termin über das is_konfirmation-Flag (Phase 117, Migration 091).
  const isKonfirmation = (e: typeof myRegisteredEvents[number]) =>
    e.is_konfirmation === true;

  const confirmationEvents = useMemo(() => myRegisteredEvents
    .filter(e => isKonfirmation(e)),
  [myRegisteredEvents]);

  const regularEvents = useMemo(() => myRegisteredEvents
    .filter(e => !isKonfirmation(e))
    .slice(0, 3),
  [myRegisteredEvents]);

  const nextConfirmationEvent = confirmationEvents.length > 0 ? confirmationEvents[0] : null;

  // Badge-Berechnungen memoisiert
  const earnedIds = useMemo(() => new Set(allBadges.earned.map((b: ApiBadge) => b.id)), [allBadges.earned]);
  const recentBadgeIds = useMemo(() => new Set(dashboardData.recent_badges?.map((b: Badge) => b.id) || []), [dashboardData.recent_badges]);

  const visibleBadges = useMemo(() => [
    ...allBadges.earned.filter((b: ApiBadge) => !b.is_hidden),
    ...allBadges.available.filter((b: ApiBadge) => !earnedIds.has(b.id) && !b.is_hidden)
  ].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)), [allBadges, earnedIds]);

  const secretEarned = useMemo(() => allBadges.earned.filter((b: ApiBadge) => b.is_hidden), [allBadges.earned]);
  const secretNotEarnedCount = badgeStats.secretAvailable - badgeStats.secretEarned;

  const recentSecretCount = useMemo(() =>
    secretEarned.filter((b: ApiBadge) => recentBadgeIds.has(b.id)).length,
    [secretEarned, recentBadgeIds]
  );
  const recentVisibleCount = useMemo(() =>
    (dashboardData.recent_badges || []).length - recentSecretCount,
    [dashboardData.recent_badges, recentSecretCount]
  );

  const handleLevelClick = (e: React.MouseEvent, level: DashboardLevel, isReached: boolean) => {
    levelPopoverRef.current = { level, isReached };
    presentLevelPopover({
      event: e.nativeEvent,
      side: 'top',
      alignment: 'center'
    });
  };

  return (
    <div style={{ padding: 'var(--app-abstand-basis)' }}>

      {/* Header Card mit ActivityRings */}
      <div className="app-dashboard-header">
        <div className="app-dashboard-header__circle" style={{ top: '-40px', right: '-40px', width: '140px', height: '140px', background: 'rgba(255, 255, 255, 0.08)' }}/>
        <div className="app-dashboard-header__circle" style={{ top: '60px', right: '30px', width: '60px', height: '60px' }}/>
        <div className="app-dashboard-header__circle" style={{ bottom: '-30px', left: '-30px', width: '100px', height: '100px' }}/>
        <div className="app-dashboard-header__circle" style={{ bottom: '40px', left: '40px', width: '40px', height: '40px' }}/>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2 className="app-dashboard-greeting">
            {getGreeting(getFirstName(dashboardData.konfi.display_name))}
          </h2>
          <p className="app-dashboard-subtitle">
            {dashboardData.konfi.jahrgang_name}
          </p>

          <div
            onClick={onOpenPointsHistory}
            style={{ cursor: onOpenPointsHistory ? 'pointer' : 'default', display: 'flex', justifyContent: 'center' }}
          >
            <ActivityRings
              totalPoints={totalCurrentPoints}
              gottesdienstPoints={gottesdienstPoints}
              gemeindePoints={gemeindePoints}
              gottesdienstGoal={targetGottesdienst}
              gemeindeGoal={targetGemeinde}
              gottesdienstEnabled={gottesdienstEnabled}
              gemeindeEnabled={gemeindeEnabled}
              size={180}
            />
          </div>

          {dashboardData.level_info?.current_level && (
            <div style={{ marginTop: 'var(--app-abstand-gross)', textAlign: 'center' }}>
              <div className="app-dashboard-glass-chip" style={{ marginBottom: 'var(--app-abstand-mittel)' }}>
                {dashboardData.level_info.current_level.title}
              </div>

              {dashboardData.level_info?.all_levels && dashboardData.level_info.all_levels.length > 0 && (
                <LevelIconsRow
                  allLevels={dashboardData.level_info.all_levels}
                  levelIndex={dashboardData.level_info.level_index}
                  onLevelClick={handleLevelClick}
                />
              )}
            </div>
          )}

          {dashboardData.level_info?.next_level && (
            <LevelProgress
              nextLevel={dashboardData.level_info.next_level}
              progressPercentage={dashboardData.level_info.progress_percentage}
              pointsToNextLevel={dashboardData.level_info.points_to_next_level}
            />
          )}
        </div>
      </div>

      {/* Dynamische Sektionen basierend auf section_order */}
      {(sectionOrder || DEFAULT_KONFI_ORDER).map(key => {
        const sectionRenderers: Record<string, () => React.ReactNode> = {
          konfirmation: () => (
            dashboardConfig?.show_konfirmation !== false && ((dashboardData.days_to_confirmation !== null && dashboardData.days_to_confirmation !== undefined) || nextConfirmationEvent) ? (
              <div className="app-dashboard-section app-dashboard-section--konfirmation" key="konfirmation">
                <div className="app-dashboard-section__bg-text">
                  <h2 className="app-dashboard-section__bg-label">DEINE</h2>
                  <h2 className="app-dashboard-section__bg-label">KONFIRMATION</h2>
                </div>
                <div className="app-dashboard-section__content" style={{ textAlign: 'center' }}>
                  {dashboardData.days_to_confirmation !== null && dashboardData.days_to_confirmation !== undefined ? (
                    <>
                      <div className="app-headline" style={{ fontSize: 'var(--app-anzeige-hero)', fontWeight: 'var(--app-schrift-schwer)', color: 'white', lineHeight: '1', marginBottom: 'var(--app-abstand-eng)' }}>
                        {dashboardData.days_to_confirmation}
                      </div>
                      <div className="app-headline" style={{ fontSize: 'var(--app-text-gross)', color: 'rgba(255, 255, 255, 0.9)', marginBottom: 'var(--app-abstand-mittel)' }}>
                        {dashboardData.days_to_confirmation === 1
                          ? `Genau 1 Tag bis zu deiner Konfirmation`
                          : `Noch genau ${dashboardData.days_to_confirmation} Tage bis zu deiner Konfirmation`
                        }
                      </div>
                    </>
                  ) : nextConfirmationEvent ? (
                    <>
                      <div className="app-headline" style={{ fontSize: 'var(--app-anzeige-gross)', fontWeight: 'var(--app-schrift-schwer)', color: 'white', lineHeight: '1', marginBottom: 'var(--app-abstand-eng)' }}>
                        {formatTimeUntil(nextConfirmationEvent.event_date || nextConfirmationEvent.date)}
                      </div>
                      <div className="app-headline" style={{ fontSize: 'var(--app-text-gross)', color: 'rgba(255, 255, 255, 0.9)', marginBottom: 'var(--app-abstand-mittel)' }}>
                        bis zu deiner Konfirmation
                      </div>
                    </>
                  ) : null}
                  <div className="app-dashboard-meta" style={{ justifyContent: 'center', flexWrap: 'wrap', fontSize: 'var(--app-text-sekundaer)' }}>
                    {nextConfirmationEvent && (
                      <>
                        <IonIcon icon={ICON_TERMIN_GEFUELLT} style={{ fontSize: 'var(--app-text-sekundaer)' }} />
                        <span>{formatEventDate(nextConfirmationEvent.event_date || nextConfirmationEvent.date)} um {formatEventTime(nextConfirmationEvent.event_date || nextConfirmationEvent.date)}</span>
                      </>
                    )}
                    {nextConfirmationEvent && (dashboardData.konfi.confirmation_location || nextConfirmationEvent?.location) && (
                      <span className="app-dashboard-dot" />
                    )}
                    {(dashboardData.konfi.confirmation_location || nextConfirmationEvent?.location) && (
                      <>
                        <IonIcon icon={ICON_ORT_GEFUELLT} style={{ fontSize: 'var(--app-text-sekundaer)' }} />
                        <span>{dashboardData.konfi.confirmation_location || nextConfirmationEvent?.location}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : null
          ),
          challenges: () => {
            // Bewusst ohne Zähler/Fortschritt: nur die laufenden Challenges und
            // der Weg hinein. Ohne aktive Challenge verschwindet die Karte ganz.
            if (dashboardConfig?.show_challenges === false || activeChallenges.length === 0) {
              return null;
            }
            const remainingFor = (endsAt: string) => {
              const diff = new Date(endsAt).getTime() - Date.now();
              if (isNaN(diff) || diff <= 0) return 'Zeit abgelaufen';
              const days = Math.floor(diff / 86400000);
              if (days >= 1) return days === 1 ? '1 Tag' : `${days} Tage`;
              const hours = Math.floor(diff / 3600000);
              if (hours >= 1) return hours === 1 ? '1 Stunde' : `${hours} Stunden`;
              return 'endet heute';
            };
            // Bis zu 3 laufende Challenges als eigene Karten, exakt nach dem
            // Muster der Events-Sektion (eine Karte je Eintrag, Button darunter
            // nur textbreit). Weitere Challenges gibt es nur noch im Tab selbst,
            // kein "+X weitere"-Hinweis mehr — Events verhalten sich genauso.
            const visibleChallenges = activeChallenges.slice(0, 3);

            return (
              // Farbverlauf kommt aus der gemeinsamen Klasse — jede
              // Dashboard-Sektion trägt ihre Bereichsfarbe, dort wäre ein
              // neutraler Sonderweg der Bruch.
              <div className="app-dashboard-section app-dashboard-section--challenges" key="challenges">
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
                        onClick={() => router.push('/konfi/challenges')}
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
                    <div
                      className="app-dashboard-glass-chip"
                      onClick={() => router.push('/konfi/challenges')}
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
          },
          konfispruch: () => {
            // Card-Gate: nur sichtbar, wenn der Jahrgang die Konfispruch-Auswahl
            // freigegeben hat (konfspruch_visible aus dem Dashboard-Endpoint).
            if (dashboardData.konfspruch_visible !== true) {
              return null;
            }
            const spruch = dashboardData.konfspruch;
            const spruchText = spruch?.text?.trim();
            const spruchReference = spruch?.reference?.trim();
            return (
              <div
                className="app-dashboard-section app-dashboard-section--konfispruch"
                key="konfispruch"
                onClick={onOpenKonfispruch}
                style={{ cursor: onOpenKonfispruch ? 'pointer' : 'default' }}
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
                        Tippe, um deinen Konfirmationsspruch zu wählen
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          },
          events: () => (
            dashboardConfig?.show_events !== false ? (
              <div className="app-dashboard-section app-dashboard-section--events" key="events">
                <div className="app-dashboard-section__bg-text">
                  <h2 className="app-dashboard-section__bg-label">DEINE</h2>
                  <h2 className="app-dashboard-section__bg-label">EVENTS</h2>
                </div>
<div className="app-dashboard-section__content app-dashboard-section__content--compact">
                  {regularEvents.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-mittel)' }}>
                      {regularEvents.map((event) => (
                        <EventCard
                          key={event.id}
                          event={event}
                          onClick={() => router.push(`/konfi/events/${event.id}`)}
                        />
                      ))}
                      <div
                        className="app-dashboard-glass-chip"
                        onClick={() => router.push('/konfi/events')}
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
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-mittel)' }}>
                      <div
                        className="app-dashboard-glass-card"
                        onClick={() => router.push('/konfi/events')}
                        style={{ cursor: 'pointer', textAlign: 'center', padding: 'var(--app-abstand-gross) var(--app-abstand-basis)' }}
                      >
                        <div style={{ fontSize: 'var(--app-text-standard)', fontWeight: 'var(--app-schrift-halbfett)', color: 'white', marginBottom: 'var(--app-abstand-mini)' }}>
                          Buche dein nächstes Event
                        </div>
                        <div style={{ fontSize: 'var(--app-text-sekundaer)', color: 'rgba(255, 255, 255, 0.7)' }}>
                          Tippe hier um verfügbare Events zu sehen
                        </div>
                      </div>
                      <div
                        className="app-dashboard-glass-chip"
                        onClick={() => router.push('/konfi/events')}
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
            ) : null
          ),
          losung: () => (
            dashboardConfig?.show_losung !== false && !loadingVerse && actualDailyVerse && (actualDailyVerse.losungstext || actualDailyVerse.lehrtext) ? (
              <div className="app-dashboard-section app-dashboard-section--tageslosung" key="losung">
                <div className="app-dashboard-section__bg-text">
                  <h2 className="app-dashboard-section__bg-label">TAGES</h2>
                  <h2 className="app-dashboard-section__bg-label">LOSUNG</h2>
                </div>
                <div className="app-dashboard-section__content">
                  {(() => {
                    const hasLosung = actualDailyVerse.losungstext;
                    const hasLehrtext = actualDailyVerse.lehrtext;
                    let text, reference;
                    if (hasLosung && hasLehrtext) {
                      text = showLosung ? actualDailyVerse.losungstext : actualDailyVerse.lehrtext;
                      reference = showLosung ? actualDailyVerse.losungsvers : actualDailyVerse.lehrtextvers;
                    } else {
                      text = hasLosung ? actualDailyVerse.losungstext : actualDailyVerse.lehrtext || actualDailyVerse.text;
                      reference = hasLosung ? actualDailyVerse.losungsvers : actualDailyVerse.lehrtextvers || actualDailyVerse.reference;
                    }
                    return (
                      <div
                        onClick={() => presentBibleModal()}
                        style={{ cursor: 'pointer' }}
                      >
                        <blockquote className="app-dashboard-quote">"{text}"</blockquote>
                        <cite className="app-dashboard-cite">{reference}</cite>
                        <div className="app-dashboard-translation-hint">
                          {getTranslationName(selectedTranslation)} · zum Ändern tippen
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : null
          ),
          badges: () => (
            dashboardConfig?.show_badges !== false && (allBadges.available.length > 0 || allBadges.earned.length > 0) ? (
              <div className="app-dashboard-section app-dashboard-section--badges" key="badges">
                <div className="app-dashboard-section__bg-text">
                  <h2 className="app-dashboard-section__bg-label">DEINE</h2>
                  <h2 className="app-dashboard-section__bg-label">BADGES</h2>
                </div>
                <div className="app-dashboard-section__content" style={{ padding: 'var(--app-freiraum-kopf-m) var(--app-abstand-gross) var(--app-abstand-weit) var(--app-abstand-gross)' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--app-abstand-schmal)', marginBottom: 'var(--app-abstand-gross)', flexWrap: 'wrap' }}>
                    <div className="app-dashboard-glass-chip" style={{ display: 'flex', alignItems: 'center', fontSize: 'var(--app-text-basis)' }}>
                      <span style={{ fontWeight: 'var(--app-schrift-extrafett)' }}>{badgeStats.totalEarned}/{badgeStats.totalAvailable}</span>
                      <span style={{ opacity: 0.8, marginLeft: 'var(--app-abstand-mini)' }}>sichtbar</span>
                      {recentVisibleCount > 0 && (
                        <>
                          <span className="app-dashboard-dot" />
                          <span style={{ fontWeight: 'var(--app-schrift-extrafett)' }}>{recentVisibleCount} {recentVisibleCount === 1 ? 'neuer' : 'neue'}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--app-abstand-schmal)', justifyContent: 'center', marginBottom: secretEarned.length > 0 || secretNotEarnedCount > 0 ? 'var(--app-abstand-basis)' : '0' }}>
                      {visibleBadges.map((badge) => {
                        const isEarned = earnedIds.has(badge.id);
                        const isRecent = recentBadgeIds.has(badge.id);
                        const badgeClr = getBadgeColor(badge);
                        return (
                          <div
                            key={badge.id}
                            onClick={(e) => {
                              badgePopoverRef.current = { badge, isEarned };
                              presentBadgePopover({ event: e.nativeEvent, side: 'top', alignment: 'center', cssClass: 'badge-detail-popover' });
                            }}
                            style={{
                              width: '44px', height: '44px', borderRadius: 'var(--app-radius-kreis)',
                              background: isEarned ? `linear-gradient(135deg, ${badgeClr} 0%, ${badgeClr}dd 100%)` : 'rgba(255, 255, 255, 0.15)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              boxShadow: isEarned ? (isRecent ? `0 0 0 3px var(--app-color-success-fresh), 0 0 20px rgba(var(--app-color-success-fresh-rgb), 0.6)` : `0 4px 12px ${badgeClr}50`) : 'none',
                              border: isRecent ? '3px solid var(--app-color-success-fresh)' : isEarned ? '2px solid rgba(255, 255, 255, 0.3)' : '2px dashed rgba(255, 255, 255, 0.25)',
                              transition: 'all 0.3s ease', opacity: isEarned ? 1 : 0.5, cursor: 'pointer',
                              position: 'relative', animation: isRecent ? 'badgePulse 2s ease-in-out infinite' : 'none'
                            }}
                          >
                            <IonIcon icon={isEarned ? getIconFromString(badge.icon) : ICON_VERBORGEN_GEFUELLT} style={{ fontSize: isEarned ? 'var(--app-text-titel-gross)' : 'var(--app-text-standard)', color: isEarned ? 'white' : 'rgba(255, 255, 255, 0.4)', filter: isEarned ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' : 'none' }} />
                            {isRecent && (
                              <div style={{ position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px', borderRadius: 'var(--app-radius-kreis)', background: 'var(--app-gradient-success)', border: '2px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--app-schatten-punkt-erfolg)' }}>
                                <span style={{ fontSize: 'var(--app-text-hinweispunkt)', fontWeight: 'var(--app-schrift-extrafett)', color: 'white' }}>!</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {(secretEarned.length > 0 || secretNotEarnedCount > 0) && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--app-abstand-mittel)' }}>
                          <div className="app-dashboard-glass-chip" style={{ fontSize: 'var(--app-text-basis)', display: 'flex', alignItems: 'center' }}>
                            <span style={{ fontWeight: 'var(--app-schrift-extrafett)' }}>{badgeStats.secretEarned}/{badgeStats.secretAvailable}</span>
                            <span style={{ opacity: 0.8, marginLeft: 'var(--app-abstand-mini)' }}>geheim</span>
                            {recentSecretCount > 0 && (
                              <>
                                <span className="app-dashboard-dot" />
                                <span style={{ fontWeight: 'var(--app-schrift-extrafett)' }}>{recentSecretCount} {recentSecretCount === 1 ? 'neuer' : 'neue'}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--app-abstand-schmal)', justifyContent: 'center' }}>
                          {secretEarned.map((badge) => {
                            const isRecent = recentBadgeIds.has(badge.id);
                            const badgeClr = getBadgeColor(badge);
                            return (
                              <div key={badge.id}
                                onClick={(e) => {
                                  badgePopoverRef.current = { badge, isEarned: true };
                                  presentBadgePopover({ event: e.nativeEvent, side: 'top', alignment: 'center', cssClass: 'badge-detail-popover' });
                                }}
                                style={{
                                  width: '44px', height: '44px', borderRadius: 'var(--app-radius-kreis)',
                                  background: `linear-gradient(135deg, ${badgeClr} 0%, ${badgeClr}dd 100%)`,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  boxShadow: isRecent ? `0 0 0 3px var(--app-color-success-fresh), 0 0 20px rgba(var(--app-color-success-fresh-rgb), 0.6)` : `0 4px 12px ${badgeClr}50`,
                                  border: isRecent ? '3px solid var(--app-color-success-fresh)' : '2px solid rgba(255, 255, 255, 0.3)',
                                  cursor: 'pointer', position: 'relative',
                                  animation: isRecent ? 'badgePulse 2s ease-in-out infinite' : 'none'
                                }}
                              >
                                <IonIcon icon={getIconFromString(badge.icon)} style={{ fontSize: 'var(--app-text-titel-gross)', color: 'white', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }} />
                                {isRecent && (
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
                  </>

                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--app-abstand-basis)' }}>
                    <div className="app-dashboard-glass-chip" onClick={() => router.push('/konfi/badges')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-kompakt)' }}>
                      <span>Alle Badges anzeigen</span>
                      <IonIcon icon={ICON_WEITER_GEFUELLT} style={{ fontSize: 'var(--app-text-basis)' }} />
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
            ) : null
          ),
          ranking: () => (
            dashboardConfig?.show_ranking !== false && dashboardData.ranking && dashboardData.ranking.length > 0 ? (
              <RankingSection
                key="ranking"
                ranking={dashboardData.ranking}
                rankInJahrgang={dashboardData.rank_in_jahrgang || 1}
                totalInJahrgang={dashboardData.total_in_jahrgang || 1}
                konfiId={dashboardData.konfi.id}
                konfiDisplayName={dashboardData.konfi.display_name}
                konfiGottesdienstPoints={dashboardData.konfi.gottesdienst_points}
                konfiGemeindePoints={dashboardData.konfi.gemeinde_points}
                jahrgangName={dashboardData.konfi.jahrgang_name}
              />
            ) : null
          ),
        };
        return sectionRenderers[key]?.();
      })}

    </div>
  );
};

export default DashboardView;
