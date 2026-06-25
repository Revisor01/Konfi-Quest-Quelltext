import React from 'react';
import SlideBase from '../SlideBase';
import type { SlideProps, TeamerWrappedData } from '../../../../types/wrapped';

interface TeamerAbschlussSlideProps extends SlideProps {
  data: TeamerWrappedData;
  year: number;
}

const TeamerAbschlussSlide: React.FC<TeamerAbschlussSlideProps> = ({ isActive, data, year }) => {
  return (
    <SlideBase isActive={isActive} className="teamer-abschluss-slide">
      <div className="wrapped-anim-fly-left" style={{ opacity: 0 }}>
        <p className="wrapped-label">Dein Teamer-Jahr {year}</p>
        <p className="wrapped-hero-text" style={{ fontSize: 'clamp(1.8rem, 7vw, 3rem)' }}>
          Auf einen<br />Blick
        </p>
      </div>

      {/* Stats linksbuendig gestapelt */}
      <div className="wrapped-anim-fly-left wrapped-anim-delay-1" style={{
        opacity: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        marginTop: '24px',
        width: '100%',
      }}>
        {[
          { value: data.slides.events_geleitet.total, label: 'Events geleitet' },
          { value: data.slides.konfis_betreut.total_konfis, label: 'Konfis betreut' },
          { value: data.slides.badges.total_earned, label: 'Badges' },
        ].map((stat, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
            <span style={{ fontSize: '1.8rem', fontWeight: 800, color: '#fff', minWidth: '48px' }}>{stat.value}</span>
            <span style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.6)' }}>{stat.label}</span>
          </div>
        ))}
      </div>

      <div className="wrapped-anim-fade wrapped-anim-delay-2" style={{ opacity: 0, marginTop: '32px' }}>
        <p style={{ color: '#fb7185', fontSize: '1.3rem', fontWeight: 700 }}>
          Danke fuer deinen Einsatz!
        </p>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem', marginTop: '4px' }}>
          Du machst den Unterschied
        </p>
      </div>
    </SlideBase>
  );
};

export default TeamerAbschlussSlide;
