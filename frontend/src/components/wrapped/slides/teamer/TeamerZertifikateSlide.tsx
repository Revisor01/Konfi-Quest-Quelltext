import React from 'react';
import SlideBase from '../SlideBase';
import type { SlideProps, TeamerZertifikateSlide as Zert } from '../../../../types/wrapped';

interface Props extends SlideProps { zertifikate: Zert; }

/**
 * Der Abgleich laeuft ueber den Namen, weil die Gemeinde ihre Zertifikate
 * frei anlegt. Die beiden stehen als Vorlage in jeder neuen Gemeinde
 * (routes/organizations.js), koennen aber umbenannt worden sein -- deshalb
 * nachsichtig verglichen und ohne Treffer einfach die normale Seite.
 */
const HERVORGEHOBEN = [
  { muster: /juleica/i, name: 'JuLeiCa' },
  { muster: /teamer[\s-]?card/i, name: 'Teamer-Card' }
];

const TeamerZertifikateSlide: React.FC<Props> = ({ isActive, zertifikate }) => {
  const n = zertifikate.total;

  const besondere = HERVORGEHOBEN
    .filter(h => zertifikate.zertifikate?.some(z => h.muster.test(z.name)))
    .map(h => h.name);

  const slogan = besondere.length > 0
    ? ['Das ist', 'was wert.']
    : n >= 3
      ? ['Schwarz', 'auf weiß.']
      : n >= 1
        ? ['Das hast du', 'schriftlich.']
        : ['Dein erstes', 'Zertifikat', 'kommt noch.'];

  const nachsatz = besondere.length === 2
    ? 'JuLeiCa und Teamer-Card — beide in der Tasche. Danke, dass du das gemacht hast.'
    : besondere.length === 1
      ? `${besondere[0]} — dafür hast du ein Wochenende drangegeben. Danke dafür.`
      : n >= 1
        ? `${n} ${n === 1 ? 'Zertifikat' : 'Zertifikate'} für deine Ausbildung — das zählt auch außerhalb der Gemeinde.`
        : 'Zertifikate gibt es für Schulungen und Kurse.';

  return (
    <SlideBase isActive={isActive} className="teamer-zertifikate-slide" kachel="teamer-zertifikate">
      <div className="kat-auge">Deine Zertifikate</div>
      {n > 0 && <div className="kat-zahl">{n}</div>}
      <div className="kat-slogan">
        {slogan.map((z, i) => <span key={i} style={{ display: 'block' }}>{z}</span>)}
      </div>
      <div className="kat-nachsatz">{nachsatz}</div>
      {zertifikate.zertifikate?.length > 0 && (
        <div className="w-merkzettel">
          <span className="w-merkzettel__label">Zuletzt</span>
          <span className="w-merkzettel__wert">{zertifikate.zertifikate[0].name}</span>
        </div>
      )}
    </SlideBase>
  );
};

export default TeamerZertifikateSlide;
