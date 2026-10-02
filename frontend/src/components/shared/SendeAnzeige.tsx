import React from 'react';
import FortschrittsBalken from './FortschrittsBalken';
import { sendeText } from '../../utils/fortschritt';

// Die Anzeige beim Hochladen unter der Kopfzeile eines Formulars: "Wird
// gesendet… 40 %" mit Balken, bei 100 % "Wird verarbeitet…" — der Server
// verschlüsselt dann noch.

interface SendeAnzeigeProps {
  /** 0–100; bei 0 (noch nichts unterwegs) steht nichts da. */
  prozent: number;
  /** Was gesendet wird, für Vorlesehilfen, etwa "Beitrag", "Foto". */
  was: string;
  /** Farbe des Balkens, etwa "var(--app-text-challenges)". */
  farbe: string;
}

const SendeAnzeige: React.FC<SendeAnzeigeProps> = ({ prozent, was, farbe }) => {
  if (prozent <= 0) return null;
  return (
    <div
      aria-live="polite"
      style={{
        padding: '0 var(--app-abstand-basis) var(--app-abstand-eng)',
        fontSize: 'var(--app-text-klein)',
        color: 'var(--app-text-secondary)'
      }}
    >
      {sendeText(prozent)}
      <div style={{ color: farbe }}>
        <FortschrittsBalken prozent={prozent} beschriftung={`${was} wird gesendet: ${prozent} Prozent`} />
      </div>
    </div>
  );
};

export default SendeAnzeige;
