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
import {
  ICON_CHAT,
  ICON_HAKEN,
  ICON_OFFLINE,
  ICON_SCHLIESSEN,
  ICON_TERMIN,
} from '../../shared/icons';
import { useApp } from '../../../contexts/AppContext';

interface UnregisterModalProps {
  eventName: string;
  mandatory?: boolean;
  onUnregister: (reason: string) => void;
  dismiss: (data?: string, role?: string) => void;
}

const UnregisterModal: React.FC<UnregisterModalProps> = ({
  eventName,
  mandatory,
  onUnregister,
  dismiss
}) => {
  const { isOnline } = useApp();
  const [reason, setReason] = useState('');
  const { isSubmitting, guard } = useActionGuard();

  const minLength = mandatory ? 5 : 1;
  const isValid = reason.trim().length >= minLength;

  const handleSubmit = async () => {
    if (!isValid) {
      return;
    }
    await guard(async () => {
      onUnregister(reason.trim());
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
          <IonTitle>Abmeldung</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={handleClose}>
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label="Abmeldung bestätigen" className="app-modal-submit-btn app-modal-submit-btn--konfi" onClick={handleSubmit} disabled={!isValid || isSubmitting || !isOnline}>
              {!isOnline ? <><IonIcon icon={ICON_OFFLINE} /> Du bist offline</> : <IonIcon icon={ICON_HAKEN} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Event Info */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events">
              <IonIcon icon={ICON_TERMIN} />
            </div>
            <IonLabel>Abmeldung von</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
              <div style={{ fontWeight: 'var(--app-schrift-halbfett)', fontSize: 'var(--app-text-betont)', color: 'var(--app-text-primary)' }}>
                {eventName}
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Grund Sektion */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events">
              <IonIcon icon={ICON_CHAT} />
            </div>
            <IonLabel>Grund für die Abmeldung</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              {mandatory && (
                <p style={{ color: 'var(--ion-color-medium)', fontSize: 'var(--app-text-sekundaer)', margin: '0 0 var(--app-abstand-eng) 0', padding: '0 var(--app-abstand-mini)' }}>
                  Dies ist ein Pflicht-Event. Bitte gib einen Grund für deine Abmeldung an.
                  {' '}<strong>Deine Eltern müssen die Abmeldung noch bei uns bestätigen.</strong>
                </p>
              )}
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonTextarea
                    value={reason}
                    onIonInput={(e) => setReason(e.detail.value!)}
                    placeholder="Bitte gib einen Grund für deine Abmeldung an..."
                    rows={4}
                    autoGrow={true}
                  />
                </IonItem>
              </IonList>
              {mandatory && reason.trim().length < 5 && (
                <p style={{ color: 'var(--ion-color-danger)', fontSize: 'var(--app-text-klein)', margin: 'var(--app-abstand-mini) 0 0 var(--app-abstand-mini)' }}>
                  {reason.trim().length}/5 Zeichen
                </p>
              )}
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default UnregisterModal;
