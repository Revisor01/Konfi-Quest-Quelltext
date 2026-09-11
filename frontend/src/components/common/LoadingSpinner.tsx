import React from 'react';
import {
  IonPage,
  IonContent,
  IonSpinner
} from '@ionic/react';

interface LoadingSpinnerProps {
  fullScreen?: boolean;
  message?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  fullScreen = false,
  message = 'Quest wird geladen...'
}) => {
  if (fullScreen) {
    // Loadingscreen identisch zum Auth-Screen: gleicher Verlauf (app-auth-background),
    // freigestelltes Logo als Wasserzeichen (app-auth-ghost-icon), gleiche Deko-Bubbles.
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

          {/* Dekorative Bubbles wie auf den Auth-Screens */}
          <div className="app-auth-bubble" style={{ top: '70px', left: '-55px', width: '150px', height: '150px' }} />
          <div className="app-auth-bubble app-auth-bubble--soft" style={{ top: '210px', left: '45px', width: '46px', height: '46px' }} />
          <div className="app-auth-bubble" style={{ bottom: '-50px', left: '-30px', width: '180px', height: '180px' }} />
          <div className="app-auth-bubble app-auth-bubble--soft" style={{ bottom: '90px', right: '25px', width: '38px', height: '38px' }} />

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100%',
            color: 'white',
            textAlign: 'center',
            position: 'relative',
            zIndex: 1
          }}>

            {/* App Title */}
            <h1 className="app-auth-hero__title--cosmic" style={{ marginBottom: 'var(--app-abstand-gross)' }}>
              KONFI QUEST
            </h1>

            {/* Loading Message */}
            <p style={{
              fontSize: 'var(--app-text-gross)',
              opacity: 0.92,
              margin: '0 0 var(--app-abstand-extraweit) 0',
              textShadow: '0 1px 2px rgba(0,0,0,0.25)'
            }}>
              {message}
            </p>

            {/* Spinner */}
            <IonSpinner
              name="crescent"
              style={{
                '--color': 'white',
                transform: 'scale(1.5)'
              }}
            />

            {/* Progress Dots */}
            <div style={{
              display: 'flex',
              gap: 'var(--app-abstand-eng)',
              marginTop: 'var(--app-abstand-extraweit)'
            }}>
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: 'var(--app-radius-kreis)',
                    backgroundColor: 'rgba(255,255,255,0.6)',
                    animation: `pulse 1.5s infinite ${i * 0.2}s`
                  }}
                />
              ))}
            </div>
          </div>

          <style>{`
            @keyframes pulse {
              0%, 100% {
                opacity: 0.4;
                transform: scale(1);
              }
              50% {
                opacity: 1;
                transform: scale(1.2);
              }
            }
          `}</style>
        </IonContent>
      </IonPage>
    );
  }

  // Inline loading spinner
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: 'var(--app-abstand-gross)'
    }}>
      <IonSpinner name="crescent" color="primary" />
      {message && (
        <p style={{
          marginTop: 'var(--app-abstand-basis)',
          color: 'var(--ion-color-medium)',
          textAlign: 'center'
        }}>
          {message}
        </p>
      )}
    </div>
  );
};

export default LoadingSpinner;