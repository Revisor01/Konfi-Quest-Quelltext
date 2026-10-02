import React from 'react';


interface FortschrittsBalkenProps {
  prozent: number;
  /** Für Vorlesehilfen, etwa "Datei wird geladen: 40 Prozent". */
  beschriftung: string;
}

/**
 * Der dünne Balken unter dem Text. Er nimmt die Textfarbe seiner Umgebung an
 * (currentColor) und passt so in eine farbige Sprechblase wie auf eine helle
 * Karte.
 */
const FortschrittsBalken: React.FC<FortschrittsBalkenProps> = ({ prozent, beschriftung }) => (
  <div
    role="progressbar"
    aria-valuenow={prozent}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-label={beschriftung}
    style={{
      height: '3px',
      marginTop: 'var(--app-abstand-mini)',
      borderRadius: 'var(--app-abstand-winzig)',
      backgroundColor: 'currentColor',
      opacity: 0.25,
      overflow: 'hidden'
    }}
  >
    <div style={{
      width: `${prozent}%`,
      height: '100%',
      backgroundColor: 'currentColor',
      borderRadius: 'var(--app-abstand-winzig)',
      transition: 'width 0.2s ease-out'
    }} />
  </div>
);

export default FortschrittsBalken;
