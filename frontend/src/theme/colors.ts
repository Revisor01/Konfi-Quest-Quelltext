/**
 * Zentrale Farbkonstanten fuer JS-Kontexte.
 *
 * WARUM eine zweite Quelle neben theme/variables.css? CSS-Variablen
 * funktionieren nicht ueberall: SVG-Praesentationsattribute (stroke/fill),
 * die QR-Bibliothek, und alle Stellen, die aus einer Farbe per
 * Alpha-Suffix (`${farbe}40`) oder hexToRgb einen abgeleiteten Wert
 * rechnen, brauchen echte Hexwerte zur Laufzeit.
 */

/** Spiegel von --app-color-* bzw. --app-text-* aus variables.css. */
export const FARBEN = {
  // Domaenen-Farben
  events: '#dc2626', // --app-color-events
  eventsDunkel: '#b91c1c', // --app-color-events-dunkel
  activities: '#047857', // --app-color-activities
  activitiesDunkel: '#065f46', // --app-color-activities-dunkel
  konfis: '#5b21b6', // --app-color-konfis
  konfisDunkel: '#4c1d95', // --app-color-konfis-dunkel
  teamer: '#be185d', // --app-color-teamer
  teamerDunkel: '#831843', // --app-color-teamer-dunkel
  challenges: '#4f46e5',
  challengesDunkel: '#4338ca', // --app-color-challenges-dunkel
  users: '#667eea', // --app-color-users
  usersDunkel: '#5a67d8', // --app-color-users-dunkel
  badges: '#f59e0b', // --app-color-badges
  badgesDunkel: '#d97706', // --app-color-badges-dunkel
  jahrgang: '#007aff', // --app-color-jahrgang
  jahrgangDunkel: '#0066d6', // --app-color-jahrgang-dunkel
  categories: '#0ea5e9', // --app-color-categories
  categoriesDunkel: '#0284c7', // --app-color-categories-dunkel
  level: '#ec4899', // --app-color-level
  levelDunkel: '#db2777', // --app-color-level-dunkel
  chat: '#06b6d4', // --app-color-chat
  chatDunkel: '#0891b2', // --app-color-chat-dunkel
  material: '#d97706', // --app-color-material
  materialDunkel: '#b45309', // --app-color-material-dunkel
  wrapped: '#7c3aed', // --app-color-wrapped
  wrappedDunkel: '#6d28d9', // --app-color-wrapped-dunkel

  // Punkte-Typen
  gottesdienst: '#3b82f6', // --app-color-gottesdienst
  gemeinde: '#059669', // --app-color-gemeinde

  // Status
  danger: '#dc3545', // --app-color-danger
  warning: '#ff9500', // --app-color-warning
  success: '#34c759', // --app-color-success
  successStrong: '#059669', // --app-color-success-strong
  successFresh: '#10b981', // --app-color-success-fresh
  neutral: '#6c757d', // --app-color-neutral (vergangene/neutrale Zustaende)
  neutralHell: '#9ca3af', // --app-color-neutral-hell
  textSystem: '#6e6e73',

  // Medaillen (Abzeichen-Stufen nach Punktewert)
  gold: '#ffd700', // --app-color-gold
  goldHell: '#ffed4e', // --app-color-gold-hell
  silber: '#c0c0c0', // --app-color-silber
  silberHell: '#e8e8e8', // --app-color-silber-hell
  bronze: '#cd7f32', // --app-color-bronze
  bronzeHell: '#deb887', // --app-color-bronze-hell

  // Fallback fuer Abzeichen/Level ohne eigene Farbe (Wert == users)
  abzeichenFallback: '#667eea', // --app-color-users
} as const;

/**
 * Abzeichen-Kriterienfarben als FLAECHE.
 *
 * Spiegel von --app-color-kriterium-<typ> in variables.css. Hexwerte, weil
 * die Aufrufer daraus rechnen: Alpha-Suffix (`${farbe}40`), SVG-stroke im
 * Fortschrittsring und die Vorgabe fuer die gespeicherte Badge-Farbe (die
 * Datenbank und die Store-Apps kennen nur Hex). In beiden Modi gleich;
 * als SCHRIFT gilt getCriteriaTextColor() in utils/badgeCriteria.ts.
 * Schluessel = criteria_type; `standard` ist der Rueckfall (== users).
 */
export const KRITERIUM_FARBEN = {
  total_points: '#ffd700', // --app-color-kriterium-total-points
  gottesdienst_points: '#ff9500', // --app-color-kriterium-gottesdienst-points
  gemeinde_points: '#059669', // --app-color-kriterium-gemeinde-points
  bonus_points: '#ff6b9d', // --app-color-kriterium-bonus-points
  both_categories: '#5856d6', // --app-color-kriterium-both-categories
  activity_count: '#3880ff', // --app-color-kriterium-activity-count
  unique_activities: '#10dc60', // --app-color-kriterium-unique-activities
  activity_combination: '#7044ff', // --app-color-kriterium-activity-combination
  category_activities: '#0cd1e8', // --app-color-kriterium-category-activities
  category_combination: '#0891b2', // --app-color-kriterium-category-combination
  specific_activity: '#ffce00', // --app-color-kriterium-specific-activity
  streak: '#eb445a', // --app-color-kriterium-streak
  time_based: '#8e8e93', // --app-color-kriterium-time-based
  event_count: '#e63946', // --app-color-kriterium-event-count
  mandatory_event_count: '#b91c1c', // --app-color-kriterium-mandatory-event-count
  teamer_year: '#5b21b6', // --app-color-kriterium-teamer-year
  standard: '#667eea', // --app-color-kriterium-standard
} as const;

/**
 * QR-Codes: Die qrcode-Bibliothek malt selbst (Canvas/SVG-Attribute) und
 * kann keine CSS-Variablen aufloesen — deshalb echte Hexwerte.
 */
export const QR_FARBEN = { dunkel: '#000000', hell: '#ffffff' } as const;

/**
 * Aktivitaets-Ringe (ActivityRings): SVG-stroke-Attribute, CSS-Variablen
 * werden dort vom Browser nicht aufgeloest. Werte unveraendert aus der
 * bisherigen Inline-Palette uebernommen.
 * total == --app-color-badges, gottesdienst == --app-color-gottesdienst,
 * gemeinde == --app-color-gemeinde; Dark/Bright sind Ringschattierungen.
 */
export const RING_FARBEN = {
  total: '#f59e0b',
  totalDark: '#b45309',
  totalBright: '#fbbf24',
  gottesdienst: '#3b82f6',
  gottesdienstDark: '#1d4ed8',
  gottesdienstBright: '#60a5fa',
  gemeinde: '#059669',
  gemeindeDark: '#047857',
  gemeindeBright: '#34d399',
  background: 'rgba(255, 255, 255, 0.12)',
} as const;

/**
 * Konfetti der Wrapped-Folie "Ueber das Ziel" — dekorative Folien-Palette,
 * bewusst KEINE Semantik-Tokens (die Folien sind eigenstaendig gestaltet).
 */
export const WRAPPED_KONFETTI = [
  '#fbbf24', '#f59e0b', '#fcd34d', '#a78bfa',
  '#ffffff', '#f97316', '#34d399', '#60a5fa',
] as const;

export const METRIK_AMPEL = {
  gut: 'var(--app-color-success-klassisch)',
  maessig: 'var(--app-color-ampel-maessig)',
  erhoeht: 'var(--app-color-ampel-erhoeht)', // eigener Ampel-Ton; das
  kritisch: 'var(--app-color-danger)',
  blass: 'var(--app-color-ampel-blass)', // gedaempfte Nebenwerte
} as const;
