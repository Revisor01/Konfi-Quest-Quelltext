import React from 'react';
import {
  IonIcon,
  IonProgressBar
} from '@ionic/react';
import {
  time,
  location,
  calendar,
  eyeOff,
  star,
  trophy,
  medal,
  ribbon,
  checkmarkCircle,
  diamond,
  shield,
  flame,
  flash,
  rocket,
  sparkles,
  thumbsUp,
  heart,
  people,
  personAdd,
  chatbubbles,
  gift,
  book,
  school,
  construct,
  brush,
  colorPalette,
  sunny,
  moon,
  leaf,
  rose,
  today,
  timer,
  stopwatch,
  restaurant,
  fitness,
  bicycle,
  car,
  airplane,
  boat,
  camera,
  image,
  musicalNote,
  balloon,
  home,
  business,
  navigate,
  compass,
  pin,
  flag,
  informationCircle,
  helpCircle,
  alertCircle,
  hammer
} from 'ionicons/icons';
import { Badge } from '../../../types/dashboard';

// Badge Icon Mapping
export const BADGE_ICONS: Record<string, { icon: string; name: string; category: string }> = {
  trophy: { icon: trophy, name: 'Pokal', category: 'Erfolg' },
  medal: { icon: medal, name: 'Medaille', category: 'Erfolg' },
  ribbon: { icon: ribbon, name: 'Band', category: 'Erfolg' },
  star: { icon: star, name: 'Stern', category: 'Erfolg' },
  checkmarkCircle: { icon: checkmarkCircle, name: 'Bestanden', category: 'Erfolg' },
  diamond: { icon: diamond, name: 'Diamant', category: 'Erfolg' },
  shield: { icon: shield, name: 'Schild', category: 'Erfolg' },
  flame: { icon: flame, name: 'Flamme', category: 'Engagement' },
  flash: { icon: flash, name: 'Blitz', category: 'Engagement' },
  rocket: { icon: rocket, name: 'Rakete', category: 'Engagement' },
  sparkles: { icon: sparkles, name: 'Funken', category: 'Engagement' },
  thumbsUp: { icon: thumbsUp, name: 'Daumen hoch', category: 'Engagement' },
  heart: { icon: heart, name: 'Herz', category: 'Gemeinschaft' },
  people: { icon: people, name: 'Gruppe', category: 'Gemeinschaft' },
  personAdd: { icon: personAdd, name: 'Neue Person', category: 'Gemeinschaft' },
  chatbubbles: { icon: chatbubbles, name: 'Chat', category: 'Gemeinschaft' },
  gift: { icon: gift, name: 'Geschenk', category: 'Gemeinschaft' },
  book: { icon: book, name: 'Buch', category: 'Lernen' },
  school: { icon: school, name: 'Schule', category: 'Lernen' },
  construct: { icon: construct, name: 'Werkzeug', category: 'Lernen' },
  brush: { icon: brush, name: 'Pinsel', category: 'Lernen' },
  colorPalette: { icon: colorPalette, name: 'Farbpalette', category: 'Lernen' },
  sunny: { icon: sunny, name: 'Sonne', category: 'Natur' },
  moon: { icon: moon, name: 'Mond', category: 'Natur' },
  leaf: { icon: leaf, name: 'Blatt', category: 'Natur' },
  rose: { icon: rose, name: 'Rose', category: 'Natur' },
  calendar: { icon: calendar, name: 'Kalender', category: 'Zeit' },
  today: { icon: today, name: 'Heute', category: 'Zeit' },
  time: { icon: time, name: 'Uhr', category: 'Zeit' },
  timer: { icon: timer, name: 'Timer', category: 'Zeit' },
  stopwatch: { icon: stopwatch, name: 'Stoppuhr', category: 'Zeit' },
  restaurant: { icon: restaurant, name: 'Restaurant', category: 'Aktivitäten' },
  fitness: { icon: fitness, name: 'Fitness', category: 'Aktivitäten' },
  bicycle: { icon: bicycle, name: 'Fahrrad', category: 'Aktivitäten' },
  car: { icon: car, name: 'Auto', category: 'Aktivitäten' },
  airplane: { icon: airplane, name: 'Flugzeug', category: 'Aktivitäten' },
  boat: { icon: boat, name: 'Boot', category: 'Aktivitäten' },
  camera: { icon: camera, name: 'Kamera', category: 'Aktivitäten' },
  image: { icon: image, name: 'Bild', category: 'Aktivitäten' },
  musicalNote: { icon: musicalNote, name: 'Musik', category: 'Aktivitäten' },
  balloon: { icon: balloon, name: 'Ballon', category: 'Aktivitäten' },
  home: { icon: home, name: 'Zuhause', category: 'Orte' },
  business: { icon: business, name: 'Gebäude', category: 'Orte' },
  location: { icon: location, name: 'Standort', category: 'Orte' },
  navigate: { icon: navigate, name: 'Navigation', category: 'Orte' },
  compass: { icon: compass, name: 'Kompass', category: 'Orte' },
  pin: { icon: pin, name: 'Pin', category: 'Orte' },
  flag: { icon: flag, name: 'Flagge', category: 'Orte' },
  informationCircle: { icon: informationCircle, name: 'Info', category: 'Sonstiges' },
  helpCircle: { icon: helpCircle, name: 'Hilfe', category: 'Sonstiges' },
  alertCircle: { icon: alertCircle, name: 'Warnung', category: 'Sonstiges' },
  hammer: { icon: hammer, name: 'Hammer', category: 'Sonstiges' }
};

// Helper function to get icon from string
export const getIconFromString = (iconName: string | undefined): string => {
  if (!iconName) return trophy;
  return BADGE_ICONS[iconName]?.icon || trophy;
};

// Level Popover Content Komponente
export interface LevelPopoverData {
  level: { id: number; name: string; title: string; icon: string; color: string; points_required: number } | null;
  isReached: boolean;
}

export const LevelPopoverContent: React.FC<{
  dataRef: React.RefObject<LevelPopoverData>;
}> = ({ dataRef }) => {
  const data = dataRef.current;
  if (!data || !data.level) return null;
  const level = data.level;
  const isReached = data.isReached;

  return (
    <div style={{ padding: '12px', background: 'white' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isReached
            ? `linear-gradient(145deg, ${level.color || '#667eea'} 0%, ${level.color || '#667eea'}cc 100%)`
            : 'linear-gradient(145deg, #d0d0d0 0%, #b8b8b8 100%)',
          boxShadow: isReached
            ? `0 2px 8px ${level.color || '#667eea'}40`
            : '0 1px 4px rgba(0,0,0,0.1)'
        }}>
          <IonIcon
            icon={getIconFromString(level.icon)}
            style={{
              fontSize: '1.4rem',
              color: isReached ? 'white' : '#999'
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', fontWeight: '700', color: '#333', whiteSpace: 'nowrap' }}>
            {level.title}
          </h3>
          <p style={{
            margin: '0',
            fontSize: '0.8rem',
            color: '#666',
            lineHeight: '1.3'
          }}>
            {level.points_required} Punkte erforderlich
          </p>
        </div>
      </div>
      <div style={{
        marginTop: '10px',
        paddingTop: '10px',
        borderTop: '1px solid #eee',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          background: isReached ? '#22c55e' : '#8e8e93',
          color: 'white',
          padding: '3px 8px',
          borderRadius: '8px',
          fontSize: '0.7rem',
          fontWeight: '600'
        }}>
          {isReached && <IonIcon icon={checkmarkCircle} style={{ fontSize: '0.75rem' }} />}
          {isReached ? 'Erreicht' : 'Noch nicht erreicht'}
        </div>
      </div>
    </div>
  );
};

// Badge Popover Content Komponente für Dashboard
export const DashboardBadgePopoverContent: React.FC<{
  dataRef: React.RefObject<{ badge: Badge | null; isEarned: boolean; getBadgeColor: (badge: Badge) => string }>;
}> = ({ dataRef }) => {
  const data = dataRef.current;
  if (!data || !data.badge) return null;
  const badge = data.badge;
  const isEarned = data.isEarned;
  const badgeColor = data.getBadgeColor(badge);

  return (
    <div style={{ padding: '12px', background: 'white', width: 'max-content', minWidth: '200px', maxWidth: '320px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isEarned
            ? `linear-gradient(145deg, ${badgeColor} 0%, ${badgeColor}cc 100%)`
            : 'linear-gradient(145deg, #d0d0d0 0%, #b8b8b8 100%)',
          boxShadow: isEarned
            ? `0 2px 8px ${badgeColor}40`
            : '0 1px 4px rgba(0,0,0,0.1)'
        }}>
          <IonIcon
            icon={isEarned ? getIconFromString(badge.icon) : eyeOff}
            style={{
              fontSize: '1.4rem',
              color: isEarned ? 'white' : '#999'
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', fontWeight: '700', color: '#333', whiteSpace: 'nowrap' }}>
            {badge.name}
          </h3>
          <p style={{
            margin: '0',
            fontSize: '0.8rem',
            color: '#666',
            lineHeight: '1.3'
          }}>
            {badge.description || 'Keine Beschreibung'}
          </p>
        </div>
      </div>
      <div style={{
        marginTop: '10px',
        paddingTop: '10px',
        borderTop: '1px solid #eee',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        {isEarned ? (
          <>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              background: '#22c55e',
              color: 'white',
              padding: '3px 8px',
              borderRadius: '8px',
              fontSize: '0.7rem',
              fontWeight: '600'
            }}>
              <IonIcon icon={checkmarkCircle} style={{ fontSize: '0.75rem' }} />
              Erreicht
            </div>
            {badge.earned_at && (
              <span style={{ fontSize: '0.7rem', color: '#888' }}>
                {new Date(badge.earned_at).toLocaleDateString('de-DE', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric'
                })}
              </span>
            )}
          </>
        ) : (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            background: '#8e8e93',
            color: 'white',
            padding: '3px 8px',
            borderRadius: '8px',
            fontSize: '0.7rem',
            fontWeight: '600'
          }}>
            Noch nicht erreicht
          </div>
        )}
      </div>
    </div>
  );
};

// --- Utility Helpers ---

export const getGreeting = (name: string): string => {
  const hour = new Date().getHours();
  let greeting: string;
  if (hour < 12) {
    greeting = 'Guten Morgen';
  } else if (hour < 18) {
    greeting = 'Guten Tag';
  } else {
    greeting = 'Guten Abend';
  }
  return `${greeting}, ${name}!`;
};

export const getInitials = (name: string) => {
  return name
    .split(' ')
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase()
    .substring(0, 2);
};

export const getFirstName = (name: string) => {
  return name.split(' ')[0];
};

export const formatTimeUntil = (dateString: string | undefined) => {
  if (!dateString) return '';
  const targetDate = new Date(dateString);
  const now = new Date();
  const diffTime = targetDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Heute';
  if (diffDays === 1) return 'Morgen';
  if (diffDays < 0) return 'Vorbei';
  if (diffDays === 1) return '1 Tag';
  if (diffDays < 7) return `${diffDays} Tage`;
  if (diffDays < 14) return '1 Woche';
  if (diffDays < 21) return '2 Wochen';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} Wochen`;
  if (diffDays < 365) return `${diffDays} Tage`;
  return `${Math.floor(diffDays / 365)} Jahr${Math.floor(diffDays / 365) > 1 ? 'e' : ''}`;
};

export const formatEventTime = (dateString: string | undefined) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const formatEventDate = (dateString: string | undefined) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
};

export const getBadgeColor = (badge: Badge) => {
  if (badge.color) return badge.color;
  if (badge.criteria_type === 'total_points') {
    if (badge.criteria_value <= 5) return '#cd7f32'; // Bronze
    if (badge.criteria_value <= 15) return '#c0c0c0'; // Silver
    return '#ffd700'; // Gold
  }
  return '#667eea'; // Default
};

// --- EventCard ---
import { DashboardEvent } from '../../../types/dashboard';
import { bagHandle } from 'ionicons/icons';

interface EventCardProps {
  event: DashboardEvent;
  onClick: () => void;
}

export const EventCard = React.memo<EventCardProps>(({ event, onClick }) => {
  const isWaitlist = event.booking_status === 'waitlist' || event.booking_status === 'pending';
  return (
    <div
      onClick={onClick}
      className="app-dashboard-glass-card"
      style={{
        background: isWaitlist
          ? 'rgba(251, 191, 36, 0.25)'
          : undefined,
        position: 'relative',
        overflow: 'hidden',
        border: event.cancelled
          ? '2px dashed rgba(255,255,255,0.3)'
          : isWaitlist
            ? '2px solid rgba(251, 191, 36, 0.5)'
            : 'none',
        cursor: 'pointer',
        transition: 'transform 0.2s ease, background 0.2s ease'
      }}>
      {/* Eselsohr oben rechts */}
      <div style={{
        position: 'absolute',
        top: '0',
        right: '0',
        background: event.cancelled
          ? 'rgba(255,255,255,0.3)'
          : isWaitlist
            ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
            : 'rgba(255,255,255,0.25)',
        borderRadius: '0 10px 0 10px',
        padding: '4px 10px',
        fontSize: '0.65rem',
        fontWeight: '600',
        color: 'white',
        whiteSpace: 'nowrap',
        textTransform: 'uppercase',
        letterSpacing: '0.3px'
      }}>
        {event.cancelled ? 'ABGESAGT' :
         isWaitlist ?
           `Warteliste #${event.waitlist_position || '?'}` :
           formatTimeUntil(event.event_date || event.date)}
      </div>
      <div>
        <div className="app-headline" style={{
          fontSize: '1rem',
          fontWeight: '700',
          color: 'white',
          marginBottom: '4px',
          paddingRight: '80px',
          textDecoration: event.cancelled ? 'line-through' : 'none'
        }}>
          {event.title || event.name}
        </div>
        {/* Zeile 1: Datum + Uhrzeit */}
        <div className="app-dashboard-meta">
          <IonIcon icon={calendar} style={{ fontSize: '0.9rem' }} />
          <span>{formatEventDate(event.event_date || event.date)}</span>
          <span className="app-dashboard-dot" />
          <IonIcon icon={time} style={{ fontSize: '0.9rem' }} />
          <span>
            {event.booked_timeslot_start
              ? `${formatEventTime(event.booked_timeslot_start)}${event.booked_timeslot_end ? ` - ${formatEventTime(event.booked_timeslot_end)}` : ''}`
              : formatEventTime(event.event_date || event.date)
            }
          </span>
        </div>
        {/* Zeile 2: Ort (eigene Zeile) */}
        {event.location && (
          <div className="app-dashboard-meta" style={{ marginTop: '4px' }}>
            <IonIcon icon={location} style={{ fontSize: '0.9rem' }} />
            <span>{event.location}</span>
          </div>
        )}
        {/* Zeile 3: Mitbringen (eigene Zeile) */}
        {event.bring_items && (
          <div className="app-dashboard-meta" style={{ marginTop: '4px', alignItems: 'flex-start' }}>
            <IonIcon icon={bagHandle} style={{ fontSize: '0.9rem', flexShrink: 0, marginTop: '2px' }} />
            <span>Mitbringen: {event.bring_items}</span>
          </div>
        )}
      </div>
    </div>
  );
});

// --- RankingSection ---
import { RankingEntry as RankingEntryType } from '../../../types/dashboard';

interface RankingSectionProps {
  ranking: RankingEntryType[];
  rankInJahrgang: number;
  totalInJahrgang: number;
  konfiId: number;
  konfiDisplayName: string;
  konfiGottesdienstPoints: number;
  konfiGemeindePoints: number;
  jahrgangName: string;
}

export const RankingSection = React.memo<RankingSectionProps>(({
  ranking,
  rankInJahrgang,
  totalInJahrgang,
  konfiId,
  konfiDisplayName,
  konfiGottesdienstPoints,
  konfiGemeindePoints,
  jahrgangName
}) => {
  const currentUserRank = rankInJahrgang || 1;
  const totalRanking = ranking;
  const playersToShow: any[] = [];

  // Immer Platz 1 zeigen
  if (totalRanking.length > 0) {
    playersToShow.push({ ...totalRanking[0], actualRank: 1 });
  }

  // Falls User nicht auf Platz 1-3 ist, zeige Nachbarn
  if (currentUserRank > 3) {
    if (currentUserRank > 2) {
      playersToShow.push({ separator: true });
    }

    const startRank = Math.max(1, currentUserRank - 1);
    const endRank = Math.min(totalInJahrgang || currentUserRank, currentUserRank + 1);

    for (let rank = startRank; rank <= endRank; rank++) {
      if (rank === currentUserRank) {
        playersToShow.push({
          id: konfiId,
          display_name: konfiDisplayName,
          points: (konfiGottesdienstPoints || 0) + (konfiGemeindePoints || 0),
          initials: getInitials(konfiDisplayName),
          actualRank: rank,
          isCurrentUser: true
        });
      } else {
        playersToShow.push({
          id: `neighbor-${rank}`,
          display_name: rank === startRank ? 'Konfi vor dir' : 'Konfi nach dir',
          points: rank < currentUserRank ?
            (konfiGottesdienstPoints || 0) + (konfiGemeindePoints || 0) + (currentUserRank - rank) :
            Math.max(0, (konfiGottesdienstPoints || 0) + (konfiGemeindePoints || 0) - (rank - currentUserRank)),
          initials: '??',
          actualRank: rank,
          isNeighbor: true
        });
      }
    }
  } else {
    for (let i = 1; i < Math.min(3, totalRanking.length); i++) {
      playersToShow.push({ ...totalRanking[i], actualRank: i + 1 });
    }
  }

  return (
    <div className="app-dashboard-section app-dashboard-section--ranking">
      <div className="app-dashboard-section__bg-text">
        <h2 className="app-dashboard-section__bg-label">DEIN</h2>
        <h2 className="app-dashboard-section__bg-label">RANKING</h2>
      </div>

      <div className="app-dashboard-section__content app-dashboard-section__content--compact">
        <div className="app-dashboard-glass-card" style={{
          borderRadius: '16px',
          padding: '16px',
          marginBottom: '20px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '8px',
            marginBottom: '8px',
            justifyContent: 'center'
          }}>
            <span style={{ fontSize: '2.5rem', fontWeight: '900', color: 'white' }}>
              {rankInJahrgang || 1}
            </span>
            <span style={{ fontSize: '1.5rem', color: 'rgba(255, 255, 255, 0.7)' }}>
              / {totalInJahrgang || 1}
            </span>
          </div>

          <div className="app-dashboard-meta" style={{ justifyContent: 'center', fontSize: '0.9rem' }}>
            <IonIcon icon={trophy} style={{ fontSize: '0.9rem' }} />
            <span>Platz {rankInJahrgang || 1}</span>
            <span className="app-dashboard-dot" />
            <span>{jahrgangName}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {playersToShow.map((item, index) => {
            if (item.separator) {
              return (
                <div key="separator" style={{
                  display: 'flex',
                  justifyContent: 'center',
                  margin: '2px 0'
                }}>
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: 'rgba(255, 255, 255, 0.6)',
                    padding: '4px 12px',
                    borderRadius: '12px',
                    fontSize: '0.7rem',
                    fontWeight: '500'
                  }}>
                    ...
                  </div>
                </div>
              );
            }

            const entry = item as { id?: number | string; display_name?: string; points?: number; initials?: string; actualRank?: number; rank?: number; isCurrentUser?: boolean; isNeighbor?: boolean };
            const isCurrentUser = entry.isCurrentUser || entry.id === konfiId;
            const rank = entry.actualRank ?? entry.rank ?? 0;

            return (
              <div key={entry.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                background: isCurrentUser
                  ? 'rgba(255, 255, 255, 0.2)'
                  : entry.isNeighbor
                  ? 'rgba(255, 255, 255, 0.05)'
                  : 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(10px)',
                borderRadius: '12px',
                padding: '12px',
                border: isCurrentUser
                  ? '2px solid rgba(255, 255, 255, 0.4)'
                  : '1px solid rgba(255, 255, 255, 0.15)',
                opacity: entry.isNeighbor ? 0.7 : 1
              }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: rank === 1
                    ? 'linear-gradient(135deg, #ffd700 0%, #ffed4e 100%)'
                    : rank === 2
                    ? 'linear-gradient(135deg, #c0c0c0 0%, #e8e8e8 100%)'
                    : rank === 3
                    ? 'linear-gradient(135deg, #cd7f32 0%, #deb887 100%)'
                    : 'rgba(255, 255, 255, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: rank <= 3 ? '#1a1a1a' : 'white',
                  fontWeight: '700',
                  fontSize: '0.9rem'
                }}>
                  {rank}
                </div>

                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: '600',
                  fontSize: '0.9rem',
                  backdropFilter: 'blur(10px)'
                }}>
                  {entry.initials}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: '0.9rem',
                    fontWeight: '600',
                    color: 'white',
                    marginBottom: '2px'
                  }}>
                    {entry.display_name}
                  </div>
                  <div style={{
                    fontSize: '0.75rem',
                    color: 'rgba(255, 255, 255, 0.7)'
                  }}>
                    {entry.points} Punkte
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

// --- LevelIconsRow ---
interface LevelIconsRowProps {
  allLevels: Array<{ id: number; name: string; title: string; icon: string; color: string; points_required: number }>;
  levelIndex: number;
  onLevelClick: (e: React.MouseEvent, level: any, isReached: boolean) => void;
}

export const LevelIconsRow = React.memo<LevelIconsRowProps>(({ allLevels, levelIndex, onLevelClick }) => (
  <div style={{
    display: 'flex',
    gap: '8px',
    justifyContent: 'center',
    flexWrap: 'wrap'
  }}>
    {allLevels.map((level, index) => {
      const isReached = index < levelIndex;
      const isCurrent = index === levelIndex - 1;
      return (
        <div
          key={level.id}
          onClick={(e) => {
            e.stopPropagation();
            onLevelClick(e, level, isReached);
          }}
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: isReached
              ? `linear-gradient(135deg, ${level.color || '#667eea'} 0%, ${level.color || '#667eea'}dd 100%)`
              : 'rgba(255, 255, 255, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: isReached
              ? `0 4px 12px ${level.color || '#667eea'}50`
              : 'none',
            border: isCurrent
              ? '2px solid rgba(255, 255, 255, 0.8)'
              : isReached
              ? '2px solid rgba(255, 255, 255, 0.3)'
              : '2px dashed rgba(255, 255, 255, 0.2)',
            transition: 'all 0.3s ease',
            opacity: isReached ? 1 : 0.5,
            cursor: 'pointer'
          }}
        >
          <IonIcon
            icon={getIconFromString(level.icon)}
            style={{
              fontSize: '1.2rem',
              color: isReached ? 'white' : 'rgba(255, 255, 255, 0.4)',
              filter: isReached ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' : 'none'
            }}
          />
        </div>
      );
    })}
  </div>
));

// --- LevelProgress ---
interface LevelProgressProps {
  nextLevel: { title: string; points_required: number };
  progressPercentage: number;
  pointsToNextLevel: number;
}

export const LevelProgress = React.memo<LevelProgressProps>(({ nextLevel, progressPercentage, pointsToNextLevel }) => (
  <div style={{ marginTop: '16px' }}>
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '6px'
    }}>
      <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.9)' }}>
        Nächstes Level: {nextLevel.title}
      </span>
      <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.9)' }}>
        {pointsToNextLevel ? `noch ${pointsToNextLevel} Punkte` : `${progressPercentage}%`}
      </span>
    </div>
    <IonProgressBar
      value={progressPercentage / 100}
      style={{
        '--progress-background': 'rgba(255, 255, 255, 0.8)',
        '--background': 'rgba(255, 255, 255, 0.2)',
        'height': '6px',
        'borderRadius': '3px'
      }}
    />
  </div>
));
