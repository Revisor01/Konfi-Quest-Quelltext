import React from 'react';
import SlideBase from '../SlideBase';
import type { SlideProps, TeamerKonfiZeitSlide as KonfiZeit } from '../../../../types/wrapped';

interface TeamerKonfiZeitSlideProps extends SlideProps {
  konfiZeit: KonfiZeit;
}

/**
 * "Vom Konfi zur Teamer:in" -- die eigene Geschichte in dieser Gemeinde.
 *
 * WARUM DIESE SEITE: Sie ist die einzige im Rueckblick, die nicht das Jahr
 * erzaehlt, sondern den Weg. Wer heute anderen die Konfi-Zeit gestaltet und
 * sie selbst einmal durchlaufen hat, hat den Kreis geschlossen -- und das
 * ist die schoenste Nachricht, die ein Teamer-Rueckblick tragen kann.
 *
 * KEINE ERFUNDENE HERKUNFT: Die Seite erscheint nur, wenn wirklich eine
 * Konfi-Zeit in DIESER Gemeinde in den Daten steht (konfi_profiles bleibt
 * beim Rollenwechsel stehen). Wer von aussen ins Team kam, bekommt sie
 * nicht.
 *
 * Der Jahrgangsname steht nur da, wenn er bekannt ist -- ohne ihn bleibt es
 * bei der Aussage selbst, statt eine Luecke sichtbar zu machen.
 */
const TeamerKonfiZeitSlide: React.FC<TeamerKonfiZeitSlideProps> = ({ isActive, konfiZeit }) => (
  <SlideBase isActive={isActive} className="teamer-konfi-zeit-slide" kachel="teamer-konfi-zeit">
    <div className="kat-auge">Wie alles anfing</div>
    <div className="kat-slogan">
      <span style={{ display: 'block' }}>Du saßt mal</span>
      <span style={{ display: 'block' }}>auf der</span>
      <span style={{ display: 'block' }}>anderen Seite.</span>
    </div>
    <div className="kat-nachsatz">
      {konfiZeit.jahrgang
        ? `Selbst Konfi im Jahrgang ${konfiZeit.jahrgang} — heute gestaltest du es mit.`
        : 'Selbst Konfi in dieser Gemeinde — heute gestaltest du es mit.'}
    </div>
  </SlideBase>
);

export default TeamerKonfiZeitSlide;
