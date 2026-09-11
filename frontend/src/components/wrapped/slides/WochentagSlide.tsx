import React from 'react';
import SlideBase from './SlideBase';
import type { SlideProps, KonfiWochentagSlide } from '../../../types/wrapped';

interface WochentagSlideProps extends SlideProps {
  wochentag: KonfiWochentagSlide;
}

/**
 * "Dein Wochentag" -- an welchem Tag die Termine ueberwiegend lagen.
 *
 * Der Wochentag wird im Backend in BERLINER Zeit bestimmt
 * (AT TIME ZONE 'Europe/Berlin'). Ohne das kippte ein Gottesdienst am
 * Sonntagabend je nach Zeitstempel auf Montag -- dieselbe Fehlerklasse wie
 * der Datumsversatz, der schon einmal aus dem 1.9. den 31.8. machte.
 */
const WochentagSlide: React.FC<WochentagSlideProps> = ({ isActive, wochentag }) => (
  <SlideBase isActive={isActive} className="wochentag-slide" kachel="wochentag">
    <div className="kat-auge">Dein Tag</div>
    <div className="kat-slogan">
      <span style={{ display: 'block' }}>Meistens</span>
      <span style={{ display: 'block' }}>{wochentag.name}.</span>
    </div>
    <div className="kat-nachsatz">
      {wochentag.anzahl} von {wochentag.gesamt} Terminen lagen an einem {wochentag.name}.
    </div>
  </SlideBase>
);

export default WochentagSlide;
