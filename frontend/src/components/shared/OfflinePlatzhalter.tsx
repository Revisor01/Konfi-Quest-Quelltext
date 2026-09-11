import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_OFFLINE } from './icons';

/**
 * Eine Zeile, die sagt, was gerade fehlt — statt einen Abschnitt kommentarlos
 * auszublenden.
 *
 * Bewusst schmal gehalten: eine graue Zeile mit Wolken-Symbol, kein Alarm.
 * Dass etwas fehlt, ist eine Information, kein Fehler.
 */
interface Props {
  /** Was fehlt, im Nominativ Plural — z.B. "Die Teilnehmerliste". */
  was: string;
}

const OfflinePlatzhalter: React.FC<Props> = ({ was }) => (
  <div className="app-offline-platzhalter">
    <IonIcon icon={ICON_OFFLINE} aria-hidden="true" />
    <span>{was} ist offline nicht verfügbar.</span>
  </div>
);

export default OfflinePlatzhalter;
