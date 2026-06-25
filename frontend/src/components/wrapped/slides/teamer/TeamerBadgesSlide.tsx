import React from 'react';
import { IonIcon } from '@ionic/react';
import SlideBase from '../SlideBase';
import { getIconFromString } from '../../../konfi/views/DashboardSections';
import type { SlideProps, TeamerBadgesSlide as TeamerBadgesSlideType } from '../../../../types/wrapped';

interface TeamerBadgesSlideProps extends SlideProps {
  badges: TeamerBadgesSlideType;
}

const TeamerBadgesSlide: React.FC<TeamerBadgesSlideProps> = ({ isActive, badges }) => {
  return (
    <SlideBase isActive={isActive}>
      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label">Deine Badges</p>
      </div>
      <div className="wrapped-anim-number-pop wrapped-anim-delay-1">
        <p className="wrapped-big-number">{badges.total_earned}</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-1">
        <p className="wrapped-subtitle">verdient</p>
      </div>
      <div className="badges-grid wrapped-anim-fade wrapped-anim-delay-2">
        {badges.badges.slice(0, 6).map((badge, i) => (
          <div key={i} className="badge-item" style={{ animationDelay: `${0.4 + i * 0.1}s` }}>
            <div className="badge-icon" style={{ background: badge.color || '#e11d48' }}>
              <IonIcon icon={getIconFromString(badge.icon)} />
            </div>
            <span className="badge-name">{badge.name}</span>
          </div>
        ))}
      </div>
    </SlideBase>
  );
};

export default TeamerBadgesSlide;
