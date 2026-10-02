import React from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButton,
  IonButtons, IonIcon,
} from '@ionic/react';
import {
  ICON_ARCHIV,
  ICON_BEARBEITEN,
  ICON_CHALLENGE_GEFUELLT,
  ICON_ENTFERNEN,
  ICON_HAKEN,
  ICON_SCHLIESSEN,
  ICON_SENDEN,
  ICON_SICHTBAR,
  ICON_SPERRE,
  ICON_TERMIN,
  ICON_UHRZEIT,
  ICON_VERBORGEN,
} from './icons';

export interface ChallengeLegendModalProps {
  onClose: () => void;
}

interface LegendEntry {
  color: string;
  icon?: string;
  /** Statt eines Symbols eine Zahl im Kreis (rote Kugel fuer Neues). */
  zahl?: string;
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
    icon: ICON_CHALLENGE_GEFUELLT,
    label: 'Aktiv',
    description: 'Die Challenge läuft, Konfis können Beiträge einreichen.',
  },
  {
    color: 'var(--app-color-info)',
    icon: ICON_TERMIN,
    label: 'Geplant',
    description: 'Die Challenge startet erst noch.',
  },
  {
    color: 'var(--app-text-system)',
    icon: ICON_BEARBEITEN,
    label: 'Entwurf',
    description: 'Die Challenge ist noch nicht veröffentlicht — du findest sie im Reiter "Geplant".',
  },
  {
    color: 'var(--app-color-neutral)',
    icon: ICON_ARCHIV,
    label: 'Beendet',
    description: 'Die Challenge ist abgelaufen (Archiv).',
  },
];

const COUNTER_ENTRY: LegendEntry = {
  color: 'var(--app-color-warning)',
  icon: ICON_UHRZEIT,
  label: 'Oranges Feld mit Uhr',
  description: 'An dieser Challenge warten Beiträge auf Freigabe. Wie viele, zeigt die orange Zahl an „Wartet“.',
};

const NEU_ENTRY: LegendEntry = {
  color: 'var(--app-color-danger)',
  zahl: '1',
  label: 'Rote Zahl am Symbol',
  description: 'Neue Beiträge seit deinem letzten Öffnen, auch solche, die noch auf Freigabe warten — wie ungelesene Nachrichten im Chat. Sie verschwindet beim Öffnen.',
};

// Orange Zahl im Umschalter Aktuell/Geplant/Archiv und am
// Reiter "Wartet" in der geoeffneten Challenge: nur Wartendes.
const SEGMENT_ENTRY: LegendEntry = {
  color: 'var(--app-color-warning)',
  zahl: '1',
  label: 'Orange Zahl am Umschalter und an „Wartet“',
  description: 'So viele Beiträge warten auf Freigabe — am Umschalter Aktuell, Geplant und Archiv, auch im Archiv, und in der geöffneten Challenge am Reiter „Wartet“. Neue Beiträge zählen hier nicht mit.',
};

// Moderations-Badges aus ChallengeLeitungModal (STATUS_BADGE + CONSENT_BADGE).
const MODERATION_ENTRIES: LegendEntry[] = [
  {
    color: 'var(--app-color-warning)',
    icon: ICON_UHRZEIT,
    label: 'Wartet auf Freigabe',
    description: 'Der Beitrag wurde eingereicht und muss noch geprüft werden.',
  },
  {
    color: 'var(--app-color-success-strong)',
    icon: ICON_HAKEN,
    label: 'Freigegeben',
    description: 'Der Beitrag wurde geprüft und freigegeben.',
  },
  {
    color: 'var(--app-color-danger)',
    icon: ICON_ENTFERNEN,
    label: 'Ausgeblendet',
    description: 'Der Beitrag wurde ausgeblendet und ist nicht sichtbar.',
  },
  {
    color: 'var(--app-color-success-strong)',
    icon: ICON_SICHTBAR,
    label: 'Mit Namen sichtbar',
    description: 'Der Beitrag erscheint in der Galerie mit dem Namen. Du kannst ihn anonym stellen — das gilt dann dauerhaft.',
  },
  {
    color: 'var(--app-color-wrapped)',
    icon: ICON_VERBORGEN,
    label: 'Anonym sichtbar',
    description: 'Der Beitrag erscheint ohne Namen — so gewählt vom Konfi oder von euch. Ihr seht weiterhin, von wem er stammt.',
  },
  {
    color: 'var(--app-color-neutral)',
    icon: ICON_SPERRE,
    label: 'Nur Leitung',
    description: 'Der Beitrag darf nur von der Leitung gesehen werden. Diese Zusage lässt sich nicht ändern.',
  },
];

const KONFI_ENTRY: LegendEntry = {
  color: 'var(--app-color-challenges)',
  icon: ICON_SENDEN,
  label: 'Teilgenommen',
  description: 'Zeigt an, dass bereits ein eigener Beitrag eingereicht wurde — auch wenn er noch auf Freigabe wartet.',
};

const renderRow = (entry: LegendEntry, i: number) => (
  <div
    key={i}
    style={{
      display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mittelweit)',
      background: 'var(--app-surface-card)', borderRadius: 'var(--app-radius-weich)',
      padding: 'var(--app-abstand-mittel) var(--app-abstand-mittelweit)', boxShadow: 'var(--app-schatten-hauch)'
    }}
  >
    <div
      style={{
        width: '40px', height: '40px', flexShrink: 0, borderRadius: 'var(--app-radius-kreis)',
        background: entry.color, display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      {entry.zahl
        ? <span style={{ color: 'white', fontSize: 'var(--app-text-untertitel)', fontWeight: 'var(--app-schrift-fett)' }}>{entry.zahl}</span>
        : <IonIcon icon={entry.icon} style={{ color: 'white', fontSize: 'var(--app-text-untertitel)' }} />}
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

// Erklaert Farben + Icons der Challenge-Verwaltung. Wird über das (i)-Symbol
// im Challenges-Header geoeffnet (analog EventLegendModal).
const ChallengeLegendModal: React.FC<ChallengeLegendModalProps> = ({ onClose }) => {
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
              background: 'var(--app-color-challenges)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 'var(--app-abstand-gross)', boxShadow: 'var(--app-schatten-hoch)'
            }}
          >
            <IonIcon icon={ICON_CHALLENGE_GEFUELLT} style={{ fontSize: 'var(--app-anzeige-gross)', color: 'white' }} />
          </div>
          <h1 style={{ fontSize: 'var(--app-text-titel-gross)', fontWeight: 'var(--app-schrift-extrafett)', margin: '0 0 var(--app-abstand-eng)', textAlign: 'center', color: 'var(--app-text-emphasis)' }}>
            Farben & Symbole
          </h1>
          <p style={{ fontSize: 'var(--app-text-standard)', lineHeight: 1.6, color: 'var(--app-text-primary)', margin: '0 0 var(--app-abstand-gross)', textAlign: 'center', maxWidth: '520px' }}>
            Farbe und Symbol an jeder Challenge zeigen ihren Status:
          </p>
          <div style={{ maxWidth: '520px', width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-schmal)' }}>
            {STATUS_ENTRIES.map(renderRow)}
            {renderRow(COUNTER_ENTRY, STATUS_ENTRIES.length)}
            {renderRow(NEU_ENTRY, STATUS_ENTRIES.length + 1)}
            {renderRow(SEGMENT_ENTRY, STATUS_ENTRIES.length + 2)}
          </div>

          <h2 style={{ fontSize: 'var(--app-text-gross)', fontWeight: 'var(--app-schrift-extrafett)', margin: 'var(--app-abstand-sehrweit) 0 var(--app-abstand-kompakt)', textAlign: 'center', color: 'var(--app-text-emphasis)' }}>
            Beiträge prüfen
          </h2>
          <p style={{ fontSize: 'var(--app-text-betont)', lineHeight: 1.5, color: 'var(--app-text-primary)', margin: '0 0 var(--app-abstand-basis)', textAlign: 'center', maxWidth: '520px' }}>
            Diese Symbole erscheinen bei den einzelnen Beiträgen in der Moderation:
          </p>
          <div style={{ maxWidth: '520px', width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-schmal)' }}>
            {MODERATION_ENTRIES.map(renderRow)}
          </div>

          <h2 style={{ fontSize: 'var(--app-text-gross)', fontWeight: 'var(--app-schrift-extrafett)', margin: 'var(--app-abstand-sehrweit) 0 var(--app-abstand-kompakt)', textAlign: 'center', color: 'var(--app-text-emphasis)' }}>
            Eigene Teilnahme
          </h2>
          <p style={{ fontSize: 'var(--app-text-betont)', lineHeight: 1.5, color: 'var(--app-text-primary)', margin: '0 0 var(--app-abstand-basis)', textAlign: 'center', maxWidth: '520px' }}>
            Dieses Symbol steht bei Challenges, bei denen bereits ein eigener Beitrag eingereicht wurde:
          </p>
          <div style={{ maxWidth: '520px', width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-schmal)' }}>
            {renderRow(KONFI_ENTRY, 0)}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default ChallengeLegendModal;
