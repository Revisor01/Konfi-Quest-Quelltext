import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  IonPage,
  IonContent,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonSpinner,
  IonIcon,
  useIonRouter
} from '@ionic/react';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren
import { lockClosedOutline, eye, eyeOff, checkmarkCircle, alertCircle, closeCircle, arrowBack } from 'ionicons/icons';
import api from '../../services/api';

const PasswordCheckItem: React.FC<{ label: string; checked: boolean }> = ({ label, checked }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: checked ? '#67e8f9' : 'rgba(255, 255, 255, 0.35)'
  }}>
    <IonIcon
      icon={checked ? checkmarkCircle : closeCircle}
      style={{ fontSize: '0.9rem' }}
    />
    <span style={{ fontSize: '0.75rem' }}>{label}</span>
  </div>
);

const ResetPasswordPage: React.FC = () => {
  const router = useIonRouter();
  const location = useLocation();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Token aus URL extrahieren und danach aus der URL entfernen,
  // damit er nicht in Browser-History/Referer-Header hängenbleibt.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tokenParam = params.get('token');
    if (tokenParam) {
      setToken(tokenParam);
      // Token aus sichtbarer URL entfernen (best-effort, ohne Navigation)
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } else if (!token) {
      setError('Ungültiger Reset-Link. Bitte fordere einen neuen an.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // Passwort-Validierung
  const passwordChecks = {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/~`]/.test(password)
  };

  const isPasswordValid = Object.values(passwordChecks).every(Boolean);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  const handleSubmit = async () => {
    if (!token) {
      setError('Ungültiger Reset-Link');
      return;
    }

    if (!isPasswordValid) {
      setError('Das Passwort erfüllt nicht alle Anforderungen');
      return;
    }

    if (!passwordsMatch) {
      setError('Die Passwörter stimmen nicht überein');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.post('/auth/reset-password', {
        token,
        newPassword: password
      });
      setSuccess(true);
    } catch (err: any) {
      const message = err.response?.data?.error || 'Fehler beim Zurücksetzen des Passworts';
      if (message.includes('abgelaufen') || message.includes('expired') || message.includes('ungültig')) {
        setError('Dieser Link ist abgelaufen oder ungültig. Bitte fordere einen neuen an.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonContent className="app-auth-background">
        {/* Freigestelltes Logo als Wasserzeichen */}
        <img src="/assets/icon/logo-mark.png" alt="" className="app-auth-ghost-icon" aria-hidden="true" />
        {/* Glow-Sterne */}
        <div className="app-auth-star app-auth-star--pink" style={{ top: '80px', left: '30px', width: '50px', height: '50px' }} />
        <div className="app-auth-star app-auth-star--cyan" style={{ top: '200px', right: '20px', width: '70px', height: '70px' }} />
        <div className="app-auth-star app-auth-star--gold" style={{ top: '380px', left: '20px', width: '40px', height: '40px' }} />
        <div className="app-auth-star app-auth-star--cyan" style={{ bottom: '200px', right: '40px', width: '60px', height: '60px' }} />
        <div className="app-auth-star app-auth-star--dot" style={{ top: '110px', left: '80px', width: '2px', height: '2px' }} />
        <div className="app-auth-star app-auth-star--dot" style={{ top: '300px', left: '280px', width: '2px', height: '2px' }} />

        <div className="app-auth-container">

          {/* Header */}
          <div className="app-auth-hero" style={{ marginTop: '60px' }}>
            <div className="app-auth-hero__cosmic-circle">
              <IonIcon icon={lockClosedOutline} className="app-auth-hero__cosmic-circle-icon" />
            </div>

            <h1 className="app-auth-hero__title--cosmic" style={{ fontSize: '2.2rem', letterSpacing: '4px' }}>
              NEUES<br />PASSWORT
            </h1>

            <div className="app-auth-hero__divider">
              <span className="app-auth-hero__divider-icon" />
            </div>

            <p className="app-auth-hero__subtitle--cosmic">
              Wähle ein sicheres Passwort
            </p>
          </div>

          {/* Card */}
          <IonCard className="app-auth-card app-auth-card--narrow">
            <IonCardContent className="app-auth-card__content">

              {success ? (
                // Erfolgsmeldung
                <div style={{ textAlign: 'center' }}>
                  <div className="app-auth-success-circle--small">
                    <IonIcon icon={checkmarkCircle} className="app-auth-success-circle__icon--small" />
                  </div>

                  <h2 style={{
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: '1.6rem',
                    fontWeight: 400,
                    letterSpacing: '3px',
                    margin: '0 0 12px 0',
                    color: '#5b21b6'
                  }}>
                    PASSWORT GEÄNDERT
                  </h2>

                  <p style={{
                    color: 'rgba(0, 0, 0, 0.6)',
                    fontSize: '0.9rem',
                    margin: '0 0 24px 0',
                    lineHeight: '1.5'
                  }}>
                    Dein Passwort wurde erfolgreich geändert. Du kannst dich jetzt mit deinem neuen Passwort anmelden.
                  </p>

                  <IonButton
                    expand="full"
                    onClick={() => router.push('/login')}
                    className="app-auth-button"
                  >
                    Zum Login
                  </IonButton>
                </div>
              ) : !token ? (
                // Kein Token - Pink/Magenta Cosmic-Variante statt klassisches Rot
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: '72px',
                    height: '72px',
                    borderRadius: '22px',
                    background: 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px auto',
                    boxShadow: '0 8px 32px rgba(236, 72, 153, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1) inset'
                  }}>
                    <IonIcon icon={alertCircle} style={{ fontSize: '2rem', color: 'white' }} />
                  </div>

                  <h2 style={{
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: '1.6rem',
                    fontWeight: 400,
                    letterSpacing: '3px',
                    margin: '0 0 12px 0',
                    color: '#5b21b6'
                  }}>
                    UNGÜLTIGER LINK
                  </h2>

                  <p style={{
                    color: 'rgba(0, 0, 0, 0.6)',
                    fontSize: '0.9rem',
                    margin: '0 0 24px 0',
                    lineHeight: '1.5'
                  }}>
                    Dieser Link ist ungültig oder abgelaufen. Bitte fordere einen neuen Reset-Link an.
                  </p>

                  <IonButton
                    expand="full"
                    onClick={() => router.push('/forgot-password')}
                    className="app-auth-button"
                  >
                    Neuen Link anfordern
                  </IonButton>
                </div>
              ) : (
                // Formular
                <>
                  <IonItem lines="none" className="app-auth-input app-auth-input--compact">
                    <IonIcon icon={lockClosedOutline} slot="start" style={{ color: '#67e8f9' }} />
                    <IonLabel position="stacked" className="app-auth-input__label">
                      Neues Passwort
                    </IonLabel>
                    <IonInput
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onIonInput={(e) => setPassword(e.detail.value!)}
                      placeholder="Neues Passwort"
                      className="app-auth-input__value"
                      autocapitalize="none"
                      autocorrect="off"
                      spellcheck={false}
                    />
                    <IonIcon
                      icon={showPassword ? eyeOff : eye}
                      slot="end"
                      onClick={() => setShowPassword(!showPassword)}
                      className="app-auth-input__toggle"
                    />
                  </IonItem>

                  {/* Passwort-Anforderungen */}
                  {password.length > 0 && !isPasswordValid && (
                    <div className="app-auth-password-checks">
                      <div className="app-auth-password-checks__grid">
                        <PasswordCheckItem label="Mind. 8 Zeichen" checked={passwordChecks.minLength} />
                        <PasswordCheckItem label="Großbuchstabe" checked={passwordChecks.hasUppercase} />
                        <PasswordCheckItem label="Kleinbuchstabe" checked={passwordChecks.hasLowercase} />
                        <PasswordCheckItem label="Zahl" checked={passwordChecks.hasNumber} />
                        <PasswordCheckItem label="Sonderzeichen" checked={passwordChecks.hasSpecial} />
                      </div>
                    </div>
                  )}

                  <IonItem lines="none" className="app-auth-input">
                    <IonIcon icon={lockClosedOutline} slot="start" style={{ color: '#67e8f9' }} />
                    <IonLabel position="stacked" className="app-auth-input__label">
                      Passwort bestätigen
                    </IonLabel>
                    <IonInput
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onIonInput={(e) => setConfirmPassword(e.detail.value!)}
                      placeholder="Passwort wiederholen"
                      className="app-auth-input__value"
                      autocapitalize="none"
                      autocorrect="off"
                      spellcheck={false}
                    />
                    <IonIcon
                      icon={showConfirmPassword ? eyeOff : eye}
                      slot="end"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="app-auth-input__toggle"
                    />
                  </IonItem>

                  {/* Passwörter stimmen nicht überein */}
                  {confirmPassword.length > 0 && !passwordsMatch && (
                    <div className="app-auth-password-match-error">
                      <IonIcon icon={alertCircle} style={{ fontSize: '1rem', color: '#f9a8d4' }} />
                      <span style={{ fontSize: '0.8rem', color: '#fce7f3' }}>
                        Die Passwörter stimmen nicht überein
                      </span>
                    </div>
                  )}

                  {error && (
                    <div className="app-auth-error">
                      <IonIcon icon={alertCircle} className="app-auth-error__icon" />
                      <span className="app-auth-error__text">{error}</span>
                    </div>
                  )}

                  <IonButton
                    expand="full"
                    onClick={handleSubmit}
                    disabled={loading || !isPasswordValid || !passwordsMatch}
                    className="app-auth-button"
                  >
                    {loading ? (
                      <IonSpinner name="crescent" style={{ '--color': 'white' }} />
                    ) : (
                      'Passwort ändern'
                    )}
                  </IonButton>

                  <div className="app-auth-footer">
                    <span onClick={() => router.push('/login')} className="app-auth-link">
                      <IonIcon icon={arrowBack} />
                      Zurück zum Login
                    </span>
                  </div>
                </>
              )}
            </IonCardContent>
          </IonCard>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default ResetPasswordPage;
