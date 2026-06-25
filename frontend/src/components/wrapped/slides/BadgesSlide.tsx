import React from 'react';
import { IonIcon } from '@ionic/react';
import { ribbonOutline } from 'ionicons/icons';
import SlideBase from './SlideBase';
import { getIconFromString } from '../../konfi/views/DashboardSections';
import type { SlideProps, KonfiBadgesSlide } from '../../../types/wrapped';

interface BadgesSlideProps extends SlideProps {
  badges: KonfiBadgesSlide;
}

const BadgesSlide: React.FC<BadgesSlideProps> = ({ isActive, badges }) => {
  return (
    <SlideBase isActive={isActive} className="badges-slide">
      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IonIcon icon={ribbonOutline} style={{ fontSize: '1rem' }} />
          Deine Badges
        </p>
      </div>
      <div className="wrapped-anim-number-pop wrapped-anim-delay-1">
        <p className="wrapped-big-number">{badges.total_earned}</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-1">
        <p className="wrapped-subtitle">von {badges.total_available} verdient</p>
      </div>
      <div className="badges-grid wrapped-anim-fade wrapped-anim-delay-2">
        {badges.badges.slice(0, 6).map((badge, i) => (
          <div key={i} className="badge-item wrapped-anim-bounce" style={{ animationDelay: `${0.4 + i * 0.12}s` }}>
            <div className="badge-icon" style={{ background: badge.color || '#7c3aed' }}>
              <IonIcon icon={getIconFromString(badge.icon)} />
            </div>
            <span className="badge-name">{badge.name}</span>
          </div>
        ))}
      </div>
    </SlideBase>
  );
};

export default BadgesSlide;
