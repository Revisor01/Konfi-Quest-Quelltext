import React, { useCallback, useEffect, useState } from 'react';
import { IonIcon, IonToggle, IonSpinner, useIonAlert } from '@ionic/react';
import { fingerPrintOutline } from 'ionicons/icons';
import {
  biometrieVerfuegbar,
  istBiometrieAktiv,
  biometrieAktivieren,
  biometrieVergessen,
  GESPEICHERTE_SITZUNG_MAX_TAGE,
  BiometrieVerfuegbarkeit
} from '../../services/biometrics';

// Farbvariante der jeweiligen Rolle, damit sich der Eintrag in die
// "Konto-Einstellungen" der drei Profil-Ansichten einfuegt.
export type SchalterVariante = 'users' | 'teamer' | 'purple';

interface Props {
  variante: SchalterVariante;
}

/**
 * Ein Eintrag fuer die "Konto-Einstellungen": biometrische Anmeldung an/aus.
 *
 * BEWUSST EINE GEMEINSAME KOMPONENTE statt dreimal derselbe Block:
 * Die App hat drei getrennte Komponentenbaeume (admin/teamer/konfi) und die
 * uebliche Falle ist, eine Aenderung nur in einem davon zu machen. Hier steckt
 * die gesamte Logik — Verfuegbarkeit, Einschalten, Ausschalten, Fehlerfaelle —
 * an EINER Stelle; die drei Profil-Seiten binden sie nur noch ein und geben
 * ueber `variante` ihre Farbe mit. Eine spaetere Korrektur wirkt damit
 * automatisch fuer alle drei Rollen.
 *
 * Rendert NICHTS, wenn das Geraet keine eingerichtete Biometrie hat oder die
 * App im Browser laeuft — ein Schalter, der ins Leere fuehrt, ist schlimmer
 * als gar keiner.
 */
const BiometrieSchalter: React.FC<Props> = ({ variante }) => {
  const [presentAlert] = useIonAlert();
  const [verfuegbarkeit, setVerfuegbarkeit] = useState<BiometrieVerfuegbarkeit | null>(null);
  const [aktiv, setAktiv] = useState(false);
  const [laedt, setLaedt] = useState(true);
  const [speichert, setSpeichert] = useState(false);

  useEffect(() => {
    let abgemeldet = false;
    (async () => {
      const [v, a] = await Promise.all([biometrieVerfuegbar(), istBiometrieAktiv()]);
      if (abgemeldet) return;
      setVerfuegbarkeit(v);
      setAktiv(a);
      setLaedt(false);
    })();
    return () => { abgemeldet = true; };
  }, []);

  const umschalten = useCallback(async (gewuenscht: boolean) => {
    setSpeichert(true);
    try {
      if (gewuenscht) {
        const erfolg = await biometrieAktivieren();
        setAktiv(erfolg);
        if (!erfolg) {
          presentAlert({
            header: 'Nicht eingerichtet',
            message: 'Die Anmeldung konnte nicht gesichert werden. Bitte versuche es noch einmal.',
            buttons: ['OK']
          });
        }
      } else {
        await biometrieVergessen();
        setAktiv(false);
      }
    } finally {
      setSpeichert(false);
    }
  }, [presentAlert]);

  // Weder im Browser noch auf Geraeten ohne eingerichtete Biometrie anzeigen.
  if (laedt || !verfuegbarkeit?.verfuegbar) return null;

  const bezeichnung = verfuegbarkeit.bezeichnung;

  return (
    <div className={`app-list-item app-list-item--${variante}`} style={{ width: '100%' }}>
      <div className="app-list-item__row">
        <div className="app-list-item__main">
          <div className={`app-icon-circle app-icon-circle--${variante}`}>
            <IonIcon icon={fingerPrintOutline} />
          </div>
          <div className="app-list-item__content">
            <div className="app-list-item__title">Anmelden mit {bezeichnung}</div>
            <div className="app-list-item__meta">
              <span className="app-list-item__meta-item">
                {aktiv
                  ? `Angemeldet bleiben für ${GESPEICHERTE_SITZUNG_MAX_TAGE} Tage`
                  : 'Ohne Passwort in die App'}
              </span>
            </div>
          </div>
        </div>
        {speichert ? (
          <IonSpinner name="crescent" />
        ) : (
          <IonToggle
            checked={aktiv}
            aria-label={`Anmelden mit ${bezeichnung}`}
            onIonChange={(e) => umschalten(e.detail.checked)}
          />
        )}
      </div>
    </div>
  );
};

export default BiometrieSchalter;
