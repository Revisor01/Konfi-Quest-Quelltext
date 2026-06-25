import React, { useState } from 'react';
import { useActionGuard } from '../../../hooks/useActionGuard';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonIcon,
  IonButton,
  IonButtons,
  IonInput,
  IonList,
  IonListHeader,
  IonSpinner
} from '@ionic/react';
import {
  closeOutline,
  checkmarkOutline,
  briefcaseOutline,
  informationCircleOutline,
  cloudOfflineOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';

interface ChangeRoleTitleModalProps {
  onClose: () => void;
  onSuccess: () => void;
  initialRoleTitle?: string;
  sectionIconClass?: string;
  submitBtnClass?: string;
  infoBoxClass?: string;
}

const ChangeRoleTitleModal: React.FC<ChangeRoleTitleModalProps> = ({
  onClose,
  onSuccess,
  initialRoleTitle = '',
  sectionIconClass = 'app-section-icon--users',
  submitBtnClass = 'app-modal-submit-btn--settings',
  infoBoxClass = 'app-info-box--blue'
}) => {
  const { setSuccess, setError, isOnline } = useApp();
  const [roleTitle, setRoleTitle] = useState(initialRoleTitle);
  const { isSubmitting, guard } = useActionGuard();

  const handleSave = async () => {
    // Offline: Queue-Fallback (fire-and-forget)
    if (!networkMonitor.isOnline) {
      writeQueue.enqueue({
        method: 'POST',
        url: '/auth/update-role-title',
        body: { role_title: roleTitle.trim() },
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'fire-and-forget', clientId: safeUUID(), label: 'Funktionsbeschreibung' },
      });
      setSuccess('Funktionsbeschreibung wird bei Verbindung aktualisiert');
      onSuccess();
      return;
    }

    await guard(async () => {
      try {
        await api.post('/auth/update-role-title', {
          role_title: roleTitle.trim()
        });
        onSuccess();
      } catch (err: any) {
        setError(err.response?.data?.error || 'Fehler beim Aktualisieren der Funktionsbeschreibung');
      }
    });
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Funktionsbeschreibung</IonTitle>
          <IonButtons slot="start">
            <IonButton onClick={onClose} disabled={isSubmitting} className="app-modal-close-btn">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton onClick={handleSave} disabled={isSubmitting || !isOnline} className={`app-modal-submit-btn ${submitBtnClass}`}>
              {!isOnline ? <><IonIcon icon={cloudOfflineOutline} /> Du bist offline</> : isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Funktionsbeschreibung Sektion - iOS26 Pattern */}
        <IonList inset={true} className="app-segment-wrapper" style={{ marginTop: '8px' }}>
          <IonListHeader>
            <div className={`app-section-icon ${sectionIconClass}`}>
              <IonIcon icon={briefcaseOutline} />
            </div>
            <IonLabel>Deine Funktion</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent className="app-info-box">
              <IonList style={{ background: 'transparent' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Funktionsbeschreibung</IonLabel>
                  <IonInput
                    value={roleTitle}
                    onIonInput={(e) => setRoleTitle(e.detail.value!)}
                    placeholder="z.B. Pastor, Diakonin, Jugendmitarbeiter"
                    disabled={isSubmitting}
                    clearInput={true}
                  />
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Hinweis Sektion - iOS26 Pattern */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className={`app-section-icon ${sectionIconClass}`}>
              <IonIcon icon={informationCircleOutline} />
            </div>
            <IonLabel>Hinweis</IonLabel>
          </IonListHeader>
          <IonCard className={`app-card ${infoBoxClass}`}>
            <IonCardContent className="app-info-box">
              <p style={{ margin: 0 }}>
                Deine Funktionsbeschreibung wird anderen Nutzern im Chat und an anderen Stellen angezeigt.
                Sie ersetzt nicht deine Rolle (Admin, Teamer:in), sondern ergänzt sie.
              </p>
              <p style={{ margin: '12px 0 0 0', fontSize: '0.85rem', fontStyle: 'italic' }}>
                Beispiele: Pastor, Diakonin, Jugendmitarbeiter, Gemeindediakon, Pfarrerin
              </p>
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default ChangeRoleTitleModal;
