import { fehlerText } from '../../utils/fehler';
import React, { useState, useEffect } from 'react';
import { useActionGuard } from '../../hooks/useActionGuard';
import { setToken, setRefreshToken, getDeviceId } from '../../services/tokenStore';
import { Capacitor } from '@capacitor/core';
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
  ICON_HAKEN,
  ICON_OFFLINE,
  ICON_SCHLIESSEN,
  ICON_SCHLUESSEL,
  ICON_SCHUTZ,
  ICON_SICHTBAR,
  ICON_SPERRE,
  ICON_VERBORGEN,
  ICON_WARNHINWEIS_GEFUELLT,
  ICON_ZUSAGE_GEFUELLT,
} from './icons';
import { useApp } from '../../contexts/AppContext';
import api from '../../services/api';
import { KontoModalVariante, KONTO_MODAL_STIL } from './ChangeEmailModal';

// EINE gemeinsame Komponente fuer alle drei Profil-Ansichten (Muster:
// BiometrieSchalter) — vorher lag dieses Modal funktional identisch doppelt
// vor, nur die CSS-Klassen unterschieden sich. Die Seiten geben ueber
// `variante` ihre Rollenfarbe mit.
interface ChangePasswordModalProps {
  onClose: () => void;
  onSuccess: () => void;
  variante?: KontoModalVariante;
}

interface PasswordCheck {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

// Einzelner Eintrag der Passwort-Anforderungen
const PasswordCheckItem: React.FC<{ label: string; checked: boolean }> = ({ label, checked }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--app-abstand-kompakt)',
    color: checked ? 'var(--app-color-success-fresh)' : 'var(--app-color-neutral-hell)',
    fontSize: 'var(--app-text-hinweis)'
  }}>
    <IonIcon
      icon={checked ? ICON_ZUSAGE_GEFUELLT : ICON_WARNHINWEIS_GEFUELLT}
      style={{ fontSize: 'var(--app-text-basis)' }}
    />
    <span>{label}</span>
  </div>
);

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  onClose,
  onSuccess,
  variante = 'purple'
}) => {
  const { setSuccess, setError, isOnline } = useApp();
  const { isSubmitting, guard } = useActionGuard();
  const stil = KONTO_MODAL_STIL[variante];

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

  // Passwort-Anforderungen live pruefen
  useEffect(() => {
    const pw = passwordData.new_password;
    setPasswordChecks({
      minLength: pw.length >= 8,
      hasUppercase: /[A-Z]/.test(pw),
      hasLowercase: /[a-z]/.test(pw),
      hasNumber: /[0-9]/.test(pw),
      hasSpecial: /[!@#$%^&*(),.?":{}|<>_\-+=[\]\\/~`]/.test(pw)
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
        // Geraete-Angabe mitschicken: Der Passwortwechsel beendet alle
        // ANDEREN Sitzungen und loescht deren Push-Tokens. Nur mit device_id
        // + platform kann der Server das EIGENE Geraet verschonen — dieselbe
        // Quelle wie bei der Token-Registrierung (AppContext nutzt getDeviceId).
        const res = await api.post('/auth/change-password', {
          currentPassword: passwordData.current_password,
          newPassword: passwordData.new_password,
          device_id: getDeviceId() || undefined,
          platform: Capacitor.getPlatform()
        });

        // Der Passwortwechsel beendet serverseitig ALLE Sitzungen. Die Antwort
        // liefert dafuer ein frisches Token-Paar für diese Sitzung — ohne
        // Uebernahme wuerde der nächste Request am invalidierten Token
        // scheitern und sich wie ein grundloser Rauswurf anfuehlen.
        if (res.data?.token) {
          await setToken(res.data.token);
          if (res.data.refresh_token) await setRefreshToken(res.data.refresh_token);
        }

        setSuccess('Passwort erfolgreich geändert');
        onSuccess();
      } catch (err) {
        setError(fehlerText(err, 'Fehler beim Ändern des Passworts'));
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
            <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={onClose} disabled={isSubmitting}>
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label="Passwort speichern" className={`app-modal-submit-btn ${stil.submitBtn}`} onClick={handleSave} disabled={isSubmitting || !isValid || !isOnline}>
              {!isOnline ? <><IonIcon icon={ICON_OFFLINE} /> Du bist offline</> : isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={ICON_HAKEN} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Aktuelles Passwort Sektion - iOS26 Pattern */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className={`app-section-icon ${stil.sectionIcon}`}>
              <IonIcon icon={ICON_SPERRE} />
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
                  <IonButton aria-label="Aktuelles Passwort anzeigen oder verbergen"
                    slot="end"
                    fill="clear"
                    onClick={() => setShowPasswords(prev => ({ ...prev, current: !prev.current }))}
                  >
                    <IonIcon icon={showPasswords.current ? ICON_VERBORGEN : ICON_SICHTBAR} />
                  </IonButton>
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Neues Passwort Sektion - iOS26 Pattern */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className={`app-section-icon ${stil.sectionIcon}`}>
              <IonIcon icon={ICON_SCHLUESSEL} />
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
                  <IonButton aria-label="Neues Passwort anzeigen oder verbergen"
                    slot="end"
                    fill="clear"
                    onClick={() => setShowPasswords(prev => ({ ...prev, new: !prev.new }))}
                  >
                    <IonIcon icon={showPasswords.new ? ICON_VERBORGEN : ICON_SICHTBAR} />
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
                  <IonButton aria-label="Passwortbestätigung anzeigen oder verbergen"
                    slot="end"
                    fill="clear"
                    onClick={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}
                  >
                    <IonIcon icon={showPasswords.confirm ? ICON_VERBORGEN : ICON_SICHTBAR} />
                  </IonButton>
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Passwort-Anforderungen Sektion */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className={`app-section-icon ${stil.sectionIcon}`}>
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

        {/* Validierungs-Hinweis - Passwörter stimmen nicht überein */}
        {passwordData.new_password && passwordData.confirm_password && !passwordsMatch && (
          <IonList inset={true} className="app-modal-section">
            <IonCard className="app-card" style={{ background: 'rgba(var(--app-color-danger-rgb), 0.08)', border: '1px solid rgba(var(--app-color-danger-rgb), 0.2)' }}>
              <IonCardContent style={{ padding: 'var(--app-abstand-mittel) var(--app-abstand-basis)' }}>
                <IonText color="danger">
                  <p style={{ margin: 0, fontSize: 'var(--app-text-sekundaer)' }}>
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

export default ChangePasswordModal;
