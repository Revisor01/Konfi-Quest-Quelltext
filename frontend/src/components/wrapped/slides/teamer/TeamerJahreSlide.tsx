import React from 'react';
import SlideBase from '../SlideBase';
import { useCountUp } from '../../../../hooks/useCountUp';
import type { SlideProps, TeamerEngagementSlide } from '../../../../types/wrapped';

interface TeamerJahreSlideProps extends SlideProps {
  engagement: TeamerEngagementSlide;
}

const TeamerJahreSlide: React.FC<TeamerJahreSlideProps> = ({ isActive, engagement }) => {
  const animatedCount = useCountUp(engagement.jahre_aktiv, isActive);

  const formattedDate = new Date(engagement.teamer_seit).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <SlideBase isActive={isActive} className="teamer-jahre-slide">
      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label">Dein Engagement</p>
      </div>
      <div className="wrapped-anim-number-pop wrapped-anim-delay-1">
        <p className="wrapped-big-number">{animatedCount}</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-1">
        <p className="wrapped-subtitle">{engagement.jahre_aktiv === 1 ? 'Jahr als Teamer:in' : 'Jahre als Teamer:in'}</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-2">
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', marginTop: '16px' }}>
          Dabei seit {formattedDate}
        </p>
      </div>
    </SlideBase>
  );
};

export default TeamerJahreSlide;
