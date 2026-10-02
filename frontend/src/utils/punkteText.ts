/**
 * „1 Punkt", aber „0 Punkte", „2 Punkte" -- an EINER Stelle.
 */

/** „Punkt" bei genau 1, sonst „Punkte" (auch bei 0 und bei Abzügen). */
export const punktWort = (anzahl: number): string => (anzahl === 1 ? 'Punkt' : 'Punkte');

/** Zahl samt passendem Wort: „1 Punkt", „3 Punkte". */
export const punkteText = (anzahl: number): string => `${anzahl} ${punktWort(anzahl)}`;
