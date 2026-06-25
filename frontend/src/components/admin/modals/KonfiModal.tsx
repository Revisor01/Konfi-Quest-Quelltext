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
  IonInput,
  IonSelect,
  IonSelectOption,
  IonList,
  IonListHeader,
  IonIcon,
  IonCard,
  IonCardContent,
  IonSpinner,
  IonText
} from '@ionic/react';
import { closeOutline, checkmarkOutline, personOutline, informationCircleOutline, cloudOfflineOutline } from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';

interface Jahrgang {
  id: number;
  name: string;
}

interface KonfiModalProps {
  jahrgaenge: Jahrgang[];
  onClose: () => void;
  onSave: (konfiData: any) => void;
  dismiss?: () => void;
}

const KonfiModal: React.FC<KonfiModalProps> = ({ jahrgaenge, onClose, onSave, dismiss }) => {
  const { isOnline } = useApp();
  const [name, setName] = useState('');
  const [jahrgang, setJahrgang] = useState('');
  const { isSubmitting, guard } = useActionGuard();

  const handleClose = () => {
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !jahrgang) return;

    await guard(async () => {
      const konfiData = {
        name: name.trim(),
        jahrgang_id: jahrgaenge.find(jg => jg.name === jahrgang)?.id || 1
      };

      await onSave(konfiData);
    });
  };

  const isValid = name.trim().length > 0 && jahrgang;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Konfi erstellen</IonTitle>
          <IonButtons slot="start">
            <IonButton onClick={handleClose} disabled={isSubmitting} className="app-modal-close-btn">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton onClick={handleSave} disabled={!isValid || isSubmitting || !isOnline} className="app-modal-submit-btn app-modal-submit-btn--konfi">
              {!isOnline ? <><IonIcon icon={cloudOfflineOutline} /> Du bist offline</> : isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Name Sektion - iOS26 Pattern */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--purple">
              <IonIcon icon={personOutline} />
            </div>
            <IonLabel>Konfi Daten</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '16px' }}>
              <IonList style={{ background: 'transparent' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Name *</IonLabel>
                  <IonInput
                    value={name}
                    onIonInput={(e) => setName(e.detail.value!)}
                    placeholder="Vor- und Nachname"
                    disabled={isSubmitting}
                    clearInput={true}
                  />
                </IonItem>

                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Jahrgang *</IonLabel>
                  <IonSelect
                    value={jahrgang}
                    onIonChange={(e) => setJahrgang(e.detail.value)}
                    placeholder="Jahrgang wählen"
                    disabled={isSubmitting}
                    interface="popover"
                  >
                    {jahrgaenge.map(jg => (
                      <IonSelectOption key={jg.id} value={jg.name}>
                        {jg.name}
                      </IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Hinweis Sektion - iOS26 Pattern in Lila */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--purple">
              <IonIcon icon={informationCircleOutline} />
            </div>
            <IonLabel>Hinweis</IonLabel>
          </IonListHeader>
          <IonCard className="app-card" style={{ background: 'rgba(91, 33, 182, 0.08)', border: '1px solid rgba(91, 33, 182, 0.2)' }}>
            <IonCardContent style={{ padding: '16px' }}>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.5', color: 'var(--app-color-konfis)' }}>
                Benutzername und Passwort werden automatisch generiert. Du kannst das Passwort später in der Detailansicht einsehen oder zurücksetzen.
              </p>
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default KonfiModal;