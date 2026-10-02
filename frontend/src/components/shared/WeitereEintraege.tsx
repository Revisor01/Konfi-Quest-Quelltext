import React from 'react';
import { IonButton, IonInfiniteScroll, IonInfiniteScrollContent } from '@ionic/react';
import { LISTE_SCHRITT } from '../../hooks/useSchrittweiseListe';

interface Props {
  /** Wie viele Eintraege noch nicht gezeigt werden. 0 = nichts rendern. */
  weitere: number;
  onMehr: () => void;
  /** Wie der Eintrag heisst, fuer den Knopf ("Konfis", "Aktivitäten", "Events"). */
  bezeichnung: string;
}

/**
 * Das Ende einer schrittweise gezeigten Liste (hooks/useSchrittweiseListe.ts).
 *
 * Zwei Wege zu den naechsten Zeilen, absichtlich beide:
 *  - IonInfiniteScroll haengt sie an, sobald das Listenende naeher als 800 px
 *    kommt -- beim normalen Scrollen merkt man vom Schritt nichts;
 *  - der Knopf darunter tut dasselbe per Antippen, Tastatur oder
 *    Vorlesefunktion, und er sagt, wie viele noch fehlen.
 *
 * Rendert nichts, solange alles zu sehen ist. Muss innerhalb eines
 * IonContent stehen (dort sucht IonInfiniteScroll seinen Scrollbereich).
 */
const WeitereEintraege: React.FC<Props> = ({ weitere, onMehr, bezeichnung }) => {
  if (weitere <= 0) return null;
  const naechste = Math.min(weitere, LISTE_SCHRITT);
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '0 var(--app-abstand-basis)' }}>
        <IonButton fill="clear" size="small" onClick={onMehr}>
          {`Weitere ${naechste} ${bezeichnung} zeigen (noch ${weitere})`}
        </IonButton>
      </div>
      <IonInfiniteScroll
        threshold="800px"
        onIonInfinite={(e) => {
          onMehr();
          // Erst nach dem Rendern freigeben, sonst meldet sich die Schwelle
          // sofort noch einmal, weil die Liste noch nicht laenger ist.
          const ziel = e.target as HTMLIonInfiniteScrollElement;
          window.setTimeout(() => { void ziel.complete(); }, 0);
        }}
      >
        <IonInfiniteScrollContent loadingSpinner="crescent" />
      </IonInfiniteScroll>
    </>
  );
};

export default WeitereEintraege;
