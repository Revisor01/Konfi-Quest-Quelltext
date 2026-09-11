import React from 'react';
import SlideBase from '../SlideBase';
import type { SlideProps, TeamerEngagementSlide } from '../../../../types/wrapped';

interface Props extends SlideProps { engagement: TeamerEngagementSlide; }

/**
 * Erscheint nur, wenn users.teamer_since gesetzt ist -- sonst stuende hier
 * "0 Jahre als Teamer:in", eine Aussage ueber eine fehlende Angabe.
 */
const TeamerJahreSlide: React.FC<Props> = ({ isActive, engagement }) => {
  const j = engagement.jahre_aktiv;
  const slogan = j >= 5
    ? ['Du gehörst', 'zum', 'Inventar.']
    : j >= 3
      ? ['Ein alter', 'Hase.']
      : j >= 2
        ? ['Schon', 'wieder', 'dabei.']
        : ['Dein erstes', 'Jahr im', 'Team.'];
  const nachsatz = j >= 2
    ? `${j} Jahre begleitest du jetzt schon Konfis.`
    : 'Willkommen im Team — schön, dass du da bist.';

  return (
    <SlideBase isActive={isActive} className="teamer-jahre-slide" kachel="teamer-jahre">
      <div className="kat-auge">Dein Weg</div>
      {j > 0 && <div className="kat-zahl">{j}<span className="kat-zahl__mal">{j === 1 ? ' Jahr' : ' Jahre'}</span></div>}
      <div className="kat-slogan">
        {slogan.map((z, i) => <span key={i} style={{ display: 'block' }}>{z}</span>)}
      </div>
      <div className="kat-nachsatz">{nachsatz}</div>
    </SlideBase>
  );
};

export default TeamerJahreSlide;
