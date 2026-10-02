import React from 'react';
import FortschrittsBalken from './FortschrittsBalken';
import { ladeText } from '../../utils/fortschritt';


interface LadeStandZeileProps {
  /** Lädt diese Datei gerade? */
  laedt: boolean;
  prozent: number | null;
  /** Was sonst dasteht, etwa "2,4 MB". */
  sonst: React.ReactNode;
  /** Farbe des Balkens, etwa "var(--app-text-material)". */
  farbe: string;
}

const LadeStandZeile: React.FC<LadeStandZeileProps> = ({ laedt, prozent, sonst, farbe }) => (
  <>
    <div className="app-list-item__meta">
      <span className="app-list-item__meta-item" aria-live={laedt ? 'polite' : undefined}>
        {laedt ? ladeText(prozent) : sonst}
      </span>
    </div>
    {laedt && prozent != null && (
      <div style={{ color: farbe }}>
        <FortschrittsBalken prozent={prozent} beschriftung={`Datei wird geladen: ${prozent} Prozent`} />
      </div>
    )}
  </>
);

export default LadeStandZeile;
