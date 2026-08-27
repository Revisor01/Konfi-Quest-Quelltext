import React from 'react';
import { IonIcon } from '@ionic/react';
import { chevronForwardOutline, closeOutline, sparklesOutline } from 'ionicons/icons';

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
// Ohne onDismiss (Profil): dauerhaft erreichbar, mit Pfeil statt X.
const MitmachenHinweisKarte: React.FC<MitmachenHinweisKarteProps> = ({ onOpen, onDismiss, style }) => (
  <div
    className="app-whatsnew app-whatsnew--mitmachen"
    role="button"
    tabIndex={0}
    style={style}
    aria-label="Events und Aktivitäten: So funktioniert der Mitmachen-Tab"
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
        <IonIcon icon={closeOutline} aria-hidden="true" />
      </button>
    ) : (
      <IonIcon icon={chevronForwardOutline} className="app-whatsnew__chevron" aria-hidden="true" />
    )}
  </div>
);

export default MitmachenHinweisKarte;
