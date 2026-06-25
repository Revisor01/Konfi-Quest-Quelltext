import React from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButton,
  IonButtons, IonIcon,
} from '@ionic/react';
import {
  closeOutline, calendar, people, flame, shieldCheckmark,
  addCircle, checkmarkCircle, checkmarkDoneCircle, closeCircle,
  hourglassOutline, ellipseOutline, informationCircle, timeOutline, lockClosed,
} from 'ionicons/icons';

export type EventLegendVariant = 'konfi' | 'teamer' | 'admin';

export interface EventLegendModalProps {
  onClose: () => void;
  // Steuert, welche Eintraege gezeigt werden (rollenabhaengig).
  variant: EventLegendVariant;
}

interface LegendEntry {
  color: string;
  icon: string;
  label: string;
  description: string;
  variants: EventLegendVariant[];
}

// Status-Legende fuer Events. Farbe UND Icon muessen mit den EventsViews
// uebereinstimmen (gleiche --app-color-Tokens, Icons aus StatusBadge-Map).
// Reihenfolge: erst "Zusatz-Marker" (Team/Konfirmation/Pflicht als Eck-Badges),
// dann die eigentlichen Status-Farben des Balkens.
const ENTRIES: LegendEntry[] = [
  // --- Status-Farben (Balken + grosses Icon) ---
  {
    color: 'var(--app-color-success)',
    icon: addCircle,
    label: 'Anmeldung möglich',
    description: 'Du kannst dich für dieses Event anmelden.',
    variants: ['konfi', 'admin'],
  },
  {
    color: 'var(--app-color-teamer)',
    icon: addCircle,
    label: 'Anmeldung möglich (Team)',
    description: 'Dieses Event sucht Teamer:innen. Du kannst dich anmelden.',
    variants: ['teamer'],
  },
  {
    color: '#9ca3af',
    icon: informationCircle,
    label: 'Nur zur Info',
    description: 'Ein Konfi-Event, zu dem du dich nicht anmelden kannst.',
    variants: ['teamer'],
  },
  {
    color: 'var(--app-color-info)',
    icon: checkmarkCircle,
    label: 'Angemeldet',
    description: 'Du bist für dieses Event angemeldet.',
    variants: ['konfi', 'teamer', 'admin'],
  },
  {
    color: 'var(--app-color-success)',
    icon: checkmarkDoneCircle,
    label: 'Anwesend',
    description: 'Deine Teilnahme wurde bestätigt.',
    variants: ['konfi', 'teamer'],
  },
  {
    color: 'var(--app-color-bonus)',
    icon: timeOutline,
    label: 'Anmeldung bald',
    description: 'Die Anmeldung für dieses Event ist noch nicht geöffnet.',
    variants: ['konfi', 'teamer', 'admin'],
  },
  {
    color: 'var(--app-color-bonus)',
    icon: hourglassOutline,
    label: 'Warteliste',
    description: 'Das Event ist voll, du stehst auf der Warteliste.',
    variants: ['konfi', 'admin'],
  },
  {
    color: 'var(--app-color-bonus)',
    icon: hourglassOutline,
    label: 'Ausstehend',
    description: 'Das Event ist vorbei, die Anwesenheit wird noch geprüft.',
    variants: ['konfi', 'teamer'],
  },
  {
    color: 'var(--app-color-info)',
    icon: ellipseOutline,
    label: 'Verbuchen',
    description: 'Das Event ist vorbei und muss noch verbucht werden.',
    variants: ['admin'],
  },
  {
    color: 'var(--app-color-danger)',
    icon: closeCircle,
    label: 'Absage / Abmeldung',
    description: 'Abgesagt, abgemeldet oder nicht anwesend gewesen.',
    variants: ['konfi', 'teamer', 'admin'],
  },
  {
    color: 'var(--app-color-danger)',
    icon: lockClosed,
    label: 'Ausgebucht',
    description: 'Das Event ist voll, eine Anmeldung ist nicht mehr möglich.',
    variants: ['konfi', 'admin'],
  },
  {
    color: '#6c757d',
    icon: timeOutline,
    label: 'Vergangen',
    description: 'Dieses Event liegt in der Vergangenheit.',
    variants: ['konfi', 'teamer', 'admin'],
  },
];

// Zusatz-Marker, die als kleine Eck-Badges (oben rechts) zusätzlich erscheinen.
const MARKERS: LegendEntry[] = [
  {
    color: 'var(--app-color-teamer)',
    icon: people,
    label: 'Team',
    description: 'Für dieses Event werden Teamer:innen gesucht (oder es ist nur für das Team).',
    // Konfis geht das nichts an -> nur Teamer/Admin.
    variants: ['teamer', 'admin'],
  },
  {
    color: 'var(--app-color-konfis)',
    icon: flame,
    label: 'Konfirmation',
    description: 'Ein Konfirmations-Termin.',
    variants: ['konfi', 'teamer', 'admin'],
  },
  {
    color: 'var(--app-color-events)',
    icon: shieldCheckmark,
    label: 'Pflicht',
    description: 'Ein Pflicht-Event – die Teilnahme ist verbindlich.',
    variants: ['konfi', 'teamer', 'admin'],
  },
];

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

// Erklärt Farben + Icons der Event-Liste. Wird über das (i)-Symbol im
// Events-Header geöffnet.
const EventLegendModal: React.FC<EventLegendModalProps> = ({ onClose, variant }) => {
  const entries = ENTRIES.filter((e) => e.variants.includes(variant));
  const markers = MARKERS.filter((e) => e.variants.includes(variant));

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={onClose}>
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
              background: 'var(--app-color-events)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: '20px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
            }}
          >
            <IonIcon icon={calendar} style={{ fontSize: '2.6rem', color: '#fff' }} />
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 8px', textAlign: 'center', color: '#1a1a1a' }}>
            Farben & Symbole
          </h1>
          <p style={{ fontSize: '1rem', lineHeight: 1.6, color: '#3a3a3a', margin: '0 0 20px', textAlign: 'center', maxWidth: '520px' }}>
            Farbe und Symbol an jedem Event zeigen seinen Status:
          </p>
          <div style={{ maxWidth: '520px', width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {entries.map(renderRow)}
          </div>

          {markers.length > 0 && (
            <>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '28px 0 6px', textAlign: 'center', color: '#1a1a1a' }}>
                Zusätzliche Markierungen
              </h2>
              <p style={{ fontSize: '0.95rem', lineHeight: 1.5, color: '#3a3a3a', margin: '0 0 16px', textAlign: 'center', maxWidth: '520px' }}>
                Diese kleinen Symbole erscheinen oben rechts am Event:
              </p>
              <div style={{ maxWidth: '520px', width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {markers.map(renderRow)}
              </div>
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default EventLegendModal;
