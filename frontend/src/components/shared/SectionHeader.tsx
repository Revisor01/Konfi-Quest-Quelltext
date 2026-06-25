import React from 'react';
import { IonIcon } from '@ionic/react';
import { informationCircleOutline } from 'ionicons/icons';

interface SectionHeaderProps {
  title: string;
  subtitle: string;
  icon: string;
  preset?: 'events' | 'activities' | 'konfis' | 'teamer' | 'users' | 'organizations' | 'badges' | 'requests' | 'jahrgang' | 'konfi-requests' | 'categories' | 'level';
  colors?: { primary: string; secondary: string };
  stats: Array<{ value: number; label: string }>;
  // Optionaler Info-(i)-Button oben rechts im Banner (z.B. für eine Farbcode-Legende).
  onInfo?: () => void;
}

// Liest --app-color-XYZ aus :root, mit Hex-Fallback fuer SSR/Initial-Render
const cssColor = (token: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--app-color-${token}`).trim();
  return v || fallback;
};

// Presets: primary kommt aus CSS-Variable, secondary bleibt als feste Hover-Stufe
const PRESET_COLORS: Record<string, { primary: string; secondary: string }> = {
  events: { primary: cssColor('events', '#dc2626'), secondary: '#b91c1c' },
  activities: { primary: cssColor('activities', '#047857'), secondary: '#065f46' },
  konfis: { primary: cssColor('konfis', '#5b21b6'), secondary: '#4c1d95' },
  teamer: { primary: cssColor('teamer', '#be185d'), secondary: '#831843' },
  users: { primary: cssColor('users', '#667eea'), secondary: '#5a67d8' },
  organizations: { primary: cssColor('users', '#667eea'), secondary: '#5a67d8' },
  badges: { primary: cssColor('badges', '#f59e0b'), secondary: '#d97706' },
  requests: { primary: cssColor('activities', '#047857'), secondary: '#065f46' },
  'konfi-requests': { primary: cssColor('activities', '#047857'), secondary: '#065f46' },
  jahrgang: { primary: cssColor('jahrgang', '#007aff'), secondary: '#0066d6' },
  categories: { primary: cssColor('categories', '#0ea5e9'), secondary: '#0284c7' },
  level: { primary: cssColor('level', '#ec4899'), secondary: '#db2777' },
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
  const primary = resolvedColors?.primary || '#667eea';
  const secondary = resolvedColors?.secondary || '#5a67d8';

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
          <IonIcon icon={informationCircleOutline} />
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

      {/* Stats Row */}
      <div className={`app-stats-row${stats.length > 4 ? ' app-stats-row--grid' : ''}`}>
        {stats.map((stat, index) => (
          <div key={index} className="app-stats-row__item">
            <div className="app-stats-row__value">{stat.value}</div>
            <div className="app-stats-row__label">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SectionHeader;
