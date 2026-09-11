import React from 'react';
import SlideBase from '../SlideBase';
import { useCountUp } from '../../../../hooks/useCountUp';
import type { SlideProps, TeamerChatSlide } from '../../../../types/wrapped';

interface TeamerAntwortenSlideProps extends SlideProps {
  chat: TeamerChatSlide;
}

/**
 * "Der Antwortende" -- wie oft jemand im Chat auf andere reagiert hat.
 *
 * WARUM ANTWORTEN UND NICHT NACHRICHTEN: Wer viel schreibt, redet
 * vielleicht viel. Wer viel ANTWORTET, hat sich anderen zugewandt -- das
 * ist die Arbeit im Team, die selten jemand sieht, weil sie nie in einer
 * Statistik auftaucht. Genau deshalb bekommt sie hier eine Seite.
 *
 * KEIN VERGLEICH, KEIN RANG: Die Zahl steht fuer sich. Wer wem wie oft
 * geantwortet hat, geht niemanden etwas an.
 */
function spruchFuer(n: number): { slogan: string[]; nachsatz: string } {
  if (n >= 100) return { slogan: ['Du warst', 'immer', 'da.'], nachsatz: `${n} Mal hast du geantwortet.` };
  if (n >= 40) return { slogan: ['Auf dich', 'kam eine', 'Antwort.'], nachsatz: `${n} Mal hast du reagiert.` };
  if (n >= 15) return { slogan: ['Du hast', 'zugehört.'], nachsatz: `${n} Antworten von dir.` };
  return { slogan: ['Du hast', 'geantwortet.'], nachsatz: `${n} Mal bist du auf jemanden eingegangen.` };
}

const TeamerAntwortenSlide: React.FC<TeamerAntwortenSlideProps> = ({ isActive, chat }) => {
  const animiert = useCountUp(chat.antworten, isActive);
  const t = spruchFuer(chat.antworten);

  return (
    <SlideBase isActive={isActive} className="teamer-antworten-slide" kachel="teamer-antworten">
      <div className="kat-auge">Im Gespräch</div>
      <div className="kat-zahl">{animiert}</div>
      <div className="kat-slogan">
        {t.slogan.map((z, i) => <span key={i} style={{ display: 'block' }}>{z}</span>)}
      </div>
      <div className="kat-nachsatz">{t.nachsatz}</div>
    </SlideBase>
  );
};

export default TeamerAntwortenSlide;
