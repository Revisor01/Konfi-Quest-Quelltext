import React from 'react';
import UpdateHinweisKarte from './UpdateHinweisKarte';
import MitmachenHinweisKarte from './MitmachenHinweisKarte';

interface NeuerungenBannerProps {
  /** Öffnet den "Was ist neu"-Walkthrough der jeweiligen Rolle. */
  onUpdateOeffnen: () => void;
  /** Öffnet die Erklärung zum Mitmachen-Tab. */
  onMitmachenOeffnen: () => void;
  /**
   * Weggeklickt werden kann nur auf der Startseite. Fehlen die beiden
   * Handler, stehen die Banner dauerhaft — so wie im Profil und unter "Mehr".
   */
  onUpdateAusblenden?: () => void;
  onMitmachenAusblenden?: () => void;
  /**
   * Sichtbarkeit je Banner. Ohne Angabe sichtbar — im Profil sollen beide
   * immer stehen, dort gibt es keine Flags.
   */
  updateSichtbar?: boolean;
  mitmachenSichtbar?: boolean;
  /** Aussenabstand, damit die Banner zur jeweiligen Seite passen. */
  style?: React.CSSProperties;
}

// Die beiden Neuerungs-Banner als EIN Bauteil: rosa "Was ist neu?" und gruen
// "Events und Aktivitaeten".
//
// Zwei Spielarten, sonst identisch:
// - Profil und "Mehr": dauerhaft, kein X (Handler weglassen).
// - Startseite: wegklickbar, mit X (Handler uebergeben).
const NeuerungenBanner: React.FC<NeuerungenBannerProps> = ({
  onUpdateOeffnen,
  onMitmachenOeffnen,
  onUpdateAusblenden,
  onMitmachenAusblenden,
  updateSichtbar = true,
  mitmachenSichtbar = true,
  style = { margin: 'var(--app-abstand-basis)' },
}) => (
  <>
    {updateSichtbar && (
      <UpdateHinweisKarte
        style={style}
        onOpen={onUpdateOeffnen}
        onDismiss={onUpdateAusblenden}
      />
    )}
    {mitmachenSichtbar && (
      <MitmachenHinweisKarte
        style={style}
        onOpen={onMitmachenOeffnen}
        onDismiss={onMitmachenAusblenden}
      />
    )}
  </>
);

export default NeuerungenBanner;
