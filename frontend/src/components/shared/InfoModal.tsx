import React from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButton,
  IonButtons, IonIcon,
} from '@ionic/react';
import { ICON_SCHLIESSEN } from './icons';

export interface InfoModalProps {
  onClose: () => void;
  title: string;
  icon: string;
  // CSS-Farbe (z.B. var(--app-color-jahrgang)) für Icon-Kreis + Akzent.
  color?: string;
  // Absatzweise Erklaerung. Jeder Eintrag wird als eigener Absatz gerendert.
  paragraphs: string[];
}

// Schlichtes, wiederverwendbares Info-/Erklaer-Modal. Wird über das (i)-Symbol
// an Eintraegen der "Mehr"-Seite geoeffnet und erklärt einen Bereich genauer.
const InfoModal: React.FC<InfoModalProps> = ({ onClose, title, icon, color = 'var(--app-color-info)', paragraphs }) => (
  <IonPage>
    <IonHeader>
      <IonToolbar>
        <IonButtons slot="start">
          <IonButton className="app-modal-close-btn" onClick={onClose} aria-label="Schließen">
            <IonIcon icon={ICON_SCHLIESSEN} slot="icon-only" />
          </IonButton>
        </IonButtons>
        <IonTitle>{title}</IonTitle>
      </IonToolbar>
    </IonHeader>
    <IonContent className="app-gradient-background">
      <div style={{ padding: 'var(--app-abstand-weit) var(--app-abstand-gross)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            width: '88px', height: '88px', borderRadius: 'var(--app-radius-modal)',
            background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 'var(--app-abstand-gross)', boxShadow: 'var(--app-schatten-hoch)'
          }}
        >
          <IonIcon icon={icon} style={{ fontSize: 'var(--app-anzeige-gross)', color: 'white' }} />
        </div>
        <h1 style={{ fontSize: 'var(--app-text-titel-gross)', fontWeight: 'var(--app-schrift-extrafett)', margin: '0 0 var(--app-abstand-basis)', textAlign: 'center', color: 'var(--app-text-emphasis)' }}>
          {title}
        </h1>
        <div style={{ maxWidth: '520px', width: '100%' }}>
          {paragraphs.map((p, i) => (
            <p key={i} style={{ fontSize: 'var(--app-text-standard)', lineHeight: 1.6, color: 'var(--app-text-primary)', margin: '0 0 var(--app-abstand-mittelweit)' }}>
              {p}
            </p>
          ))}
        </div>
      </div>
    </IonContent>
  </IonPage>
);

export default InfoModal;
