import React from 'react';
import SlideBase from '../SlideBase';
import type { SlideProps } from '../../../../types/wrapped';

/**
 * "Neu dabei" -- das erste Jahr im Team.
 *
 * Das Gegenstueck zu "seit x Jahren dabei": Wer im ersten Jahr ist, bekommt
 * DIESE Seite statt jener. Beide zugleich waeren dieselbe Auskunft zweimal,
 * einmal davon mit einer 1.
 *
 * Die Seite erscheint nur, wenn das Startjahr wirklich bekannt ist.
 * "Unbekannt" ist nicht "neu" -- wer seit Jahren dabei ist, aber kein
 * Eintrittsdatum hinterlegt hat, darf nicht als Neuling begruesst werden.
 */
const TeamerNeuDabeiSlide: React.FC<SlideProps> = ({ isActive }) => (
  <SlideBase isActive={isActive} className="teamer-neu-dabei-slide" kachel="teamer-neu-dabei">
    <div className="kat-auge">Dein erstes Jahr</div>
    <div className="kat-slogan">
      <span style={{ display: 'block' }}>Du hast</span>
      <span style={{ display: 'block' }}>angefangen.</span>
    </div>
    <div className="kat-nachsatz">
      Dein erstes Jahr im Team — und du warst mittendrin.
    </div>
  </SlideBase>
);

export default TeamerNeuDabeiSlide;
