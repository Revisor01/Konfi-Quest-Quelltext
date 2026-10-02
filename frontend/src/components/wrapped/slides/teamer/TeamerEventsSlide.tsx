import React from 'react';
import SlideBase from '../SlideBase';
import { useCountUp } from '../../../../hooks/useCountUp';
import type { SlideProps, TeamerEventsGeleitetSlide } from '../../../../types/wrapped';

interface TeamerEventsSlideProps extends SlideProps {
  events: TeamerEventsGeleitetSlide;
}

/**
 * Die Teamer-Seiten hatten bisher nicht einmal eine className und bekamen
 * dadurch gar kein Hintergrundbild. Jetzt tragen sie dieselbe Gestaltung wie
 * der Konfi-Rueckblick: Spruch gross, Zahl klein.
 *
 * ANDERER TON ALS BEI KONFIS: Teamer:innen machen das freiwillig, neben
 * Schule oder Beruf. Die Texte danken, statt zu loben.
 */
function spruchFuer(n: number): { auge: string; slogan: string[]; nachsatz: string } {
  if (n >= 30) return { auge: 'Deine Events', slogan: ['Du warst', 'fast', 'immer da.'], nachsatz: `${n} Events — das ist ein zweites Ehrenamt.` };
  if (n >= 15) return { auge: 'Deine Events', slogan: ['Ohne dich', 'wär das', 'nicht gegangen.'], nachsatz: `${n} Mal hast du deine Zeit gegeben.` };
  if (n >= 6) return { auge: 'Deine Events', slogan: ['Verlässlich', 'dabei.'], nachsatz: `${n} Events, bei denen du gebraucht wurdest.` };
  if (n >= 2) return { auge: 'Deine Events', slogan: ['Du hast', 'mitgetragen.'], nachsatz: `${n} Mal warst du dabei.` };
  if (n === 1) return { auge: 'Dein Event', slogan: ['Einmal', 'mitgetragen.'], nachsatz: 'Und das zählt.' };
  return { auge: 'Deine Events', slogan: ['Es fängt', 'gerade', 'erst an.'], nachsatz: 'Die Events kommen.' };
}

const TeamerEventsSlide: React.FC<TeamerEventsSlideProps> = ({ isActive, events }) => {
  const animiert = useCountUp(events.total, isActive);
  const t = spruchFuer(events.total);

  return (
    <SlideBase isActive={isActive} className="teamer-events-slide" kachel="teamer-events">
      <div className="kat-auge">{t.auge}</div>
      {events.total > 0 && <div className="kat-zahl">{animiert}<span className="kat-zahl__mal">×</span></div>}
      <div className="kat-slogan">
        {t.slogan.map((z, i) => <span key={i} style={{ display: 'block' }}>{z}</span>)}
      </div>
      <div className="kat-nachsatz">{t.nachsatz}</div>
      {events.meiste_teilnehmer_event?.name && (
        <div className="w-merkzettel">
          <span className="w-merkzettel__label">Dein größtes Event</span>
          <span className="w-merkzettel__wert">{events.meiste_teilnehmer_event.name}</span>
        </div>
      )}
    </SlideBase>
  );
};

export default TeamerEventsSlide;
