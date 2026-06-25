import React from 'react';
import SlideBase from '../SlideBase';
import { useCountUp } from '../../../../hooks/useCountUp';
import type { SlideProps, TeamerEventsGeleitetSlide } from '../../../../types/wrapped';

interface TeamerEventsSlideProps extends SlideProps {
  events: TeamerEventsGeleitetSlide;
}

const TeamerEventsSlide: React.FC<TeamerEventsSlideProps> = ({ isActive, events }) => {
  const animatedCount = useCountUp(events.total, isActive);

  return (
    <SlideBase isActive={isActive}>
      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label">Deine Events</p>
      </div>
      <div className="wrapped-anim-number-pop wrapped-anim-delay-1">
        <p className="wrapped-big-number">{animatedCount}</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-1">
        <p className="wrapped-subtitle">Events geleitet</p>
      </div>
      {events.meiste_teilnehmer_event && (
        <div className="wrapped-anim-fly-left wrapped-anim-delay-2">
          <div style={{
            marginTop: '24px',
            padding: '16px 20px',
            background: 'rgba(225, 29, 72, 0.15)',
            border: '1px solid rgba(225, 29, 72, 0.3)',
            borderRadius: '16px',
          }}>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Groesstes Event</p>
            <p style={{ color: '#fb7185', fontSize: '1.2rem', fontWeight: 700, marginTop: '4px' }}>
              {events.meiste_teilnehmer_event.name}
            </p>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginTop: '4px' }}>
              {events.meiste_teilnehmer_event.teilnehmer} Teilnehmer:innen
            </p>
          </div>
        </div>
      )}
    </SlideBase>
  );
};

export default TeamerEventsSlide;
