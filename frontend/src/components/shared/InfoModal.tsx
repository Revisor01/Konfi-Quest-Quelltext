import React from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButton,
  IonButtons, IonIcon,
} from '@ionic/react';
import { closeOutline } from 'ionicons/icons';

export interface InfoModalProps {
  onClose: () => void;
  title: string;
  icon: string;
  // CSS-Farbe (z.B. var(--app-color-jahrgang)) fuer Icon-Kreis + Akzent.
  color?: string;
  // Absatzweise Erklaerung. Jeder Eintrag wird als eigener Absatz gerendert.
  paragraphs: string[];
}

// Schlichtes, wiederverwendbares Info-/Erklaer-Modal. Wird ueber das (i)-Symbol
// an Eintraegen der "Mehr"-Seite geoeffnet und erklaert einen Bereich genauer.
const InfoModal: React.FC<InfoModalProps> = ({ onClose, title, icon, color = 'var(--app-color-info)', paragraphs }) => (
  <IonPage>
    <IonHeader>
      <IonToolbar>
        <IonButtons slot="start">
          <IonButton className="app-modal-close-btn" onClick={onClose}>
            <IonIcon icon={closeOutline} slot="icon-only" />
          </IonButton>
        </IonButtons>
        <IonTitle>{title}</IonTitle>
      </IonToolbar>
    </IonHeader>
    <IonContent className="app-gradient-background">
      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            width: '88px', height: '88px', borderRadius: '24px',
            background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: '20px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
          }}
        >
          <IonIcon icon={icon} style={{ fontSize: '2.6rem', color: '#fff' }} />
        </div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 16px', textAlign: 'center', color: '#1a1a1a' }}>
          {title}
        </h1>
        <div style={{ maxWidth: '520px', width: '100%' }}>
          {paragraphs.map((p, i) => (
            <p key={i} style={{ fontSize: '1rem', lineHeight: 1.6, color: '#3a3a3a', margin: '0 0 14px' }}>
              {p}
            </p>
          ))}
        </div>
      </div>
    </IonContent>
  </IonPage>
);

export default InfoModal;
