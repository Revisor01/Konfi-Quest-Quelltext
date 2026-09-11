/**
 * Farbe und Symbol je Badge-Kriterientyp — gemeinsame Quelle für die
 * Badge-Liste (admin/BadgesView) und das Anlege-Formular
 * (admin/modals/BadgeManagementModal).
 *
 * Vorher lagen die Farben nur im Modal und die Symbole nur in der Liste.
 * Dadurch trug ein Kriterium in der Auswahl eine andere Farbe als das
 * fertige Badge in der Liste — die Auswahlliste war pauschal orange
 * (User-Hinweis 11.08.).
 */
import {
  ICON_AKTION_GEFUELLT,
  ICON_FLAMME_GEFUELLT,
  ICON_FUNKELN_GEFUELLT,
  ICON_GOTTESDIENST_GEFUELLT,
  ICON_GRUPPE_GEFUELLT,
  ICON_KATEGORIE_GEFUELLT,
  ICON_LISTE,
  ICON_PRISMA,
  ICON_RASTER_GEFUELLT,
  ICON_SCHILD_GEFUELLT,
  ICON_STATISTIK_GEFUELLT,
  ICON_STERN_GEFUELLT,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT_GEFUELLT,
  ICON_ZUSAGE_GEFUELLT,
} from '../components/shared/icons';

/**
 * Die Zusatzangaben eines Kriteriums (`custom_badges.criteria_extra`).
 *
 * In der Datenbank steht dort JSON, und zwar teils DOPPELT escaped
 * ("{\"days\":30}") — beide Leser parsen deshalb bis zu zweimal. Welche
 * Felder belegt sind, haengt am criteria_type; alle sind darum optional.
 */
export interface BadgeKriteriumExtra {
  /** activity_count: eine bestimmte Aktivitaet. */
  activity_id?: number;
  /** Vom Backend aufgeloester Name zu activity_id. */
  required_activity_name?: string;
  /** activity_combination: mehrere Aktivitaeten, alle noetig. */
  required_activities?: string[];
  /** specific_activities: Auswahl, von der eine Mindestzahl noetig ist. */
  activity_ids?: number[];
  /** category_activities: Name der Kategorie. */
  required_category?: string;
  /**
   * category_combination: mehrere Kategorien, von denen eine Mindestzahl
   * abgedeckt sein muss. Jede Kategorie zaehlt hoechstens einmal — anders als
   * bei category_activities, wo dieselbe Kategorie mehrfach zaehlt.
   */
  required_categories?: string[];
  /** time_based: der gespeicherte Wert — die Anzeige rechnet in Wochen um. */
  days?: number;
  /**
   * time_based, Altbestand: Frueher schrieb das Formular `weeks` direkt in
   * die Zusatzangaben. Neu gespeichert wird immer `days` (weeks * 7); beide
   * Leser nehmen deshalb `days` zuerst und fallen nur fuer alte Datensaetze
   * auf `weeks` zurueck.
   */
  weeks?: number;
}

/** Standardfarbe eines Kriterientyps. Auch die Vorgabe für die Badge-Farbe. */
export const CRITERIA_COLORS: Record<string, string> = {
  total_points: '#ffd700',
  gottesdienst_points: '#ff9500',
  gemeinde_points: '#059669',
  bonus_points: '#ff6b9d',
  both_categories: '#5856d6',
  activity_count: '#3880ff',
  unique_activities: '#10dc60',
  activity_combination: '#7044ff',
  category_activities: '#0cd1e8',
  category_combination: '#0891b2',
  specific_activity: '#ffce00',
  streak: '#eb445a',
  time_based: '#8e8e93',
  event_count: '#e63946',
  mandatory_event_count: '#b91c1c',
  teamer_year: '#5b21b6'
};

const CRITERIA_ICONS: Record<string, string> = {
  total_points: ICON_STATISTIK_GEFUELLT,
  gottesdienst_points: ICON_GOTTESDIENST_GEFUELLT,
  gemeinde_points: ICON_GRUPPE_GEFUELLT,
  specific_activity: ICON_AKTION_GEFUELLT,
  both_categories: ICON_RASTER_GEFUELLT,
  activity_combination: ICON_LISTE,
  category_activities: ICON_KATEGORIE_GEFUELLT,
  category_combination: ICON_PRISMA,
  time_based: ICON_UHRZEIT_GEFUELLT,
  activity_count: ICON_ZUSAGE_GEFUELLT,
  event_count: ICON_TERMIN_GEFUELLT,
  mandatory_event_count: ICON_SCHILD_GEFUELLT,
  bonus_points: ICON_STERN_GEFUELLT,
  streak: ICON_FLAMME_GEFUELLT,
  unique_activities: ICON_FUNKELN_GEFUELLT,
  teamer_year: ICON_TERMIN_GEFUELLT
};

/** Farbe für Kriterientypen ohne eigenen Eintrag (entspricht --app-color-users). */
export const CRITERIA_FALLBACK_COLOR = '#667eea';

export const getCriteriaColor = (criteriaType: string): string =>
  CRITERIA_COLORS[criteriaType] || CRITERIA_FALLBACK_COLOR;

export const getCriteriaIcon = (criteriaType: string): string =>
  CRITERIA_ICONS[criteriaType] || ICON_AKTION_GEFUELLT;
