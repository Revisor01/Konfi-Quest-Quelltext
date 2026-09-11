import React from 'react';
import SlideBase from '../SlideBase';
import type { SlideProps } from '../../../../types/wrapped';

interface Props extends SlideProps {
  text: string;
  quelle: string;
}

/**
 * Der Zuspruch -- die Seite, die an die Stelle eines leeren Rueckblicks tritt.
 *
 * KEINE ZAHL AUF DIESER SEITE, und das ist der ganze Punkt: Wer sie sieht,
 * hat im Backend keine Eintraege -- eine Bilanz waere eine Reihe Nullen.
 * Der Text kommt aus dem Snapshot (utils/wrappedSegen.js), damit er beim
 * Wieder-Oeffnen derselbe bleibt.
 */
const TeamerSegenSlide: React.FC<Props> = ({ isActive, text, quelle }) => (
  <SlideBase isActive={isActive} className="teamer-segen-slide" kachel="teamer-segen">
    <div className="kat-auge">Für dich</div>

    <div className="teamer-segen-slide__spruch">„{text}"</div>

    {quelle ? <div className="kat-nachsatz">{quelle}</div> : null}
  </SlideBase>
);

export default TeamerSegenSlide;
