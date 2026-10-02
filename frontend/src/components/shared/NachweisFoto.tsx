import React from 'react';
import MedienPlatzhalter from './MedienPlatzhalter';
import { useMedienDatei } from '../../hooks/useMedienDatei';

// Das Nachweisfoto eines Antrags — EINE Anzeige für Konfi und Team (eigener
// Antrag, solange er offen ist) und die Leitung (Antrag prüfen, Konfi-Detail).
//
// Vorher hatte jede der drei Stellen einen eigenen Lader per api.get: Die
// Konfi-Ansicht zeigte "Lade Foto..." und bei einem Fehler den Rat, die Seite
// herunterzuziehen; die Leitung sah bei einem Fehler "Lade Foto..." für
// immer; das Konfi-Detail der Leitung lud erst still und öffnete dann. Keine
// Stelle zeigte, wie weit das Laden ist, keine kannte "ohne Netz".
//
// Wechselt der Antrag, gehört ein `key` an die Anzeige (Antrags-ID): Sie
// beginnt dann neu, statt kurz das Foto des vorigen Antrags zu zeigen.

interface NachweisFotoProps {
  antragId: number;
  /** Route der Leitung (jeder Stand); sonst die eigene von Konfi und Team. */
  leitung?: boolean;
  /** Ganze Fläche, Foto eingepasst (Foto-Ansicht im Konfi-Detail). */
  vollflaeche?: boolean;
}

const NachweisFoto: React.FC<NachweisFotoProps> = ({ antragId, leitung = false, vollflaeche = false }) => {
  const { url, zustand, prozent, erneutVersuchen } = useMedienDatei(String(antragId), {
    quelle: leitung ? 'nachweisfotoLeitung' : 'nachweisfoto',
  });

  if (url) {
    return (
      <img
        src={url}
        alt="Foto zur Aktivität"
        style={vollflaeche
          ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 'var(--app-radius-klein)' }
          : { maxWidth: '100%', borderRadius: 'var(--app-radius-klein)', boxShadow: 'var(--app-schatten-karte)', display: 'block' }}
      />
    );
  }

  return (
    <div
      style={{
        width: vollflaeche ? '100%' : undefined,
        background: 'var(--app-surface-muted)',
        borderRadius: 'var(--app-radius-karte)',
        padding: 'var(--app-abstand-weit) var(--app-abstand-basis)',
        color: 'var(--app-text-secondary)'
      }}
    >
      <MedienPlatzhalter zustand={zustand} prozent={prozent} was="Das Foto" onErneut={erneutVersuchen} />
    </div>
  );
};

export default NachweisFoto;
