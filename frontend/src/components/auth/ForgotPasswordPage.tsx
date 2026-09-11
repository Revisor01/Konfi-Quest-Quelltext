import {
  ICON_AKTUALISIEREN,
  ICON_INFO,
  ICON_MAIL,
  ICON_OFFLINE,
  ICON_WARNHINWEIS_GEFUELLT,
  ICON_ZURUECK,
  ICON_ZUSAGE_GEFUELLT,
} from '../shared/icons';
import { fehlerStatus, istNetzwerkfehler } from '../../utils/fehler';
import React, { useState } from 'react';
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
import { useApp } from '../../contexts/AppContext';

const ForgotPasswordPage: React.FC = () => {
  const { isOnline } = useApp();
  const router = useIonRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError('Bitte gib deine E-Mail-Adresse ein');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Bitte gib eine gültige E-Mail-Adresse ein');
      return;
    }

    setLoading(true);
    setError(null);
    setIsNetworkError(false);

    try {
      await api.post('/auth/request-password-reset', { email: email.trim() });
      setSent(true);
    } catch (err) {
      const status = fehlerStatus(err);
      if (status === 500) {
        setError('E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut.');
      } else if (istNetzwerkfehler(err)) {
        setError('Verbindung fehlgeschlagen. Bitte prüfe deine Internetverbindung.');
        setIsNetworkError(true);
      } else {
        // Für alle anderen Fälle (inkl. 200 bei unbekannter E-Mail)
        // zeigen wir weiterhin "gesendet" an (Privacy)
        setSent(true);
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
        <div className="app-auth-star app-auth-star--pink" style={{ bottom: '100px', left: '50px', width: '80px', height: '80px' }} />
        <div className="app-auth-star app-auth-star--dot" style={{ top: '110px', left: '80px', width: '2px', height: '2px' }} />
        <div className="app-auth-star app-auth-star--dot" style={{ top: '150px', right: '90px', width: '3px', height: '3px' }} />
        <div className="app-auth-star app-auth-star--dot" style={{ top: '300px', left: '280px', width: '2px', height: '2px' }} />
        <div className="app-auth-star app-auth-star--dot" style={{ top: '420px', left: '60px', width: '3px', height: '3px' }} />

        <div className="app-auth-container">

          {/* Header */}
          <div className="app-auth-hero" style={{ marginTop: 'var(--app-freiraum-kopf-m)' }}>
            <div className="app-auth-hero__cosmic-circle">
              <IonIcon icon={ICON_MAIL} className="app-auth-hero__cosmic-circle-icon" />
            </div>

            <h1 className="app-auth-hero__title--cosmic" style={{ fontSize: 'var(--app-anzeige-zahl)', letterSpacing: '4px' }}>
              PASSWORT<br />VERGESSEN?
            </h1>

            <div className="app-auth-hero__divider">
              <span className="app-auth-hero__divider-icon" />
            </div>

            <p className="app-auth-hero__subtitle--cosmic">
              Kein Problem — wir senden dir einen Link
            </p>
          </div>

          {/* Card */}
          <IonCard className="app-auth-card app-auth-card--narrow">
            <IonCardContent className="app-auth-card__content">

              {sent ? (
                // Erfolgsmeldung
                <div style={{ textAlign: 'center' }}>
                  <div className="app-auth-success-circle--small">
                    <IonIcon icon={ICON_ZUSAGE_GEFUELLT} className="app-auth-success-circle__icon--small" />
                  </div>

                  <h2 style={{
                    fontFamily: 'var(--app-schriftart-marke)',
                    fontSize: 'var(--app-text-ueberschrift-gross)',
                    fontWeight: 'var(--app-schrift-normal)',
                    letterSpacing: '3px',
                    margin: '0 0 var(--app-abstand-mittel) 0',
                    color: 'var(--app-color-konfis)'
                  }}>
                    E-MAIL GESENDET
                  </h2>

                  <p style={{
                    color: 'rgba(0, 0, 0, 0.6)',
                    fontSize: 'var(--app-text-basis)',
                    margin: '0 0 var(--app-abstand-weit) 0',
                    lineHeight: '1.5'
                  }}>
                    Falls ein Konto mit dieser E-Mail-Adresse existiert, erhältst du in Kürze eine E-Mail mit einem Link zum Zurücksetzen deines Passworts.
                  </p>

                  <IonButton
                    expand="full"
                    onClick={() => router.push('/login')}
                    className="app-auth-button"
                  >
                    Zurück zum Login
                  </IonButton>
                </div>
              ) : (
                // Formular
                <>
                  <IonItem lines="none" className="app-auth-input">
                    <IonIcon icon={ICON_MAIL} slot="start" style={{ color: 'var(--app-auth-akzent)' }} />
                    <IonLabel position="stacked" className="app-auth-input__label">
                      E-Mail-Adresse
                    </IonLabel>
                    <IonInput
                      type="email"
                      value={email}
                      onIonInput={(e) => setEmail(e.detail.value!)}
                      placeholder="deine@email.de"
                      className="app-auth-input__value"
                    />
                  </IonItem>

                  {/* Konfi-Hinweis */}
                  <div className="app-auth-konfi-hint">
                    <IonIcon icon={ICON_INFO} />
                    <span>Keine E-Mail-Adresse hinterlegt? Frag deinen Konfi-Leiter -- er kann dein Passwort direkt zurücksetzen.</span>
                  </div>

                  {error && (
                    <div className="app-auth-error">
                      <IonIcon icon={ICON_WARNHINWEIS_GEFUELLT} className="app-auth-error__icon" />
                      <span className="app-auth-error__text">{error}</span>
                    </div>
                  )}

                  {isNetworkError && (
                    <IonButton
                      expand="full"
                      fill="outline"
                      onClick={() => handleSubmit()}
                      style={{ marginBottom: 'var(--app-abstand-mittel)', '--border-radius': '8px', height: '36px', fontSize: 'var(--app-text-sekundaer)' }}
                    >
                      <IonIcon icon={ICON_AKTUALISIEREN} slot="start" />
                      Erneut versuchen
                    </IonButton>
                  )}

                  <IonButton
                    expand="full"
                    onClick={handleSubmit}
                    disabled={loading || !isOnline}
                    className="app-auth-button"
                    style={{ marginBottom: 'var(--app-abstand-basis)' }}
                  >
                    {loading ? (
                      <IonSpinner name="crescent" style={{ '--color': 'white' }} />
                    ) : !isOnline ? (
                      <><IonIcon icon={ICON_OFFLINE} style={{ marginRight: 'var(--app-abstand-mini)'}} /> Du bist offline</>
                    ) : (
                      'Link senden'
                    )}
                  </IonButton>

                  <div className="app-auth-footer">
                    <span
                      onClick={() => router.push('/login')}
                      className="app-auth-link"
                    >
                      <IonIcon icon={ICON_ZURUECK} />
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

export default ForgotPasswordPage;
