import React, { useState } from 'react';
import {
  IonIcon,
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
} from '@ionic/react';
import { timeOutline, alertCircleOutline, chevronForwardOutline } from 'ionicons/icons';
import { useWartendeVorgaenge } from '../../hooks/useWartendeVorgaenge';
import WartendeVorgaengeKarte from '../shared/WartendeVorgaengeKarte';

/**
 * Schmale Leiste, die in der ganzen App erscheint, sobald etwas in der
 * Offline-Warteschlange liegt oder endgueltig gescheitert ist. Antippen
 * oeffnet die Liste.
 *
 * Haengt wie GlobalToasts auf App-Ebene. Grund: Die rund zwanzig
 * Leitungs-Aktionen (Kategorien, Jahrgaenge, Abzeichen, Level, Termine,
 * Material, Zertifikate) verteilen sich ueber ebenso viele Seiten mit je
 * eigener Kopfzeile — es gibt keine gemeinsame Huelle, in die sich ein
 * Hinweis pro Ansicht einhaengen liesse. Eine Stelle wirkt hier ueberall,
 * auch dort, wo spaeter etwas Neues eingereiht wird.
 *
 * Die Termin-Seiten zeigen ihre wartenden Vorgaenge zusaetzlich in der Liste
 * selbst (WartendeVorgaengeKarte) — dort steht der Hinweis im Zusammenhang,
 * direkt neben den Antraegen, um die es geht. Das ist Absicht und keine
 * Dopplung: Die Leiste sagt "da ist noch was", die Karte sagt "und zwar das".
 */
const WartendeVorgaengeLeiste: React.FC = () => {
  const { wartend, gescheitert, vergessen, alleVergessen } = useWartendeVorgaenge();
  const [offen, setOffen] = useState(false);

  const anzahl = wartend.length + gescheitert.length;
  if (anzahl === 0) return null;

  const nurGescheitert = wartend.length === 0;
  const text = nurGescheitert
    ? `${gescheitert.length} ${gescheitert.length === 1 ? 'Vorgang wurde' : 'Vorgänge wurden'} nicht gesendet`
    : `${wartend.length} ${wartend.length === 1 ? 'Vorgang wird' : 'Vorgänge werden'} gesendet`;

  return (
    <>
      <button
        type="button"
        className="app-wartende-leiste"
        data-variante={nurGescheitert ? 'danger' : 'warning'}
        onClick={() => setOffen(true)}
      >
        <IonIcon icon={nurGescheitert ? alertCircleOutline : timeOutline} />
        <span className="app-wartende-leiste__text">{text}</span>
        <IonIcon icon={chevronForwardOutline} className="app-wartende-leiste__pfeil" />
      </button>

      <IonModal isOpen={offen} onDidDismiss={() => setOffen(false)}>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Warteschlange</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setOffen(false)}>Fertig</IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <WartendeVorgaengeKarte
            wartend={wartend}
            gescheitert={gescheitert}
            onVergessen={vergessen}
          />
          {gescheitert.length > 1 && (
            <div style={{ padding: '0 16px 16px' }}>
              <IonButton expand="block" fill="clear" onClick={alleVergessen}>
                Alle Fehlschläge wegwischen
              </IonButton>
            </div>
          )}
        </IonContent>
      </IonModal>
    </>
  );
};

export default WartendeVorgaengeLeiste;
