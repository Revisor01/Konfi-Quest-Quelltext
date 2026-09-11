import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_FLAMME_GEFUELLT, ICON_GRUPPE_GEFUELLT, ICON_SCHUTZ_GEFUELLT } from './icons';
import StatusBadge from './StatusBadge';

// Gemeinsame Corner-Badge-Reihe für Event-Cards (zuvor pro Rolle dupliziert).
// Reihenfolge: Team -> Konfirmation -> Pflicht -> Status. Jeweils mit Separator
// dazwischen. Welche Badges sichtbar sind, ergibt sich aus den event-Flags;
// der Status-Badge wird nur gezeigt, wenn showStatus gesetzt ist.
//
// Bewusst datengetrieben (kein role-Prop): jede Rolle uebergibt einfach ihr
// event + die rollenspezifisch berechneten statusText/statusColor.

interface EventCornerBadgesProps {
  event: {
    teamer_only?: boolean;
    teamer_needed?: boolean;
    is_konfirmation?: boolean;
    mandatory?: boolean;
  };
  statusText?: string;
  statusColor?: string;
  // Status-Badge anzeigen? (Konfi blendet ihn in manchen Faellen aus.)
  showStatus?: boolean;
  // Optisches Ausgrauen (z.B. gesperrte Konfirmations-Events).
  grayOut?: boolean;
  // Team-Badge ausblenden (Konfis geht "Teamer gesucht" nichts an).
  hideTeam?: boolean;
}

const badgeStyle = (bg: string): React.CSSProperties => ({
  backgroundColor: bg,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--app-abstand-mini) var(--app-abstand-eng)',
});

const iconStyle: React.CSSProperties = { color: 'white', fontSize: 'var(--app-text-sekundaer)' };

const Separator = () => <div className="app-corner-badges__separator" />;

const EventCornerBadges: React.FC<EventCornerBadgesProps> = ({
  event,
  statusText,
  statusColor,
  showStatus = true,
  grayOut = false,
  hideTeam = false,
}) => {
  const isTeam = !hideTeam && (event.teamer_only || event.teamer_needed);
  const isKonfirmation = event.is_konfirmation === true;
  const isMandatory = event.mandatory === true;

  // Nichts zu zeigen -> nicht rendern (vermeidet leere Badge-Leiste).
  if (!isTeam && !isKonfirmation && !isMandatory && !showStatus) return null;

  return (
    <div className="app-corner-badges" style={{ opacity: grayOut ? 0.5 : 1 }}>
      {isTeam && (
        <>
          <div
            className="app-corner-badge"
            style={badgeStyle('var(--app-color-teamer)')}
            title={event.teamer_only ? 'Nur Team' : 'Team gesucht'}
          >
            <IonIcon icon={ICON_GRUPPE_GEFUELLT} style={iconStyle} />
          </div>
          <Separator />
        </>
      )}
      {isKonfirmation && (
        <>
          <div className="app-corner-badge" style={badgeStyle('var(--app-color-konfis)')} title="Konfirmation">
            <IonIcon icon={ICON_FLAMME_GEFUELLT} style={iconStyle} />
          </div>
          <Separator />
        </>
      )}
      {isMandatory && (
        <>
          <div className="app-corner-badge" style={badgeStyle('var(--app-color-events)')} title="Pflichtveranstaltung">
            <IonIcon icon={ICON_SCHUTZ_GEFUELLT} style={iconStyle} />
          </div>
          <Separator />
        </>
      )}
      {showStatus && statusText && (
        <StatusBadge statusText={statusText} statusColor={statusColor ?? 'var(--app-text-system)'} />
      )}
    </div>
  );
};

export default EventCornerBadges;
