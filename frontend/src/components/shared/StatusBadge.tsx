import React from 'react';
import { IonIcon } from '@ionic/react';
import {
  ellipseOutline,
  checkmarkCircle,
  closeCircle,
  close,
  shieldCheckmark,
  flame,
  hourglassOutline,
  checkmark,
  timeOutline,
  lockClosed,
  eye,
  eyeOff,
  informationCircle,
  addCircle,
  checkmarkDoneCircle
} from 'ionicons/icons';

// Mapping: Status-Text -> Icon
// SINGLE SOURCE OF TRUTH fuer Event-Status-Icons: dieselbe Map wird sowohl fuer
// das Corner-Badge als auch (ueber getStatusIcon) fuer das grosse Kreis-Icon
// vorne genutzt -> Kreis und Badge zeigen IMMER dasselbe Icon pro Zustand.
// Durchgehend "Kreis"-Icons fuer Event-Status (einheitliche runde Symbole).
const STATUS_ICON_MAP: Record<string, string> = {
  // Events
  'Offen': addCircle,        // Plus im Kreis = "anmelden/hinzufuegen"
  'Verbuchen': ellipseOutline,  // leerer Kreis = "noch offen, muss verbucht werden"
  'Verbucht': checkmarkCircle,
  'Pflicht': shieldCheckmark,
  'Abgesagt': closeCircle,
  'Konfirmation': flame,
  'Warteliste': hourglassOutline,
  'Ausgebucht': lockClosed,  // geschlossenes Schloss = eindeutig "zu / keine Anmeldung"
  'Bald': timeOutline,
  'Geschlossen': lockClosed,
  'Nur Info': informationCircle,
  'Vergangen': timeOutline,
  // Konfi-/Teamer-Event Status
  'Angemeldet': checkmarkCircle,
  'Dabei': checkmarkCircle,  // Teamer "Dabei" = angemeldet
  'Gebucht': checkmarkCircle,
  'Anwesend': checkmarkDoneCircle,  // Doppelhaken IM Kreis -> passt zur Kreis-Haken-Familie (Angemeldet/Dabei)
  'Abwesend': closeCircle,
  'Gefehlt': closeCircle,
  'Abgemeldet': closeCircle,
  'Verpasst': closeCircle,
  'Ausstehend': hourglassOutline,
  // Anträge
  'Genehmigt': checkmarkCircle,
  'Abgelehnt': closeCircle,
  // Badges / generische Zustände (keine Text-Corner-Badges mehr)
  'Geheim': eyeOff,
  'Sichtbar': eye,
  'Aktiv': checkmark,
  'Inaktiv': close
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
 * Faellt auf Text zurueck, wenn fuer den Status kein Icon gemappt ist.
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
          padding: '4px 8px'
        }}
        title={statusText}
      >
        <IonIcon icon={icon} style={{ color: '#fff', fontSize: '0.85rem' }} />
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
