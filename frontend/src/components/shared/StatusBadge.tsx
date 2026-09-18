import React from 'react';
import { IonIcon } from '@ionic/react';
import {
  ICON_ABSAGE,
  ICON_ANWESEND,
  ICON_ENTFERNEN_GEFUELLT,
  ICON_FLAMME_GEFUELLT,
  ICON_HAKEN_GEFUELLT,
  ICON_INFO_GEFUELLT,
  ICON_KREIS_LEER,
  ICON_PLUS_KREIS_GEFUELLT,
  ICON_SCHLIESSEN_GEFUELLT,
  ICON_SCHUTZ_GEFUELLT,
  ICON_SICHTBAR_GEFUELLT,
  ICON_SPERRE_GEFUELLT,
  ICON_UHRZEIT,
  ICON_VERBORGEN_GEFUELLT,
  ICON_WARTEND,
  ICON_ZUSAGE_GEFUELLT,
} from './icons';

// Mapping: Status-Text -> Icon
// SINGLE SOURCE OF TRUTH für Event-Status-Icons: dieselbe Map wird sowohl für
// das Corner-Badge als auch (über getStatusIcon) für das grosse Kreis-Icon
// vorne genutzt -> Kreis und Badge zeigen IMMER dasselbe Icon pro Zustand.
// Durchgehend "Kreis"-Icons für Event-Status (einheitliche runde Symbole).
const STATUS_ICON_MAP: Record<string, string> = {
  // Events
  'Offen': ICON_PLUS_KREIS_GEFUELLT,        // Plus im Kreis = "anmelden/hinzufuegen"
  'Verbuchen': ICON_KREIS_LEER,  // leerer Kreis = "noch offen, muss verbucht werden"
  'Verbucht': ICON_ZUSAGE_GEFUELLT,
  'Pflicht': ICON_SCHUTZ_GEFUELLT,
  'Abgesagt': ICON_ABSAGE,
  'Konfirmation': ICON_FLAMME_GEFUELLT,
  'Warteliste': ICON_WARTEND,
  'Ausgebucht': ICON_SPERRE_GEFUELLT,  // geschlossenes Schloss = eindeutig "zu / keine Anmeldung"
  'Bald': ICON_UHRZEIT,
  'Geschlossen': ICON_SPERRE_GEFUELLT,
  'Nur Info': ICON_INFO_GEFUELLT,
  'Vergangen': ICON_UHRZEIT,
  // Konfi-/Teamer-Event Status
  'Angemeldet': ICON_ZUSAGE_GEFUELLT,
  'Dabei': ICON_ZUSAGE_GEFUELLT,  // Teamer "Dabei" = angemeldet
  'Gebucht': ICON_ZUSAGE_GEFUELLT,
  'Anwesend': ICON_ANWESEND,  // Doppelhaken IM Kreis -> passt zur Kreis-Haken-Familie (Angemeldet/Dabei)
  'Abwesend': ICON_ABSAGE,
  'Gefehlt': ICON_ABSAGE,
  'Abgemeldet': ICON_ABSAGE,
  // Von der Leitung nachgetragene Abmeldung. Eigenes Zeichen,
  // weil es weder ein Fehlen (Kreuz) noch eine Selbstabmeldung ist: der
  // Minus-Kreis sagt "faellt heraus", ohne zu werten.
  'Abgemeldet (nachgetragen)': ICON_ENTFERNEN_GEFUELLT,
  // Eigene Absage der Teamer:innen. Fehlte hier, deshalb fiel das Badge auf
  // die Text-Variante zurueck und schrieb "Abgesagt von dir" lang aus, waehrend
  // jeder andere Zustand ein Symbol zeigt. Gleiches Zeichen
  // wie 'Abgesagt' und 'Abgemeldet' -- es ist dieselbe Aussage.
  'Abgesagt von dir': ICON_ABSAGE,
  'Verpasst': ICON_ABSAGE,
  'Ausstehend': ICON_WARTEND,
  'Genehmigt': ICON_ZUSAGE_GEFUELLT,
  'Abgelehnt': ICON_ABSAGE,
  // Badges / generische Zustände (keine Text-Corner-Badges mehr)
  'Geheim': ICON_VERBORGEN_GEFUELLT,
  'Sichtbar': ICON_SICHTBAR_GEFUELLT,
  'Aktiv': ICON_HAKEN_GEFUELLT,
  'Inaktiv': ICON_SCHLIESSEN_GEFUELLT
};

export const getStatusIcon = (statusText: string): string | null => {
  // exact match
  if (STATUS_ICON_MAP[statusText]) return STATUS_ICON_MAP[statusText];
  // "Warteliste (3)" -> Warteliste
  const base = statusText.split(/\s*\(/)[0].trim();
  return STATUS_ICON_MAP[base] || null;
};

interface StatusBadgeProps {
  statusText: string;
  statusColor: string;
}

/**
 * Corner-Badge mit Icon statt Text.
 * Faellt auf Text zurück, wenn für den Status kein Icon gemappt ist.
 */
const StatusBadge: React.FC<StatusBadgeProps> = ({ statusText, statusColor }) => {
  const icon = getStatusIcon(statusText);

  if (icon) {
    return (
      <div
        className="app-corner-badge"
        style={{
          backgroundColor: statusColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--app-abstand-mini) var(--app-abstand-eng)'
        }}
        title={statusText}
      >
        <IonIcon icon={icon} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
      </div>
    );
  }

  return (
    <div className="app-corner-badge" style={{ backgroundColor: statusColor }}>
      {statusText}
    </div>
  );
};

export default StatusBadge;
