import React from 'react';
import { IonIcon } from '@ionic/react';
import { timeOutline, alertCircleOutline } from 'ionicons/icons';
import { useApp } from '../../contexts/AppContext';

/**
 * Hinweis-Banner fuer laufende Testphasen.
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
  const days = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  // Abgelaufen wird serverseitig per Login/Refresh gesperrt — hier nur laufende Trials
  if (days < 0) return null;

  const isUrgent = days <= 7;
  const accent = isUrgent ? '#dc2626' : '#667eea';
  const bg = isUrgent ? 'rgba(220, 38, 38, 0.08)' : 'rgba(102, 126, 234, 0.08)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        margin: '0 16px 12px',
        padding: '12px 14px',
        background: bg,
        border: `1px solid ${accent}33`,
        borderRadius: '12px',
        ...style
      }}
    >
      <IonIcon
        icon={isUrgent ? alertCircleOutline : timeOutline}
        style={{ color: accent, fontSize: '1.3rem', flexShrink: 0 }}
      />
      <div style={{ fontSize: '0.88rem', color: '#333', lineHeight: 1.35 }}>
        <strong style={{ color: accent }}>
          {days === 0
            ? 'Testphase endet heute'
            : `Testphase: noch ${days} Tag${days === 1 ? '' : 'e'}`}
        </strong>
        <div style={{ color: '#666', fontSize: '0.82rem' }}>
          Läuft bis {end.toLocaleDateString('de-DE')}. Danach wird der Zugang gesperrt.
        </div>
      </div>
    </div>
  );
};

export default TrialBanner;
