import React from 'react';
import { IonIcon } from '@ionic/react';
import { checkmarkCircleOutline } from 'ionicons/icons';
import type { SlideProps, KonfiEndspurtSlide } from '../../../types/wrapped';
import { useCountUp } from '../../../hooks/useCountUp';
import SlideBase from './SlideBase';

interface UeberDasZielSlideProps extends SlideProps {
  endspurt: KonfiEndspurtSlide;
  titel?: string;
}

// 30 Konfetti-Farben (zyklisch)
const KONFETTI_FARBEN = ['#fbbf24', '#f59e0b', '#fcd34d', '#a78bfa', '#ffffff', '#f97316', '#34d399', '#60a5fa'];

const UeberDasZielSlide: React.FC<UeberDasZielSlideProps> = ({ isActive, endspurt, titel }) => {
  const ueberschuss = Math.max(0, endspurt.aktuell_total - endspurt.ziel_total);
  const animatedUeberschuss = useCountUp(ueberschuss, isActive);

  return (
    <SlideBase isActive={isActive} className="ueber-das-ziel-slide">
      <div className="konfetti-container">
        {Array.from({ length: 30 }, (_, i) => (
          <div
            key={i}
            className="konfetti-piece"
            style={{ background: KONFETTI_FARBEN[i % KONFETTI_FARBEN.length] }}
          />
        ))}
      </div>
      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '1rem' }}>
          <IonIcon icon={checkmarkCircleOutline} style={{ fontSize: '1.2rem' }} />
          {titel || 'Geschafft!'}
        </p>
      </div>
      <div className="wrapped-anim-number-pop wrapped-anim-delay-1">
        <p className="wrapped-big-number" style={{
          color: '#fbbf24',
          textShadow: '0 0 60px rgba(251, 191, 36, 0.5)',
        }}>
          +{animatedUeberschuss}
        </p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-1">
        <p className="wrapped-subtitle">Punkte über dem Ziel!</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-2">
        <p style={{ color: 'rgba(252, 211, 77, 0.7)', fontSize: '0.9rem', marginTop: '16px' }}>
          {endspurt.aktuell_total} / {endspurt.ziel_total} Punkte
        </p>
      </div>
    </SlideBase>
  );
};

export default UeberDasZielSlide;
