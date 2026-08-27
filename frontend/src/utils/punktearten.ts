/**
 * Punktearten: welche sind für eine Konfi überhaupt aktiv?
 *
 * Hintergrund: Pro Jahrgang lässt sich jede der beiden Punktearten
 * ("Gottesdienst", "Gemeinde") abschalten — `jahrgaenge.gottesdienst_enabled`
 * und `jahrgaenge.gemeinde_enabled`, gesetzt in den Jahrgangs-Einstellungen.
 * Das Backend blockt die Vergabe einer abgeschalteten Art mit 400
 * (`checkPointTypeEnabled`), und die Anzeige rechnet sie überall heraus.
 *
 * Deshalb steht die Regel jetzt an EINER Stelle. Wer eine Punkteart zur
 * Auswahl anbietet, benutzt `aktivePunktearten()` oder `istPunkteartAktiv()`
 * statt die Felder selbst zu lesen.
 *
 * Wichtig zur Vorbelegung: Fehlt das Feld (ältere Antwort, unvollständig
 * geladene Daten), gilt die Art als AKTIV. Andernfalls verschwänden bei einem
 * Ladefehler stillschweigend Auswahlmöglichkeiten — schlimmer als eine
 * Fehlermeldung beim Speichern, weil niemand merkt, dass etwas fehlt.
 */

export type Punkteart = 'gottesdienst' | 'gemeinde';

/**
 * Die Felder, die eine Konfi (oder ein Jahrgang) zu den Punktearten mitbringt.
 * Beide sind optional: Nicht jede Antwort des Servers enthält sie.
 */
export interface PunkteartFlags {
  gottesdienst_enabled?: boolean;
  gemeinde_enabled?: boolean;
}

/** Anzeigename einer Punkteart, für Auswahllisten und Meldungen. */
export const PUNKTEART_NAME: Record<Punkteart, string> = {
  gottesdienst: 'Gottesdienst',
  gemeinde: 'Gemeinde',
};

/**
 * Ist diese Punkteart für die gegebenen Daten aktiv?
 *
 * `!== false` statt `=== true`: Ein fehlendes Feld gilt als aktiv (siehe oben).
 */
export const istPunkteartAktiv = (
  flags: PunkteartFlags | null | undefined,
  art: Punkteart
): boolean =>
  art === 'gottesdienst'
    ? flags?.gottesdienst_enabled !== false
    : flags?.gemeinde_enabled !== false;

/**
 * Die aktiven Punktearten in fester Reihenfolge (Gottesdienst, Gemeinde).
 */
export const aktivePunktearten = (
  flags: PunkteartFlags | null | undefined
): Punkteart[] =>
  (['gottesdienst', 'gemeinde'] as Punkteart[]).filter((art) =>
    istPunkteartAktiv(flags, art)
  );

/**
 * Eine sinnvolle Vorbelegung für ein Auswahlfeld.
 *
 * Nimmt den Wunsch-Wert, wenn dessen Art aktiv ist, sonst die erste aktive.
 * Ohne das stand in Modalen eine feste Vorbelegung (`'gemeinde'`) — war
 * ausgerechnet diese Art abgeschaltet, war die Voreinstellung die verbotene.
 */
export const ersteAktivePunkteart = (
  flags: PunkteartFlags | null | undefined,
  wunsch: Punkteart = 'gemeinde'
): Punkteart | null => {
  const aktive = aktivePunktearten(flags);
  if (aktive.length === 0) return null;
  return aktive.includes(wunsch) ? wunsch : aktive[0];
};
