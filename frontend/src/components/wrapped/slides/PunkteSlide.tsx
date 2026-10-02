import React from 'react';
import SlideBase from './SlideBase';
import { useCountUp } from '../../../hooks/useCountUp';
import type { SlideProps, KonfiPunkteSlide } from '../../../types/wrapped';

interface PunkteSlideProps extends SlideProps {
  punkte: KonfiPunkteSlide;
}

/**
 * Die Punkte-Seite -- auf die Slogan-Gestaltung umgezogen.
 */

function spruchFuer(total: number): { auge: string; slogan: string[]; nachsatz: string } {
  // 1) Weit ueber dem Ziel
  if (total >= 40) {
    return {
      auge: 'Deine Punkte',
      slogan: ['Du hast', 'gesammelt', 'wie andere', 'Sticker.'],
      nachsatz: 'Das ist eine Menge Konfi-Zeit.'
    };
  }
  // 2) Ziel erreicht
  if (total >= 20) {
    return {
      auge: 'Deine Punkte',
      slogan: ['Da kommt', 'was', 'zusammen.'],
      nachsatz: 'Jeder Punkt steht für ein Event, bei dem du da warst.'
    };
  }
  // 3) Auf dem Weg
  if (total >= 10) {
    return {
      auge: 'Deine Punkte',
      slogan: ['Der Stapel', 'wächst.'],
      nachsatz: 'Zweistellig. Und da kommt noch was.'
    };
  }
  // 4) Angefangen
  if (total >= 3) {
    return {
      auge: 'Deine Punkte',
      slogan: ['Jeder Punkt', 'ist ein Mal', 'dabei.'],
      nachsatz: 'Und dabei sein ist der ganze Punkt.'
    };
  }
  // 5) Ganz am Anfang
  if (total >= 1) {
    return {
      auge: 'Deine Punkte',
      slogan: ['Der Anfang', 'ist', 'gemacht.'],
      nachsatz: total === 1 ? 'Ein Punkt. Der erste zählt am meisten.' : `${total} Punkte stehen schon auf deinem Konto.`
    };
  }
  // Null: keine Zahl, kein Vergleich, kein Vorwurf.
  return {
    auge: 'Deine Punkte',
    slogan: ['Deine', 'Konfi-Zeit', 'fängt', 'gerade erst an.'],
    nachsatz: 'Die Punkte kommen, sobald du dabei bist.'
  };
}

const PunkteSlide: React.FC<PunkteSlideProps> = ({ isActive, punkte }) => {
  const animatedTotal = useCountUp(punkte.total, isActive, 1600);
  const text = spruchFuer(punkte.total);

  return (
    <SlideBase isActive={isActive} className="punkte-slide" kachel="punkte">
      <div className="kat-auge">{text.auge}</div>

      {punkte.total > 0 && (
        <div className="kat-zahl">
          {animatedTotal}<span className="kat-zahl__mal">P</span>
        </div>
      )}

      <div className="kat-slogan">
        {text.slogan.map((zeile, i) => (
          <span key={i} style={{ display: 'block' }}>{zeile}</span>
        ))}
      </div>

      <div className="kat-nachsatz">{text.nachsatz}</div>

      {/* Die Aufteilung bleibt -- sie sagt etwas, das der Spruch nicht sagt. */}
      {punkte.total > 0 && (
        <div className="w-aufteilung">
          <span><b>{punkte.gottesdienst}</b> Gottesdienst</span>
          <span><b>{punkte.gemeinde}</b> Gemeinde</span>
          {punkte.bonus > 0 && <span><b>{punkte.bonus}</b> Bonus</span>}
        </div>
      )}
    </SlideBase>
  );
};

export default PunkteSlide;
