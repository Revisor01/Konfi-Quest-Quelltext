import React from 'react';
import { IonSpinner } from '@ionic/react';

/**
 * Kopf der Nachrichtenliste beim Blaettern nach oben:
 * waehrend aeltere Nachrichten laden, eine
 * Ladeanzeige; ist der Anfang erreicht, der Hinweis „Anfang des Chats"; ging
 * das Nachladen schief, ein Knopf zum erneuten Versuch.
 *
 * Die Zeile steht immer da und behaelt ihre Hoehe. Kaeme sie erst mit der
 * Ladeanzeige dazu, schoebe sie die Nachrichten darunter um ihre Hoehe nach
 * unten — genau der Sprung, den das Nachladen vermeiden soll.
 *
 * role="status" mit aria-live: Vorlesefunktionen sagen an, dass geladen wird
 * und wenn der Anfang erreicht ist, ohne den Fokus zu verschieben.
 */
interface ChatVerlaufAnfangProps {
  laedt: boolean;
  fehler: boolean;
  anfang: boolean;
  onErneutLaden: () => void;
}

const ChatVerlaufAnfang: React.FC<ChatVerlaufAnfangProps> = ({ laedt, fehler, anfang, onErneutLaden }) => (
  <div
    role="status"
    aria-live="polite"
    data-chat-verlauf-anfang
    style={{
      minHeight: '44px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--app-abstand-eng)',
      padding: 'var(--app-abstand-eng) var(--app-abstand-basis) 0',
      fontSize: 'var(--app-text-hinweis)',
      color: 'var(--app-text-secondary)',
      textAlign: 'center'
    }}
  >
    {laedt ? (
      <>
        <IonSpinner name="crescent" aria-hidden="true" style={{ width: '18px', height: '18px' }} />
        <span>Ältere Nachrichten werden geladen...</span>
      </>
    ) : fehler ? (
      <button
        type="button"
        className="app-beruehrungsziel"
        onClick={onErneutLaden}
        style={{
          background: 'none',
          border: 'none',
          padding: 'var(--app-abstand-mini) var(--app-abstand-eng)',
          font: 'inherit',
          fontWeight: 'var(--app-schrift-halbfett)',
          // Textfarbe statt Chat-Tuerkis: das Tuerkis erreicht auf hellem
          // Grund keinen lesbaren Kontrast fuer Schrift.
          color: 'var(--app-text-body)',
          textDecoration: 'underline',
          cursor: 'pointer'
        }}
      >
        Ältere Nachrichten laden
      </button>
    ) : anfang ? (
      <span>Anfang des Chats</span>
    ) : null}
  </div>
);

export default ChatVerlaufAnfang;
