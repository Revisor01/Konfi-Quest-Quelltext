import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_ABZEICHEN, ICON_GRUPPE, ICON_TERMIN } from '../../../shared/icons';
import SlideBase from '../SlideBase';
import { teamerUeberschrift } from '../../ueberschrift';
import type { SlideProps, TeamerWrappedData } from '../../../../types/wrapped';

interface Props extends SlideProps {
  data: TeamerWrappedData;
  year: number;
}

/**
 * Der Schluss des Teamer-Rueckblicks.
 *
 * DABEI BEHOBEN: Die alte Fassung setzte `opacity: 0` fest auf
 * die Inhalte und verliess sich darauf, dass eine Animation sie wieder
 * einblendet. Greift die nicht (reduzierte Bewegung, unterbrochener
 * Seitenwechsel), blieb die Seite leer.
 */
const TeamerAbschlussSlide: React.FC<Props> = ({ isActive, data, year }) => {
  const zahlen = [
    { icon: ICON_TERMIN, wert: data.slides.events_geleitet.total, label: 'Termine' },
    { icon: ICON_GRUPPE, wert: data.slides.konfis_betreut.total_konfis, label: 'Konfis' },
    { icon: ICON_ABZEICHEN, wert: data.slides.badges.total_earned, label: 'Abzeichen' },
  ];

  return (
    <SlideBase isActive={isActive} className="teamer-abschluss-slide" kachel="teamer-abschluss">
      <div className="kat-auge">{teamerUeberschrift(year).join(' ')}</div>

      <div className="kat-slogan">
        <span style={{ display: 'block' }}>Danke,</span>
        <span style={{ display: 'block' }}>dass du</span>
        <span style={{ display: 'block' }}>dabei bist.</span>
      </div>

      <div className="w-bilanz">
        {zahlen.map((s, i) => (
          <div key={i} className="w-bilanz__zeile">
            <IonIcon icon={s.icon} />
            <b>{s.wert}</b>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      <div className="kat-nachsatz" style={{ marginTop: 'var(--app-abstand-basis)'}}>
        Ohne Menschen wie dich gäbe es keine Konfi-Zeit — nicht so,
        wie wir sie machen.
      </div>
    </SlideBase>
  );
};

export default TeamerAbschlussSlide;
