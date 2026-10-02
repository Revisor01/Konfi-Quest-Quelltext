import {
  ICON_ABSAGE,
  ICON_SICHTBAR,
  ICON_SPERRE,
  ICON_VERBORGEN,
  ICON_WARNHINWEIS_GEFUELLT,
  ICON_ZURUECK,
  ICON_ZUSAGE_GEFUELLT,
} from '../shared/icons';
import { fehlerText } from '../../utils/fehler';
import { beiEnter } from '../../utils/tastatur';
import React, { useState, useEffect } from 'react';
import { useAppLocation } from '../../navigation/useAppLocation';

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
import api from '../../services/api';

const PasswordCheckItem: React.FC<{ label: string; checked: boolean }> = ({ label, checked }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--app-abstand-kompakt)',
    color: checked ? 'var(--app-auth-akzent)' : 'rgba(255, 255, 255, 0.35)'
  }}>
    <IonIcon
      icon={checked ? ICON_ZUSAGE_GEFUELLT : ICON_ABSAGE}
      style={{ fontSize: 'var(--app-text-basis)' }}
    />
    <span style={{ fontSize: 'var(--app-text-klein)' }}>{label}</span>
  </div>
);

const ResetPasswordPage: React.FC = () => {
  const router = useIonRouter();
  const location = useAppLocation();
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
    hasSpecial: /[!@#$%^&*(),.?":{}|<>_\-+=[\]\\/~`]/.test(password)
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
    } catch (err) {
      const message = fehlerText(err, 'Fehler beim Zurücksetzen des Passworts');
      if (message.includes('abgelaufen') || message.includes('expired') || message.includes('ungültig')) {
        setError('Dieser Link ist abgelaufen oder ungültig. Bitte fordere einen neuen an.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Enter im Feld sendet wie der Knopf; die Pruefungen in handleSubmit melden
  // ein zu schwaches oder nicht uebereinstimmendes Passwort als Fehler.
  const absendenPerTastatur = () => { if (!loading) void handleSubmit(); };

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
          <div className="app-auth-hero" style={{ marginTop: 'var(--app-freiraum-kopf-m)' }}>
            <div className="app-auth-hero__cosmic-circle">
              <IonIcon icon={ICON_SPERRE} className="app-auth-hero__cosmic-circle-icon" />
            </div>

            <h1 className="app-auth-hero__title--cosmic" style={{ fontSize: 'var(--app-anzeige-zahl)', letterSpacing: '4px' }}>
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
                <div style={{ textAlign: 'center' }} role="status">
                  <div className="app-auth-success-circle--small">
                    <IonIcon icon={ICON_ZUSAGE_GEFUELLT} className="app-auth-success-circle__icon--small" />
                  </div>

                  <h2 style={{
                    fontFamily: 'var(--app-schriftart-marke)',
                    fontSize: 'var(--app-text-ueberschrift-gross)',
                    fontWeight: 'var(--app-schrift-normal)',
                    letterSpacing: '3px',
                    margin: '0 0 var(--app-abstand-mittel) 0',
                    color: 'var(--app-text-konfis)'
                  }}>
                    PASSWORT GEÄNDERT
                  </h2>

                  <p style={{
                    color: 'rgba(0, 0, 0, 0.6)',
                    fontSize: 'var(--app-text-basis)',
                    margin: '0 0 var(--app-abstand-weit) 0',
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
                <div style={{ textAlign: 'center' }} role="alert">
                  <div style={{
                    width: '72px',
                    height: '72px',
                    borderRadius: 'var(--app-radius-modal)',
                    background: 'var(--app-gradient-auth-fehler)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto var(--app-abstand-gross) auto',
                    boxShadow: '0 8px 32px rgba(236, 72, 153, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1) inset'
                  }}>
                    <IonIcon icon={ICON_WARNHINWEIS_GEFUELLT} style={{ fontSize: 'var(--app-anzeige-zahl)', color: 'white' }} />
                  </div>

                  <h2 style={{
                    fontFamily: 'var(--app-schriftart-marke)',
                    fontSize: 'var(--app-text-ueberschrift-gross)',
                    fontWeight: 'var(--app-schrift-normal)',
                    letterSpacing: '3px',
                    margin: '0 0 var(--app-abstand-mittel) 0',
                    color: 'var(--app-text-konfis)'
                  }}>
                    UNGÜLTIGER LINK
                  </h2>

                  <p style={{
                    color: 'rgba(0, 0, 0, 0.6)',
                    fontSize: 'var(--app-text-basis)',
                    margin: '0 0 var(--app-abstand-weit) 0',
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
                  {/* Feldnamen per aria-label: Ionic 9 bindet das Geschwister-IonLabel nicht mehr an das Feld;
                      das sichtbare Label bleibt fuer das Layout. */}
                  <IonItem lines="none" className="app-auth-input app-auth-input--compact">
                    <IonIcon icon={ICON_SPERRE} slot="start" style={{ color: 'var(--app-auth-akzent)' }} />
                    <IonLabel position="stacked" className="app-auth-input__label">
                      Neues Passwort
                    </IonLabel>
                    <IonInput
                      aria-label="Neues Passwort"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onIonInput={(e) => setPassword(e.detail.value!)}
                      onKeyDown={beiEnter(absendenPerTastatur)}
                      placeholder="Neues Passwort"
                      className="app-auth-input__value"
                      autocapitalize="none"
                      autocorrect={false}
                      spellcheck={false}
                    />
                    <button
                      type="button"
                      slot="end"
                      onClick={() => setShowPassword(!showPassword)}
                      className="app-auth-input__toggle app-knopf-nackt app-beruehrungsziel"
                      aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                      aria-pressed={showPassword}
                    >
                      <IonIcon icon={showPassword ? ICON_VERBORGEN : ICON_SICHTBAR} aria-hidden="true" />
                    </button>
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
                    <IonIcon icon={ICON_SPERRE} slot="start" style={{ color: 'var(--app-auth-akzent)' }} />
                    <IonLabel position="stacked" className="app-auth-input__label">
                      Passwort bestätigen
                    </IonLabel>
                    <IonInput
                      aria-label="Passwort bestätigen"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onIonInput={(e) => setConfirmPassword(e.detail.value!)}
                      onKeyDown={beiEnter(absendenPerTastatur)}
                      placeholder="Passwort wiederholen"
                      className="app-auth-input__value"
                      autocapitalize="none"
                      autocorrect={false}
                      spellcheck={false}
                    />
                    <button
                      type="button"
                      slot="end"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="app-auth-input__toggle app-knopf-nackt app-beruehrungsziel"
                      aria-label={showConfirmPassword ? 'Passwortbestätigung verbergen' : 'Passwortbestätigung anzeigen'}
                      aria-pressed={showConfirmPassword}
                    >
                      <IonIcon icon={showConfirmPassword ? ICON_VERBORGEN : ICON_SICHTBAR} aria-hidden="true" />
                    </button>
                  </IonItem>

                  {/* Passwörter stimmen nicht überein */}
                  {confirmPassword.length > 0 && !passwordsMatch && (
                    <div className="app-auth-password-match-error" role="status">
                      <IonIcon icon={ICON_WARNHINWEIS_GEFUELLT} style={{ fontSize: 'var(--app-text-standard)', color: 'var(--app-auth-rosa)' }} />
                      <span style={{ fontSize: 'var(--app-text-hinweis)', color: 'var(--app-auth-rosa-hell)' }}>
                        Die Passwörter stimmen nicht überein
                      </span>
                    </div>
                  )}

                  {error && (
                    <div className="app-auth-error" role="alert">
                      <IonIcon icon={ICON_WARNHINWEIS_GEFUELLT} className="app-auth-error__icon" />
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
                    <a href="/login" onClick={(e) => { e.preventDefault(); router.push('/login'); }} className="app-auth-link">
                      <IonIcon icon={ICON_ZURUECK} aria-hidden="true" />
                      Zurück zum Login
                    </a>
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
