import React from 'react';
import { IonIcon } from '@ionic/react';
import { schoolOutline, starOutline, alertCircleOutline } from 'ionicons/icons';
import SlideBase from './SlideBase';
import type { SlideProps } from '../../../types/wrapped';

interface PflichtSlideProps extends SlideProps {
  pflichtBesucht: number;
  pflichtGesamt: number;
  seed: number;
}

function getThreshold(besucht: number, gesamt: number): { text: string; icon: string; color: string } {
  if (gesamt === 0) return { text: 'Noch keine Pflichtveranstaltungen', icon: '', color: 'rgba(255,255,255,0.7)' };
  const percent = (besucht / gesamt) * 100;
  if (percent >= 90) return { text: 'Vorbildlich!', icon: 'star', color: '#fbbf24' };
  if (percent >= 50) return { text: 'Gut dabei!', icon: '', color: '#a78bfa' };
  return { text: 'Da geht noch was!', icon: 'alert', color: '#f87171' };
}

const PflichtSlide: React.FC<PflichtSlideProps> = ({ isActive, pflichtBesucht, pflichtGesamt }) => {
  const threshold = getThreshold(pflichtBesucht, pflichtGesamt);
  const progressPercent = pflichtGesamt > 0 ? Math.round((pflichtBesucht / pflichtGesamt) * 100) : 0;

  return (
    <SlideBase isActive={isActive} className="pflicht-slide">
      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IonIcon icon={schoolOutline} style={{ fontSize: '1rem' }} />
          Pflichtveranstaltungen
        </p>
      </div>
      <div className="wrapped-anim-number-pop wrapped-anim-delay-1">
        <p className="wrapped-big-number">{pflichtBesucht}</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-1">
        <p className="wrapped-subtitle">
          von {pflichtGesamt} besucht
        </p>
      </div>
      {pflichtGesamt > 0 && (
        <div className="wrapped-anim-fade wrapped-anim-delay-2" style={{ width: '100%', maxWidth: '300px', marginTop: '20px' }}>
          <div style={{ height: '12px', background: 'rgba(255,255,255,0.15)', borderRadius: '6px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: isActive ? `${progressPercent}%` : '0%',
              background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
              borderRadius: '6px',
              transition: 'width 2s ease-out',
            }} />
          </div>
        </div>
      )}
      <div className="wrapped-anim-bounce wrapped-anim-delay-3">
        <p style={{
          color: threshold.color,
          fontSize: '1.2rem',
          fontWeight: 700,
          marginTop: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          {threshold.icon === 'star' && <IonIcon icon={starOutline} style={{ fontSize: '1.2rem' }} />}
          {threshold.icon === 'alert' && <IonIcon icon={alertCircleOutline} style={{ fontSize: '1.2rem' }} />}
          {threshold.text}
        </p>
      </div>
    </SlideBase>
  );
};

export default PflichtSlide;
