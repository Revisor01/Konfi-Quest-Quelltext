import React from 'react';
import SlideBase from './SlideBase';
import { useCountUp } from '../../../hooks/useCountUp';
import type { SlideProps, KonfiLangerAtemSlide } from '../../../types/wrapped';

interface LangerAtemSlideProps extends SlideProps {
  langerAtem: KonfiLangerAtemSlide;
}

/**
 * "Der lange Atem" -- die Spanne zwischen erstem und letztem Termin.
 *
 * Die Aussage ist "du warst von Anfang bis Ende dabei", nicht "du hast
 * viele Termine". Deshalb steht hier die SPANNE gross und nicht die
 * Menge -- die Menge hat ihre eigene Seite.
 *
 * Die Seite erscheint erst ab fuenf Terminen (Bedingung im Backend): Bei
 * zwei Terminen im September und im Mai waeren es rechnerisch auch 240
 * Tage, aber die Zahl erzaehlte dann das Gegenteil.
 */

/** "14. September" -- ohne Jahreszahl, die Konfi-Zeit ist keine Jahresrechnung. */
function tag(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
}

const LangerAtemSlide: React.FC<LangerAtemSlideProps> = ({ isActive, langerAtem }) => {
  const animiert = useCountUp(langerAtem.tage, isActive);
  const erster = tag(langerAtem.erster);
  const letzter = tag(langerAtem.letzter);

  return (
    <SlideBase isActive={isActive} className="langer-atem-slide" kachel="langer-atem">
      <div className="kat-auge">Vom ersten bis zum letzten Mal</div>
      <div className="kat-zahl">{animiert}</div>
      <div className="kat-slogan">
        <span style={{ display: 'block' }}>Tage lang</span>
        <span style={{ display: 'block' }}>warst du</span>
        <span style={{ display: 'block' }}>dabei.</span>
      </div>
      <div className="kat-nachsatz">
        {erster && letzter
          ? `Vom ${erster} bis zum ${letzter} — die ganze Strecke.`
          : 'Vom ersten bis zum letzten Mal durchgehalten.'}
      </div>
    </SlideBase>
  );
};

export default LangerAtemSlide;
