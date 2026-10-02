/**
 * WELCHES DATUM EIN PUNKTE-EINTRAG ZEIGT -- eine Regel für alle Listen.
 *
 * Event-Punkte zeigen deshalb das Datum des Termins (`event_date`), Aktivitäten
 * ihr Aktivitätsdatum, Bonuspunkte ihr Datum. Fehlt das Eventdatum (Antwort
 * eines älteren Servers), gilt das Verbuchungsdatum wie bisher.
 *
 * Die Server liefern ihre Listen nach Verbuchung sortiert -- das bleibt so,
 * weil die Apps im Store das Verbuchungsdatum anzeigen und ihre Liste sonst
 * nicht mehr chronologisch wirkte. Wer das Eventdatum zeigt, ordnet deshalb
 * selbst nach dem angezeigten Datum, neueste zuerst.
 *
 * Genutzt von: Events-Abschnitt und Konfi-Historie der Leitungs-Detailansicht
 * (KonfiDetailSections.tsx) und dem Punkte-Verlauf (PointsHistoryModal.tsx,
 * Konfi-Profil, Konfi-Startseite und Teamer-Konfi-Statistik).
 */
export interface MitPunkteDatum {
  /** Datum des Termins (nur Event-Punkte; sonst null oder fehlend). */
  event_date?: string | null;
  /** Mischlisten (Punkte-Verlauf): Aktivitäts-, Bonus- bzw. Verbuchungsdatum. */
  date?: string | null;
  /** Event-Punkte-Liste der Leitung: Verbuchungsdatum. */
  awarded_date?: string | null;
}

/** Das anzuzeigende Datum: Eventdatum, sonst das Datum des Eintrags. */
export const punkteAnzeigeDatum = (eintrag: MitPunkteDatum): string =>
  eintrag.event_date || eintrag.date || eintrag.awarded_date || '';

const zeit = (eintrag: MitPunkteDatum): number => {
  const t = new Date(punkteAnzeigeDatum(eintrag)).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** Neue Liste, nach dem angezeigten Datum absteigend (stabil bei Gleichstand). */
export const nachAnzeigeDatumAbsteigend = <T extends MitPunkteDatum>(liste: readonly T[]): T[] =>
  [...liste].sort((a, b) => zeit(b) - zeit(a));
