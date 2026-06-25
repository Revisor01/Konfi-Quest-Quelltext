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
  eyeOutline,
  eyeOffOutline,
  shieldCheckmarkOutline,
  checkmarkCircle,
  alertCircle,
  sparklesOutline,
  cloudOfflineOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';

interface AdminPasswordResetModalProps {
  adminId: number;
  adminName: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface PasswordCheck {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

// Anforderungs-Anzeige wie im ChangePasswordModal
const PasswordCheckItem: React.FC<{ label: string; checked: boolean }> = ({ label, checked }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: checked ? '#10b981' : '#9ca3af',
    fontSize: '0.8rem'
  }}>
    <IonIcon icon={checked ? checkmarkCircle : alertCircle} style={{ fontSize: '0.9rem' }} />
    <span>{label}</span>
  </div>
);

// Starkes Passwort generieren (erfuellt garantiert alle Anforderungen)
const generateStrongPassword = (length = 14): string => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*?-_+=';
  const all = upper + lower + digits + special;
  // Mindestens je ein Zeichen aus jeder Kategorie
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  let chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  for (let i = chars.length; i < length; i++) {
    chars.push(pick(all));
  }
  // Mischen (Fisher-Yates)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

const AdminPasswordResetModal: React.FC<AdminPasswordResetModalProps> = ({ adminId, adminName, onClose, onSuccess }) => {
  const { setSuccess, setError, isOnline } = useApp();
  const { isSubmitting, guard } = useActionGuard();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState({ new: false, confirm: false });
  const [passwordChecks, setPasswordChecks] = useState<PasswordCheck>({
    minLength: false,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSpecial: false
  });

  useEffect(() => {
    setPasswordChecks({
      minLength: newPassword.length >= 8,
      hasUppercase: /[A-Z]/.test(newPassword),
      hasLowercase: /[a-z]/.test(newPassword),
      hasNumber: /[0-9]/.test(newPassword),
      hasSpecial: /[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/~`]/.test(newPassword)
    });
  }, [newPassword]);

  const isPasswordValid = Object.values(passwordChecks).every(Boolean);
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
  const isValid = isPasswordValid && passwordsMatch;

  const handleSuggest = () => {
    const pw = generateStrongPassword();
    setNewPassword(pw);
    setConfirmPassword(pw);
    // Vorschlag direkt sichtbar machen, damit er notiert werden kann
    setShowPasswords({ new: true, confirm: true });
  };

  const handleSave = async () => {
    if (!isPasswordValid) {
      setError('Das neue Passwort erfüllt nicht alle Anforderungen');
      return;
    }
    if (!passwordsMatch) {
      return;
    }

    await guard(async () => {
      try {
        await api.put(`/users/${adminId}/reset-password`, { password: newPassword });
        setSuccess('Passwort erfolgreich zurückgesetzt');
        onSuccess();
      } catch (err: any) {
        setError(err.response?.data?.error || 'Fehler beim Zurücksetzen des Passworts');
      }
    });
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Passwort ändern</IonTitle>
          <IonButtons slot="start">
            <IonButton onClick={onClose} disabled={isSubmitting} className="app-modal-close-btn">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton onClick={handleSave} disabled={isSubmitting || !isValid || !isOnline} className="app-modal-submit-btn app-modal-submit-btn--settings">
              {!isOnline ? <><IonIcon icon={cloudOfflineOutline} /> Du bist offline</> : isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Neues Passwort */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--users">
              <IonIcon icon={keyOutline} />
            </div>
            <IonLabel>Neues Passwort für {adminName}</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Neues Passwort *</IonLabel>
                  <IonInput
                    type={showPasswords.new ? 'text' : 'password'}
                    value={newPassword}
                    onIonInput={(e) => setNewPassword(e.detail.value!)}
                    placeholder="Neues Passwort eingeben"
                    disabled={isSubmitting}
                  />
                  <IonButton slot="end" fill="clear" onClick={() => setShowPasswords(prev => ({ ...prev, new: !prev.new }))}>
                    <IonIcon icon={showPasswords.new ? eyeOffOutline : eyeOutline} />
                  </IonButton>
                </IonItem>

                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Neues Passwort bestätigen *</IonLabel>
                  <IonInput
                    type={showPasswords.confirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onIonInput={(e) => setConfirmPassword(e.detail.value!)}
                    placeholder="Neues Passwort bestätigen"
                    disabled={isSubmitting}
                  />
                  <IonButton slot="end" fill="clear" onClick={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}>
                    <IonIcon icon={showPasswords.confirm ? eyeOffOutline : eyeOutline} />
                  </IonButton>
                </IonItem>
              </IonList>

              <IonButton expand="block" fill="outline" onClick={handleSuggest} disabled={isSubmitting} style={{ marginTop: '12px' }}>
                <IonIcon icon={sparklesOutline} slot="start" />
                Sicheres Passwort vorschlagen
              </IonButton>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Passwort-Anforderungen */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--users">
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

        {/* Passwörter stimmen nicht überein */}
        {newPassword && confirmPassword && !passwordsMatch && (
          <IonList inset={true} className="app-modal-section">
            <IonCard className="app-card" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <IonCardContent style={{ padding: '12px 16px' }}>
                <IonText color="danger">
                  <p style={{ margin: 0, fontSize: '0.85rem' }}>Die Passwörter stimmen nicht überein.</p>
                </IonText>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* Alles erfüllt */}
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

export default AdminPasswordResetModal;
