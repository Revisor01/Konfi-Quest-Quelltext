import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_FUNKELN, ICON_SCHLIESSEN } from './icons';
import { tastaturKlick } from '../../utils/tastatur';

interface MitmachenHinweisKarteProps {
  /** Öffnet die Erklärung zum Mitmachen-Tab. */
  onOpen: () => void;
  /**
   * X gedrückt: Hinweis dauerhaft ausblenden. Fehlt der Wert, wird kein X
   * gerendert — so steht dieselbe Karte dauerhaft im Profil.
   */
  onDismiss?: () => void;
  style?: React.CSSProperties;
}

// Mit onDismiss (Startseite): X blendet dauerhaft aus.
// Ohne onDismiss (Profil): dauerhaft erreichbar, ohne X.
//
// Kein Knopf im Knopf: Karte role="presentation", Knopf ist der Text, das X
// steht daneben -- Begründung in UpdateHinweisKarte.tsx.
const MitmachenHinweisKarte: React.FC<MitmachenHinweisKarteProps> = ({ onOpen, onDismiss, style }) => (
  <div className="app-whatsnew app-whatsnew--mitmachen" role="presentation" style={style} onClick={onOpen}>
    <IonIcon icon={ICON_FUNKELN} className="app-whatsnew__icon" aria-hidden="true" />
    <div
      className="app-whatsnew__text"
      role="button"
      tabIndex={0}
      aria-label="Events und Aktivitäten: So funktioniert der Mitmachen-Tab"
      onKeyDown={tastaturKlick}
    >
      <span className="app-whatsnew__title">Events und Aktivitäten</span>
      <span className="app-whatsnew__sub">
        Beides steht jetzt im Mitmachen-Tab — hier tippen für den Überblick.
      </span>
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
        <IonIcon icon={ICON_SCHLIESSEN} aria-hidden="true" />
      </button>
    ) : null}
  </div>
);

export default MitmachenHinweisKarte;
