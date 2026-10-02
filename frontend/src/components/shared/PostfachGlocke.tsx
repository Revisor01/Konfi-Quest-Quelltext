import React from 'react';
import { IonButton, IonIcon } from '@ionic/react';
import { ICON_GLOCKE } from './icons';
import { useBadge } from '../../contexts/BadgeContext';
import { useWartendeVorgaenge } from '../../hooks/useWartendeVorgaenge';
import { oeffnePostfach } from '../../utils/postfach';

/**
 * Wie dringend ist, was hinter der Glocke liegt?
 *
 * Die Stufen fuer die Warteschlange sind wortgleich aus der frueheren
 * WartendeVorgaengeLeiste uebernommen: "Wartend ist Information,
 * Fehlschlag ist eine Aufgabe." Solange noch etwas gesendet wird, bleibt es
 * bei orange — auch wenn daneben schon etwas gescheitert ist.
 */
export type GlockeVariante = 'ruhe' | 'hinweis' | 'warning' | 'danger';

export interface GlockeZustand {
  /**
   * Die Zahl an der Glocke: nur die Warteschlange (wartend + gescheitert).
   * Ungelesene Mitteilungen zaehlen hier nicht -- sie zeigen den Punkt.
   */
  anzahl: number;
  /** Mindestens eine ungelesene Mitteilung: ein Punkt statt einer Zahl. */
  punkt: boolean;
  variante: GlockeVariante;
  /** Der volle Satz fuer Vorleseprogramme. */
  text: string;
}

const einzahlMehrzahl = (n: number, einzahl: string, mehrzahl: string): string =>
  `${n} ${n === 1 ? einzahl : mehrzahl}`;

/**
 * Reine Funktion, damit die Regel ohne Rendern pruefbar bleibt.
 *
 * Die Warteschlange behaelt ihre Zahl: Das sind Vorgaenge dieses Geraets
 * (gesendet oder gescheitert), keine Mitteilungen, und die Zahl sagt, wie
 * viel noch offen ist. Liegt etwas in der Warteschlange, steht ihre Zahl
 * (orange/rot) im Kreis -- die dringlichere Nachricht; der Punkt kommt
 * zurueck, sobald sie leer ist. Der Satz fuer Vorleseprogramme nennt
 * beides.
 */
export const glockeZustand = (ungelesen: number, wartend: number, gescheitert: number): GlockeZustand => {
  const anzahl = wartend + gescheitert;
  const punkt = ungelesen > 0;
  let variante: GlockeVariante = 'ruhe';
  if (gescheitert > 0 && wartend === 0) variante = 'danger';
  else if (wartend > 0) variante = 'warning';
  else if (ungelesen > 0) variante = 'hinweis';

  const warteschlange: string[] = [];
  if (wartend > 0) warteschlange.push(einzahlMehrzahl(wartend, 'Vorgang wird gesendet', 'Vorgänge werden gesendet'));
  if (gescheitert > 0) warteschlange.push(einzahlMehrzahl(gescheitert, 'Vorgang wurde nicht gesendet', 'Vorgänge wurden nicht gesendet'));
  let text: string;
  if (punkt) text = ['Ungelesene Mitteilungen im Postfach', ...warteschlange].join(', ');
  else if (warteschlange.length > 0) text = `Postfach: ${warteschlange.join(', ')}`;
  else text = 'Postfach: nichts Neues';

  return { anzahl, punkt, variante, text };
};

/**
 * Die Glocke in der Kopfzeile. Steht ueber AppKopfzeile auf jeder Seite und
 * oeffnet das eine Postfach (common/PostfachModal), das auf App-Ebene haengt.
 *
 * Zwei Quellen: die ungelesenen Mitteilungen aus dem BadgeContext
 * (GET /notifications/badge-counts, Feld postfach) -- sie zeigen den
 * Punkt -- und die Offline-Warteschlange aus useWartendeVorgaenge, die ihre
 * Zahl behaelt. Beide sitzen mit derselben Mitte auf der Ecke des Symbols
 * (Geometrie in variables.css). Die Farbe tragen nur Kreis und Punkt — die
 * Glocke selbst bleibt in Toolbar-Farbe wie ihre Nachbarn.
 *
 * Gehoert als Kind in IonButtons slot="end"; AppKopfzeile stellt das.
 */
const PostfachGlocke: React.FC = () => {
  const { postfachUngelesen } = useBadge();
  const { wartend, gescheitert } = useWartendeVorgaenge();
  const { anzahl, punkt, variante, text } = glockeZustand(postfachUngelesen, wartend.length, gescheitert.length);

  return (
    <IonButton
      className="app-postfach-glocke"
      data-variante={variante}
      onClick={oeffnePostfach}
      aria-label={`${text} — antippen öffnet das Postfach`}
    >
      <IonIcon slot="icon-only" icon={ICON_GLOCKE} aria-hidden="true" />
      {anzahl > 0 ? (
        <span className="app-postfach-glocke__zahl" aria-hidden="true">
          {anzahl > 99 ? '99+' : anzahl}
        </span>
      ) : punkt && (
        <span className="app-ungelesen-punkt app-postfach-glocke__punkt" aria-hidden="true" />
      )}
    </IonButton>
  );
};

export default PostfachGlocke;
