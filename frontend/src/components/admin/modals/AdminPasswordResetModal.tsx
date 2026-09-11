import { fehlerText } from '../../../utils/fehler';
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
  ICON_FUNKELN,
  ICON_HAKEN,
  ICON_OFFLINE,
  ICON_SCHLIESSEN,
  ICON_SCHLUESSEL,
  ICON_SCHUTZ,
  ICON_SICHTBAR,
  ICON_VERBORGEN,
  ICON_WARNHINWEIS_GEFUELLT,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
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
    gap: 'var(--app-abstand-kompakt)',
    color: checked ? 'var(--app-color-success-fresh)' : 'var(--app-color-neutral-hell)',
    fontSize: 'var(--app-text-hinweis)'
  }}>
    <IonIcon icon={checked ? ICON_ZUSAGE_GEFUELLT : ICON_WARNHINWEIS_GEFUELLT} style={{ fontSize: 'var(--app-text-basis)' }} />
    <span>{label}</span>
  </div>
);

// Kryptographisch sicherer Zufallswert in [0, max) — Rejection-Sampling
// gegen Modulo-Bias (Math.random ist für Passwoerter nicht geeignet)
const randomInt = (max: number): number => {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
};

// Starkes Passwort generieren (erfuellt garantiert alle Anforderungen)
const generateStrongPassword = (length = 14): string => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*?-_+=';
  const all = upper + lower + digits + special;
  // Mindestens je ein Zeichen aus jeder Kategorie
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  for (let i = chars.length; i < length; i++) {
    chars.push(pick(all));
  }
  // Mischen (Fisher-Yates)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
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
      hasSpecial: /[!@#$%^&*(),.?":{}|<>_\-+=[\]\\/~`]/.test(newPassword)
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
      } catch (err) {
        setError(fehlerText(err, 'Fehler beim Zurücksetzen des Passworts'));
      }
    });
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Passwort ändern</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" onClick={onClose} disabled={isSubmitting} className="app-modal-close-btn">
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label="Passwort zurücksetzen" onClick={handleSave} disabled={isSubmitting || !isValid || !isOnline} className="app-modal-submit-btn app-modal-submit-btn--settings">
              {!isOnline ? <><IonIcon icon={ICON_OFFLINE} /> Du bist offline</> : isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={ICON_HAKEN} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Neues Passwort */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--users">
              <IonIcon icon={ICON_SCHLUESSEL} />
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
                  <IonButton aria-label="Passwort anzeigen oder verbergen" slot="end" fill="clear" onClick={() => setShowPasswords(prev => ({ ...prev, new: !prev.new }))}>
                    <IonIcon icon={showPasswords.new ? ICON_VERBORGEN : ICON_SICHTBAR} />
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
                  <IonButton aria-label="Passwortbestätigung anzeigen oder verbergen" slot="end" fill="clear" onClick={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}>
                    <IonIcon icon={showPasswords.confirm ? ICON_VERBORGEN : ICON_SICHTBAR} />
                  </IonButton>
                </IonItem>
              </IonList>

              <IonButton expand="block" fill="outline" onClick={handleSuggest} disabled={isSubmitting} style={{ marginTop: 'var(--app-abstand-mittel)' }}>
                <IonIcon icon={ICON_FUNKELN} slot="start" />
                Sicheres Passwort vorschlagen
              </IonButton>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Passwort-Anforderungen */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--users">
              <IonIcon icon={ICON_SCHUTZ} />
            </div>
            <IonLabel>Passwort-Anforderungen</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--app-abstand-eng)' }}>
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
            <IonCard className="app-card" style={{ background: 'rgba(var(--app-color-danger-rgb), 0.08)', border: '1px solid rgba(var(--app-color-danger-rgb), 0.2)' }}>
              <IonCardContent style={{ padding: 'var(--app-abstand-mittel) var(--app-abstand-basis)' }}>
                <IonText color="danger">
                  <p style={{ margin: 0, fontSize: 'var(--app-text-sekundaer)' }}>Die Passwörter stimmen nicht überein.</p>
                </IonText>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* Alles erfüllt */}
        {isValid && (
          <IonList inset={true} className="app-modal-section">
            <IonCard className="app-card" style={{ background: 'rgba(var(--app-color-success-fresh-rgb), 0.08)', border: '1px solid rgba(var(--app-color-success-fresh-rgb), 0.2)' }}>
              <IonCardContent style={{ padding: 'var(--app-abstand-mittel) var(--app-abstand-basis)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-eng)', color: 'var(--app-color-success-fresh)' }}>
                  <IonIcon icon={ICON_ZUSAGE_GEFUELLT} />
                  <span style={{ fontSize: 'var(--app-text-sekundaer)' }}>Alle Anforderungen erfüllt - bereit zum Speichern</span>
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
