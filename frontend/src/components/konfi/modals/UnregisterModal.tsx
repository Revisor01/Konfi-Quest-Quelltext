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
  closeOutline,
  checkmarkOutline,
  calendarOutline,
  chatbubbleOutline,
  cloudOfflineOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';

interface UnregisterModalProps {
  eventName: string;
  mandatory?: boolean;
  onClose: () => void;
  onUnregister: (reason: string) => void;
  dismiss: (data?: string, role?: string) => void;
}

const UnregisterModal: React.FC<UnregisterModalProps> = ({
  eventName,
  mandatory,
  onClose,
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
            <IonButton className="app-modal-close-btn" onClick={handleClose}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton className="app-modal-submit-btn app-modal-submit-btn--konfi" onClick={handleSubmit} disabled={!isValid || isSubmitting || !isOnline}>
              {!isOnline ? <><IonIcon icon={cloudOfflineOutline} /> Du bist offline</> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Event Info */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events">
              <IonIcon icon={calendarOutline} />
            </div>
            <IonLabel>Abmeldung von</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '16px' }}>
              <div style={{ fontWeight: '600', fontSize: '0.95rem', color: '#333' }}>
                {eventName}
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Grund Sektion */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events">
              <IonIcon icon={chatbubbleOutline} />
            </div>
            <IonLabel>Grund für die Abmeldung</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              {mandatory && (
                <p style={{ color: 'var(--ion-color-medium)', fontSize: '0.85rem', margin: '0 0 8px 0', padding: '0 4px' }}>
                  Dies ist ein Pflicht-Event. Bitte gib einen Grund für deine Abmeldung an.
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
                <p style={{ color: 'var(--ion-color-danger)', fontSize: '0.75rem', margin: '4px 0 0 4px' }}>
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
