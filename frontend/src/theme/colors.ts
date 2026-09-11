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
  textSystem: '#8e8e93', // --app-text-system

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

/**
 * Ampel der Admin-Metrikseite (Antwortzeiten/Statuscodes). Interne
 * Diagnoseseite mit eigener, feinerer Abstufung als die Status-Tokens —
 * zentralisiert statt verstreut.
 */
export const METRIK_AMPEL = {
  gut: '#28a745',
  maessig: '#f0ad4e',
  erhoeht: '#fd7e14', // eigener Ampel-Ton; das gleichlautende
  kritisch: '#dc3545', // == --app-color-danger
  blass: '#b0b0b5', // gedaempfte Nebenwerte
} as const;
