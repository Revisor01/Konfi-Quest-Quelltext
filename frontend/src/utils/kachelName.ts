// kachelName.ts — kuerzt einen Kachel-Namen so, dass er NIE mitten im Wort
// abgeschnitten wird.
//
//   - Schrift verkleinern: "Gottesdienstbesucher" braeuchte 7,15 px, um in
//     79 px zu passen. Selbst ohne jeden seitlichen Innenabstand (94,7 px)
//     sind es 8,57 px — unlesbar, und nur gueltig, bis jemand einen
//     laengeren Namen anlegt.
//   - Mehr Zeilen: hilft nicht. Zu schmal ist die ZEILE, nicht die Spalte.
//     Bei 9 px ueberlaufen immer noch vier Produktionswoerter die 79 px.
//   - text-overflow: ellipsis: greift im `-webkit-box`-Container NICHT bei
//     einem waagerecht ueberlaufenden Einzelwort. Nachgemessen steht dort
//     scrollWidth 124 gegen clientWidth 79 — und es wird hart geschnitten,
//     ohne "…".
//   - overflow-wrap: break-word (der Stand von heute frueh): bricht das Wort
//     zwar um, aber per Definition MITTEN DRIN. Genau das ist der gemeldete
//     Fehler: "Punktemeiste" / "r".
//
// WARUM GEMESSEN UND NICHT NACH ZEICHENZAHL:
// Eine Zeichengrenze waere nur ein grober Naeherungswert. Im Schriftschnitt
// der App ist "W" mit 11,21 px genau 3,6-mal so breit wie "j" mit 3,12 px.
// Eine Grenze, die im schlimmsten Fall haelt, laege bei 6 Zeichen; eine, die
// typisch passt, bei 11. Dazwischen liegt entweder unnoetige Kuerzung oder
// weiterhin ein Ueberlauf. Deshalb wird die Breite tatsaechlich gemessen.
//
// Der volle Name geht nicht verloren: Abzeichen zeigen ihn im Popover
// (BadgePopoverContent), und die Kachel traegt ihn im title-Attribut.

/**
 * Misst die Breite eines Textes in Pixeln. Wird hereingereicht, damit diese
 * Datei ohne DOM testbar bleibt und die Messung an genau einer Stelle steht.
 */
export type Breitenmesser = (text: string) => number;

/** Das Auslassungszeichen. Ein echtes Zeichen, keine drei Punkte. */
export const AUSLASSUNG = '…';

/**
 * Kuerzt EIN Wort so weit, dass es samt Auslassungszeichen in `maxBreite`
 * passt. Passt es ohnehin, bleibt es unangetastet.
 *
 * Die Suche laeuft binaer statt Zeichen fuer Zeichen: Bei einer Kachel sind
 * das wenige Messungen statt zwanzig, und Messen ist der teure Teil (jede
 * Messung zwingt den Browser zum Umbruch-Neuberechnen).
 */
export function wortKuerzen(
  wort: string,
  maxBreite: number,
  miss: Breitenmesser
): string {
  if (!wort) return wort;
  if (miss(wort) <= maxBreite) return wort;

  // Untergrenze 0: Passt nicht einmal ein einzelnes Zeichen samt
  // Auslassung, bleibt nur die Auslassung selbst. Besser ein sichtbares
  // "zu schmal" als ein Wortfragment, das wie ein Name aussieht.
  let unten = 0;
  let oben = wort.length - 1;
  while (unten < oben) {
    const mitte = Math.ceil((unten + oben) / 2);
    if (miss(wort.slice(0, mitte) + AUSLASSUNG) <= maxBreite) {
      unten = mitte;
    } else {
      oben = mitte - 1;
    }
  }
  return wort.slice(0, unten) + AUSLASSUNG;
}

/**
 * Kuerzt jedes zu breite Wort eines Namens einzeln.
 *
 * Wortweise und nicht am ganzen Text: "Gottesdienstbesuch: September" soll
 * zu "Gottesdiens… September" werden und nicht zu "Gottesdienstbesuch:…".
 * Der zweite Teil traegt Bedeutung (welcher Monat) und passt in seine eigene
 * Zeile — ihn wegzuwerfen, weil das erste Wort zu lang ist, waere falsch.
 *
 * Leerraum bleibt erhalten, damit der Umbruch an denselben Stellen greift
 * wie vorher.
 */
export function kachelNameKuerzen(
  name: string,
  maxBreite: number,
  miss: Breitenmesser
): string {
  if (!name) return '';
  if (maxBreite <= 0) return name;
  // Der Trenner bleibt als eigene Gruppe erhalten (split mit Klammer).
  return name
    .split(/(\s+)/)
    .map((teil) => (/^\s+$/.test(teil) ? teil : wortKuerzen(teil, maxBreite, miss)))
    .join('');
}
