import React from 'react';
import { IonIcon } from '@ionic/react';
import { sparklesOutline } from 'ionicons/icons';
import SlideBase from './SlideBase';
import type { SlideProps } from '../../../types/wrapped';

interface IntroSlideProps extends SlideProps {
  displayName: string;
  jahrgangName: string;
  year: number;
}

const IntroSlide: React.FC<IntroSlideProps> = ({ isActive, displayName, jahrgangName, year }) => {
  return (
    <SlideBase isActive={isActive} className="intro-slide">
      <div className="wrapped-slide-decoration wrapped-slide-decoration--1" />
      <div className="wrapped-slide-decoration wrapped-slide-decoration--2" />
      <div className="wrapped-slide-decoration wrapped-slide-decoration--3" />

      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IonIcon icon={sparklesOutline} style={{ fontSize: '1rem' }} />
          Willkommen zu deinem
        </p>
      </div>
      <div className="wrapped-anim-fly-left wrapped-anim-delay-1">
        <h1 className="wrapped-hero-text">
          Konfi-<br />
          Jahr<br />
          {year}
        </h1>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-2">
        <p className="wrapped-subtitle" style={{ marginTop: '16px' }}>{displayName}</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-3">
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', marginTop: '4px' }}>{jahrgangName}</p>
      </div>
    </SlideBase>
  );
};

export default IntroSlide;
