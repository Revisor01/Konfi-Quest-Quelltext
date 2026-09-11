import React from 'react';
import SlideBase from './SlideBase';
import { useCountUp } from '../../../hooks/useCountUp';
import type { SlideProps, KonfiEventsSlide } from '../../../types/wrapped';

interface EventsSlideProps extends SlideProps {
  events: KonfiEventsSlide;
}

/**
 * Die Termin-Seite -- auf die Slogan-Gestaltung umgezogen.
 *
 * Das Snapshot-Feld `slides.events.lieblings_event` BLEIBT im Backend:
 * Ausgelieferte App-Versionen lesen es, und die Antwortform ist ein
 * Vertrag. Nur die Anzeige faellt weg -- hier und in der Teilen-Karte.
 */

/**
 * Die Schwellen sind eng genug, dass sich 3 Termine anders anfuehlen als 12.
 * Vorher lag alles zwischen 2 und 9 im selben Topf -- "Du warst dabei" stand
 * damit ueber einer 3 wie ueber einer 9.
 */
function spruchFuer(besucht: number): { auge: string; slogan: string[]; nachsatz: string } {
  // 1) Sehr viel: 20 und mehr
  if (besucht >= 20) {
    return {
      auge: 'Deine Termine',
      slogan: ['Du warst', 'öfter da', 'als manche', 'Möbel.'],
      nachsatz: 'Du hast kaum etwas ausgelassen.'
    };
  }
  // 2) Viel: 10 bis 19
  if (besucht >= 10) {
    return {
      auge: 'Deine Termine',
      slogan: ['Immer wieder', 'aufgetaucht.'],
      nachsatz: 'Nicht einmal, nicht zweimal — immer wieder.'
    };
  }
  // 3) Solide: 5 bis 9
  if (besucht >= 5) {
    return {
      auge: 'Deine Termine',
      slogan: ['Auf dich', 'war', 'Verlass.'],
      nachsatz: 'Immer wieder hast du dir die Zeit genommen.'
    };
  }
  // 4) Wenig, aber da: 2 bis 4
  if (besucht >= 2) {
    return {
      auge: 'Deine Termine',
      slogan: ['Du warst', 'dabei.'],
      nachsatz: 'Und darum geht es.'
    };
  }
  // 5) Einmal oder gar nicht
  if (besucht === 1) {
    return {
      auge: 'Dein Termin',
      slogan: ['Einmal', 'hingegangen.'],
      nachsatz: 'Aller Anfang ist genau das.'
    };
  }
  return {
    auge: 'Deine Termine',
    slogan: ['Der erste', 'Termin', 'wartet noch.'],
    nachsatz: 'Es ist immer Platz für dich.'
  };
}

const EventsSlide: React.FC<EventsSlideProps> = ({ isActive, events }) => {
  const animatedCount = useCountUp(events.total_attended, isActive);
  const text = spruchFuer(events.total_attended);

  return (
    <SlideBase isActive={isActive} className="events-slide" kachel="events">
      <div className="kat-auge">{text.auge}</div>

      {events.total_attended > 0 && (
        <div className="kat-zahl">
          {animatedCount}<span className="kat-zahl__mal">×</span>
        </div>
      )}

      <div className="kat-slogan">
        {text.slogan.map((zeile, i) => (
          <span key={i} style={{ display: 'block' }}>{zeile}</span>
        ))}
      </div>

      <div className="kat-nachsatz">{text.nachsatz}</div>
    </SlideBase>
  );
};

export default EventsSlide;
