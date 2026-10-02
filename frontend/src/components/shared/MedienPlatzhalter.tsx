import React from 'react';
import { IonButton } from '@ionic/react';
import OfflinePlatzhalter from './OfflinePlatzhalter';
import FortschrittsBalken from './FortschrittsBalken';
import { ladeText } from '../../utils/fortschritt';
import type { MedienZustand } from '../../hooks/useMedienDatei';

// Was an der Stelle eines Bildes, Videos oder einer Aufnahme steht, solange
// es noch nicht da ist — im Chat wie in den Challenges gleich:
//
//  - beim Laden die Anzeige aus dem Chat: "Wird geladen… 40 %" mit Balken
//  - bei einem Fehler ein Satz und "Erneut versuchen" (vorher: nur ein Satz,
//    ein zweiter Versuch ging erst nach dem Verlassen der Ansicht)
//  - ohne Netz die graue Zeile mit Wolke, wie überall in der App, statt einer
//    Ladeanzeige, die bis zum Zeitlimit steht
//  - gelöscht oder kein Zugriff mehr: "… ist nicht mehr verfügbar." ohne
//    zweiten Versuch

interface MedienPlatzhalterProps {
  zustand: MedienZustand;
  prozent: number | null;
  /** Mit Artikel, etwa "Das Bild", "Das Video", "Die Aufnahme". */
  was: string;
  onErneut: () => void;
  /** Heller Text auf dunklem Grund (Video-Vorschau). */
  dunkel?: boolean;
}

const MedienPlatzhalter: React.FC<MedienPlatzhalterProps> = ({ zustand, prozent, was, onErneut, dunkel }) => {
  if (zustand === 'offline') {
    return <OfflinePlatzhalter was={was} />;
  }

  if (zustand === 'weg') {
    // Gelöscht oder kein Zugriff mehr: Ein zweiter Versuch hülfe nicht.
    return (
      <div style={{ textAlign: 'center', fontSize: 'var(--app-text-sekundaer)', padding: '0 var(--app-abstand-basis)' }}>
        {was} ist nicht mehr verfügbar.
      </div>
    );
  }

  if (zustand === 'fehler') {
    return (
      <div style={{ textAlign: 'center', fontSize: 'var(--app-text-sekundaer)' }}>
        <div>{was} konnte nicht geladen werden.</div>
        <IonButton
          fill="outline"
          color={dunkel ? 'light' : undefined}
          style={{ marginTop: 'var(--app-abstand-eng)' }}
          onClick={(e) => {
            // Die Anzeige sitzt oft in einer antippbaren Karte oder
            // Sprechblase — der Tipp gilt nur dem zweiten Versuch.
            e.stopPropagation();
            onErneut();
          }}
        >
          Erneut versuchen
        </IonButton>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', padding: '0 var(--app-abstand-basis)', fontSize: 'var(--app-text-sekundaer)', textAlign: 'center' }}>
      <div>{ladeText(prozent)}</div>
      {prozent != null && (
        <FortschrittsBalken prozent={prozent} beschriftung={`${was} wird geladen: ${prozent} Prozent`} />
      )}
    </div>
  );
};

export default MedienPlatzhalter;
