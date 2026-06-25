import React from 'react';
import { IonIcon } from '@ionic/react';
import { calendarOutline } from 'ionicons/icons';
import SlideBase from './SlideBase';
import type { SlideProps } from '../../../types/wrapped';

interface KonfirmationsSlideProps extends SlideProps {
  zeitraumEnde: string;
  displayName: string;
}

const KonfirmationsSlide: React.FC<KonfirmationsSlideProps> = ({ isActive, zeitraumEnde, displayName }) => {
  const endeDate = new Date(zeitraumEnde);
  const now = new Date();
  const diffMs = endeDate.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  const formattedDate = endeDate.toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <SlideBase isActive={isActive} className="konfirmation-slide">
      <div className="wrapped-slide-decoration wrapped-slide-decoration--1" />
      <div className="wrapped-slide-decoration wrapped-slide-decoration--2" />

      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IonIcon icon={calendarOutline} style={{ fontSize: '1rem' }} />
          Deine Konfirmation
        </p>
      </div>
      <div className="wrapped-anim-number-pop wrapped-anim-delay-1">
        <p className="wrapped-hero-text" style={{ fontSize: 'clamp(1.6rem, 7vw, 2.8rem)' }}>
          {formattedDate}
        </p>
      </div>
      <div className="wrapped-anim-bounce wrapped-anim-delay-2">
        <p style={{
          fontSize: '1.3rem',
          fontWeight: 700,
          color: '#fbbf24',
          textShadow: '0 0 30px rgba(251,191,36,0.3)',
          marginTop: '16px',
        }}>
          Es ist bald soweit!
        </p>
      </div>
      {daysRemaining > 0 && (
        <div className="wrapped-anim-fade wrapped-anim-delay-3">
          <p className="wrapped-big-number" style={{ fontSize: 'clamp(2rem, 8vw, 4rem)', marginTop: '12px' }}>
            {daysRemaining}
          </p>
          <p className="wrapped-subtitle">Tage noch</p>
        </div>
      )}
    </SlideBase>
  );
};

export default KonfirmationsSlide;
