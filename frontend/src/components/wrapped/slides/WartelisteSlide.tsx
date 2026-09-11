import React from 'react';
import SlideBase from './SlideBase';
import { useCountUp } from '../../../hooks/useCountUp';
import type { SlideProps, KonfiWartelisteSlide } from '../../../types/wrapped';

interface WartelisteSlideProps extends SlideProps {
  warteliste: KonfiWartelisteSlide;
}

/**
 * "Warteliste-Held:in" -- wie oft jemand nachgerueckt ist.
 *
 * Die Geschichte ist: du hast gewartet, und es hat geklappt. Nicht: du
 * warst zu spaet. Deshalb steht hier das Ergebnis im Vordergrund
 * ("du warst dabei"), nicht das Warten.
 *
 * Die Seite erscheint nur bei einem echten Nachruecken. Buchungen aus der
 * Zeit vor Migration 145 tragen NULL -- das heisst UNBEKANNT, nicht "nein";
 * niemand bekommt die Seite auf Verdacht, und niemandem wird abgesprochen,
 * gewartet zu haben.
 */
function spruchFuer(n: number): { slogan: string[]; nachsatz: string } {
  if (n >= 3) return {
    slogan: ['Du bist', 'drangeblieben.'],
    nachsatz: `${n} Mal bist du von der Warteliste nachgerückt.`,
  };
  if (n === 2) return {
    slogan: ['Zweimal', 'gewartet.', 'Zweimal drin.'],
    nachsatz: 'Beide Male hat es geklappt.',
  };
  return {
    slogan: ['Du hast', 'gewartet.', 'Und warst dabei.'],
    nachsatz: 'Ein Platz wurde frei — und er war deiner.',
  };
}

const WartelisteSlide: React.FC<WartelisteSlideProps> = ({ isActive, warteliste }) => {
  const animiert = useCountUp(warteliste.nachgerueckt, isActive);
  const t = spruchFuer(warteliste.nachgerueckt);

  return (
    <SlideBase isActive={isActive} className="warteliste-slide" kachel="warteliste">
      <div className="kat-auge">Nachgerückt</div>
      {warteliste.nachgerueckt >= 2 && <div className="kat-zahl">{animiert}</div>}
      <div className="kat-slogan">
        {t.slogan.map((z, i) => <span key={i} style={{ display: 'block' }}>{z}</span>)}
      </div>
      <div className="kat-nachsatz">{t.nachsatz}</div>
    </SlideBase>
  );
};

export default WartelisteSlide;
