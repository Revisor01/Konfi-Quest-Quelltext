import React from 'react';
import SlideBase from './SlideBase';
import { TEXTE, stufeFuer } from './kategorieSeitenTexte';

/**
 * Die Kategorie- und Datums-Seiten des Rueckblicks.
 *
 * Der erste Entwurf war: kleines Label, riesige Zahl, ein Satz. Das ist eine
 * Statistikkachel, keine Erinnerung. Eine 8 sagt nichts -- "Achtmal Kirche.
 * Und jedes Mal warst du da." schon.
 *
 * DESHALB JETZT:
 *   - Der SLOGAN traegt die Seite, nicht die Zahl (Bebas Neue, gross).
 *   - Die Zahl steht klein darueber als Beiwerk ("8 MAL").
 *   - Darunter ein warmer Nachsatz, der die Zahl einordnet.
 *   - Bei kleinen Zahlen ein ANDERER Text als bei grossen: "Einmal" ist
 *     keine schlechtere 8, sondern eine eigene Geschichte.
 *
 * Bild und Farbverlauf kommen aus SlideBase (hintergrundbilder.ts).
 */

interface Props {
  isActive: boolean;
  /** z. B. 'kategorie:freizeit' oder 'datum:advent' */
  kachel: string;
  anzahl: number;
  ausTerminen?: number;
}


const KategorieSeiteSlide: React.FC<Props> = ({ isActive, kachel, anzahl, ausTerminen }) => {
  const text = TEXTE[kachel];
  // Unbekannter Schluessel: lieber gar nichts zeigen als eine leere Seite.
  if (!text) return null;

  // Farbklasse je Seite ('kategorie:fest' -> 'k-fest', 'datum:advent' ->
  // 'd-advent'). SlideBase liest den Verlauf aus dem CSS und legt ihn als
  // Schleier ueber das Foto -- Farbe und Bild gehoeren zusammen.
  const farbklasse = kachel.startsWith('datum:')
    ? `d-${kachel.slice('datum:'.length)}`
    : kachel.startsWith('kategorie:')
      ? `k-${kachel.slice('kategorie:'.length)}`
      : 'k-allgemein';

  return (
    <SlideBase
      isActive={isActive}
      className={`kategorie-seite-slide ${farbklasse}`}
      kachel={kachel}
    >
      <div className="kat-auge">{text.auge}</div>

      {/* Die Zahl klein und beilaeufig -- sie ordnet ein, traegt aber nicht. */}
      <div className="kat-zahl">
        {anzahl}<span className="kat-zahl__mal">×</span>
      </div>

      {/* Der Slogan traegt die Seite. Zeilenumbrueche stehen im Text und
          sind Absicht: Sie geben den Rhythmus vor. */}
      <div className="kat-slogan">
        {stufeFuer(text.stufen, anzahl).split('\n').map((zeile, i) => (
          <span key={i} style={{ display: 'block' }}>{zeile}</span>
        ))}
      </div>

      <div className="kat-nachsatz">{text.nachsatz(anzahl)}</div>

      {typeof ausTerminen === 'number' && ausTerminen > 0 && ausTerminen < anzahl && (
        <div className="kat-fussnote">
          davon {ausTerminen} {ausTerminen === 1 ? 'Event' : 'Events'}
        </div>
      )}
    </SlideBase>
  );
};

export default KategorieSeiteSlide;
