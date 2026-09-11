import React from 'react';
import SlideBase from './SlideBase';
import type { SlideProps } from '../../../types/wrapped';

/**
 * Die Sonderseite zur Sommerfreizeit 2026 nach Stavanger (Norwegen).
 *
 * Der Text steht dreigeteilt wie auf allen Slogan-Seiten: kleines Auge oben,
 * der Slogan gross, ein Nachsatz darunter.
 *
 * WARUM EINE EIGENE KOMPONENTE UND KEINE KATEGORIE-SEITE: Alle
 * Kategorie-Seiten (KategorieSeiteSlide) tragen eine Zahl -- ihr ganzer
 * Aufbau haengt daran: das Feld `.kat-zahl`, die fuenf Slogan-Stufen nach
 * Zahl (stufeFuer) und der Nachsatz als Funktion von n. Diese Seite hat
 * KEINE Zahl.
 *
 * DIE 14 IST FESTER TEXT, KEINE GERECHNETE ZAHL. Die
 * Fahrt dauerte 14 Tage -- unabhaengig davon, wie oft jemand angehakt
 * wurde. Eine gerechnete Zahl haette bei den meisten "1" ergeben und aus
 * zwei Wochen Norwegen einen einzelnen Haken gemacht. Deshalb steht sie im
 * Nachsatz und nicht gross auf der Seite; hier gibt es nichts zu zaehlen.
 */
const Stavanger2026Slide: React.FC<SlideProps> = ({ isActive }) => (
  <SlideBase isActive={isActive} className="stavanger-slide" kachel="stavanger-2026">
    <div className="kat-auge">Stavanger 2026</div>

    <div className="kat-slogan">
      <span style={{ display: 'block' }}>Du warst</span>
      <span style={{ display: 'block' }}>dabei.</span>
    </div>

    <div className="kat-nachsatz">
      14 unvergessliche Tage in Himmel og Hav.
    </div>
  </SlideBase>
);

export default Stavanger2026Slide;
