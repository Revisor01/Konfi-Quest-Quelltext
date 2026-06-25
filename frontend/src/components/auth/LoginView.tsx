import React, { useState, useEffect } from 'react';
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
import { key, person, arrowForward, alertCircle, closeCircle, eye, eyeOff, refreshOutline } from 'ionicons/icons';
import { useApp } from '../../contexts/AppContext';
import { loginWithAutoDetection } from '../../services/auth';

const LoginView: React.FC = () => {
  const { setUser } = useApp();
  const router = useIonRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [shakeError, setShakeError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isNetworkError, setIsNetworkError] = useState(false);

  // Hinweis "Sitzung abgelaufen" anzeigen, wenn der User wegen abgelaufenem
  // Refresh-Token hierher umgeleitet wurde (Flag aus App.tsx).
  useEffect(() => {
    try {
      if (sessionStorage.getItem('session_expired') === '1') {
        sessionStorage.removeItem('session_expired');
        setLoginError('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
      }
    } catch {
      // sessionStorage nicht verfuegbar -> kein Hinweis
    }
  }, []);

  const triggerShake = () => {
    setShakeError(true);
    setTimeout(() => setShakeError(false), 600);
  };

  const handleLogin = async () => {
    setLoginError(null);
    setIsNetworkError(false);

    if (!username || !password) {
      setLoginError('Bitte Benutzername und Passwort eingeben');
      triggerShake();
      return;
    }

    setLoading(true);
    try {
      const user = await loginWithAutoDetection(username, password);
      setUser(user);

      // Explicit navigation based on user type
      if (user.role_name === 'super_admin') {
        // Super-Admin Branch hat kein IonTabs-Wrapper -> router.push verliert die Route
        // im Capacitor WebView. Hartes Navigieren erzwingt sauberen Re-Render.
        window.location.replace('/admin/organizations');
      } else if (user.type === 'admin') {
        router.push('/admin/konfis', 'root', 'replace');
      } else if (user.type === 'teamer') {
        router.push('/teamer/dashboard', 'root', 'replace');
      } else {
        router.push('/konfi/dashboard', 'root', 'replace');
      }
    } catch (err: any) {
      // Defensiv: errorMessage immer ein String, sonst werfen die .includes()-Checks unten
      const errorMessage: string = err?.response?.data?.error || err?.message || '';
      const errorCode: string = err?.response?.data?.error_code || '';
      let displayError: string;

      // Rate-Limit (429) ZUERST pruefen — ein 429 ist KEINE fehlende Verbindung.
      // Sonst zeigt die App bei "zu viele Versuche" faelschlich "Keine Verbindung".
      if (err.response?.status === 429 || err.rateLimitMessage) {
        displayError = err.rateLimitMessage || err?.response?.data?.error || 'Zu viele Login-Versuche. Bitte warte einen Moment.';
      } else if (!err.response || err.code === 'ERR_NETWORK') {
        // Netzwerkfehler erkennen
        displayError = 'Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung.';
        setIsNetworkError(true);
      } else if (errorCode === 'org_trial_expired' || errorCode === 'org_inactive' || errorCode === 'user_inactive') {
        // Zugangs-Sperre (Testphase abgelaufen / Org gesperrt / User deaktiviert):
        // klare Server-Meldung direkt anzeigen.
        displayError = errorMessage || 'Zugang gesperrt. Bitte wende dich an deine Gemeinde.';
      } else if (errorMessage.includes('password') || errorMessage.includes('Passwort') || errorMessage.includes('Invalid credentials') || errorMessage.includes('Ungültige Anmeldedaten')) {
        displayError = 'Falsches Passwort. Bitte versuche es erneut.';
      } else if (errorMessage.includes('not found') || errorMessage.includes('nicht gefunden') || errorMessage.includes('User not found')) {
        displayError = 'Nutzername nicht gefunden. Bitte überprüfe deine Eingabe.';
      } else if (errorMessage.includes('network') || errorMessage.includes('Network')) {
        displayError = 'Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung.';
        setIsNetworkError(true);
      } else {
        displayError = 'Anmeldung fehlgeschlagen. Bitte versuche es erneut.';
      }

      setLoginError(displayError);
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonContent className="app-auth-background">
        {/* Freigestelltes Logo als grosses, angedeutetes Wasserzeichen */}
        <img
          src="/assets/icon/logo-mark.png"
          alt=""
          className="app-auth-ghost-icon"
          aria-hidden="true"
        />

        {/* Dashboard-Bubbles: dekorative Kreise, asymmetrisch verstreut (Icon oben rechts frei lassen) */}
        <div className="app-auth-bubble" style={{ top: '70px', left: '-55px', width: '150px', height: '150px' }} />
        <div className="app-auth-bubble app-auth-bubble--soft" style={{ top: '210px', left: '45px', width: '46px', height: '46px' }} />
        <div className="app-auth-bubble" style={{ bottom: '-50px', left: '-30px', width: '180px', height: '180px' }} />
        <div className="app-auth-bubble app-auth-bubble--soft" style={{ bottom: '130px', left: '55px', width: '64px', height: '64px' }} />
        <div className="app-auth-bubble" style={{ bottom: '-25px', right: '-55px', width: '130px', height: '130px' }} />
        <div className="app-auth-bubble app-auth-bubble--soft" style={{ bottom: '90px', right: '25px', width: '38px', height: '38px' }} />

        {/* Glow-Sterne (Cyan, Pink, Gold) */}
        <div className="app-auth-star app-auth-star--pink" style={{ top: '80px', left: '30px', width: '50px', height: '50px' }} />
        <div className="app-auth-star app-auth-star--cyan" style={{ top: '200px', right: '20px', width: '70px', height: '70px' }} />
        <div className="app-auth-star app-auth-star--gold" style={{ top: '380px', left: '20px', width: '40px', height: '40px' }} />
        <div className="app-auth-star app-auth-star--cyan" style={{ bottom: '200px', right: '40px', width: '60px', height: '60px' }} />
        <div className="app-auth-star app-auth-star--pink" style={{ bottom: '100px', left: '50px', width: '80px', height: '80px' }} />

        {/* Weisse Dot-Sterne */}
        <div className="app-auth-star app-auth-star--dot" style={{ top: '110px', left: '80px', width: '2px', height: '2px' }} />
        <div className="app-auth-star app-auth-star--dot" style={{ top: '150px', right: '90px', width: '3px', height: '3px' }} />
        <div className="app-auth-star app-auth-star--dot" style={{ top: '300px', left: '280px', width: '2px', height: '2px' }} />
        <div className="app-auth-star app-auth-star--dot" style={{ top: '420px', left: '60px', width: '3px', height: '3px' }} />
        <div className="app-auth-star app-auth-star--dot" style={{ top: '250px', left: '180px', width: '2px', height: '2px' }} />

        <div className="app-auth-container">

          {/* Hero Section */}
          <div className="app-auth-hero" style={{ marginTop: '60px' }}>
            <h1 className="app-auth-hero__title app-auth-hero__title--cosmic">
              KONFI<br />QUEST
            </h1>

            <div className="app-auth-hero__divider">
              <span className="app-auth-hero__divider-icon" />
            </div>

            <p className="app-auth-hero__subtitle app-auth-hero__subtitle--cosmic">
              Glaube entdecken, Level für Level
            </p>
          </div>

          {/* Login Card */}
          <IonCard className={`app-auth-card app-auth-card--narrow ${loginError ? 'app-auth-card--error' : ''} ${shakeError ? 'app-auth-card--shaking' : ''}`}
            style={{ transition: 'box-shadow 0.3s ease, border 0.3s ease' }}
          >
            <IonCardContent className="app-auth-card__content">

              <div className="app-auth-card__heading">
                <h2>Anmelden</h2>
                <p>Melde dich an um deine Quest fortzusetzen</p>
              </div>

              <IonItem lines="none" className="app-auth-input">
                <IonIcon icon={person} slot="start" color="medium" />
                <IonLabel position="stacked" className="app-auth-input__label">
                  Benutzername
                </IonLabel>
                <IonInput
                  value={username}
                  onIonInput={(e) => setUsername(e.detail.value!)}
                  placeholder="Dein Nutzername"
                  className="app-auth-input__value"
                  autocapitalize="none"
                  autocorrect="off"
                  spellcheck={false}
                />
              </IonItem>

              <IonItem lines="none" className="app-auth-input" style={{ marginBottom: '24px' }}>
                <IonIcon icon={key} slot="start" color="medium" />
                <IonLabel position="stacked" className="app-auth-input__label">
                  Passwort
                </IonLabel>
                <IonInput
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onIonInput={(e) => setPassword(e.detail.value!)}
                  placeholder="Dein Passwort"
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

              <IonButton
                expand="full"
                onClick={handleLogin}
                disabled={loading}
                className="app-auth-button"
              >
                {loading ? (
                  <IonSpinner name="crescent" style={{ '--color': 'white' }} />
                ) : (
                  <>
                    Anmelden
                    <IonIcon icon={arrowForward} slot="end" />
                  </>
                )}
              </IonButton>

              {/* Passwort vergessen Link - immer an fester Position direkt unter Button */}
              <div className="app-auth-footer">
                <span
                  onClick={() => router.push('/forgot-password')}
                  className="app-auth-link app-auth-link--muted"
                  style={{ cursor: 'pointer' }}
                >
                  Passwort vergessen?
                </span>
              </div>

              {/* Fehlermeldung */}
              {loginError && (
                <div className="app-auth-error app-auth-error--with-badge" style={{ gap: '12px' }}>
                  <div className="app-auth-error__badge">
                    <IonIcon icon={alertCircle} className="app-auth-error__badge-icon" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="app-auth-error__title">
                      Anmeldung fehlgeschlagen
                    </div>
                    <div className="app-auth-error__detail">
                      {loginError}
                    </div>
                  </div>
                  <IonIcon
                    icon={closeCircle}
                    onClick={() => { setLoginError(null); setIsNetworkError(false); }}
                    className="app-auth-error__close"
                    style={{ opacity: 0.7 }}
                  />
                </div>
              )}

              {isNetworkError && (
                <IonButton
                  expand="full"
                  className="app-auth-retry-button"
                  onClick={handleLogin}
                >
                  <IonIcon icon={refreshOutline} slot="start" />
                  Erneut versuchen
                </IonButton>
              )}

              {/* Register-Link mit Trennlinie */}
              <div className="app-auth-footer app-auth-footer--separator">
                <span
                  onClick={() => router.push('/register')}
                  className="app-auth-link"
                  style={{ fontSize: '0.85rem', display: 'block', lineHeight: 1.5 }}
                >
                  Noch keinen Account?<br /><strong>Mit Einladungscode registrieren</strong>
                </span>
              </div>
            </IonCardContent>
          </IonCard>

        </div>
      </IonContent>
    </IonPage>
  );
};

export default LoginView;
