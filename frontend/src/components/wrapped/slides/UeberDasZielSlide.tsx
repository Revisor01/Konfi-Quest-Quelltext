import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_ZUSAGE } from '../../shared/icons';
import type { SlideProps, KonfiEndspurtSlide } from '../../../types/wrapped';
import { useCountUp } from '../../../hooks/useCountUp';
import SlideBase from './SlideBase';
import { WRAPPED_KONFETTI } from '../../../theme/colors';

interface UeberDasZielSlideProps extends SlideProps {
  endspurt: KonfiEndspurtSlide;
  titel?: string;
}


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
            style={{ background: WRAPPED_KONFETTI[i % WRAPPED_KONFETTI.length] }}
          />
        ))}
      </div>
      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-kompakt)', fontSize: 'var(--app-text-standard)' }}>
          <IonIcon icon={ICON_ZUSAGE} style={{ fontSize: 'var(--app-text-untertitel)' }} />
          {titel || 'Geschafft!'}
        </p>
      </div>
      <div className="wrapped-anim-number-pop wrapped-anim-delay-1">
        <p className="wrapped-big-number" style={{
          color: 'var(--app-wrapped-gold)',
          textShadow: '0 0 60px rgba(var(--app-wrapped-gold-rgb), 0.5)',
        }}>
          +{animatedUeberschuss}
        </p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-1">
        <p className="wrapped-subtitle">Punkte über dem Ziel!</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-2">
        <p style={{ color: 'rgba(252, 211, 77, 0.7)', fontSize: 'var(--app-text-basis)', marginTop: 'var(--app-abstand-basis)' }}>
          {endspurt.aktuell_total} / {endspurt.ziel_total} Punkte
        </p>
      </div>
    </SlideBase>
  );
};

export default UeberDasZielSlide;
