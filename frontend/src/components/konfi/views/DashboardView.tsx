import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  IonIcon,
  useIonAlert,
  useIonPopover,
  useIonModal,
  useIonRouter
} from '@ionic/react';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren
import ActivityRings from '../../admin/views/ActivityRings';
import {
  calendar,
  location,
  eyeOff,
  helpCircle,
  chevronForward,
  time
} from 'ionicons/icons';
import { Badge, DashboardEvent, RankingEntry } from '../../../types/dashboard';
import {
  getIconFromString,
  LevelPopoverContent,
  DashboardBadgePopoverContent,
  LevelPopoverData,
  getGreeting,
  getFirstName,
  getInitials,
  formatTimeUntil,
  formatEventTime,
  formatEventDate,
  getBadgeColor,
  EventCard,
  RankingSection,
  LevelIconsRow,
  LevelProgress
} from './DashboardSections';
import api from '../../../services/api';
import BibleTranslationModal, { getTranslationName } from '../../shared/BibleTranslationModal';

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

interface BadgeStats {
  totalAvailable: number;
  totalEarned: number;
  secretAvailable: number;
  secretEarned: number;
}

interface AllBadgesData {
  available: Badge[];
  earned: Badge[];
}

interface DashboardConfig {
  show_konfirmation: boolean;
  show_events: boolean;
  show_losung: boolean;
  show_badges: boolean;
  show_ranking: boolean;
}

const DEFAULT_KONFI_ORDER = ['konfirmation', 'konfispruch', 'events', 'losung', 'badges', 'ranking'];

interface DashboardViewProps {
  dashboardData: DashboardData;
  dailyVerse: DailyVerse | null;
  badgeStats: BadgeStats;
  allBadges: AllBadgesData;
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
  dailyVerse,
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
  const [presentAlert] = useIonAlert();
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
      console.error('Bibeluebersetzung speichern fehlgeschlagen:', err);
    }
  };

  const [presentBibleModal, dismissBibleModal] = useIonModal(BibleTranslationModal, {
    currentTranslation: selectedTranslation,
    onClose: () => dismissBibleModal(),
    onSelect: (code: string) => { handleTranslationChange(code); dismissBibleModal(); },
  });
  const [showLosung, setShowLosung] = useState(true);

  // Level Popover via useIonPopover
  const levelPopoverRef = useRef<LevelPopoverData>({ level: null, isReached: false });
  const [presentLevelPopover, dismissLevelPopover] = useIonPopover(LevelPopoverContent, {
    dataRef: levelPopoverRef
  });

  // Badge Popover via useIonPopover
  const badgePopoverRef = useRef<{ badge: Badge | null; isEarned: boolean; getBadgeColor: (badge: Badge) => string }>({
    badge: null, isEarned: false, getBadgeColor: () => '#667eea'
  });
  const [presentBadgePopover, dismissBadgePopover] = useIonPopover(DashboardBadgePopoverContent, {
    dataRef: badgePopoverRef
  });

  // Load Tageslosung directly from backend
  useEffect(() => {
    if (dashboardConfig?.show_losung === false) {
      setLoadingVerse(false);
      setActualDailyVerse(null);
      return;
    }
    setShowLosung(Math.random() > 0.5);

    const loadTageslosung = async () => {
      try {
        const response = await api.get('/konfi/tageslosung');
        if (response.data && response.data.success) {
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
        } else {
 console.error('Invalid response from backend:', response.data);
          setActualDailyVerse(null);
        }
      } catch (error: unknown) {
 console.error('Failed to load Tageslosung from backend:', error);
        setActualDailyVerse(null);
      } finally {
        setLoadingVerse(false);
      }
    };
    loadTageslosung();
  }, [dailyVerse, dashboardConfig?.show_losung]);

  const gottesdienstPoints = dashboardData.konfi.gottesdienst_points || 0;
  const gemeindePoints = dashboardData.konfi.gemeinde_points || 0;
  const totalCurrentPoints = (gottesdienstEnabled ? gottesdienstPoints : 0) + (gemeindeEnabled ? gemeindePoints : 0);

  // Filter nur Events wo Konfi angemeldet ist (confirmed oder waitlist)
  const myRegisteredEvents = useMemo(() => upcomingEvents
    .filter(e => e.is_registered || e.booking_status === 'waitlist')
    .filter(e => new Date(e.event_date || e.date || '') >= new Date())
    .sort((a, b) => new Date(a.event_date || a.date || '').getTime() - new Date(b.event_date || b.date || '').getTime()),
  [upcomingEvents]);

  // Konfirmations-Termin ueber das is_konfirmation-Flag (Phase 117, Migration 091).
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
  const earnedIds = useMemo(() => new Set(allBadges.earned.map((b: Badge) => b.id)), [allBadges.earned]);
  const recentBadgeIds = useMemo(() => new Set(dashboardData.recent_badges?.map((b: Badge) => b.id) || []), [dashboardData.recent_badges]);

  const visibleBadges = useMemo(() => [
    ...allBadges.earned.filter((b: Badge) => !b.is_hidden),
    ...allBadges.available.filter((b: Badge) => !earnedIds.has(b.id) && !b.is_hidden)
  ].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)), [allBadges, earnedIds]);

  const secretEarned = useMemo(() => allBadges.earned.filter((b: Badge) => b.is_hidden), [allBadges.earned]);
  const secretNotEarnedCount = badgeStats.secretAvailable - badgeStats.secretEarned;

  const recentSecretCount = useMemo(() =>
    secretEarned.filter((b: Badge) => recentBadgeIds.has(b.id)).length,
    [secretEarned, recentBadgeIds]
  );
  const recentVisibleCount = useMemo(() =>
    (dashboardData.recent_badges || []).length - recentSecretCount,
    [dashboardData.recent_badges, recentSecretCount]
  );

  const handleLevelClick = (e: React.MouseEvent, level: any, isReached: boolean) => {
    levelPopoverRef.current = { level, isReached };
    presentLevelPopover({
      event: (e as any).nativeEvent,
      side: 'top',
      alignment: 'center'
    });
  };

  return (
    <div style={{ padding: '16px' }}>

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
            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <div className="app-dashboard-glass-chip" style={{ marginBottom: '12px' }}>
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
                      <div className="app-headline" style={{ fontSize: '3.5rem', fontWeight: '900', color: 'white', lineHeight: '1', marginBottom: '8px' }}>
                        {dashboardData.days_to_confirmation}
                      </div>
                      <div className="app-headline" style={{ fontSize: '1.1rem', color: 'rgba(255, 255, 255, 0.9)', marginBottom: '12px' }}>
                        {dashboardData.days_to_confirmation === 1
                          ? `Genau 1 Tag bis zu deiner Konfirmation`
                          : `Noch genau ${dashboardData.days_to_confirmation} Tage bis zu deiner Konfirmation`
                        }
                      </div>
                    </>
                  ) : nextConfirmationEvent ? (
                    <>
                      <div className="app-headline" style={{ fontSize: '2.5rem', fontWeight: '900', color: 'white', lineHeight: '1', marginBottom: '8px' }}>
                        {formatTimeUntil(nextConfirmationEvent.event_date || nextConfirmationEvent.date)}
                      </div>
                      <div className="app-headline" style={{ fontSize: '1.1rem', color: 'rgba(255, 255, 255, 0.9)', marginBottom: '12px' }}>
                        bis zu deiner Konfirmation
                      </div>
                    </>
                  ) : null}
                  <div className="app-dashboard-meta" style={{ justifyContent: 'center', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                    {nextConfirmationEvent && (
                      <>
                        <IonIcon icon={calendar} style={{ fontSize: '0.85rem' }} />
                        <span>{formatEventDate(nextConfirmationEvent.event_date || nextConfirmationEvent.date)} um {formatEventTime(nextConfirmationEvent.event_date || nextConfirmationEvent.date)}</span>
                      </>
                    )}
                    {nextConfirmationEvent && (dashboardData.konfi.confirmation_location || nextConfirmationEvent?.location) && (
                      <span className="app-dashboard-dot" />
                    )}
                    {(dashboardData.konfi.confirmation_location || nextConfirmationEvent?.location) && (
                      <>
                        <IonIcon icon={location} style={{ fontSize: '0.85rem' }} />
                        <span>{dashboardData.konfi.confirmation_location || nextConfirmationEvent?.location}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : null
          ),
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
                      <div className="app-headline" style={{ fontSize: '1.3rem', fontWeight: '800', color: 'white', marginBottom: '8px' }}>
                        Dein Konfispruch
                      </div>
                      <div style={{ fontSize: '0.95rem' }}>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                          gap: '4px'
                        }}
                      >
                        Alle Events anzeigen <IonIcon icon={chevronForward} />
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div
                        className="app-dashboard-glass-card"
                        onClick={() => router.push('/konfi/events')}
                        style={{ cursor: 'pointer', textAlign: 'center', padding: '20px 16px' }}
                      >
                        <div style={{ fontSize: '1rem', fontWeight: '600', color: 'white', marginBottom: '4px' }}>
                          Buche dein nächstes Event
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
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
                          gap: '4px'
                        }}
                      >
                        Alle Events anzeigen <IonIcon icon={chevronForward} />
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
                <div className="app-dashboard-section__content" style={{ padding: '60px 20px 24px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                    <div className="app-dashboard-glass-chip" style={{ display: 'flex', alignItems: 'center', fontSize: '0.9rem' }}>
                      <span style={{ fontWeight: '800' }}>{badgeStats.totalEarned}/{badgeStats.totalAvailable}</span>
                      <span style={{ opacity: 0.8, marginLeft: '4px' }}>sichtbar</span>
                      {recentVisibleCount > 0 && (
                        <>
                          <span className="app-dashboard-dot" />
                          <span style={{ fontWeight: '800' }}>{recentVisibleCount} {recentVisibleCount === 1 ? 'neuer' : 'neue'}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', marginBottom: secretEarned.length > 0 || secretNotEarnedCount > 0 ? '16px' : '0' }}>
                      {visibleBadges.map((badge) => {
                        const isEarned = earnedIds.has(badge.id);
                        const isRecent = recentBadgeIds.has(badge.id);
                        const badgeClr = getBadgeColor(badge);
                        return (
                          <div
                            key={badge.id}
                            onClick={(e) => {
                              badgePopoverRef.current = { badge, isEarned, getBadgeColor };
                              presentBadgePopover({ event: e.nativeEvent, side: 'top', alignment: 'center', cssClass: 'badge-detail-popover' });
                            }}
                            style={{
                              width: '44px', height: '44px', borderRadius: '50%',
                              background: isEarned ? `linear-gradient(135deg, ${badgeClr} 0%, ${badgeClr}dd 100%)` : 'rgba(255, 255, 255, 0.15)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              boxShadow: isEarned ? (isRecent ? `0 0 0 3px #10b981, 0 0 20px rgba(16, 185, 129, 0.6)` : `0 4px 12px ${badgeClr}50`) : 'none',
                              border: isRecent ? '3px solid #10b981' : isEarned ? '2px solid rgba(255, 255, 255, 0.3)' : '2px dashed rgba(255, 255, 255, 0.25)',
                              transition: 'all 0.3s ease', opacity: isEarned ? 1 : 0.5, cursor: 'pointer',
                              position: 'relative', animation: isRecent ? 'badgePulse 2s ease-in-out infinite' : 'none'
                            }}
                          >
                            <IonIcon icon={isEarned ? getIconFromString(badge.icon) : eyeOff} style={{ fontSize: isEarned ? '1.4rem' : '1rem', color: isEarned ? 'white' : 'rgba(255, 255, 255, 0.4)', filter: isEarned ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' : 'none' }} />
                            {isRecent && (
                              <div style={{ position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px', borderRadius: '50%', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: '2px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(16, 185, 129, 0.5)' }}>
                                <span style={{ fontSize: '10px', fontWeight: '800', color: 'white' }}>!</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {(secretEarned.length > 0 || secretNotEarnedCount > 0) && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
                          <div className="app-dashboard-glass-chip" style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center' }}>
                            <span style={{ fontWeight: '800' }}>{badgeStats.secretEarned}/{badgeStats.secretAvailable}</span>
                            <span style={{ opacity: 0.8, marginLeft: '4px' }}>geheim</span>
                            {recentSecretCount > 0 && (
                              <>
                                <span className="app-dashboard-dot" />
                                <span style={{ fontWeight: '800' }}>{recentSecretCount} {recentSecretCount === 1 ? 'neuer' : 'neue'}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
                          {secretEarned.map((badge) => {
                            const isRecent = recentBadgeIds.has(badge.id);
                            const badgeClr = getBadgeColor(badge);
                            return (
                              <div key={badge.id}
                                onClick={(e) => {
                                  badgePopoverRef.current = { badge, isEarned: true, getBadgeColor };
                                  presentBadgePopover({ event: e.nativeEvent, side: 'top', alignment: 'center', cssClass: 'badge-detail-popover' });
                                }}
                                style={{
                                  width: '44px', height: '44px', borderRadius: '50%',
                                  background: `linear-gradient(135deg, ${badgeClr} 0%, ${badgeClr}dd 100%)`,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  boxShadow: isRecent ? `0 0 0 3px #10b981, 0 0 20px rgba(16, 185, 129, 0.6)` : `0 4px 12px ${badgeClr}50`,
                                  border: isRecent ? '3px solid #10b981' : '2px solid rgba(255, 255, 255, 0.3)',
                                  cursor: 'pointer', position: 'relative',
                                  animation: isRecent ? 'badgePulse 2s ease-in-out infinite' : 'none'
                                }}
                              >
                                <IonIcon icon={getIconFromString(badge.icon)} style={{ fontSize: '1.4rem', color: 'white', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }} />
                                {isRecent && (
                                  <div style={{ position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px', borderRadius: '50%', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: '2px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(16, 185, 129, 0.5)' }}>
                                    <span style={{ fontSize: '10px', fontWeight: '800', color: 'white' }}>!</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {Array.from({ length: secretNotEarnedCount }).map((_, index) => (
                            <div key={`secret-placeholder-${index}`} style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed rgba(255, 255, 255, 0.35)', opacity: 0.6 }}>
                              <IonIcon icon={helpCircle} style={{ fontSize: '1.2rem', color: 'rgba(255, 255, 255, 0.5)' }} />
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>

                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
                    <div className="app-dashboard-glass-chip" onClick={() => router.push('/konfi/badges')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>Alle Badges anzeigen</span>
                      <IonIcon icon={chevronForward} style={{ fontSize: '0.9rem' }} />
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
