import React from 'react';
import { IonIcon } from '@ionic/react';
import { flameOutline } from 'ionicons/icons';
import type { SlideProps, KonfiEndspurtSlide } from '../../../types/wrapped';
import { useCountUp } from '../../../hooks/useCountUp';
import SlideBase from './SlideBase';

interface EndspurtSlideProps extends SlideProps {
  endspurt: KonfiEndspurtSlide;
}

const EndspurtSlide: React.FC<EndspurtSlideProps> = ({ isActive, endspurt }) => {
  const animatedFehlend = useCountUp(endspurt.fehlende_punkte, isActive);
  const progressPercent = Math.round((endspurt.aktuell_total / endspurt.ziel_total) * 100);

  return (
    <SlideBase isActive={isActive} className="endspurt-slide">
      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IonIcon icon={flameOutline} style={{ fontSize: '1rem' }} />
          Endspurt!
        </p>
      </div>
      <div className="wrapped-anim-number-pop wrapped-anim-delay-1">
        <p className="wrapped-hero-text" style={{
          textShadow: '0 0 40px rgba(249,115,22,0.4)',
          color: '#fb923c',
        }}>
          {animatedFehlend}
        </p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-1">
        <p className="wrapped-subtitle">Punkte fehlen noch</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-2" style={{ width: '100%' }}>
        <div className="endspurt-progress">
          <div className="endspurt-progress-bar">
            <div
              className="endspurt-progress-fill"
              style={{ width: isActive ? `${progressPercent}%` : '0%' }}
            />
          </div>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', marginTop: '8px' }}>
            {endspurt.aktuell_total} von {endspurt.ziel_total} Punkten
          </p>
        </div>
      </div>
      <div className="wrapped-anim-bounce wrapped-anim-delay-3">
        <p style={{ color: '#fbbf24', fontSize: '1.3rem', fontWeight: 700, marginTop: '24px' }}>
          Du schaffst das!
        </p>
      </div>
    </SlideBase>
  );
};

export default EndspurtSlide;
