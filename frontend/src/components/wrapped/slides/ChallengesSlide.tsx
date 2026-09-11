import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_CHALLENGE } from '../../shared/icons';
import { getIconFromString } from '../../../utils/badgeIcons';
import { useCountUp } from '../../../hooks/useCountUp';
import type { SlideProps, KonfiChallengesSlide } from '../../../types/wrapped';
import SlideBase from './SlideBase';

/**
 * Die Challenge-ZAHL des Jahres -- wie oft jemand mitgemacht hat, und wobei
 * am liebsten.
 *
 * Die beiden Seiten erzaehlen VERSCHIEDENES, deshalb wurde die Seite gebaut
 * statt den Schluessel zu streichen:
 *
 *   'challenge-momente' zeigt die BILDER -- bis zu sechs einzelne Beitraege
 *     als Pinnwand. Sie sagt nichts darueber, wie viele es insgesamt waren;
 *     der Rest bleibt dort ausdruecklich ungezaehlt ("und 3 weitere").
 *
 *   'challenges' (diese Seite) zeigt die ZAHL -- alle Beitraege des Jahres,
 *     ungedeckelt, plus die Challenge, bei der jemand am haeufigsten dabei
 *     war. Genau diese beiden Werte (slides.challenges.beitraege und
 *     top_challenge) liegen seit Version 3 in JEDEM Snapshot und wurden
 *     bisher nirgends gezeigt -- ausser jemand zog zufaellig das Highlight
 *     'challenge_fan'. Wer das Highlight nicht zog, sah seine Challenge-Zahl
 *     nie.
 */

interface ChallengesSlideProps extends SlideProps {
  challenges: KonfiChallengesSlide;
}

/**
 * Der Ton richtet sich nach der Menge. "Du warst ueberall dabei" bei einem
 * einzigen Beitrag waere gelogen und faellt sofort auf.
 */
function tonFuer(beitraege: number): { label: string; sub: string } {
  if (beitraege >= 8) {
    return { label: 'Deine Kraftproben', sub: 'Mal hast du mitgemacht — bei fast allem dabei' };
  }
  if (beitraege >= 3) {
    return { label: 'Deine Kraftproben', sub: 'Mal hast du dich getraut' };
  }
  return { label: 'Du hast dich getraut', sub: 'Mal hast du mitgemacht' };
}

const ChallengesSlide: React.FC<ChallengesSlideProps> = ({ isActive, challenges }) => {
  const beitraege = challenges?.beitraege || 0;
  const animiert = useCountUp(beitraege, isActive);
  const top = challenges?.top_challenge || null;
  const ton = tonFuer(beitraege);

  return (
    <SlideBase isActive={isActive} className="challenges-slide" kachel="challenges">
      <div className="wrapped-slide-decoration wrapped-slide-decoration--1" />
      <div className="wrapped-slide-decoration wrapped-slide-decoration--2" />
      <IonIcon icon={ICON_CHALLENGE} className="highlight-bg-icon" aria-hidden="true" />

      <div className="wrapped-anim-fly-left" style={{ opacity: 0 }}>
        <p className="wrapped-label">{ton.label}</p>
      </div>

      <div className="wrapped-anim-bounce wrapped-anim-delay-1" style={{ opacity: 0 }}>
        <p className="wrapped-hero-text">{animiert}</p>
      </div>

      <div className="wrapped-anim-fade wrapped-anim-delay-2" style={{ opacity: 0 }}>
        <p className="wrapped-subtitle">{ton.sub}</p>
      </div>

      {top && (
        <div className="challenges-top wrapped-anim-fade wrapped-anim-delay-3" style={{ opacity: 0 }}>
          <span className="challenges-top__abzeichen">
            <IonIcon icon={getIconFromString(top.badge_icon)} />
          </span>
          <span className="challenges-top__text">
            Am liebsten dabei bei „{top.title}“
          </span>
        </div>
      )}
    </SlideBase>
  );
};

export default ChallengesSlide;
