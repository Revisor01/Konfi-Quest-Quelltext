import React from 'react';
import { IonIcon } from '@ionic/react';
import SlideBase from './SlideBase';
import { getIconFromString, istEmojiIcon } from '../../../utils/badgeIcons';
import { useCountUp } from '../../../hooks/useCountUp';
import type { SlideProps, KonfiBadgesSlide } from '../../../types/wrapped';

interface BadgesSlideProps extends SlideProps {
  badges: KonfiBadgesSlide;
}

/**
 * Die Abzeichen-Seite -- auf die Slogan-Gestaltung umgezogen.
 *
 * Die Abzeichen selbst bleiben als Reihe: Sie sind Bilder, keine Zahlen,
 * und tragen die Seite mit. Das Verhaeltnis "x von y" steht klein darunter
 * statt als Untertitel unter einer Riesenzahl.
 */

function spruchFuer(verdient: number, gesamt: number): { auge: string; slogan: string[]; nachsatz: string } {
  // 1) Alle -- die Ausnahme
  if (gesamt > 0 && verdient >= gesamt) {
    return {
      auge: 'Deine Abzeichen',
      slogan: ['Alle.', 'Wirklich', 'alle.'],
      nachsatz: 'Da geht nichts mehr — du hast jedes eingesammelt.'
    };
  }
  // 2) Sehr viele
  if (verdient >= 15) {
    return {
      auge: 'Deine Abzeichen',
      slogan: ['Die Wand', 'wird', 'langsam', 'voll.'],
      nachsatz: `${verdient} Stück — das sammelt nicht jede.`
    };
  }
  // 3) Viele
  if (verdient >= 8) {
    return {
      auge: 'Deine Abzeichen',
      slogan: ['Deine', 'Sammlung', 'kann sich', 'sehen lassen.'],
      nachsatz: `${verdient} Stück hast du dir verdient.`
    };
  }
  // 4) Einige
  if (verdient >= 3) {
    return {
      auge: 'Deine Abzeichen',
      slogan: ['Gesammelt', 'wird', 'fleißig.'],
      nachsatz: `${verdient} Abzeichen tragen deinen Namen.`
    };
  }
  // 5) Die ersten
  if (verdient >= 1) {
    return {
      auge: verdient === 1 ? 'Dein Abzeichen' : 'Deine Abzeichen',
      slogan: ['Das erste', 'ist das', 'schönste.'],
      nachsatz: verdient === 1 ? 'Eins hast du — und das zählt.' : `${verdient} hast du schon.`
    };
  }
  return {
    auge: 'Deine Abzeichen',
    slogan: ['Das erste', 'wartet', 'auf dich.'],
    nachsatz: 'Es kommt von ganz allein.'
  };
}

const BadgesSlide: React.FC<BadgesSlideProps> = ({ isActive, badges }) => {
  const animiert = useCountUp(badges.total_earned, isActive, 1400);
  const text = spruchFuer(badges.total_earned, badges.total_available);

  return (
    <SlideBase isActive={isActive} className="badges-slide" kachel="badges">
      <div className="kat-auge">{text.auge}</div>

      {badges.total_earned > 0 && (
        <div className="kat-zahl">
          {animiert}
          {badges.total_available > 0 && (
            <span className="kat-zahl__mal">/{badges.total_available}</span>
          )}
        </div>
      )}

      <div className="kat-slogan">
        {text.slogan.map((zeile, i) => (
          <span key={i} style={{ display: 'block' }}>{zeile}</span>
        ))}
      </div>

      <div className="kat-nachsatz">{text.nachsatz}</div>

      {badges.badges.length > 0 && (
        <div className="w-abzeichenreihe">
          {badges.badges.slice(0, 6).map((badge, i) => (
            <div
              key={i}
              className="w-abzeichen wrapped-anim-bounce"
              style={{ background: badge.color || 'var(--app-color-wrapped)', animationDelay: `${0.3 + i * 0.1}s` }}
              title={badge.name}
            >
              {/* Emoji-Abzeichen als Text. Dieselbe
                  Behandlung wie in SeltenstesAbzeichenSlide: In der Datenbank
                  stehen neben Ionicons-Namen auch Emoji, und
                  getIconFromString kennt sie nicht -- sie landeten
                  ausnahmslos in der Trophaee. Ausgerechnet hier, auf der
                  Seite der gesammelten Abzeichen, sahen damit alle
                  Emoji-Abzeichen gleich aus. */}
              {istEmojiIcon(badge.icon)
                ? <span className="w-abzeichen-emoji">{badge.icon}</span>
                : <IonIcon icon={getIconFromString(badge.icon)} />}
            </div>
          ))}
        </div>
      )}
    </SlideBase>
  );
};

export default BadgesSlide;
