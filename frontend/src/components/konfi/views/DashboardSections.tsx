import React from 'react';
import { FARBEN } from '../../../theme/colors';
import {
  IonIcon,
  IonProgressBar
} from '@ionic/react';
import {
  ICON_GRUPPE_GEFUELLT,
  ICON_MATERIAL,
  ICON_ORT_GEFUELLT,
  ICON_POKAL_GEFUELLT,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT_GEFUELLT,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import { Badge } from '../../../types/dashboard';

// Badge Icon Mapping


// Level Popover Content Komponente
/** Eine Stufe aus GET /konfi/dashboard (Tabelle levels). */
export interface DashboardLevel {
  id: number;
  name: string;
  title: string;
  icon: string;
  color: string;
  points_required: number;
}

export interface LevelPopoverData {
  level: DashboardLevel | null;
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
    <div style={{ padding: 'var(--app-abstand-mittel)', background: 'white' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mittel)' }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: 'var(--app-radius-kreis)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isReached
            ? `linear-gradient(145deg, ${level.color || FARBEN.abzeichenFallback} 0%, ${level.color || FARBEN.abzeichenFallback}cc 100%)`
            : 'var(--app-gradient-badge-gesperrt)',
          boxShadow: isReached
            ? `0 2px 8px ${level.color || FARBEN.abzeichenFallback}40`
            : '0 1px 4px rgba(0,0,0,0.1)'
        }}>
          <IonIcon
            icon={getIconFromString(level.icon)}
            style={{
              fontSize: 'var(--app-text-titel-gross)',
              color: isReached ? 'white' : 'var(--app-text-muted)'
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: '0 0 var(--app-abstand-mini) 0', fontSize: 'var(--app-text-betont)', fontWeight: 'var(--app-schrift-fett)', color: 'var(--app-text-primary)', whiteSpace: 'nowrap' }}>
            {level.title}
          </h3>
          <p style={{
            margin: '0',
            fontSize: 'var(--app-text-hinweis)',
            color: 'var(--app-text-secondary)',
            lineHeight: '1.3'
          }}>
            {level.points_required} Punkte erforderlich
          </p>
        </div>
      </div>
      <div style={{
        marginTop: 'var(--app-abstand-schmal)',
        paddingTop: 'var(--app-abstand-schmal)',
        borderTop: '1px solid var(--app-border-soft)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--app-abstand-mini)',
          background: isReached ? 'var(--app-color-success)' : 'var(--app-text-system)',
          color: 'white',
          padding: 'var(--app-abstand-mini) var(--app-abstand-eng)',
          borderRadius: 'var(--app-radius-klein)',
          fontSize: 'var(--app-text-meta)',
          fontWeight: 'var(--app-schrift-halbfett)'
        }}>
          {isReached && <IonIcon icon={ICON_ZUSAGE_GEFUELLT} style={{ fontSize: 'var(--app-text-klein)' }} />}
          {isReached ? 'Erreicht' : 'Noch nicht erreicht'}
        </div>
      </div>
    </div>
  );
};

// Der Abzeichen-Popover der Startseite ist derselbe wie an vier weiteren
// Stellen — er liegt jetzt gemeinsam in shared/BadgePopoverContent.
// Diese Weiterleitung bleibt, damit die Aufrufstellen unveraendert bleiben.
//
// Geaendert dabei: Nicht erreichte Abzeichen zeigten hier
// schon immer ihren Namen, nur das Icon war ein durchgestrichenes Auge. Das
// gilt jetzt ueberall — das Teamer-Dashboard maskierte sie bisher als "???".
export const DashboardBadgePopoverContent: React.FC<{
  dataRef: React.RefObject<BadgePopoverData | null>;
}> = ({ dataRef }) => <BadgePopoverContent dataRef={dataRef} />;

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

// Rechnet jetzt in Kalendertagen statt in 24-Stunden-Bloecken (siehe
// eventFormatting.ts). Bleibt hier re-exportiert, weil DashboardView und
// diese Datei sie unter diesem Namen importieren.
export { formatTimeUntil };

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

/**
 * Farbe eines Abzeichens. Nimmt bewusst nur die drei gelesenen Felder statt
 * eines der Abzeichen-Typen — sie wird sowohl mit der API-Form (`ApiBadge`)
 * als auch mit der Anzeige-Form aufgerufen.
 */
export const getBadgeColor = (badge: Pick<Badge, 'color' | 'criteria_type' | 'criteria_value'>) => {
  if (badge.color) return badge.color;
  if (badge.criteria_type === 'total_points') {
    if (badge.criteria_value <= 5) return FARBEN.bronze;
    if (badge.criteria_value <= 15) return FARBEN.silber;
    return FARBEN.gold;
  }
  return FARBEN.abzeichenFallback;
};

// --- EventCard ---
import { DashboardEvent } from '../../../types/dashboard';

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
      }}>
      {/* Eselsohr oben rechts */}
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
           `Warteliste #${event.waitlist_position || '?'}` :
           formatTimeUntil(event.event_date || event.date)}
      </div>
      <div>
        <div className="app-headline" style={{
          fontSize: 'var(--app-text-standard)',
          fontWeight: 'var(--app-schrift-fett)',
          color: 'white',
          marginBottom: 'var(--app-abstand-mini)',
          paddingRight: 'var(--app-freiraum-aktion-xl)',
          textDecoration: event.cancelled ? 'line-through' : 'none'
        }}>
          {event.title || event.name}
        </div>
        {/* Zeile 1: Datum + Uhrzeit */}
        <div className="app-dashboard-meta">
          <IonIcon icon={ICON_TERMIN_GEFUELLT} style={{ fontSize: 'var(--app-text-basis)' }} />
          <span>{formatEventDate(event.event_date || event.date)}</span>
          <span className="app-dashboard-dot" />
          <IonIcon icon={ICON_UHRZEIT_GEFUELLT} style={{ fontSize: 'var(--app-text-basis)' }} />
          <span>
            {event.booked_timeslot_start
              ? `${formatEventTime(event.booked_timeslot_start)}${event.booked_timeslot_end ? ` - ${formatEventTime(event.booked_timeslot_end)}` : ''}`
              : formatEventTime(event.event_date || event.date)
            }
          </span>
        </div>
        {/* Zeile 2: Ort (eigene Zeile) */}
        {event.location && (
          <div className="app-dashboard-meta" style={{ marginTop: 'var(--app-abstand-mini)' }}>
            <IonIcon icon={ICON_ORT_GEFUELLT} style={{ fontSize: 'var(--app-text-basis)' }} />
            <span>{event.location}</span>
          </div>
        )}
        {/* Zeile 3: Mitbringen (eigene Zeile) */}
        {event.bring_items && (
          <div className="app-dashboard-meta" style={{ marginTop: 'var(--app-abstand-mini)', alignItems: 'flex-start' }}>
            <IonIcon icon={ICON_MATERIAL} style={{ fontSize: 'var(--app-text-basis)', flexShrink: 0, marginTop: 'var(--app-abstand-winzig)' }} />
            <span>Mitbringen: {event.bring_items}</span>
          </div>
        )}
      </div>
    </div>
  );
});

// --- RankingSection ---
import { RankingEntry as RankingEntryType, RankingZeile } from '../../../types/dashboard';
import { getIconFromString } from '../../../utils/badgeIcons';
import BadgePopoverContent, { BadgePopoverData } from '../../shared/BadgePopoverContent';
import { formatTimeUntil } from '../../shared/eventFormatting';
// Re-Export für bestehende Verwender (Wrapped-Slides, KonfiDetailSections).
export { getIconFromString };

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
  const playersToShow: RankingZeile[] = [];

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
        // Nachbarplaetze OHNE Punktzahl: die Punkte der anderen Konfis liefert
        // das Backend nicht, sie wurden hier früher aus dem eigenen Stand
        // hochgerechnet — also frei erfunden. Zusammen mit "??" als Initialen
        // sah das aus wie ein Ladefehler. Jetzt steht dort nur
        // der Platz, und der stimmt.
        playersToShow.push({
          id: `neighbor-${rank}`,
          display_name: rank === startRank ? 'Konfi vor dir' : 'Konfi nach dir',
          points: null,
          initials: '',
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
          borderRadius: 'var(--app-radius-gross)',
          padding: 'var(--app-abstand-basis)',
          marginBottom: 'var(--app-abstand-gross)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--app-abstand-eng)',
            marginBottom: 'var(--app-abstand-eng)',
            justifyContent: 'center'
          }}>
            <span style={{ fontSize: 'var(--app-anzeige-gross)', fontWeight: 'var(--app-schrift-schwer)', color: 'white' }}>
              {rankInJahrgang || 1}
            </span>
            <span style={{ fontSize: 'var(--app-text-ueberschrift)', color: 'rgba(255, 255, 255, 0.7)' }}>
              / {totalInJahrgang || 1}
            </span>
          </div>

          <div className="app-dashboard-meta" style={{ justifyContent: 'center', fontSize: 'var(--app-text-basis)' }}>
            <IonIcon icon={ICON_POKAL_GEFUELLT} style={{ fontSize: 'var(--app-text-basis)' }} />
            <span>Platz {rankInJahrgang || 1}</span>
            <span className="app-dashboard-dot" />
            <span>{jahrgangName}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
          {playersToShow.map((item) => {
            if ('separator' in item) {
              return (
                <div key="separator" style={{
                  display: 'flex',
                  justifyContent: 'center',
                  margin: 'var(--app-abstand-winzig) 0'
                }}>
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: 'rgba(255, 255, 255, 0.6)',
                    padding: 'var(--app-abstand-mini) var(--app-abstand-mittel)',
                    borderRadius: 'var(--app-radius-karte)',
                    fontSize: 'var(--app-text-meta)',
                    fontWeight: 'var(--app-schrift-mittel)'
                  }}>
                    ...
                  </div>
                </div>
              );
            }

            const entry: RankingEntryType = item;
            const isCurrentUser = entry.isCurrentUser || entry.id === konfiId;
            const rank = entry.actualRank ?? entry.rank ?? 0;

            return (
              <div key={entry.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--app-abstand-mittel)',
                background: isCurrentUser
                  ? 'rgba(255, 255, 255, 0.2)'
                  : entry.isNeighbor
                  ? 'rgba(255, 255, 255, 0.05)'
                  : 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(10px)',
                borderRadius: 'var(--app-radius-karte)',
                padding: 'var(--app-abstand-mittel)',
                border: isCurrentUser
                  ? '2px solid rgba(255, 255, 255, 0.4)'
                  : '1px solid rgba(255, 255, 255, 0.15)',
                opacity: entry.isNeighbor ? 0.7 : 1
              }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--app-radius-kreis)',
                  background: rank === 1
                    ? 'linear-gradient(135deg, var(--app-color-gold) 0%, var(--app-color-gold-hell) 100%)'
                    : rank === 2
                    ? 'linear-gradient(135deg, var(--app-color-silber) 0%, var(--app-color-silber-hell) 100%)'
                    : rank === 3
                    ? 'linear-gradient(135deg, var(--app-color-bronze) 0%, var(--app-color-bronze-hell) 100%)'
                    : 'rgba(255, 255, 255, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: rank <= 3 ? 'var(--app-text-emphasis)' : 'white',
                  fontWeight: 'var(--app-schrift-fett)',
                  fontSize: 'var(--app-text-basis)'
                }}>
                  {rank}
                </div>

                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: 'var(--app-radius-kreis)',
                  background: 'rgba(255, 255, 255, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 'var(--app-schrift-halbfett)',
                  fontSize: 'var(--app-text-basis)',
                  backdropFilter: 'blur(10px)'
                }}>
                  {entry.isNeighbor
                    ? <IonIcon icon={ICON_GRUPPE_GEFUELLT} style={{ fontSize: 'var(--app-text-gross)', opacity: 0.8 }} />
                    : entry.initials}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: 'var(--app-text-basis)',
                    fontWeight: 'var(--app-schrift-halbfett)',
                    color: 'white',
                    marginBottom: 'var(--app-abstand-winzig)'
                  }}>
                    {entry.display_name}
                  </div>
                  {/* Punktzahl nur, wenn sie echt ist — Nachbarplaetze zeigen
                      stattdessen den Platz (Punkte anderer kennt die App nicht). */}
                  <div style={{
                    fontSize: 'var(--app-text-klein)',
                    color: 'rgba(255, 255, 255, 0.7)'
                  }}>
                    {entry.points === null || entry.points === undefined
                      ? `Platz ${entry.actualRank}`
                      : `${entry.points} Punkte`}
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
  allLevels: DashboardLevel[];
  levelIndex: number;
  onLevelClick: (e: React.MouseEvent, level: DashboardLevel, isReached: boolean) => void;
}

export const LevelIconsRow = React.memo<LevelIconsRowProps>(({ allLevels, levelIndex, onLevelClick }) => (
  <div style={{
    display: 'flex',
    gap: 'var(--app-abstand-eng)',
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
            borderRadius: 'var(--app-radius-kreis)',
            background: isReached
              ? `linear-gradient(135deg, ${level.color || FARBEN.abzeichenFallback} 0%, ${level.color || FARBEN.abzeichenFallback}dd 100%)`
              : 'rgba(255, 255, 255, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: isReached
              ? `0 4px 12px ${level.color || FARBEN.abzeichenFallback}50`
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
              fontSize: 'var(--app-text-untertitel)',
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
  <div style={{ marginTop: 'var(--app-abstand-basis)' }}>
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 'var(--app-abstand-kompakt)'
    }}>
      <span style={{ fontSize: 'var(--app-text-sekundaer)', color: 'rgba(255, 255, 255, 0.9)' }}>
        Nächstes Level: {nextLevel.title}
      </span>
      <span style={{ fontSize: 'var(--app-text-sekundaer)', color: 'rgba(255, 255, 255, 0.9)' }}>
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
