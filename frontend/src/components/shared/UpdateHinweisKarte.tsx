import React from 'react';
import { IonIcon } from '@ionic/react';
import { sparklesOutline, closeOutline, chevronForwardOutline } from 'ionicons/icons';

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
const UpdateHinweisKarte: React.FC<UpdateHinweisKarteProps> = ({ onOpen, onDismiss, style }) => (
  <div
    className="app-whatsnew"
    role="button"
    tabIndex={0}
    style={style}
    aria-label="Was ist neu in Version 2.0? Die Neuerungen ansehen"
    onClick={onOpen}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen();
      }
    }}
  >
    <IonIcon icon={sparklesOutline} className="app-whatsnew__icon" aria-hidden="true" />
    <div className="app-whatsnew__text">
      <span className="app-whatsnew__title">Was ist neu in Version 2.0?</span>
      <span className="app-whatsnew__sub">Challenges, der Mitmachen-Tab und mehr — hier tippen für den Überblick.</span>
    </div>
    {onDismiss ? (
      <button
        type="button"
        className="app-whatsnew__close"
        aria-label="Hinweis ausblenden"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
      >
        <IonIcon icon={closeOutline} aria-hidden="true" />
      </button>
    ) : (
      <IonIcon icon={chevronForwardOutline} className="app-whatsnew__chevron" aria-hidden="true" />
    )}
  </div>
);

export default UpdateHinweisKarte;
