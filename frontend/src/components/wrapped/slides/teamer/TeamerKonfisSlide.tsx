import React from 'react';
import SlideBase from '../SlideBase';
import { useCountUp } from '../../../../hooks/useCountUp';
import type { SlideProps, TeamerKonfisBetreutSlide } from '../../../../types/wrapped';

interface TeamerKonfisSlideProps extends SlideProps {
  konfis: TeamerKonfisBetreutSlide;
}

/**
 * Die wichtigste Zahl im Teamer-Rueckblick: Menschen, nicht Termine.
 * Deshalb steht sie hier als Einzige gross.
 */
function spruchFuer(n: number): { slogan: string[]; nachsatz: string } {
  if (n >= 40) return { slogan: ['Ein ganzer', 'Jahrgang', 'kennt dich.'], nachsatz: `${n} Konfis hast du begleitet.` };
  if (n >= 20) return { slogan: ['Du kennst', 'sie alle', 'beim Namen.'], nachsatz: `${n} Konfis waren in deinen Gruppen.` };
  if (n >= 8) return { slogan: ['Für die', 'warst du', 'da.'], nachsatz: `${n} Konfis hast du begleitet.` };
  if (n >= 2) return { slogan: ['Du hast sie', 'begleitet.'], nachsatz: `${n} Konfis — jede einzeln.` };
  if (n === 1) return { slogan: ['Eine Konfi.', 'Ganz', 'persönlich.'], nachsatz: 'Manchmal ist eine genug.' };
  return { slogan: ['Deine Konfis', 'kommen', 'noch.'], nachsatz: 'Das nächste Jahr wartet.' };
}

const TeamerKonfisSlide: React.FC<TeamerKonfisSlideProps> = ({ isActive, konfis }) => {
  const animiert = useCountUp(konfis.total_konfis, isActive);
  const t = spruchFuer(konfis.total_konfis);

  return (
    <SlideBase isActive={isActive} className="teamer-konfis-slide" kachel="teamer-konfis">
      <div className="kat-auge">Deine Konfis</div>
      {konfis.total_konfis > 0 && <div className="kat-zahl">{animiert}</div>}
      <div className="kat-slogan">
        {t.slogan.map((z, i) => <span key={i} style={{ display: 'block' }}>{z}</span>)}
      </div>
      <div className="kat-nachsatz">{t.nachsatz}</div>
      {konfis.jahrgaenge?.length > 0 && (
        <div className="kat-fussnote">
          {konfis.jahrgaenge.length === 1 ? 'Jahrgang' : 'Jahrgänge'} {konfis.jahrgaenge.join(', ')}
        </div>
      )}
    </SlideBase>
  );
};

export default TeamerKonfisSlide;
