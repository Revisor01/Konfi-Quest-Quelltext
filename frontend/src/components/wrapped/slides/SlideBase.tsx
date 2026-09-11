import React from 'react';
import WrappedHintergrund from '../WrappedHintergrund';
import { hintergrundFuer } from '../hintergrundbilder';
import { useMotive } from '../MotivKontext';

interface SlideBaseProps {
  isActive: boolean;
  children: React.ReactNode;
  className?: string;
  /**
   * Schlüssel der Kachel ('intro', 'highlight', ...). Steuert, welches Foto
   * hinter der Seite liegt. Ohne Angabe bleibt es beim reinen Farbverlauf --
   * so bleiben Seiten, die den Schlüssel (noch) nicht durchreichen,
   * unverändert statt plötzlich falsch bebildert.
   */
  kachel?: string;
}

/**
 * Grundgerüst jeder Rückblick-Seite.
 */
const SlideBase: React.FC<SlideBaseProps> = ({ isActive, children, className, kachel }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [verlauf, setVerlauf] = React.useState<string | null>(null);

  // Der Kachel-Schlüssel steckt schon in der className jeder Seite
  // ("intro-slide", "highlight-slide", "monat-slide"). Ihn dort abzulesen
  // spart es, den Schlüssel durch zwölf Seiten durchzureichen -- und die
  // beiden Angaben können nicht auseinanderlaufen.
  const abgeleitet = kachel
    || (className ? className.replace(/-slide$/, '') : undefined);

  // Die Motive kommen aus der Verteilung des ganzen Rueckblicks -- so
  // wiederholt sich keines. Fehlt der Kontext (Alt-Aufrufe, Tests), greift
  // die feste Zuordnung wie bisher.
  const verteilung = useMotive();
  const zugewiesen = abgeleitet ? verteilung?.[abgeleitet] : undefined;
  const hatBild = abgeleitet
    ? Boolean(zugewiesen?.haupt || hintergrundFuer(abgeleitet))
    : false;

  // Den Verlauf der Seite aus dem CSS lesen, statt ihn hier zu doppeln.
  // Sonst müsste jede Farbe an zwei Stellen gepflegt werden und liefe
  // irgendwann auseinander.
  // Der Verlauf steht als eigene Variable `--seiten-verlauf` im CSS, NICHT
  // mehr als background-image.
  //
  // Grund: Seiten mit Foto blenden ihren eigenen
  // background-image aus -- sonst deckt er das Bild ab, das dahinter liegt
  // (.wrapped-bg auf z-index: -1). Wuerde hier weiterhin backgroundImage
  // gelesen, kaeme 'none' zurueck und die Seite bliebe ohne Farbe.
  React.useEffect(() => {
    if (!hatBild || !isActive || !ref.current) return;
    const stil = window.getComputedStyle(ref.current);
    const ausVariable = stil.getPropertyValue('--seiten-verlauf').trim();
    const gelesen = ausVariable || stil.backgroundImage;
    if (gelesen && gelesen !== 'none') setVerlauf(gelesen);
  }, [hatBild, isActive]);

  return (
    <div
      ref={ref}
      className={`wrapped-slide${isActive ? ' wrapped-slide--active' : ''}${className ? ` ${className}` : ''}`}
    >
      {isActive && hatBild && verlauf && (
        <WrappedHintergrund
          kachel={abgeleitet as string}
          verlauf={verlauf}
          haupt={zugewiesen?.haupt}
          zweit={zugewiesen?.zweit}
        />
      )}
      {isActive && children}
    </div>
  );
};

export default SlideBase;
