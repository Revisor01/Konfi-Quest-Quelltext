import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_FUNKELN, ICON_SCHLIESSEN } from './icons';
import { tastaturKlick } from '../../utils/tastatur';

interface UpdateHinweisKarteProps {
  // Öffnet den "Was ist neu"-Walkthrough. Der Aufrufer markiert den Hinweis
  // dabei als gesehen (markUpdateHinweisGesehen) — die Karte kommt nicht wieder.
  onOpen: () => void;
  // X gedrückt: Hinweis dauerhaft ausblenden, ohne den Walkthrough zu öffnen.
  // Fehlt der Wert, wird kein X gerendert, sondern ein Pfeil — so steht
  // derselbe Banner dauerhaft im Profil und unter "Mehr".
  onDismiss?: () => void;
  style?: React.CSSProperties;
}

// Neuigkeiten-Karte auf der Startseite: erscheint einmalig nach einem Update
// für Bestandsnutzer (Steuerung: useOnboardingWithUpdateOnce). Gleicher Look
// wie der "Was ist neu?"-Banner im Profil (.app-whatsnew im Theme), nur mit
// X statt Pfeil. Wird von allen drei Rollen verwendet; welcher Walkthrough
// sich öffnet, entscheidet die aufrufende Seite.
//
// KEIN KNOPF IM KNOPF: Die Karte war selbst
// role="button" und trug das X in sich. Vorlesehilfen sahen eine Schaltfläche
// mit einer zweiten darin, und Enter auf dem X stieg zur Karte auf und
// öffnete den Walkthrough gleich mit. Jetzt wie die Zeilen unter „Mehr"
// Die Karte ist role="presentation" und nimmt nur den Finger an,
// Knopf für Tastatur und Vorlesehilfe ist der Text, das X steht daneben.
// Enter/Leertaste auf dem Text klicken ihn (tastaturKlick), der Klick steigt
// zur Karte auf -- derselbe Weg wie der Finger.
const UpdateHinweisKarte: React.FC<UpdateHinweisKarteProps> = ({ onOpen, onDismiss, style }) => (
  <div className="app-whatsnew" role="presentation" style={style} onClick={onOpen}>
    <IonIcon icon={ICON_FUNKELN} className="app-whatsnew__icon" aria-hidden="true" />
    <div
      className="app-whatsnew__text"
      role="button"
      tabIndex={0}
      aria-label="Was ist neu in Version 2.3? Die Neuerungen ansehen"
      onKeyDown={tastaturKlick}
    >
      <span className="app-whatsnew__title">Was ist neu in Version 2.3?</span>
      <span className="app-whatsnew__sub">Das Postfach unter der Glocke, selbst wählen was aufs Handy kommt, Dunkelmodus — hier tippen für den Überblick.</span>
    </div>
    {onDismiss ? (
      <button
        type="button"
        className="app-whatsnew__close app-beruehrungsziel"
        aria-label="Hinweis ausblenden"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
      >
        <IonIcon icon={ICON_SCHLIESSEN} aria-hidden="true" />
      </button>
    ) : null}
  </div>
);

export default UpdateHinweisKarte;
