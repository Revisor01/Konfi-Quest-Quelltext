import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_UHRZEIT, ICON_WARNHINWEIS } from './icons';
import { useApp } from '../../contexts/AppContext';
import { tageBis } from './eventFormatting';
import { FARBEN } from '../../theme/colors';

/**
 * Hinweis-Banner für laufende Testphasen.
 * Zeigt nur etwas an, wenn der eingeloggte User eine Org mit aktivem
 * trial_ends_at hat. Wird auf Konfi-, Teamer- und Admin-Dashboard verwendet.
 * super_admin (eigene Org NULL) sieht hier nichts.
 */
const TrialBanner: React.FC<{ style?: React.CSSProperties }> = ({ style }) => {
  const { user } = useApp();

  // Banner nur bei echter Testphase (is_trial). Bezahlte Lizenzen mit Ablaufdatum
  // (is_trial=false) zeigen KEINEN Hinweis, werden aber serverseitig trotzdem gesperrt.
  if (!user?.trial_ends_at || user?.is_trial !== true) return null;

  const end = new Date(user.trial_ends_at);
  // Kalendertage, nicht 24-Stunden-Bloecke: Sonst zeigt ein Ende heute Abend
  // "1 Tag" statt "heute", und ueber eine Zeitumstellung verschiebt sich alles
  // um einen Tag (siehe eventFormatting.ts).
  const days = tageBis(end);

  // Abgelaufen wird serverseitig per Login/Refresh gesperrt — hier nur laufende Trials
  if (days < 0) return null;

  const isUrgent = days <= 7;
  // Echte Hexwerte: unten wird `${accent}33` gerechnet — var() geht nicht.
  const accent = isUrgent ? FARBEN.events : FARBEN.users;
  const bg = isUrgent ? 'rgba(var(--app-color-events-rgb), 0.08)' : 'rgba(var(--app-color-users-rgb), 0.08)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--app-abstand-schmal)',
        margin: '0 var(--app-abstand-basis) var(--app-abstand-mittel)',
        padding: 'var(--app-abstand-mittel) var(--app-abstand-mittelweit)',
        background: bg,
        border: `1px solid ${accent}33`,
        borderRadius: 'var(--app-radius-karte)',
        ...style
      }}
    >
      <IonIcon
        icon={isUrgent ? ICON_WARNHINWEIS : ICON_UHRZEIT}
        style={{ color: accent, fontSize: 'var(--app-text-titel)', flexShrink: 0 }}
      />
      <div style={{ fontSize: 'var(--app-text-basis)', color: 'var(--app-text-primary)', lineHeight: 1.35 }}>
        <strong style={{ color: accent }}>
          {days === 0
            ? 'Testphase endet heute'
            : `Testphase: noch ${days} Tag${days === 1 ? '' : 'e'}`}
        </strong>
        <div style={{ color: 'var(--app-text-secondary)', fontSize: 'var(--app-text-hinweis)' }}>
          Läuft bis {end.toLocaleDateString('de-DE')}. Danach wird der Zugang gesperrt.
        </div>
      </div>
    </div>
  );
};

export default TrialBanner;
