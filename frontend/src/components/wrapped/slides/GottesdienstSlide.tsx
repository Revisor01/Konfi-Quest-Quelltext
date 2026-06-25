import React from 'react';
import type { SlideProps, KonfiGottesdienstSlide } from '../../../types/wrapped';
import { useCountUp } from '../../../hooks/useCountUp';
import SlideBase from './SlideBase';

interface GottesdienstSlideProps extends SlideProps {
  gottesdienst: KonfiGottesdienstSlide;
  titel?: string;
}

function getMotivation(count: number): string {
  if (count === 0) return 'Der erste Gottesdienst wartet noch auf dich';
  if (count <= 3) return 'Ein guter Anfang!';
  if (count <= 8) return 'Regelmäßig dabei!';
  return 'Beeindruckend treu!';
}

const GottesdienstSlide: React.FC<GottesdienstSlideProps> = ({ isActive, gottesdienst, titel }) => {
  const animatedCount = useCountUp(gottesdienst.count, isActive);

  return (
    <SlideBase isActive={isActive} className="gottesdienst-slide">
      <div className="wrapped-anim-fade" style={{ opacity: 0 }}>
        <p className="wrapped-label">{titel || 'Gottesdienste'}</p>
      </div>
      <div className="wrapped-anim-scale wrapped-anim-delay-1" style={{ opacity: 0 }}>
        <p className="wrapped-big-number">{animatedCount}</p>
        <p className="wrapped-subtitle">Gottesdienste besucht</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-2" style={{ opacity: 0 }}>
        <p style={{ color: '#a78bfa', fontSize: '1.1rem', fontWeight: 600, marginTop: '24px' }}>
          {getMotivation(gottesdienst.count)}
        </p>
      </div>
    </SlideBase>
  );
};

export default GottesdienstSlide;
