import React from 'react';
import SlideBase from '../SlideBase';
import type { SlideProps } from '../../../../types/wrapped';

interface Props extends SlideProps {
  gestellt: number;
  titel?: string[];
}

/**
 * Was du dem Jahrgang aufgegeben hast.
 *
 * NICHT ZU VERWECHSELN mit der Beitrags-Seite ('teamer-challenge-beitraege'):
 * Die zaehlt, wo man selbst mitgemacht hat. Hier geht es um die Challenge --
 * den Einfall, den jemand aufgeschrieben und weitergegeben hat.
 *
 * DIE SCHWELLE VON DREI ist der Grund, warum der Ton hier ohne Abstufung
 * auskommt: Wer die Seite sieht, hat mindestens drei gestellt.
 */
const TeamerChallengesSlide: React.FC<Props> = ({ isActive, gestellt, titel }) => {
  const gezeigt = (titel || []).filter(Boolean);

  return (
    <SlideBase isActive={isActive} className="teamer-challenges-slide" kachel="teamer-challenges">
      <div className="kat-auge">Deine Challenges</div>
      <div className="kat-zahl">{gestellt}</div>
      <div className="kat-slogan">
        <span style={{ display: 'block' }}>Aufgaben,</span>
        <span style={{ display: 'block' }}>die du</span>
        <span style={{ display: 'block' }}>gestellt hast.</span>
      </div>

      {gezeigt.length > 0 && (
        <div className="w-merkzettel">
          <span className="w-merkzettel__label">
            {gestellt > gezeigt.length ? 'Zuletzt' : 'Und zwar'}
          </span>
          <span className="w-merkzettel__wert">{gezeigt.join(' · ')}</span>
        </div>
      )}

      <div className="kat-nachsatz">
        Ohne dich hätte der Jahrgang nichts davon zu tun gehabt.
      </div>
    </SlideBase>
  );
};

export default TeamerChallengesSlide;
