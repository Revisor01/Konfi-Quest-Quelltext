import React from 'react';
import { IonIcon } from '@ionic/react';
import { getIconFromIoniconsName, istEmojiIcon } from '../../../utils/badgeIcons';
import SlideBase from './SlideBase';

/**
 * "Das haben nur x %" -- das seltenste Abzeichen dieser Person.
 *
 * WARUM DIESE SEITE ANDERS GEBAUT IST ALS DIE UEBRIGEN: Jede andere Zahl im
 * Rueckblick ist absolut -- "8 Termine", "17 Punkte". Die sagt nichts
 * darueber, ob das viel ist. Diese Seite setzt die Leistung ins Verhaeltnis,
 * und genau das macht sie teilenswert. Deshalb steht hier die PROZENTZAHL
 * gross, nicht der Name des Abzeichens.
 */

interface SeltenstesAbzeichen {
  name: string;
  icon: string;
  color: string;
  haben_es: number;
  konfis: number;
  prozent: number;
}

interface Props {
  isActive: boolean;
  abzeichen: SeltenstesAbzeichen;
}

/**
 * Der Ton richtet sich nach der Seltenheit. Ein Abzeichen, das 40 % haben,
 * ist nicht "extrem selten" -- das waere gelogen und faellt sofort auf.
 */
function tonFuer(prozent: number): { auge: string; nachsatz: string } {
  if (prozent <= 10) {
    return {
      auge: 'Fast niemand hat das',
      nachsatz: 'Das ist die Sorte Badge, von der die meisten nicht mal wissen, dass es sie gibt.'
    };
  }
  if (prozent <= 25) {
    return {
      auge: 'Selten',
      nachsatz: 'Die wenigsten kommen da hin. Du schon.'
    };
  }
  if (prozent <= 50) {
    return {
      auge: 'Nicht selbstverständlich',
      nachsatz: 'Mehr als die Hälfte deines Jahrgangs hat das nicht.'
    };
  }
  return {
    auge: 'Dein seltenstes',
    nachsatz: 'Von allen deinen Badges ist das das ungewöhnlichste.'
  };
}


const SeltenstesAbzeichenSlide: React.FC<Props> = ({ isActive, abzeichen }) => {
  const ton = tonFuer(abzeichen.prozent);

  return (
    <SlideBase isActive={isActive} className="seltenstes-slide" kachel="seltenstes">
      <div className="selt-auge">{ton.auge}</div>

      {/* Das Abzeichen selbst, gross und in seiner eigenen Farbe --
          es ist der Held der Seite, nicht eine Statistikzeile. */}
      <div className="selt-abzeichen" style={{ backgroundColor: abzeichen.color || 'var(--app-color-badges)' }}>
        {istEmojiIcon(abzeichen.icon)
          ? <span className="selt-abzeichen-emoji">{abzeichen.icon}</span>
          : <IonIcon icon={getIconFromIoniconsName(abzeichen.icon)} />}
      </div>

      <div className="selt-name">{abzeichen.name}</div>

      {/* Die Prozentzahl traegt die Seite. */}
      <div className="selt-prozent">
        <span className="selt-prozent__zahl">{abzeichen.prozent}</span>
        <span className="selt-prozent__zeichen">%</span>
      </div>
      <div className="selt-satz">haben das auch</div>

      <div className="selt-nachsatz">{ton.nachsatz}</div>
    </SlideBase>
  );
};

export default SeltenstesAbzeichenSlide;
