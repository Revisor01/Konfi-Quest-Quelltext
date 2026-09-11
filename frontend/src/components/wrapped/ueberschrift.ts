/**
 * Die Ueberschrift eines Rueckblicks.
 *
 * Die Ueberschrift ergibt sich aus dem, was der Rueckblick IST -- sie wird
 * nie eingetippt:
 *
 *   Konfi -> "Deine Konfi-Zeit", und "(bis jetzt)" dazu, solange die
 *            Konfirmation noch mehr als 30 Tage entfernt ist.
 *   Team  -> "Dein Teamerjahr 2026".
 *
 * WARUM DIE 30 TAGE: Der Konfi-Rueckblick laeuft vom Anfang der Konfi-Zeit
 * bis zum Tag seiner Erzeugung. Wird er lange vor der Konfirmation erzeugt,
 * ist er ein Zwischenstand -- der Nachsatz sagt das, ohne dass jemand einen
 * Titel tippen muss. Wird er kurz davor oder danach erzeugt, IST er der
 * Abschluss, und "(bis jetzt)" waere albern. Ein Monat ist die Grenze, an
 * der aus "noch eine Weile hin" ein "gleich soweit" wird.
 *
 * Ohne Konfirmationstermin gibt es nichts, wozu der Rueckblick vorlaeufig
 * waere -- dann steht der Nachsatz nicht da.
 */

/** Tage, ab denen die Konfirmation als "noch weit weg" gilt. */
export const TAGE_BIS_KONFIRMATION = 30;

const MS_PRO_TAG = 24 * 60 * 60 * 1000;

/**
 * Die Ueberschrift eines Konfi-Rueckblicks.
 *
 * @param konfirmation der Konfirmationstermin (ISO-Datum) oder null
 * @param stand        Tag, gegen den gerechnet wird -- der Tag, an dem der
 *                     Rueckblick erzeugt wurde. Bewusst uebergeben und nicht
 *                     `new Date()`: Ein Rueckblick, der im Mai erzeugt wurde,
 *                     muss im November noch dieselbe Ueberschrift tragen.
 * @returns z. B. ["Deine", "Konfi-Zeit"] oder ["Deine", "Konfi-Zeit", "(bis jetzt)"]
 */
export function konfiUeberschrift(
  konfirmation: string | null | undefined,
  stand: string | Date | null | undefined
): string[] {
  const basis = ['Deine', 'Konfi-Zeit'];
  if (!konfirmation) return basis;

  const ziel = new Date(konfirmation);
  const jetzt = stand ? new Date(stand) : new Date();
  if (isNaN(ziel.getTime()) || isNaN(jetzt.getTime())) return basis;

  const tage = Math.floor((ziel.getTime() - jetzt.getTime()) / MS_PRO_TAG);
  return tage > TAGE_BIS_KONFIRMATION ? [...basis, '(bis jetzt)'] : basis;
}

/**
 * Die Ueberschrift eines Team-Rueckblicks -- immer das Kalenderjahr.
 *
 * @param jahr das Jahr des Rueckblicks
 */
export function teamerUeberschrift(jahr: number): string[] {
  return ['Dein', 'Teamerjahr', String(jahr)];
}
