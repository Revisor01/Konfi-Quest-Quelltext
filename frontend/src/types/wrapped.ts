// ========================================
// Konfi Wrapped - TypeScript Interfaces
// Matchen 1:1 die Backend JSONB-Struktur (wrapped_snapshots.data)
// ========================================

// --- Konfi-Snapshot Slides ---

export interface KonfiPunkteSlide {
  gottesdienst: number;
  gemeinde: number;
  total: number;
  bonus: number;
}

export interface KonfiEventsSlide {
  total_attended: number;
  total_available: number;
  lieblings_event: { name: string; date: string } | null;
  abgesagt?: number;
}

export interface KonfiBadgesSlide {
  total_earned: number;
  total_available: number;
  badges: Array<{ name: string; icon: string; color: string }>;
  seltenstes?: {
    name: string;
    icon: string;
    color: string;
    haben_es: number;
    konfis: number;
    prozent: number;
  } | null;
}

export interface KonfiAktivsterMonatSlide {
  monat: number;
  monat_name: string;
  aktivitaeten: number;
}

export interface KonfiChatSlide {
  nachrichten_gesendet: number;
  /** Ab Version 3. In aelteren Snapshots nicht vorhanden. */
  reaktionen_gegeben?: number;
  reaktionen_bekommen?: number;
}

/** Challenge-Zahlen fuer das Highlight -- ab Version 3. */
export interface KonfiChallengesSlide {
  beitraege: number;
  top_challenge: { title: string; badge_icon: string; count: number } | null;
}

/** Verlaesslichkeit (Selbst-Abmeldungen) -- ab Version 3. */
export interface KonfiVerlaesslichkeitSlide {
  abmeldungen: number;
  nie_abgesagt: boolean;
}

/**
 * Das persoenliche Highlight -- ab Version 3. Der Jahrgangsschnitt ist
 * anonym (nur die Zahl, nie Namen) und wird im Frontend nur gezeigt,
 * wenn der eigene Wert darueber liegt (freundliche Vergleiche only).
 */
export interface KonfiHighlight {
  type: HighlightType;
  wert: number;
  jahrgangsschnitt: number | null;
}

export interface KonfiEndspurtSlide {
  aktiv: boolean;
  fehlende_punkte: number;
  ziel_total: number;
  aktuell_total: number;
}

export interface KonfiZeitraumSlide {
  start: string;
  ende: string;
  /**
   * Der echte Konfirmationstermin, null wenn der Jahrgang keinen hat.
   * Ab Snapshot-Version 2.1. Bei aelteren Snapshots nicht
   * vorhanden -- dort wurde `ende` als Konfirmationstermin gerendert, was
   * ohne Konfirmations-Termin einen erfundenen Stichtag zeigte.
   */
  konfirmation?: string | null;
}

export interface KonfiGottesdienstSlide {
  count: number;
}

export interface KonfiKategorieSlide {
  verteilung: Array<{
    kategorie: string;
    count: number;
    seite?: string | null;
    aus_terminen?: number;
    aus_aktivitaeten?: number;
  }>;
  top_kategorie: string | null;
}

export interface KonfiPflichtSlide {
  besucht: number;
  gesamt: number;
}

/** Ein einzelner Challenge-Beitrag des Konfi (Quelle: challenge_submissions). */
export interface KonfiChallengeMoment {
  challenge_title: string;
  badge_icon: string;
  media_type: 'text' | 'photo' | 'audio' | 'video' | 'link';
  file_path?: string | null;
  file_name?: string | null;
  text_content?: string | null;
  link_url?: string | null;
  /** Musikdienst-Metadaten; in Snapshots vor der Erlaubnisliste nicht enthalten. */
  link_title?: string | null;
  link_author?: string | null;
  link_album?: string | null;
  created_at: string;
}

/** Slide "Deine Momente" — ab Snapshot-Version 2. */
export type KonfiChallengeMomenteSlide = KonfiChallengeMoment[];

export type HighlightType =
  | 'events_held'
  | 'badge_collector'
  | 'chat_champion'
  | 'gottesdienst_treue'
  | 'gemeinde_aktiv'
  | 'ueber_das_ziel'
  // Ab Snapshot-Version 3: persoenliche Highlights aus
  // Chat, Reaktionen, Challenges und Verlaesslichkeit.
  | 'chat_star'
  | 'reaktions_magnet'
  | 'challenge_fan'
  | 'verlaesslich';

export interface KonfiWrappedData {
  /** 1 = Alt-Snapshots (History), ab 2 = Challenges-Wrapped. */
  version: number;
  titel?: string | null;
  kacheln?: string[];
  highlight_type: HighlightType;
  formulierung_seed: number;
  slides: {
    gemeinde?: string | null;
    punkte: KonfiPunkteSlide;
    events: KonfiEventsSlide;
    badges: KonfiBadgesSlide;
    aktivster_monat: KonfiAktivsterMonatSlide;
    endspurt: KonfiEndspurtSlide;
    zeitraum: KonfiZeitraumSlide;
    kategorie: KonfiKategorieSlide;
    /** Ab Version 2. Bei Version-1-Snapshots nicht vorhanden. */
    challenge_momente?: KonfiChallengeMomenteSlide;
    /** Ab Version 3: das persoenliche Highlight dieser Person. */
    highlight?: KonfiHighlight;
    /** Ab Version 3: Challenge-Zahlen fuer die Highlight-Seite. */
    challenges?: KonfiChallengesSlide;
    warteliste?: KonfiWartelisteSlide;
    langer_atem?: KonfiLangerAtemSlide | null;
    wochentag?: KonfiWochentagSlide | null;
    medienarten?: string[];
    /** Ab Version 3: Selbst-Abmeldungen (nur positiv/neutral verwendet). */
    verlaesslichkeit?: KonfiVerlaesslichkeitSlide;
    /**
     * Version 1: nur nachrichten_gesendet, wurde nicht mehr gerendert.
     * Ab Version 3 wieder befuellt (gleicher Typ, zwei Felder mehr) und
     * von der Highlight-Seite verwendet.
     */
    chat?: KonfiChatSlide;
    /** Nur noch Alt-Daten (Version 1), wird nicht mehr gerendert. */
    gottesdienst?: KonfiGottesdienstSlide;
    /** Backend liefert es weiter, wird aber nicht mehr gerendert. */
    pflicht?: KonfiPflichtSlide;
  };
}

export interface KonfiWartelisteSlide {
  nachgerueckt: number;
}

export interface KonfiLangerAtemSlide {
  erster: string;
  letzter: string;
  tage: number;
  termine: number;
}

export interface KonfiWochentagSlide {
  tag: number;
  name: string;
  anzahl: number;
  gesamt: number;
  anteil: number;
}

// --- Teamer-Snapshot Slides ---

export interface TeamerEventsGeleitetSlide {
  total: number;
  meiste_teilnehmer_event: { name: string; teilnehmer: number } | null;
}

export interface TeamerKonfisBetreutSlide {
  total_konfis: number;
  jahrgaenge: string[];
}

export interface TeamerBadgesSlide {
  total_earned: number;
  total_available?: number;
  badges: Array<{ name: string; icon: string; color: string }>;
}

export interface TeamerZertifikateSlide {
  total: number;
  zertifikate: Array<{ name: string; issued_date: string }>;
}

export interface TeamerEngagementSlide {
  // Nullbar: Das Backend liefert null, wenn users.teamer_since nicht gesetzt
  // ist (wrapped.js:446). Der Typ behauptete string und verdeckte damit, dass
  // die Seite "0 Jahre als Teamer:in" anzeigen konnte.
  teamer_seit: string | null;
  jahre_aktiv: number;
}

/** Freigegebene Challenge-Beitraege -- ab Snapshot-Version 3 (Migration 146). */
export interface TeamerModerationSlide {
  freigegeben: number;
}

/** Mit wie vielen anderen zusammen -- ab Snapshot-Version 3. */
export interface TeamerTeamSlide {
  mitstreitende: number;
}

/** Das erste Jahr im Team -- ab Snapshot-Version 3. */
export interface TeamerNeuDabeiSlide {
  erstes_jahr: boolean;
  start_jahr: number | null;
}

/** Der erste Termin des Jahres -- ab Snapshot-Version 3. */
export interface TeamerAnfangSlide {
  name: string;
  datum: string;
}

/** Das erste Abzeichen des Jahres -- ab Snapshot-Version 3. */
/**
 * Das erste Abzeichen eines Teamer-Jahres.
 */
export interface TeamerErstesAbzeichenSlide {
  name: string;
  icon: string;
  color: string;
  datum: string;
}

/** Chat-Zahlen im Teamer-Rueckblick -- ab Snapshot-Version 3. */
export interface TeamerChatSlide {
  antworten: number;
}

/**
 * Die eigene Konfi-Zeit einer Teamer:in -- ab Snapshot-Version 3.
 * null, wenn die Person nicht selbst Konfi in dieser Gemeinde war.
 */
export interface TeamerKonfiZeitSlide {
  jahrgang: string | null;
}

export interface TeamerZeitraumSlide {
  year: number;
  // Additiv ab Snapshot-Version 2: der Zeitraum, auf den die
  // Zahlen des Teamer-Rueckblicks eingegrenzt sind. Version-1-Snapshots
  // haben die Felder nicht -- dort zaehlten die Zahlen noch die gesamte
  // Kontolebenszeit, weshalb sie optional bleiben.
  start?: string;
  ende?: string;
}

export interface TeamerWrappedData {
  version: number;
  /**
   * Die Seiten dieses Rueckblicks in Anzeigereihenfolge, vom Backend
   * gewaehlt (utils/wrappedKacheln.js, waehleTeamerKacheln). Ab
   * Snapshot-Version 3. Fehlt bei aelteren Snapshots -- dann
   * rendert das Frontend wie bisher die feste Siebener-Reihenfolge.
   */
  kacheln?: string[];
  slides: {
    events_geleitet: TeamerEventsGeleitetSlide;
    konfis_betreut: TeamerKonfisBetreutSlide;
    badges: TeamerBadgesSlide;
    zertifikate: TeamerZertifikateSlide;
    engagement: TeamerEngagementSlide;
    /** Ab Version 3. Fehlt bei aelteren Snapshots. */
    team?: TeamerTeamSlide;
    /** Ab Version 3. Fehlt bei aelteren Snapshots. */
    moderation?: TeamerModerationSlide;
    /** Ab Version 3. Fehlt bei aelteren Snapshots. */
    neu_dabei?: TeamerNeuDabeiSlide;
    /** Ab Version 3. Fehlt bei aelteren Snapshots. */
    anfang?: TeamerAnfangSlide | null;
    /** Ab Version 3. Fehlt bei aelteren Snapshots. */
    erstes_abzeichen?: TeamerErstesAbzeichenSlide | null;
    /** Ab Version 3. Fehlt bei aelteren Snapshots. */
    chat?: TeamerChatSlide;
    /** Ab Version 3. Fehlt bei aelteren Snapshots. */
    konfi_zeit?: TeamerKonfiZeitSlide | null;
    challenges?: KonfiChallengesSlide;
    challenges_gestellt?: { total: number; titel?: string[] };
    /**
     * Der Zuspruch statt eines leeren Rueckblicks.
     * Steht NUR, wenn fuer die Person im Jahr nichts zusammenkam -- dann
     * traegt `kacheln` die drei Segens-Seiten. Sonst fehlt das Feld.
     */
    segen?: { text: string; quelle: string };
    zeitraum: TeamerZeitraumSlide;
  };
}

// --- API Response ---

export interface WrappedResponse {
  data: KonfiWrappedData | TeamerWrappedData;
  computed_at: string;
  year: number;
  wrapped_type: 'konfi' | 'teamer';
  titel?: string | null;
  ausgabe_id?: number | null;
}

// --- History ---

export interface WrappedHistoryEntry {
  id: number;
  wrapped_type: 'konfi' | 'teamer';
  year: number;
  data: KonfiWrappedData | TeamerWrappedData;
  computed_at: string;
  titel?: string | null;
  ausgabe_id?: number | null;
  freigegeben_at?: string | null;
}

// --- Slide-Props Basis ---

export interface SlideProps {
  isActive: boolean;
}
