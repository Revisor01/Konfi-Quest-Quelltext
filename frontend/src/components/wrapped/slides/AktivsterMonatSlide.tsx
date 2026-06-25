import React from 'react';
import type { SlideProps, KonfiAktivsterMonatSlide } from '../../../types/wrapped';
import { useCountUp } from '../../../hooks/useCountUp';
import SlideBase from './SlideBase';

interface AktivsterMonatSlideProps extends SlideProps {
  aktivsterMonat: KonfiAktivsterMonatSlide;
}

const AktivsterMonatSlide: React.FC<AktivsterMonatSlideProps> = ({ isActive, aktivsterMonat }) => {
  const animatedCount = useCountUp(aktivsterMonat.aktivitaeten, isActive);

  return (
    <SlideBase isActive={isActive} className="monat-slide">
      <div className="wrapped-anim-fly-left" style={{ opacity: 0 }}>
        <p className="wrapped-label">Dein aktivster Monat</p>
      </div>
      <div className="wrapped-anim-scale wrapped-anim-delay-1" style={{ opacity: 0 }}>
        <p className="wrapped-hero-text">{aktivsterMonat.monat_name}</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-2" style={{ opacity: 0 }}>
        <p className="wrapped-subtitle">{animatedCount} Aktivitaeten</p>
      </div>
      <div className="monat-bar-container wrapped-anim-fade wrapped-anim-delay-3" style={{ opacity: 0 }}>
        <div className="monat-bar">
          <div className="monat-bar-fill" style={{ width: isActive ? '100%' : '0%' }} />
        </div>
      </div>
    </SlideBase>
  );
};

export default AktivsterMonatSlide;
