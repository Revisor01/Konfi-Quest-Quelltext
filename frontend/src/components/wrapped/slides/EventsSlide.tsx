import React from 'react';
import { IonIcon } from '@ionic/react';
import { calendarOutline, closeCircleOutline } from 'ionicons/icons';
import SlideBase from './SlideBase';
import { useCountUp } from '../../../hooks/useCountUp';
import type { SlideProps, KonfiEventsSlide } from '../../../types/wrapped';

interface EventsSlideProps extends SlideProps {
  events: KonfiEventsSlide;
}

const EventsSlide: React.FC<EventsSlideProps> = ({ isActive, events }) => {
  const animatedCount = useCountUp(events.total_attended, isActive);

  return (
    <SlideBase isActive={isActive} className="events-slide">
      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IonIcon icon={calendarOutline} style={{ fontSize: '1rem' }} />
          Deine Events
        </p>
      </div>
      <div className="wrapped-anim-number-pop wrapped-anim-delay-1">
        <p className="wrapped-big-number">{animatedCount}</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-1">
        <p className="wrapped-subtitle">Events besucht</p>
        {events.total_available > 0 && (
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginTop: '4px' }}>
            von {events.total_available} verfügbaren
          </p>
        )}
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-2" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}>
        <IonIcon icon={closeCircleOutline} style={{ fontSize: '1.1rem' }} />
        <span>0 mal abgesagt</span>
      </div>
      {events.lieblings_event && (
        <div className="wrapped-anim-fly-left wrapped-anim-delay-3">
          <div style={{
            marginTop: '24px',
            padding: '16px 20px',
            background: 'rgba(255,255,255,0.15)',
            borderRadius: '16px',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Dein letztes Event</p>
            <p style={{ color: '#fff', fontSize: '1.2rem', fontWeight: 700, margin: '4px 0 0 0' }}>
              {events.lieblings_event.name}
            </p>
          </div>
        </div>
      )}
    </SlideBase>
  );
};

export default EventsSlide;
