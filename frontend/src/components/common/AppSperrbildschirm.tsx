import React, { useCallback, useEffect, useState } from 'react';
import { IonButton, IonIcon, IonSpinner } from '@ionic/react';
import { ICON_SPERRE_GEFUELLT, ICON_ABMELDEN } from '../shared/icons';
import { biometrieIcon } from '../shared/biometrieSymbol';
import { sperreOeffnen } from '../../services/appSperre';
import { biometrieVerfuegbar, BiometrieSinnbild } from '../../services/biometrics';

interface Props {
  /** Erfolgreich entsperrt — die App wird wieder freigegeben. */
  onEntsperrt: () => void;
  /** Letzter Ausweg: sauber abmelden und auf die normale Anmeldung. */
  onAbmelden: () => void | Promise<void>;
}

/**
 * Der Sperrbildschirm. Verdeckt die App vollständig, solange gesperrt ist.
 *
 * NIEMAND DARF SICH AUSSPERREN — das ist die wichtigste Eigenschaft dieses
 * Bildschirms, und alles hier ist darauf ausgelegt:
 *   - Schlägt die Biometrie fehl oder wird abgebrochen, bleibt der Bildschirm
 *     stehen und der Knopf lässt sich beliebig oft erneut antippen. Es gibt
 *     keinen Zähler, der irgendwann dichtmacht.
 *   - Auf iOS bietet das System nach Fehlversuchen von sich aus den Gerätecode
 *     an (useFallback in sperreOeffnen). Auf Android reicht die Bibliothek das
 *     nicht durch — deshalb ist der nächste Punkt keine Zierde.
 *   - "Abmelden" steht IMMER sichtbar da und führt sauber auf die normale
 *     Anmeldung mit Benutzername und Passwort. Wer die Biometrie am Gerät
 *     geändert oder entfernt hat, kommt hier heraus.
 *
 * Die Sperre ist ein Sichtschutz, keine kryptografische Absicherung — die
 * Texte versprechen deshalb nichts weiter als "gesperrt".
 */
const AppSperrbildschirm: React.FC<Props> = ({ onEntsperrt, onAbmelden }) => {
  // Vor der Antwort des Geraets steht hier bewusst das NEUTRALE "Biometrie" mit
  // Schloss-Symbol und nicht "Face ID": Auf einem Fingerabdruck-Geraet waere
  // ein kurz aufblitzendes "Mit Face ID entsperren" schlicht falsch. Ein
  // neutraler Text, der sich gleich praezisiert, ist die ehrlichere Zwischenzeit.
  const [bezeichnung, setBezeichnung] = useState('Biometrie');
  const [sinnbild, setSinnbild] = useState<BiometrieSinnbild>('schloss');
  const [laeuft, setLaeuft] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);

  useEffect(() => {
    let abgemeldet = false;
    biometrieVerfuegbar().then((v) => {
      if (abgemeldet) return;
      setBezeichnung(v.bezeichnung);
      setSinnbild(v.sinnbild);
    });
    return () => { abgemeldet = true; };
  }, []);

  const entsperrenVersuchen = useCallback(async () => {
    if (laeuft) return;
    setLaeuft(true);
    setHinweis(null);
    try {
      const ausgang = await sperreOeffnen();
      if (ausgang === 'ok') {
        onEntsperrt();
        return;
      }
      // Kein zweiter Versuch von selbst: Wer abbricht, will vielleicht gerade
      // nicht. Der Knopf bleibt da, die Entscheidung liegt bei der Person.
      setHinweis(
        ausgang === 'abgebrochen'
          ? 'Nicht erkannt. Tippe noch einmal, um es erneut zu versuchen.'
          : 'Das hat gerade nicht geklappt. Versuche es noch einmal oder melde dich ab.'
      );
    } finally {
      setLaeuft(false);
    }
  }, [laeuft, onEntsperrt]);

  // Beim Erscheinen von sich aus fragen: sonst müsste man erst tippen, um
  // etwas zu sehen, das man ohnehin gleich tippt.
  useEffect(() => {
    entsperrenVersuchen();
    // Genau einmal beim Einblenden — nicht bei jeder Änderung von `laeuft`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Das Aussehen steckt in .app-sperrbildschirm (theme/variables.css) — dort
  // liegen die Tokens fuer Abstand, Schrift und Farbe. Deckend und ganz oben:
  // Nichts von den Inhalten darf durchscheinen, solange gesperrt ist. Keine
  // Transparenz, keine Unschaerfe — Unschaerfe liesse Fotos und Namen
  // weiterhin erahnen.
  //
  // Die Bildsprache ist die der Anmeldeseite (Aurora-Verlauf, freigestelltes
  // Logo als Wasserzeichen): beide sind Torhueter vor der App. Was hier NICHT
  // steht, steht bewusst nicht da — kein Name, keine Rolle, keine Gemeinde.
  // Diesen Bildschirm sehen auch Unbefugte, die das Geraet in die Hand
  // bekommen; er verraet nur, dass es Konfi Quest ist.
  return (
    <div
      className="app-sperrbildschirm"
      role="dialog"
      aria-modal="true"
      aria-label="Konfi Quest ist gesperrt"
    >
      {/* Freigestelltes Logo als grosses, angedeutetes Wasserzeichen —
          dasselbe Bild wie auf der Anmeldeseite. */}
      <img
        src="/assets/icon/logo-mark.png"
        alt=""
        className="app-sperrbildschirm__wasserzeichen"
        aria-hidden="true"
      />

      <div className="app-sperrbildschirm__schloss-kreis">
        <IonIcon
          className="app-sperrbildschirm__schloss"
          icon={ICON_SPERRE_GEFUELLT}
          aria-hidden="true"
        />
      </div>

      <h1 className="app-sperrbildschirm__titel">Konfi Quest ist gesperrt</h1>

      <p className="app-sperrbildschirm__text">Entsperre die App, um weiterzumachen.</p>

      {hinweis && (
        <p role="status" className="app-sperrbildschirm__hinweis">{hinweis}</p>
      )}

      <IonButton
        className="app-sperrbildschirm__knopf"
        expand="block"
        onClick={entsperrenVersuchen}
        disabled={laeuft}
      >
        {laeuft ? (
          <IonSpinner name="crescent" />
        ) : (
          <>
            <IonIcon slot="start" icon={biometrieIcon(sinnbild)} aria-hidden="true" />
            Mit {bezeichnung} entsperren
          </>
        )}
      </IonButton>

      {/* Der Rückweg. Steht immer da, auch während die Abfrage läuft — wer hier
          festhängt, soll nicht warten müssen, bis ein Spinner fertig ist.
          Deshalb ist er auch gestalterisch ein richtiger Knopf mit Rahmen und
          nicht bloss ein blasser Link: in einer Notlage muss man ihn finden. */}
      <IonButton
        className="app-sperrbildschirm__abmelden"
        expand="block"
        fill="outline"
        onClick={() => onAbmelden()}
      >
        <IonIcon slot="start" icon={ICON_ABMELDEN} aria-hidden="true" />
        Abmelden
      </IonButton>
    </div>
  );
};

export default AppSperrbildschirm;
