import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_HERZ } from '../../shared/icons';
import SlideBase from './SlideBase';
import type { SlideProps } from '../../../types/wrapped';

/**
 * Die vorletzte Seite eines Konfi-Rueckblicks: die Einladung ins Team.
 *
 * WARUM EINE EIGENE SEITE: Die Einladung stand bisher als kleine Zeile unter
 * der Bilanz auf der Abschluss-Seite -- zwischen Punkten, Terminen und
 * Abzeichen ging sie unter. Als eigene Seite ist sie das, was haengen
 * bleibt.
 *
 * TON: Einladend, nicht werbend. Es ist eine Kirchen-App, kein
 * Mitgliederwerbe-Formular. Deshalb keine Handlungsaufforderung mit
 * Ausrufezeichen, sondern eine offene Tuer -- und ein konkreter erster
 * Schritt, der niemanden ueberfordert: eine Nachricht schreiben.
 */
const WerdeTeamerSlide: React.FC<SlideProps> = ({ isActive }) => (
  <SlideBase isActive={isActive} className="werde-teamer-slide" kachel="werde-teamer">
    <div className="kat-auge">Und jetzt?</div>

    <div className="kat-slogan">
      <span style={{ display: 'block' }}>Bleib</span>
      <span style={{ display: 'block' }}>dabei.</span>
    </div>

    <div className="kat-nachsatz">
      Schreib einfach jemandem aus dem Team. Und gestalte mit —
      die Kirche und den Glauben von morgen.
    </div>

    {/* 22px ist Wrapped-Feinjustierung ausserhalb der Abstands-Skala -- bleibt bewusst roh */}
    <div className="w-einladung" style={{ marginTop: 22 }}>
      <IonIcon icon={ICON_HERZ} />
      <span>Für die, die jetzt anfangen, wo du angefangen hast</span>
    </div>
  </SlideBase>
);

export default WerdeTeamerSlide;
