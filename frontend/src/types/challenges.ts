// Typen für das Challenges-Feature (Konfi-Sicht + Leitungs-Verwaltung).
//
// Quelle: SPEC Challenges 2.0 (Datenmodell + API-Vertrag). Der Status einer
// Challenge ist NICHT gespeichert, sondern wird aus is_draft/starts_at/ends_at
// abgeleitet (siehe getChallengeStatus in admin/views/ChallengesManageView).

export type ChallengeType = 'wahrnehmung' | 'beitrag' | 'praxis' | 'frei';

export type ChallengeVisibility = 'public' | 'konfi_choice' | 'private';

/**
 * Teilnahme-Kreis (Migration 121) — WER einreichen darf. Nicht zu verwechseln
 * mit ChallengeVisibility, die regelt, wer die Beitraege SIEHT.
 * 'nur_team' läuft org-weit über die Rolle, ohne Jahrgangs-Zuordnung.
 */
export type ChallengeAudience = 'konfis' | 'konfis_und_team' | 'nur_team';

export type ChallengeMediaType = 'text' | 'photo' | 'audio' | 'video' | 'link';

/** Nur bei visibility = 'konfi_choice' relevant. */
export type ChallengeConsent = 'publish' | 'private' | 'anonymous';

export type ChallengeModerationStatus = 'pending' | 'approved' | 'hidden';

/** Abgeleiteter Status (keine Datenbank-Spalte). */
export type ChallengeStatus = 'draft' | 'scheduled' | 'active' | 'ended';

export interface ChallengeJahrgang {
  id: number;
  name: string;
}

/** Gemeinsame Felder aus der Tabelle challenges. */
export interface ChallengeBase {
  id: number;
  title: string;
  description: string;
  challenge_type: ChallengeType;
  /** Teilnahme-Kreis; fehlt bei Alt-Daten -> wie 'konfis' behandeln. */
  audience?: ChallengeAudience;
  visibility: ChallengeVisibility;
  moderated: boolean;
  allowed_media: ChallengeMediaType[];
  allow_multiple: boolean;
  badge_icon: string;
  badge_name: string;
  author_user_id?: number | null;
  author_freetext?: string | null;
  /** Vom Backend aufgeloester Name des Urhebers (bei author_user_id). */
  author_display_name?: string | null;
  starts_at: string;
  ends_at: string;
  is_draft: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Challenge in der Leitungs-Sicht (GET /challenges/admin) — inklusive Entwuerfen,
 * Jahrgangszuordnung und Zaehlern.
 */
export interface AdminChallenge extends ChallengeBase {
  jahrgaenge?: ChallengeJahrgang[];
  submission_count?: number;
  pending_count?: number;
  /** Nach dem Start gesperrt (Backend-Urteil, hat Vorrang vor lokaler Ableitung). */
  locked?: boolean;
  /** Vom Backend aufgeloester Urheber-Name (COALESCE aus display_name/author_freetext). */
  author_name?: string | null;
  /** Roh-Status vom Backend, falls mitgeliefert (Ableitung bleibt getChallengeStatus). */
  status?: string;
  /**
   * Eigene Teilnahme — seit der Zusammenlegung von "Verwalten" und "Mitmachen"
   * (11.08.) liefert GET /challenges/admin diese Felder mit, damit EINE Liste
   * Verwaltung UND eigene Beitraege zeigen kann.
   */
  has_badge?: boolean;
  own_submission_count?: number;
}

/**
 * Ein Beitrag. In der Konfi-Galerie fehlen bewusst Felder (bei anonymen
 * Beitraegen liefert das Backend gar keinen Namen mit).
 */
export interface ChallengeSubmission {
  id: number;
  challenge_id?: number;
  user_id?: number;
  media_type: ChallengeMediaType;
  text_content?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  link_url?: string | null;
  /** Vom Server beim Einreichen einmalig geholt (Musikdienst-Metadaten).
      Alt-Beitraege haben null — die Anzeige faellt dann auf die Domain zurueck. */
  link_title?: string | null;
  link_author?: string | null;
  link_album?: string | null;
  konfi_consent?: ChallengeConsent | null;
  moderation_status: ChallengeModerationStatus;
  /**
   * Optionale Begründung der Leitung beim Ausblenden — sieht die einreichende
   * Person bei ihrem eigenen Beitrag. Wird beim Freigeben/Wieder-Einblenden
   * serverseitig geleert.
   */
  moderation_note?: string | null;
  created_at: string;
  /** Nur Leitungs-Sicht bzw. nicht-anonyme Galerie-Beitraege. */
  konfi_name?: string | null;
  jahrgang_name?: string | null;
  /**
   * Rolle des Verfassers (Galerie) — macht Team-Beitraege erkennbar.
   * Bei anonymen Beitraegen liefert das Backend NULL.
   */
  role_name?: string | null;
}

/**
 * Eine Galerie-Zeile, wie sie GET /challenges/konfi/:id liefert.
 *
 * Der Name kommt dort als `display_name` (bei anonymen Beitraegen NULL) —
 * NICHT als `konfi_name`, den die Oberflaeche liest. Deshalb wird er beim
 * Laden auf konfi_name normalisiert; ohne das erschien jeder Galerie-Beitrag
 * als "Anonym". Ein `moderation_status` gibt es hier nicht: in der Galerie
 * stehen ausschliesslich freigegebene Beitraege.
 */
export interface ChallengeGalerieZeile {
  id: number;
  media_type: ChallengeMediaType;
  text_content?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  link_url?: string | null;
  link_title?: string | null;
  link_author?: string | null;
  link_album?: string | null;
  created_at: string;
  display_name?: string | null;
  role_name?: string | null;
  jahrgang_name?: string | null;
  is_anonymous?: boolean;
  /** Wird im Frontend aus display_name abgeleitet. */
  konfi_name?: string | null;
}

/** Eigener Challenge-Stempel (bewusst ohne Zähler/Fortschritt). */
export interface ChallengeMark {
  challenge_id: number;
  badge_icon: string;
  badge_name: string;
  title: string;
}

/** Challenge in der Konfi-Übersicht (GET /challenges/konfi). */
export interface KonfiChallenge extends ChallengeBase {
  /** Hat der Konfi bereits mindestens einen eigenen Beitrag? */
  has_submission?: boolean;
  own_submission_count?: number;
}

export interface KonfiChallengesResponse {
  active: KonfiChallenge[];
  archive: KonfiChallenge[];
  marks: ChallengeMark[];
}

/** Detail-Antwort (GET /challenges/konfi/:id). */
export interface KonfiChallengeDetail extends KonfiChallenge {
  /** Oeffentlich sichtbare Beitraege gemäß Sichtbarkeitslogik. */
  gallery: ChallengeSubmission[];
  /** Eigene Beitraege des Konfi — immer sichtbar, mit Status. */
  own_submissions: ChallengeSubmission[];
}
