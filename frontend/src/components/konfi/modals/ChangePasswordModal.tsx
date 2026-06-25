import React, { useState, useEffect } from 'react';
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
  IonSpinner,
  IonText
} from '@ionic/react';
import {
  closeOutline,
  checkmarkOutline,
  keyOutline,
  lockClosedOutline,
  eyeOutline,
  eyeOffOutline,
  shieldCheckmarkOutline,
  checkmarkCircle,
  alertCircle,
  cloudOfflineOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';

interface ChangePasswordModalProps {
  onClose: () => void;
  onSuccess: () => void;
  sectionIconClass?: string;
  submitBtnClass?: string;
}

interface PasswordCheck {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

// Password Check Item Component
const PasswordCheckItem: React.FC<{ label: string; checked: boolean }> = ({ label, checked }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: checked ? '#10b981' : '#9ca3af',
    fontSize: '0.8rem'
  }}>
    <IonIcon
      icon={checked ? checkmarkCircle : alertCircle}
      style={{ fontSize: '0.9rem' }}
    />
    <span>{label}</span>
  </div>
);

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  onClose,
  onSuccess,
  sectionIconClass = 'app-section-icon--purple',
  submitBtnClass = 'app-modal-submit-btn--konfi'
}) => {
  const { setSuccess, setError, isOnline } = useApp();
  const { isSubmitting, guard } = useActionGuard();

  const [passwordData, setPasswordData] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });
  const [passwordChecks, setPasswordChecks] = useState<PasswordCheck>({
    minLength: false,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSpecial: false
  });

  // Password validation effect
  useEffect(() => {
    const pw = passwordData.new_password;
    setPasswordChecks({
      minLength: pw.length >= 8,
      hasUppercase: /[A-Z]/.test(pw),
      hasLowercase: /[a-z]/.test(pw),
      hasNumber: /[0-9]/.test(pw),
      hasSpecial: /[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/~`]/.test(pw)
    });
  }, [passwordData.new_password]);

  const isPasswordValid = Object.values(passwordChecks).every(Boolean);
  const passwordsMatch = passwordData.new_password === passwordData.confirm_password && passwordData.confirm_password.length > 0;

  const handleSave = async () => {
    if (!passwordData.current_password) {
      setError('Bitte gib dein aktuelles Passwort ein');
      return;
    }

    if (!isPasswordValid) {
      setError('Das neue Passwort erfüllt nicht alle Anforderungen');
      return;
    }

    if (!passwordsMatch) {
      setError('Die neuen Passwörter stimmen nicht überein');
      return;
    }

    await guard(async () => {
      try {
        await api.post('/auth/change-password', {
          currentPassword: passwordData.current_password,
          newPassword: passwordData.new_password
        });
        setSuccess('Passwort erfolgreich geändert');
        onSuccess();
      } catch (err: any) {
        setError(err.response?.data?.error || 'Fehler beim Ändern des Passworts');
      }
    });
  };

  const isValid = passwordData.current_password && isPasswordValid && passwordsMatch;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Passwort ändern</IonTitle>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={onClose} disabled={isSubmitting}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton className={`app-modal-submit-btn ${submitBtnClass}`} onClick={handleSave} disabled={isSubmitting || !isValid || !isOnline}>
              {!isOnline ? <><IonIcon icon={cloudOfflineOutline} /> Du bist offline</> : isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Aktuelles Passwort Sektion - iOS26 Pattern */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className={`app-section-icon ${sectionIconClass}`}>
              <IonIcon icon={lockClosedOutline} />
            </div>
            <IonLabel>Aktuelles Passwort</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Aktuelles Passwort *</IonLabel>
                  <IonInput
                    type={showPasswords.current ? 'text' : 'password'}
                    value={passwordData.current_password}
                    onIonInput={(e) => setPasswordData(prev => ({ ...prev, current_password: e.detail.value! }))}
                    placeholder="Aktuelles Passwort eingeben"
                    disabled={isSubmitting}
                  />
                  <IonButton
                    slot="end"
                    fill="clear"
                    onClick={() => setShowPasswords(prev => ({ ...prev, current: !prev.current }))}
                  >
                    <IonIcon icon={showPasswords.current ? eyeOffOutline : eyeOutline} />
                  </IonButton>
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Neues Passwort Sektion - iOS26 Pattern */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className={`app-section-icon ${sectionIconClass}`}>
              <IonIcon icon={keyOutline} />
            </div>
            <IonLabel>Neues Passwort</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Neues Passwort *</IonLabel>
                  <IonInput
                    type={showPasswords.new ? 'text' : 'password'}
                    value={passwordData.new_password}
                    onIonInput={(e) => setPasswordData(prev => ({ ...prev, new_password: e.detail.value! }))}
                    placeholder="Neues Passwort eingeben"
                    disabled={isSubmitting}
                  />
                  <IonButton
                    slot="end"
                    fill="clear"
                    onClick={() => setShowPasswords(prev => ({ ...prev, new: !prev.new }))}
                  >
                    <IonIcon icon={showPasswords.new ? eyeOffOutline : eyeOutline} />
                  </IonButton>
                </IonItem>

                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Neues Passwort bestätigen *</IonLabel>
                  <IonInput
                    type={showPasswords.confirm ? 'text' : 'password'}
                    value={passwordData.confirm_password}
                    onIonInput={(e) => setPasswordData(prev => ({ ...prev, confirm_password: e.detail.value! }))}
                    placeholder="Neues Passwort bestätigen"
                    disabled={isSubmitting}
                  />
                  <IonButton
                    slot="end"
                    fill="clear"
                    onClick={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}
                  >
                    <IonIcon icon={showPasswords.confirm ? eyeOffOutline : eyeOutline} />
                  </IonButton>
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Passwort-Anforderungen Sektion */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className={`app-section-icon ${sectionIconClass}`}>
              <IonIcon icon={shieldCheckmarkOutline} />
            </div>
            <IonLabel>Passwort-Anforderungen</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <PasswordCheckItem label="Mind. 8 Zeichen" checked={passwordChecks.minLength} />
                <PasswordCheckItem label="Großbuchstabe" checked={passwordChecks.hasUppercase} />
                <PasswordCheckItem label="Kleinbuchstabe" checked={passwordChecks.hasLowercase} />
                <PasswordCheckItem label="Zahl" checked={passwordChecks.hasNumber} />
                <PasswordCheckItem label="Sonderzeichen" checked={passwordChecks.hasSpecial} />
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Validation Feedback - Passwörter stimmen nicht überein */}
        {passwordData.new_password && passwordData.confirm_password && !passwordsMatch && (
          <IonList inset={true} className="app-modal-section">
            <IonCard className="app-card" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <IonCardContent style={{ padding: '12px 16px' }}>
                <IonText color="danger">
                  <p style={{ margin: 0, fontSize: '0.85rem' }}>
                    Die Passwörter stimmen nicht überein.
                  </p>
                </IonText>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* Bestätigung wenn alles passt */}
        {isValid && (
          <IonList inset={true} className="app-modal-section">
            <IonCard className="app-card" style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
              <IonCardContent style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981' }}>
                  <IonIcon icon={checkmarkCircle} />
                  <span style={{ fontSize: '0.85rem' }}>Alle Anforderungen erfüllt - bereit zum Speichern</span>
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
};

export default ChangePasswordModal;
