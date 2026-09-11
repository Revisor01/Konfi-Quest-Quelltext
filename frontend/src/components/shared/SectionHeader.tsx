import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_INFO } from './icons';
import { FARBEN } from '../../theme/colors';

interface SectionHeaderProps {
  title: string;
  subtitle: string;
  icon: string;
  preset?: 'events' | 'activities' | 'konfis' | 'teamer' | 'users' | 'organizations' | 'badges' | 'requests' | 'jahrgang' | 'konfi-requests' | 'categories' | 'level' | 'challenges';
  colors?: { primary: string; secondary: string };
  // string erlaubt, damit Kacheln auch "∞" (unbegrenzte Plaetze) zeigen können.
  // onClick optional: Kacheln, die einem Reiter entsprechen, springen dorthin.
  // Ohne onClick bleibt die Kachel reine Anzeige (Standard).
  stats: Array<{ value: number | string; label: string; onClick?: () => void; active?: boolean }>;
  // Optionaler Info-(i)-Button oben rechts im Banner (z.B. für eine Farbcode-Legende).
  onInfo?: () => void;
}

const cssColor = (token: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--app-color-${token}`).trim();
  return v || fallback;
};

// Presets: primary kommt aus CSS-Variable, secondary ist die feste
// Verlaufs-/Hover-Stufe (Token --app-color-*-dunkel).
const PRESET_COLORS: Record<string, { primary: string; secondary: string }> = {
  events: { primary: cssColor('events', FARBEN.events), secondary: cssColor('events-dunkel', FARBEN.eventsDunkel) },
  activities: { primary: cssColor('activities', FARBEN.activities), secondary: cssColor('activities-dunkel', FARBEN.activitiesDunkel) },
  konfis: { primary: cssColor('konfis', FARBEN.konfis), secondary: cssColor('konfis-dunkel', FARBEN.konfisDunkel) },
  teamer: { primary: cssColor('teamer', FARBEN.teamer), secondary: cssColor('teamer-dunkel', FARBEN.teamerDunkel) },
  users: { primary: cssColor('users', FARBEN.users), secondary: cssColor('users-dunkel', FARBEN.usersDunkel) },
  organizations: { primary: cssColor('users', FARBEN.users), secondary: cssColor('users-dunkel', FARBEN.usersDunkel) },
  badges: { primary: cssColor('badges', FARBEN.badges), secondary: cssColor('badges-dunkel', FARBEN.badgesDunkel) },
  requests: { primary: cssColor('activities', FARBEN.activities), secondary: cssColor('activities-dunkel', FARBEN.activitiesDunkel) },
  'konfi-requests': { primary: cssColor('activities', FARBEN.activities), secondary: cssColor('activities-dunkel', FARBEN.activitiesDunkel) },
  jahrgang: { primary: cssColor('jahrgang', FARBEN.jahrgang), secondary: cssColor('jahrgang-dunkel', FARBEN.jahrgangDunkel) },
  categories: { primary: cssColor('categories', FARBEN.categories), secondary: cssColor('categories-dunkel', FARBEN.categoriesDunkel) },
  level: { primary: cssColor('level', FARBEN.level), secondary: cssColor('level-dunkel', FARBEN.levelDunkel) },
  challenges: { primary: cssColor('challenges', FARBEN.challenges), secondary: cssColor('challenges-dunkel', FARBEN.challengesDunkel) },
};

// Hilfsfunktion: HEX zu RGB-String für rgba()
const hexToRgb = (hex: string): string => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '0, 0, 0';
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
};

const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  icon,
  preset,
  colors,
  stats,
  onInfo,
}) => {
  const resolvedColors = preset ? PRESET_COLORS[preset] : colors;
  const primary = resolvedColors?.primary || FARBEN.users;
  const secondary = resolvedColors?.secondary || FARBEN.usersDunkel;

  return (
    <div
      className="app-header-banner"
      style={{
        background: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,
        boxShadow: `0 8px 32px rgba(${hexToRgb(primary)}, 0.25)`,
      }}
    >
      {/* Dekorative Kreise */}
      <div className="app-header-banner__circle-top" />
      <div className="app-header-banner__circle-bottom" />

      {/* Info-(i)-Button oben rechts (optional) */}
      {onInfo && (
        <button
          type="button"
          className="app-header-banner__info-btn"
          onClick={onInfo}
          aria-label="Erklärung anzeigen"
        >
          <IonIcon icon={ICON_INFO} />
        </button>
      )}

      {/* Header mit Icon und Titel */}
      <div className="app-header-banner__header">
        <div className="app-header-banner__icon">
          <IonIcon icon={icon} />
        </div>
        <div>
          <h2 className="app-header-banner__title">{title}</h2>
          <p className="app-header-banner__subtitle">{subtitle}</p>
        </div>
      </div>

      {/* Stats Row. Kacheln mit onClick werden zu echten Buttons (Tastatur und
          Screenreader), ohne onClick bleibt es bei der reinen Anzeige. */}
      <div className={`app-stats-row${stats.length > 4 ? ' app-stats-row--grid' : ''}`}>
        {stats.map((stat, index) => {
          const content = (
            <>
              <div className="app-stats-row__value">{stat.value}</div>
              <div className="app-stats-row__label">{stat.label}</div>
            </>
          );

          if (!stat.onClick) {
            return (
              <div key={index} className="app-stats-row__item">
                {content}
              </div>
            );
          }

          return (
            <button
              key={index}
              type="button"
              className={`app-stats-row__item app-stats-row__item--clickable${stat.active ? ' app-stats-row__item--active' : ''}`}
              onClick={stat.onClick}
              aria-label={`${stat.label}: ${stat.value} anzeigen`}
              aria-current={stat.active ? 'true' : undefined}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default SectionHeader;
