import React from 'react';
import SlideBase from '../SlideBase';
import type { SlideProps, TeamerAnfangSlide as Anfang } from '../../../../types/wrapped';

interface TeamerAnfangSlideProps extends SlideProps {
  anfang: Anfang;
}

/**
 * "Der Anfang" -- der erste Termin des Jahres.
 *
 * Die Termin-Seite zaehlt, wie VIELE es waren. Diese hier erinnert an den
 * EINEN, mit dem es losging -- und steht deshalb davor: erst der Moment,
 * dann die Bilanz.
 */
const monat = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
};

const TeamerAnfangSlide: React.FC<TeamerAnfangSlideProps> = ({ isActive, anfang }) => (
  <SlideBase isActive={isActive} className="teamer-anfang-slide" kachel="teamer-anfang">
    <div className="kat-auge">So fing es an</div>
    <div className="kat-slogan">
      <span style={{ display: 'block' }}>Dein erster</span>
      <span style={{ display: 'block' }}>Termin.</span>
    </div>
    <div className="kat-nachsatz">{anfang.name}</div>
    {monat(anfang.datum) && <div className="kat-fussnote">Am {monat(anfang.datum)}</div>}
  </SlideBase>
);

export default TeamerAnfangSlide;
