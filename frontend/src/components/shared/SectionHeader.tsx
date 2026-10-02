import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_INFO } from './icons';

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

// Presets als CSS-Variablen: Vorher wurden die Tokens EINMAL
// beim Laden des Moduls aus :root gelesen, sonst griffen die hellen Hexwerte
// aus theme/colors.ts -- ein Wechsel der Systemeinstellung zur Laufzeit
// erreichte die Koepfe nie. var() loest der Browser bei jedem Zeichnen auf;
// der Schatten kommt aus dem -rgb-Tripel desselben Tokens.
const token = (name: string) => `var(--app-color-${name})`;
const preset = (primary: string, secondary: string) => ({ primary: token(primary), secondary: token(secondary) });

const PRESET_COLORS: Record<string, { primary: string; secondary: string }> = {
  events: preset('events', 'events-dunkel'),
  activities: preset('activities', 'activities-dunkel'),
  konfis: preset('konfis', 'konfis-dunkel'),
  teamer: preset('teamer', 'teamer-dunkel'),
  users: preset('users', 'users-dunkel'),
  organizations: preset('users', 'users-dunkel'),
  badges: preset('badges', 'badges-dunkel'),
  requests: preset('activities', 'activities-dunkel'),
  'konfi-requests': preset('activities', 'activities-dunkel'),
  jahrgang: preset('jahrgang', 'jahrgang-dunkel'),
  categories: preset('categories', 'categories-dunkel'),
  level: preset('level', 'level-dunkel'),
  challenges: preset('challenges', 'challenges-dunkel'),
};

// Hilfsfunktion: HEX zu RGB-String für rgba()
const hexToRgb = (hex: string): string => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '0, 0, 0';
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
};

/**
 * Schattenfarbe zur Primaerfarbe: Bei `var(--app-color-x)` das Tripel
 * `--app-color-x-rgb` (folgt dem Dunkelmodus), bei einem Hexwert (freie
 * `colors`-Angabe eines Aufrufers) die Umrechnung, sonst neutrales Grau.
 */
export const schattenFarbe = (primary: string): string => {
  const variable = /^var\(--app-color-([a-z0-9-]+)\)$/.exec(primary.trim());
  if (variable) return `rgba(var(--app-color-${variable[1]}-rgb), 0.25)`;
  if (/^#[a-f\d]{6}$/i.test(primary.trim())) return `rgba(${hexToRgb(primary.trim())}, 0.25)`;
  return 'rgba(0, 0, 0, 0.25)';
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
  const primary = resolvedColors?.primary || token('users');
  const secondary = resolvedColors?.secondary || token('users-dunkel');

  return (
    <div
      className="app-header-banner"
      style={{
        background: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,
        boxShadow: `0 8px 32px ${schattenFarbe(primary)}`,
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
