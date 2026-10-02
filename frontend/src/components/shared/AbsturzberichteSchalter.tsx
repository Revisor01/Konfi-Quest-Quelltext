import React, { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { IonIcon, IonToggle } from '@ionic/react';
import { ICON_WERKZEUG } from './icons';
import { diagnoseErlaubt, diagnoseSchalten } from '../../services/absturzdiagnose';

// Farbvariante der jeweiligen Rolle -- dasselbe Muster wie AppSperreSchalter,
// damit sich der Eintrag in die "Konto-Einstellungen" aller drei Ansichten
// einfuegt.
export type SchalterVariante = 'users' | 'teamer' | 'purple';

interface Props {
  variante: SchalterVariante;
}

/**
 * Eintrag fuer die "Konto-Einstellungen": Absturzberichte senden an/aus
 * 
 *
 * EINE Komponente fuer alle drei Rollen, wie AppSperreSchalter: Die App hat
 * drei getrennte Komponentenbaeume, eine Aenderung soll nicht nur in einem
 * davon landen.
 *
 * Rendert im Browser NICHTS: Dort gibt es keine Absturzdiagnose, der Schalter
 * fuehrte ins Leere.
 *
 * Was "aus" genau bewirkt und warum die Vorgabe "an" ist, steht in
 * services/absturzdiagnose.ts (ABSCHALTBARKEIT). Die Beschriftung sagt nur,
 * was fuer die Person zaehlt: ob etwas hinausgeht.
 */
const AbsturzberichteSchalter: React.FC<Props> = ({ variante }) => {
  const nativ = Capacitor.isNativePlatform();
  const [aktiv, setAktiv] = useState(true);
  const [laedt, setLaedt] = useState(true);

  useEffect(() => {
    if (!nativ) return;
    let abgemeldet = false;
    diagnoseErlaubt().then((wert) => {
      if (abgemeldet) return;
      setAktiv(wert);
      setLaedt(false);
    });
    return () => { abgemeldet = true; };
  }, [nativ]);

  const umschalten = useCallback(async (gewuenscht: boolean) => {
    setAktiv(gewuenscht);
    await diagnoseSchalten(gewuenscht);
  }, []);

  if (!nativ || laedt) return null;

  return (
    <div className={`app-list-item app-list-item--${variante}`} style={{ width: '100%' }}>
      <div className="app-list-item__row">
        <div className="app-list-item__main">
          <div className={`app-icon-circle app-icon-circle--${variante}`}>
            <IonIcon icon={ICON_WERKZEUG} />
          </div>
          <div className="app-list-item__content">
            <div className="app-list-item__title">Absturzberichte senden</div>
            <div className="app-list-item__meta">
              <span className="app-list-item__meta-item">
                {aktiv
                  ? 'Hilft, Fehler zu finden – ohne Namen und Inhalte'
                  : 'Aus – die App sendet keine Absturzberichte'}
              </span>
            </div>
          </div>
        </div>
        <IonToggle
          checked={aktiv}
          aria-label="Absturzberichte senden"
          onIonChange={(e) => { void umschalten(e.detail.checked); }}
        />
      </div>
    </div>
  );
};

export default AbsturzberichteSchalter;
