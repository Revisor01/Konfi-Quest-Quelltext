import React from 'react';
import { IonIcon } from '@ionic/react';
import SlideBase from '../SlideBase';
import { getIconFromString } from '../../../../utils/badgeIcons';
import { useCountUp } from '../../../../hooks/useCountUp';
import type { SlideProps, TeamerBadgesSlide as TeamerBadges } from '../../../../types/wrapped';

interface Props extends SlideProps { badges: TeamerBadges; }

function spruchFuer(n: number): { slogan: string[]; nachsatz: string } {
  if (n >= 10) return { slogan: ['Deine Wand', 'ist', 'voll.'], nachsatz: `${n} Abzeichen für deine Arbeit.` };
  if (n >= 4) return { slogan: ['Man sieht,', 'was du', 'tust.'], nachsatz: `${n} Abzeichen hast du bekommen.` };
  if (n >= 1) return { slogan: ['Anerkannt.'], nachsatz: n === 1 ? 'Ein Abzeichen für deinen Einsatz.' : `${n} Abzeichen für deinen Einsatz.` };
  return { slogan: ['Deine Arbeit', 'zählt', 'trotzdem.'], nachsatz: 'Nicht alles bekommt ein Abzeichen.' };
}

const TeamerBadgesSlide: React.FC<Props> = ({ isActive, badges }) => {
  const animiert = useCountUp(badges.total_earned, isActive, 1400);
  const t = spruchFuer(badges.total_earned);

  return (
    <SlideBase isActive={isActive} className="teamer-badges-slide" kachel="teamer-badges">
      <div className="kat-auge">Deine Abzeichen</div>
      {badges.total_earned > 0 && <div className="kat-zahl">{animiert}</div>}
      <div className="kat-slogan">
        {t.slogan.map((z, i) => <span key={i} style={{ display: 'block' }}>{z}</span>)}
      </div>
      <div className="kat-nachsatz">{t.nachsatz}</div>
      {badges.badges?.length > 0 && (
        <div className="w-abzeichenreihe">
          {badges.badges.slice(0, 6).map((b, i) => (
            <div key={i} className="w-abzeichen wrapped-anim-bounce"
                 style={{ background: b.color || 'var(--app-color-wrapped)', animationDelay: `${0.3 + i * 0.1}s` }} title={b.name}>
              <IonIcon icon={getIconFromString(b.icon)} />
            </div>
          ))}
        </div>
      )}
    </SlideBase>
  );
};

export default TeamerBadgesSlide;
