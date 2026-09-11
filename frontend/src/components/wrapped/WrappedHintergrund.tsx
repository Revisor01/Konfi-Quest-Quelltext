import React from 'react';
import { hintergrundFuer, zweitbildFuer } from './hintergrundbilder';

interface Props {
  /** Schlüssel der Kachel, z. B. 'intro' oder 'highlight'. */
  kachel: string;
  /**
   * Der Farbverlauf der Seite als CSS-Wert. Er wird als halbtransparenter
   * Schleier über die Bilder gelegt, damit der Text lesbar bleibt und die
   * Fotos farblich zur Seite gehören.
   */
  verlauf: string;
  /** Zugewiesenes Hauptmotiv (aus der Verteilung). Ohne Angabe die feste Zuordnung. */
  haupt?: string;
  /** Zugewiesenes Zweitmotiv. */
  zweit?: string;
}

/**
 * Der bebilderte Hintergrund einer Rückblick-Seite.
 *
 * Warum nicht flächig: Ein Vollbild-Foto zwingt zu einer harten Abdunklung,
 * sonst wird weißer Text auf hellen Stellen unlesbar -- und dann sieht man
 * vom Bild ohnehin nichts mehr. Als Form in der Ecke trägt es Textur, ohne
 * je hinter den Text zu geraten.
 *
 * Kacheln ohne zugeordnetes Motiv (Punkte, Abschluss) bekommen nur den
 * Verlauf: Dort trägt die große Zahl die Seite, ein Bild würde mit ihr um
 * dieselbe Aufmerksamkeit konkurrieren.
 */
const WrappedHintergrund: React.FC<Props> = ({ kachel, verlauf, haupt, zweit: zweitProp }) => {
  // Die Verteilung hat Vorrang -- sie stellt sicher, dass sich innerhalb
  // eines Rueckblicks kein Motiv wiederholt.
  const bild = haupt || hintergrundFuer(kachel);
  const zweit = zweitProp || zweitbildFuer(kachel);

  return (
    <div className="wrapped-bg" aria-hidden="true">
      {/* Grundverlauf GANZ UNTEN im Container -- nicht auf dem Slide selbst.
          Der Slide darf keinen eigenen Hintergrund haben, weil dieser
          Container auf z-index:-1 dahinter liegt und jede Farbe dort das
          Foto uebermalen wuerde. */}
      <div style={{ position: 'absolute', inset: 0, background: verlauf }} />

      {bild && (
        <div
          className="wrapped-bg-form wrapped-bg-form--oben"
          style={{ backgroundImage: `url(${bild})` }}
        />
      )}
      {zweit && (
        <div
          className="wrapped-bg-form wrapped-bg-form--unten"
          style={{ backgroundImage: `url(${zweit})` }}
        />
      )}

      {/* Farbschleier -- ABGESTUFT, nicht flaechig.

          Zwei Schichten: der Farbschleier der Seite (unten dicht, oben
          fast durchsichtig) und darueber ein neutraler Abdunkler fuer den
          Textbereich. So bleibt weisse Schrift auch auf einem hellen
          Himmel lesbar, ohne das Bild wegzunehmen. */}
      {bild && (
        <>
          <div
            className="wrapped-bg-schleier"
            style={{
              background: verlauf,
              opacity: 0.55,
              // Oben zusaetzlich zurueckgenommen (0.35 -> 0.22): Dort steht
              // kein Text, dort darf das Motiv am staerksten sprechen.
              maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.45) 35%, black 78%)',
              WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.45) 35%, black 78%)',
            }}
          />
          <div
            className="wrapped-bg-schleier"
            style={{
              // Der neutrale Abdunkler unter dem Text wird im Gegenzug
              // KRAEFTIGER (0.28/0.55 -> 0.34/0.66). Er wirkt nur im unteren
              // Drittel und haelt weisse Schrift auch auf einem hellen Himmel
              // lesbar -- genau das, was der Farbschleier vorher nebenbei
              // miterledigt hat.
              background: 'linear-gradient(to bottom, rgba(0,0,0,0) 30%, rgba(0,0,0,0.34) 62%, rgba(0,0,0,0.66) 100%)',
            }}
          />
        </>
      )}
      <div className="wrapped-bg-licht" />
    </div>
  );
};

export default WrappedHintergrund;
