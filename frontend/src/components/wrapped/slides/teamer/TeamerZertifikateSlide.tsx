import React from 'react';
import SlideBase from '../SlideBase';
import { useCountUp } from '../../../../hooks/useCountUp';
import type { SlideProps, TeamerZertifikateSlide as TeamerZertifikateSlideType } from '../../../../types/wrapped';

interface TeamerZertifikateSlideProps extends SlideProps {
  zertifikate: TeamerZertifikateSlideType;
}

const TeamerZertifikateSlide: React.FC<TeamerZertifikateSlideProps> = ({ isActive, zertifikate }) => {
  const animatedCount = useCountUp(zertifikate.total, isActive);

  return (
    <SlideBase isActive={isActive} className="teamer-zertifikate-slide">
      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label">Deine Zertifikate</p>
      </div>
      <div className="wrapped-anim-number-pop wrapped-anim-delay-1">
        <p className="wrapped-big-number">{animatedCount}</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-1">
        <p className="wrapped-subtitle">Zertifikate erhalten</p>
      </div>
      {zertifikate.zertifikate.length > 0 && (
        <div className="teamer-zertifikat-list wrapped-anim-fade wrapped-anim-delay-2">
          {zertifikate.zertifikate.map((z, i) => (
            <div key={i} className="teamer-zertifikat-item">
              <span className="teamer-zertifikat-name">{z.name}</span>
              <span className="teamer-zertifikat-date">
                {new Date(z.issued_date).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </SlideBase>
  );
};

export default TeamerZertifikateSlide;
