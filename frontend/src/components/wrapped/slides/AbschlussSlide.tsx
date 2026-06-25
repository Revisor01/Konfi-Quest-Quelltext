import React from 'react';
import { IonIcon } from '@ionic/react';
import { heartOutline, peopleOutline, trophyOutline, calendarOutline, ribbonOutline } from 'ionicons/icons';
import type { SlideProps, KonfiWrappedData } from '../../../types/wrapped';
import SlideBase from './SlideBase';

interface AbschlussSlideProps extends SlideProps {
  data: KonfiWrappedData;
  year: number;
}

const AbschlussSlide: React.FC<AbschlussSlideProps> = ({ isActive, data, year }) => {
  const zeitraumEnde = data.slides.zeitraum?.ende;

  return (
    <SlideBase isActive={isActive} className="abschluss-slide">
      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label">Dein Konfi-Jahr {year}</p>
        <p className="wrapped-hero-text" style={{ fontSize: 'clamp(1.8rem, 7vw, 3rem)' }}>
          Auf einen<br />Blick
        </p>
      </div>

      {/* Konfirmations-Countdown */}
      {zeitraumEnde && (
        <div className="wrapped-anim-fade wrapped-anim-delay-1" style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem' }}>
            <IonIcon icon={calendarOutline} style={{ fontSize: '1.1rem' }} />
            <span>
              Konfirmation am {new Date(zeitraumEnde).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        </div>
      )}

      {/* Summary Stats - linksbuendig gestapelt */}
      <div className="wrapped-anim-fly-left wrapped-anim-delay-2" style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        marginTop: '24px',
        width: '100%',
      }}>
        {[
          { icon: trophyOutline, value: data.slides.punkte.total, label: 'Punkte' },
          { icon: calendarOutline, value: data.slides.events.total_attended, label: 'Events' },
          { icon: ribbonOutline, value: data.slides.badges.total_earned, label: 'Badges' },
        ].map((stat, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
          }}>
            <IonIcon icon={stat.icon} style={{ fontSize: '1.2rem', color: '#a78bfa', flexShrink: 0 }} />
            <span style={{ fontSize: '1.8rem', fontWeight: 800, color: '#fff', minWidth: '48px' }}>{stat.value}</span>
            <span style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.6)' }}>{stat.label}</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="wrapped-anim-bounce wrapped-anim-delay-3" style={{ marginTop: '32px' }}>
        <p style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <IonIcon icon={heartOutline} style={{ fontSize: '1.3rem', color: '#f472b6' }} />
          <span className="wrapped-subtitle" style={{ fontSize: 'clamp(1.1rem, 4vw, 1.5rem)' }}>Werde Teamer:in</span>
        </p>
        <p style={{
          color: 'rgba(255,255,255,0.6)',
          fontSize: '0.85rem',
          marginTop: '4px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <IonIcon icon={peopleOutline} style={{ fontSize: '1rem' }} />
          gestalte die nächste Generation mit
        </p>
      </div>
    </SlideBase>
  );
};

export default AbschlussSlide;
