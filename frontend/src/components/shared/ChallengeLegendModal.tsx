import React from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButton,
  IonButtons, IonIcon,
} from '@ionic/react';
import {
  closeOutline, flag, timeOutline, checkmarkOutline, removeCircleOutline,
  eyeOffOutline, eyeOutline, lockClosedOutline, paperPlaneOutline, calendarOutline,
  createOutline, archiveOutline,
} from 'ionicons/icons';

export interface ChallengeLegendModalProps {
  onClose: () => void;
}

interface LegendEntry {
  color: string;
  icon: string;
  label: string;
  description: string;
}

// Status-Legende für die Challenge-Verwaltung. Farbe UND Icon müssen mit
// ChallengesManageView (Listen-Badges) und ChallengeLeitungModal
// (STATUS_BADGE/CONSENT_BADGE) uebereinstimmen.

// Status-Badges in der Challenge-Liste — Farbe UND Icon identisch zu
// STATUS_COLOR/STATUS_ICON in ChallengesManageView (jeder Status eigenes Icon).
const STATUS_ENTRIES: LegendEntry[] = [
  {
    color: 'var(--app-color-success-strong)',
    icon: flag,
    label: 'Aktiv',
    description: 'Die Challenge läuft, Konfis können Beiträge einreichen.',
  },
  {
    color: '#007aff',
    icon: calendarOutline,
    label: 'Geplant',
    description: 'Die Challenge startet erst noch.',
  },
  {
    color: '#8e8e93',
    icon: createOutline,
    label: 'Entwurf',
    description: 'Die Challenge ist noch nicht veröffentlicht — du findest sie im Reiter "Geplant".',
  },
  {
    color: '#6b7280',
    icon: archiveOutline,
    label: 'Beendet',
    description: 'Die Challenge ist abgelaufen (Archiv).',
  },
];

const COUNTER_ENTRY: LegendEntry = {
  color: '#ff9500',
  icon: timeOutline,
  label: 'Zahl mit Uhr',
  description: 'So viele Beiträge warten noch auf Freigabe.',
};

// Moderations-Badges aus ChallengeLeitungModal (STATUS_BADGE + CONSENT_BADGE).
const MODERATION_ENTRIES: LegendEntry[] = [
  {
    color: 'var(--app-color-warning)',
    icon: timeOutline,
    label: 'Wartet auf Freigabe',
    description: 'Der Beitrag wurde eingereicht und muss noch geprüft werden.',
  },
  {
    color: 'var(--app-color-success-strong)',
    icon: checkmarkOutline,
    label: 'Freigegeben',
    description: 'Der Beitrag wurde geprüft und freigegeben.',
  },
  {
    color: 'var(--app-color-danger)',
    icon: removeCircleOutline,
    label: 'Ausgeblendet',
    description: 'Der Beitrag wurde ausgeblendet und ist nicht sichtbar.',
  },
  {
    color: 'var(--app-color-success-strong)',
    icon: eyeOutline,
    label: 'Mit Namen sichtbar',
    description: 'Der Beitrag erscheint in der Galerie mit dem Namen. Du kannst ihn anonym stellen — das gilt dann dauerhaft.',
  },
  {
    color: '#7c3aed',
    icon: eyeOffOutline,
    label: 'Anonym sichtbar',
    description: 'Der Beitrag erscheint ohne Namen — so gewählt vom Konfi oder von euch. Ihr seht weiterhin, von wem er stammt.',
  },
  {
    color: '#6b7280',
    icon: lockClosedOutline,
    label: 'Nur Leitung',
    description: 'Der Beitrag darf nur von der Leitung gesehen werden. Diese Zusage lässt sich nicht ändern.',
  },
];

const KONFI_ENTRY: LegendEntry = {
  color: 'var(--app-color-challenges)',
  icon: paperPlaneOutline,
  label: 'Teilgenommen',
  description: 'Zeigt an, dass bereits ein eigener Beitrag eingereicht wurde — auch wenn er noch auf Freigabe wartet.',
};

const renderRow = (entry: LegendEntry, i: number) => (
  <div
    key={i}
    style={{
      display: 'flex', alignItems: 'center', gap: '14px',
      background: 'rgba(255,255,255,0.7)', borderRadius: '14px',
      padding: '12px 14px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
    }}
  >
    <div
      style={{
        width: '40px', height: '40px', flexShrink: 0, borderRadius: '50%',
        background: entry.color, display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <IonIcon icon={entry.icon} style={{ color: '#fff', fontSize: '1.25rem' }} />
    </div>
    <div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1a1a1a', marginBottom: '2px' }}>
        {entry.label}
      </div>
      <div style={{ fontSize: '0.9rem', lineHeight: 1.45, color: '#4a4a4a' }}>
        {entry.description}
      </div>
    </div>
  </div>
);

// Erklaert Farben + Icons der Challenge-Verwaltung. Wird über das (i)-Symbol
// im Challenges-Header geoeffnet (analog EventLegendModal).
const ChallengeLegendModal: React.FC<ChallengeLegendModalProps> = ({ onClose }) => {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={onClose} aria-label="Schließen">
              <IonIcon icon={closeOutline} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>Farben & Symbole</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background">
        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div
            style={{
              width: '88px', height: '88px', borderRadius: '24px',
              background: 'var(--app-color-challenges)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: '20px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
            }}
          >
            <IonIcon icon={flag} style={{ fontSize: '2.6rem', color: '#fff' }} />
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 8px', textAlign: 'center', color: '#1a1a1a' }}>
            Farben & Symbole
          </h1>
          <p style={{ fontSize: '1rem', lineHeight: 1.6, color: '#3a3a3a', margin: '0 0 20px', textAlign: 'center', maxWidth: '520px' }}>
            Farbe und Symbol an jeder Challenge zeigen ihren Status:
          </p>
          <div style={{ maxWidth: '520px', width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {STATUS_ENTRIES.map(renderRow)}
            {renderRow(COUNTER_ENTRY, STATUS_ENTRIES.length)}
          </div>

          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '28px 0 6px', textAlign: 'center', color: '#1a1a1a' }}>
            Beiträge prüfen
          </h2>
          <p style={{ fontSize: '0.95rem', lineHeight: 1.5, color: '#3a3a3a', margin: '0 0 16px', textAlign: 'center', maxWidth: '520px' }}>
            Diese Symbole erscheinen bei den einzelnen Beiträgen in der Moderation:
          </p>
          <div style={{ maxWidth: '520px', width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {MODERATION_ENTRIES.map(renderRow)}
          </div>

          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '28px 0 6px', textAlign: 'center', color: '#1a1a1a' }}>
            Eigene Teilnahme
          </h2>
          <p style={{ fontSize: '0.95rem', lineHeight: 1.5, color: '#3a3a3a', margin: '0 0 16px', textAlign: 'center', maxWidth: '520px' }}>
            Dieses Symbol steht bei Challenges, bei denen bereits ein eigener Beitrag eingereicht wurde:
          </p>
          <div style={{ maxWidth: '520px', width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {renderRow(KONFI_ENTRY, 0)}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default ChallengeLegendModal;
