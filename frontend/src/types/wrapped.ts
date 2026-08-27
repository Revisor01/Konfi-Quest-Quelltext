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
}

export interface KonfiAktivsterMonatSlide {
  monat: number;
  monat_name: string;
  aktivitaeten: number;
}

export interface KonfiChatSlide {
  nachrichten_gesendet: number;
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
}

export interface KonfiGottesdienstSlide {
  count: number;
}

export interface KonfiKategorieSlide {
  verteilung: Array<{ kategorie: string; count: number }>;
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
  | 'ueber_das_ziel';

export interface KonfiWrappedData {
  /** 1 = Alt-Snapshots (History), ab 2 = Challenges-Wrapped. */
  version: number;
  highlight_type: HighlightType;
  formulierung_seed: number;
  slides: {
    punkte: KonfiPunkteSlide;
    events: KonfiEventsSlide;
    badges: KonfiBadgesSlide;
    aktivster_monat: KonfiAktivsterMonatSlide;
    endspurt: KonfiEndspurtSlide;
    zeitraum: KonfiZeitraumSlide;
    kategorie: KonfiKategorieSlide;
    /** Ab Version 2. Bei Version-1-Snapshots nicht vorhanden. */
    challenge_momente?: KonfiChallengeMomenteSlide;
    /** Nur noch Alt-Daten (Version 1), wird nicht mehr gerendert. */
    chat?: KonfiChatSlide;
    /** Nur noch Alt-Daten (Version 1), wird nicht mehr gerendert. */
    gottesdienst?: KonfiGottesdienstSlide;
    /** Backend liefert es weiter, wird aber nicht mehr gerendert. */
    pflicht?: KonfiPflichtSlide;
  };
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
  badges: Array<{ name: string; icon: string; color: string }>;
}

export interface TeamerZertifikateSlide {
  total: number;
  zertifikate: Array<{ name: string; issued_date: string }>;
}

export interface TeamerEngagementSlide {
  teamer_seit: string;
  jahre_aktiv: number;
}

export interface TeamerZeitraumSlide {
  year: number;
}

export interface TeamerWrappedData {
  version: number;
  slides: {
    events_geleitet: TeamerEventsGeleitetSlide;
    konfis_betreut: TeamerKonfisBetreutSlide;
    badges: TeamerBadgesSlide;
    zertifikate: TeamerZertifikateSlide;
    engagement: TeamerEngagementSlide;
    zeitraum: TeamerZeitraumSlide;
  };
}

// --- API Response ---

export interface WrappedResponse {
  data: KonfiWrappedData | TeamerWrappedData;
  computed_at: string;
  year: number;
  wrapped_type: 'konfi' | 'teamer';
}

// --- History ---

export interface WrappedHistoryEntry {
  id: number;
  wrapped_type: 'konfi' | 'teamer';
  year: number;
  data: KonfiWrappedData | TeamerWrappedData;
  computed_at: string;
}

// --- Slide-Props Basis ---

export interface SlideProps {
  isActive: boolean;
}
