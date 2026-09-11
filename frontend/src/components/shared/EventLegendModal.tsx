import React from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButton,
  IonButtons, IonIcon,
} from '@ionic/react';
import {
  ICON_ABSAGE,
  ICON_ANWESEND,
  ICON_FLAMME_GEFUELLT,
  ICON_GRUPPE_GEFUELLT,
  ICON_INFO_GEFUELLT,
  ICON_KREIS_LEER,
  ICON_PLUS_KREIS_GEFUELLT,
  ICON_SCHLIESSEN,
  ICON_SCHUTZ_GEFUELLT,
  ICON_SPERRE_GEFUELLT,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT,
  ICON_WARTEND,
  ICON_ZUSAGE_GEFUELLT,
} from './icons';

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

// Status-Legende für Events. Farbe UND Icon müssen mit den EventsViews
// uebereinstimmen (gleiche --app-color-Tokens, Icons aus StatusBadge-Map).
// Reihenfolge: erst "Zusatz-Marker" (Team/Konfirmation/Pflicht als Eck-Badges),
// dann die eigentlichen Status-Farben des Balkens.
const ENTRIES: LegendEntry[] = [
  // --- Status-Farben (Balken + grosses Icon) ---
  {
    color: 'var(--app-color-success)',
    icon: ICON_PLUS_KREIS_GEFUELLT,
    label: 'Anmeldung möglich',
    description: 'Du kannst dich für dieses Event anmelden.',
    variants: ['konfi', 'admin'],
  },
  {
    color: 'var(--app-color-teamer)',
    icon: ICON_PLUS_KREIS_GEFUELLT,
    label: 'Anmeldung möglich (Team)',
    description: 'Für dieses Event wird Team gesucht. Du kannst dich anmelden.',
    variants: ['teamer'],
  },
  {
    color: 'var(--app-color-neutral-hell)',
    icon: ICON_INFO_GEFUELLT,
    label: 'Nur zur Info',
    description: 'Ein Konfi-Event, zu dem du dich nicht anmelden kannst.',
    variants: ['teamer'],
  },
  {
    color: 'var(--app-color-info)',
    icon: ICON_ZUSAGE_GEFUELLT,
    label: 'Angemeldet',
    description: 'Du bist für dieses Event angemeldet.',
    variants: ['konfi', 'teamer', 'admin'],
  },
  {
    color: 'var(--app-color-success)',
    icon: ICON_ANWESEND,
    label: 'Anwesend',
    description: 'Deine Teilnahme wurde bestätigt.',
    variants: ['konfi', 'teamer'],
  },
  {
    color: 'var(--app-color-bonus)',
    icon: ICON_UHRZEIT,
    label: 'Anmeldung bald',
    description: 'Die Anmeldung für dieses Event ist noch nicht geöffnet.',
    variants: ['konfi', 'teamer', 'admin'],
  },
  {
    color: 'var(--app-color-bonus)',
    icon: ICON_WARTEND,
    label: 'Warteliste',
    description: 'Das Event ist voll, du stehst auf der Warteliste.',
    variants: ['konfi', 'admin'],
  },
  {
    color: 'var(--app-color-bonus)',
    icon: ICON_WARTEND,
    label: 'Ausstehend',
    description: 'Das Event ist vorbei, die Anwesenheit wird noch geprüft.',
    variants: ['konfi', 'teamer'],
  },
  {
    color: 'var(--app-color-info)',
    icon: ICON_KREIS_LEER,
    label: 'Verbuchen',
    description: 'Das Event ist vorbei und muss noch verbucht werden.',
    variants: ['admin'],
  },
  {
    color: 'var(--app-color-danger)',
    icon: ICON_ABSAGE,
    label: 'Absage / Abmeldung',
    description: 'Abgesagt, abgemeldet oder nicht anwesend gewesen.',
    variants: ['konfi', 'teamer', 'admin'],
  },
  {
    color: 'var(--app-color-danger)',
    icon: ICON_SPERRE_GEFUELLT,
    label: 'Ausgebucht',
    description: 'Das Event ist voll, eine Anmeldung ist nicht mehr möglich.',
    variants: ['konfi', 'admin'],
  },
  {
    color: 'var(--app-color-neutral)',
    icon: ICON_UHRZEIT,
    label: 'Vergangen',
    description: 'Dieses Event liegt in der Vergangenheit.',
    variants: ['konfi', 'teamer', 'admin'],
  },
];

// Zusatz-Marker, die als kleine Eck-Badges (oben rechts) zusätzlich erscheinen.
const MARKERS: LegendEntry[] = [
  {
    color: 'var(--app-color-teamer)',
    icon: ICON_GRUPPE_GEFUELLT,
    label: 'Team',
    description: 'Für dieses Event wird Team gesucht (oder es ist nur für das Team).',
    // Konfis geht das nichts an -> nur Teamer/Admin.
    variants: ['teamer', 'admin'],
  },
  {
    color: 'var(--app-color-konfis)',
    icon: ICON_FLAMME_GEFUELLT,
    label: 'Konfirmation',
    description: 'Ein Konfirmations-Termin.',
    variants: ['konfi', 'teamer', 'admin'],
  },
  {
    color: 'var(--app-color-events)',
    icon: ICON_SCHUTZ_GEFUELLT,
    label: 'Pflicht',
    description: 'Ein Pflicht-Event – die Teilnahme ist verbindlich.',
    variants: ['konfi', 'teamer', 'admin'],
  },
];

const renderRow = (entry: LegendEntry, i: number) => (
  <div
    key={i}
    style={{
      display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mittelweit)',
      background: 'rgba(255,255,255,0.7)', borderRadius: 'var(--app-radius-weich)',
      padding: 'var(--app-abstand-mittel) var(--app-abstand-mittelweit)', boxShadow: 'var(--app-schatten-hauch)'
    }}
  >
    <div
      style={{
        width: '40px', height: '40px', flexShrink: 0, borderRadius: 'var(--app-radius-kreis)',
        background: entry.color, display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <IonIcon icon={entry.icon} style={{ color: 'white', fontSize: 'var(--app-text-untertitel)' }} />
    </div>
    <div>
      <div style={{ fontSize: 'var(--app-text-standard)', fontWeight: 'var(--app-schrift-fett)', color: 'var(--app-text-emphasis)', marginBottom: 'var(--app-abstand-winzig)' }}>
        {entry.label}
      </div>
      <div style={{ fontSize: 'var(--app-text-basis)', lineHeight: 1.45, color: 'var(--app-text-body)' }}>
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
            <IonButton className="app-modal-close-btn" onClick={onClose} aria-label="Schließen">
              <IonIcon icon={ICON_SCHLIESSEN} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>Farben & Symbole</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background">
        <div style={{ padding: 'var(--app-abstand-weit) var(--app-abstand-gross)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div
            style={{
              width: '88px', height: '88px', borderRadius: 'var(--app-radius-modal)',
              background: 'var(--app-color-events)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 'var(--app-abstand-gross)', boxShadow: 'var(--app-schatten-hoch)'
            }}
          >
            <IonIcon icon={ICON_TERMIN_GEFUELLT} style={{ fontSize: 'var(--app-anzeige-gross)', color: 'white' }} />
          </div>
          <h1 style={{ fontSize: 'var(--app-text-titel-gross)', fontWeight: 'var(--app-schrift-extrafett)', margin: '0 0 var(--app-abstand-eng)', textAlign: 'center', color: 'var(--app-text-emphasis)' }}>
            Farben & Symbole
          </h1>
          <p style={{ fontSize: 'var(--app-text-standard)', lineHeight: 1.6, color: 'var(--app-text-primary)', margin: '0 0 var(--app-abstand-gross)', textAlign: 'center', maxWidth: '520px' }}>
            Farbe und Symbol an jedem Event zeigen seinen Status:
          </p>
          <div style={{ maxWidth: '520px', width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-schmal)' }}>
            {entries.map(renderRow)}
          </div>

          {markers.length > 0 && (
            <>
              <h2 style={{ fontSize: 'var(--app-text-gross)', fontWeight: 'var(--app-schrift-extrafett)', margin: 'var(--app-abstand-sehrweit) 0 var(--app-abstand-kompakt)', textAlign: 'center', color: 'var(--app-text-emphasis)' }}>
                Zusätzliche Markierungen
              </h2>
              <p style={{ fontSize: 'var(--app-text-betont)', lineHeight: 1.5, color: 'var(--app-text-primary)', margin: '0 0 var(--app-abstand-basis)', textAlign: 'center', maxWidth: '520px' }}>
                Diese kleinen Symbole erscheinen oben rechts am Event:
              </p>
              <div style={{ maxWidth: '520px', width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-schmal)' }}>
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
