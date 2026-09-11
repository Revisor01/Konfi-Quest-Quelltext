import React from 'react';
import SlideBase from '../SlideBase';
import { useCountUp } from '../../../../hooks/useCountUp';
import type { SlideProps, TeamerTeamSlide as Team } from '../../../../types/wrapped';

interface TeamerTeamSlideProps extends SlideProps {
  team: Team;
}

/**
 * "Dein Team" -- mit wie vielen anderen zusammen die Jahrgaenge betreut
 * wurden.
 *
 * Gezaehlt werden NUR Teamer:innen auf denselben Jahrgaengen. Ohne den
 * Rollenfilter zaehlten Admins und die Leitung mit -- die Zahl waere dann
 * keine Aussage ueber das Team, sondern ueber die Zugriffsrechte.
 *
 * KEINE NAMEN: Die Seite sagt, mit wie vielen, nicht mit wem. Wer im Team
 * war, weiss das selbst; ein Rueckblick ist kein Verzeichnis.
 */
function spruchFuer(n: number): { slogan: string[]; nachsatz: string } {
  if (n >= 10) return { slogan: ['Ihr wart', 'viele.'], nachsatz: `Mit ${n} anderen zusammen.` };
  if (n >= 4) return { slogan: ['Ihr wart', 'ein Team.'], nachsatz: `${n} andere waren mit dir da.` };
  if (n >= 2) return { slogan: ['Zu dritt', 'und mehr.'], nachsatz: `${n} andere waren mit dir da.` };
  return { slogan: ['Zu zweit.'], nachsatz: 'Eine andere Person war mit dir da.' };
}

const TeamerTeamSlide: React.FC<TeamerTeamSlideProps> = ({ isActive, team }) => {
  const animiert = useCountUp(team.mitstreitende, isActive);
  const t = spruchFuer(team.mitstreitende);

  return (
    <SlideBase isActive={isActive} className="teamer-team-slide" kachel="teamer-team">
      <div className="kat-auge">Nicht allein</div>
      <div className="kat-zahl">{animiert}</div>
      <div className="kat-slogan">
        {t.slogan.map((z, i) => <span key={i} style={{ display: 'block' }}>{z}</span>)}
      </div>
      <div className="kat-nachsatz">{t.nachsatz}</div>
    </SlideBase>
  );
};

export default TeamerTeamSlide;
