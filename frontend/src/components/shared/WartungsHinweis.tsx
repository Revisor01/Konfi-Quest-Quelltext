import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_WERKZEUG } from './icons';
import { useBetriebsstatus } from '../../hooks/useBetriebsstatus';

/**
 * Selbsttragend wie StoreUpdateBanner: liest den Stand aus
 * services/betriebsstatus und rendert nichts, solange der Server keinen
 * Hinweis meldet. Die Pruefung haengt einmal in App.tsx (beim Start und bei
 * jeder Rueckkehr in die App); der Hinweis verschwindet, sobald der Server
 * ihn nicht mehr meldet.
 *
 * FUER ALLE ROLLEN: steht auf den Startseiten von Konfi, Team, Leitung und
 * Super-Admin und auf der Anmeldeseite, im Browser wie in der App.
 *
 * NICHT SPERREND UND NICHT WEGKLICKBAR: Er traegt eine Auskunft, keine
 * Aufgabe — kein Knopf, kein X. Bleiben soll er genau so lange, wie der
 * Betrieb ihn setzt.
 *
 * KLARTEXT: Der Text wird als React-Kind gesetzt, nie als HTML — was der
 * Server schickt, erscheint Zeichen fuer Zeichen.
 *
 * FORM: die Statusflaeche "Warnung" (--app-flaeche/-rand/-text-warnung),
 * die im Dunkelmodus ihre eigenen Werte hat; Aussehen in .app-wartungshinweis
 * (theme/variables.css).
 */
const WartungsHinweis: React.FC<{ style?: React.CSSProperties }> = ({
  style = { margin: 'var(--app-abstand-eng) var(--app-abstand-basis) 0' },
}) => {
  const { wartungstext } = useBetriebsstatus();
  if (!wartungstext) return null;

  return (
    <div className="app-wartungshinweis" role="note" aria-label="Wartungshinweis" style={style}>
      <IonIcon icon={ICON_WERKZEUG} className="app-wartungshinweis__icon" aria-hidden="true" />
      <div className="app-wartungshinweis__inhalt">
        <strong className="app-wartungshinweis__titel">Wartungshinweis</strong>
        <span className="app-wartungshinweis__text">{wartungstext}</span>
      </div>
    </div>
  );
};

export default WartungsHinweis;
