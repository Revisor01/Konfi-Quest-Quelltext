import React from 'react';
import SlideBase from '../SlideBase';
import { teamerUeberschrift } from '../../ueberschrift';
import type { SlideProps } from '../../../../types/wrapped';

interface Props extends SlideProps {
  year: number;
}

/**
 * Der Abschied nach dem Zuspruch.
 *
 * Er tritt an die Stelle von 'teamer-abschluss': Der fasst Termine, Konfis
 * und Abzeichen zusammen -- also genau die Nullen, um die es hier geht. Eine
 * Uebersicht ueber nichts ist keine bessere Auskunft als eine Seite mit einer
 * Null darauf.
 *
 * Der Dank bleibt derselbe wie im normalen Rueckblick. Er gilt der Person,
 * nicht ihrer Bilanz.
 */
const TeamerSegenAbschlussSlide: React.FC<Props> = ({ isActive, year }) => (
  <SlideBase isActive={isActive} className="teamer-segen-abschluss-slide" kachel="teamer-segen-abschluss">
    <div className="kat-auge">{teamerUeberschrift(year).join(' ')}</div>

    <div className="kat-slogan">
      <span style={{ display: 'block' }}>Danke,</span>
      <span style={{ display: 'block' }}>dass es dich</span>
      <span style={{ display: 'block' }}>gibt.</span>
    </div>

    <div className="kat-nachsatz" style={{ marginTop: 'var(--app-abstand-basis)' }}>
      Ohne Leute wie dich gäbe es keine Konfi-Zeit.
    </div>
  </SlideBase>
);

export default TeamerSegenAbschlussSlide;
