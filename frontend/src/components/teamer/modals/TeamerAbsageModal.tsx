import React, { useState } from 'react';
import { useActionGuard } from '../../../hooks/useActionGuard';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonItem,
  IonLabel,
  IonTextarea,
  IonIcon,
  IonCard,
  IonCardContent,
  IonList,
  IonListHeader
} from '@ionic/react';
import { ICON_CHAT, ICON_HAKEN, ICON_SCHLIESSEN, ICON_TERMIN } from '../../shared/icons';

/**
 * Absage-Dialog fuer Teamer:innen ("Ich bin nicht dabei").
 */
interface TeamerAbsageModalProps {
  eventName: string;
  /** true: Absage nach Zusage — ohne Grund geht es nicht. */
  grundPflicht: boolean;
  onAbsage: (reason: string) => void;
  dismiss: (data?: string, role?: string) => void;
}

const TeamerAbsageModal: React.FC<TeamerAbsageModalProps> = ({
  eventName,
  grundPflicht,
  onAbsage,
  dismiss
}) => {
  const [reason, setReason] = useState('');
  const { isSubmitting, guard } = useActionGuard();

  const isValid = !grundPflicht || reason.trim().length > 0;

  const handleSubmit = async () => {
    if (!isValid) {
      return;
    }
    await guard(async () => {
      onAbsage(reason.trim());
      dismiss(reason.trim(), 'confirm');
    });
  };

  const handleClose = () => {
    dismiss(undefined, 'cancel');
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Absage</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={handleClose}>
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton
              aria-label="Absage bestätigen"
              className="app-modal-submit-btn app-modal-submit-btn--teamer"
              onClick={handleSubmit}
              disabled={!isValid || isSubmitting}
            >
              <IonIcon icon={ICON_HAKEN} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events">
              <IonIcon icon={ICON_TERMIN} />
            </div>
            <IonLabel>Absage für</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
              <div style={{ fontWeight: 'var(--app-schrift-halbfett)', fontSize: 'var(--app-text-betont)', color: 'var(--app-text-primary)' }}>
                {eventName}
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>

        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events">
              <IonIcon icon={ICON_CHAT} />
            </div>
            <IonLabel>{grundPflicht ? 'Grund für die Absage' : 'Grund (freiwillig)'}</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <p style={{ color: 'var(--ion-color-medium)', fontSize: 'var(--app-text-sekundaer)', margin: '0 0 var(--app-abstand-eng) 0', padding: '0 var(--app-abstand-mini)' }}>
                {grundPflicht
                  ? 'Du hattest zugesagt. Bitte gib einen Grund an, damit die Leitung umplanen kann.'
                  : 'Ein Grund hilft der Leitung beim Planen — du musst aber keinen angeben.'}
              </p>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonTextarea aria-label={grundPflicht ? 'Warum kannst du nicht?' : 'Grund (kannst du leer lassen)'}
                    value={reason}
                    onIonInput={(e) => setReason(e.detail.value!)}
                    placeholder={grundPflicht ? 'Warum kannst du nicht?' : 'Grund (kannst du leer lassen)'}
                    rows={4}
                    autoGrow={true}
                  />
                </IonItem>
              </IonList>
              {grundPflicht && reason.trim().length === 0 && (
                <p style={{ color: 'var(--ion-color-danger)', fontSize: 'var(--app-text-klein)', margin: 'var(--app-abstand-mini) 0 0 var(--app-abstand-mini)' }}>
                  Ohne Grund lässt sich eine Absage nach Zusage nicht speichern.
                </p>
              )}
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default TeamerAbsageModal;
