import React, { useState, useEffect } from 'react';
import { useActionGuard } from '../../hooks/useActionGuard';
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
  mailOutline,
  informationCircleOutline,
  cloudOfflineOutline
} from 'ionicons/icons';
import { useApp } from '../../contexts/AppContext';
import api from '../../services/api';

// Farbvariante der jeweiligen Rolle — dasselbe Muster wie BiometrieSchalter:
// EINE gemeinsame Komponente fuer alle drei Profil-Ansichten, die Seiten geben
// nur ihre Farbe mit. Vorher lag dieses Modal doppelt vor (admin/ und konfi/,
// das Teamer-Profil importierte quer aus dem Konfi-Baum) — funktional
// identisch, nur die CSS-Klassen unterschieden sich.
export type KontoModalVariante = 'users' | 'teamer' | 'purple';

export const KONTO_MODAL_STIL: Record<KontoModalVariante, { sectionIcon: string; submitBtn: string; infoBox: string }> = {
  users: { sectionIcon: 'app-section-icon--users', submitBtn: 'app-modal-submit-btn--settings', infoBox: 'app-info-box--blue' },
  teamer: { sectionIcon: 'app-section-icon--teamer', submitBtn: 'app-modal-submit-btn--teamer', infoBox: 'app-info-box--teamer' },
  purple: { sectionIcon: 'app-section-icon--purple', submitBtn: 'app-modal-submit-btn--konfi', infoBox: 'app-info-box--purple' },
};

interface ChangeEmailModalProps {
  onClose: () => void;
  onSuccess: () => void;
  initialEmail?: string;
  variante?: KontoModalVariante;
}

const ChangeEmailModal: React.FC<ChangeEmailModalProps> = ({
  onClose,
  onSuccess,
  initialEmail = '',
  variante = 'purple'
}) => {
  const { setSuccess, setError, isOnline } = useApp();
  const [email, setEmail] = useState(initialEmail);
  const { isSubmitting, guard } = useActionGuard();
  const [loading, setLoading] = useState(true);
  const stil = KONTO_MODAL_STIL[variante];

  // Aktuelle E-Mail beim Oeffnen vom Server laden
  useEffect(() => {
    const loadCurrentEmail = async () => {
      try {
        const response = await api.get('/auth/me');
        setEmail(response.data.email || '');
      } catch (err) {
        console.error('Error loading email:', err);
        // Fallback auf die initialEmail-Prop
        setEmail(initialEmail);
      } finally {
        setLoading(false);
      }
    };
    loadCurrentEmail();
  }, []);

  const handleSave = async () => {
    // E-Mail ist optional, aber wenn angegeben muss sie gültig sein
    if (email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        setError('Ungültige E-Mail-Adresse');
        return;
      }
    }

    await guard(async () => {
      try {
        await api.post('/auth/update-email', {
          email: email.trim() || null
        });
        setSuccess('E-Mail-Adresse erfolgreich aktualisiert');
        onSuccess();
      } catch (err: any) {
        const errorMsg = err.response?.data?.error;
        if (errorMsg?.includes('bereits verwendet') || err.response?.status === 409) {
          setError('Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet.');
        } else {
          setError(errorMsg || 'Fehler beim Aktualisieren der E-Mail-Adresse');
        }
      }
    });
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>E-Mail ändern</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={onClose} disabled={isSubmitting}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label="E-Mail-Adresse speichern" className={`app-modal-submit-btn ${stil.submitBtn}`} onClick={handleSave} disabled={isSubmitting || loading || !isOnline}>
              {!isOnline ? <><IonIcon icon={cloudOfflineOutline} /> Du bist offline</> : isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* E-Mail-Adresse Sektion - iOS26 Pattern */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className={`app-section-icon ${stil.sectionIcon}`}>
              <IonIcon icon={mailOutline} />
            </div>
            <IonLabel>E-Mail-Adresse</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent className="app-info-box">
              <IonList style={{ background: 'transparent' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">E-Mail-Adresse (optional)</IonLabel>
                  {loading ? (
                    <div style={{ padding: '12px 0' }}>
                      <IonSpinner name="crescent" style={{ width: '20px', height: '20px' }} />
                    </div>
                  ) : (
                    <IonInput
                      type="email"
                      value={email}
                      onIonInput={(e) => setEmail(e.detail.value!)}
                      placeholder="deine@email.de"
                      disabled={isSubmitting}
                      clearInput={true}
                    />
                  )}
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Hinweis Sektion - iOS26 Pattern */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className={`app-section-icon ${stil.sectionIcon}`}>
              <IonIcon icon={informationCircleOutline} />
            </div>
            <IonLabel>Hinweis</IonLabel>
          </IonListHeader>
          <IonCard className={`app-card ${stil.infoBox}`}>
            <IonCardContent className="app-info-box">
              <p style={{ margin: 0 }}>
                Diese E-Mail-Adresse wird für Passwort-Reset und Benachrichtigungen verwendet.
              </p>
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default ChangeEmailModal;
