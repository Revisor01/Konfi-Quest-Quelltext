import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_ABZEICHEN, ICON_POKAL, ICON_TERMIN } from '../../shared/icons';
import type { SlideProps, KonfiWrappedData } from '../../../types/wrapped';
import SlideBase from './SlideBase';
import { konfiUeberschrift } from '../ueberschrift';

interface AbschlussSlideProps extends SlideProps {
  data: KonfiWrappedData;
  year: number;
  konfirmation?: string | null;
}

/**
 * Die Abschluss-Seite -- auf die Slogan-Gestaltung umgezogen.
 *
 * Die drei Zahlen bleiben als Zeile darunter -- hier gehoert die Uebersicht
 * hin, das ist der Sinn der Seite.
 */
const AbschlussSlide: React.FC<AbschlussSlideProps> = ({ isActive, data, year: _year, konfirmation }) => {
  // Siehe WrappedModal: `konfirmation` ist das echte Datum, `ende` nur der
  // Rueckfall fuer Alt-Snapshots ohne das Feld.
  const z = data.slides.zeitraum;
  const zeitraumEnde = z ? (('konfirmation' in z) ? (z.konfirmation || null) : (z.ende || null)) : null;
  const gemeinde = data.slides.gemeinde?.trim() || null;

  const zahlen = [
    { icon: ICON_POKAL, wert: data.slides.punkte.total, label: 'Punkte' },
    { icon: ICON_TERMIN, wert: data.slides.events.total_attended, label: 'Termine' },
    { icon: ICON_ABZEICHEN, wert: data.slides.badges.total_earned, label: 'Abzeichen' },
  ];

  return (
    <SlideBase isActive={isActive} className="abschluss-slide" kachel="abschluss">
      <div className="kat-auge">{konfiUeberschrift(konfirmation, zeitraumEnde).join(' ')}</div>

      {/* Die Kirchengemeinde -- wo diese Konfi-Zeit stattgefunden hat.
          Fehlt bei Alt-Snapshots, dann bleibt die Zeile weg. */}
      {gemeinde && <div className="kat-gemeinde">{gemeinde}</div>}

      <div className="kat-slogan">
        <span style={{ display: 'block' }}>Dein Weg.</span>
        <span style={{ display: 'block' }}>Deine Zeit.</span>
        <span style={{ display: 'block' }}>Dein Glaube.</span>
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

      {zeitraumEnde && (
        <div className="kat-fussnote">
          Konfirmation am {new Date(zeitraumEnde).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      )}
    </SlideBase>
  );
};

export default AbschlussSlide;
