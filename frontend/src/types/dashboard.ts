export interface Badge {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  criteria_type: string;
  criteria_value: number;
  criteria_activity_id?: number;
  is_hidden?: boolean;
  sort_order?: number;
  awarded_date?: string;
  earned_at?: string;
}

/**
 * Ein Abzeichen, wie es GET /konfi/badges bzw. GET /teamer/badges liefert
 * (utils/konfiBadgeProgress.js: SELECT cb.* plus earned/earned_at/seen und
 * der berechnete Fortschritt).
 *
 * Achtung: Das Feld heisst hier `earned` (boolean), NICHT `is_earned` — die
 * Oberflaeche rechnet es selbst in ihr eigenes Badge-Format um.
 */
export interface ApiBadge {
  id: number;
  name: string;
  description?: string;
  icon: string;
  criteria_type: string;
  criteria_value: number;
  criteria_extra?: string | null;
  is_hidden: boolean;
  is_active: boolean;
  sort_order?: number;
  color?: string;
  earned: boolean;
  earned_at?: string | null;
  seen: boolean;
  /** Vom Server berechnet; fehlt bei Abzeichen ohne zaehlbares Kriterium. */
  progress?: {
    current: number;
    target: number;
    percentage: number;
  };
  /** Bedingung nicht mehr erfuellbar (z.B. Punkteart im Jahrgang aus). */
  unreachable?: boolean;
}

/**
 * Ein Abzeichen in der ANZEIGE-Form der Abzeichen-Seite.
 */
export interface AnzeigeBadge {
  id: number;
  name: string;
  description?: string;
  icon: string;
  criteria_type: string;
  criteria_value: number;
  criteria_extra?: string | null;
  is_hidden: boolean;
  is_active: boolean;
  color?: string;
  is_earned: boolean;
  earned_at?: string | null;
  progress_points?: number;
  progress_percentage?: number;
}

/**
 * Verdiente und noch offene Abzeichen — die beiden Listen aus
 * GET /konfi/badges, wie die Startseite sie durchreicht.
 */
export interface AlleAbzeichen {
  available: ApiBadge[];
  earned: ApiBadge[];
}

/** Antwort von GET /konfi/badges und GET /teamer/badges. */
export interface BadgeUebersicht extends AlleAbzeichen {
  stats: {
    totalVisible: number;
    totalSecret: number;
  };
}

// DashboardEvent ist jetzt ein Re-Export von Event
export type { Event as DashboardEvent } from './event';

/**
 * Ein Eintrag der Ranking-Liste aus GET /konfi/dashboard.
 */
export interface RankingEntry {
  id: number | string;
  display_name: string;
  points: number | null;
  /** Vom Server berechnete Initialen; '??' wenn kein Anzeigename vorliegt. */
  initials?: string;
  /** Erst in der Ansicht gesetzt (Platz, Trenner, eigene Zeile). */
  rank?: number;
  actualRank?: number;
  isCurrentUser?: boolean;
  isNeighbor?: boolean;
}

/** Platzhalter-Zeile ("...") zwischen Platz 1 und der eigenen Umgebung. */
export interface RankingTrenner {
  separator: true;
}

/** Was die Ranking-Liste anzeigt: echte Plaetze und Trennzeilen. */
export type RankingZeile = RankingEntry | RankingTrenner;
