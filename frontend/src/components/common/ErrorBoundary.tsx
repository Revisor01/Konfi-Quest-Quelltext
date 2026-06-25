import React from 'react';
import {
  IonPage,
  IonContent,
  IonButton
} from '@ionic/react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary hat einen Fehler gefangen:', error, errorInfo);
  }

  // Raus aus der Fehlerseite — MUSS auch im nativen Capacitor-WebView funktionieren.
  // window.location.href = '/' laedt dort capacitor://localhost neu und kann
  // haengenbleiben (404/weisse Seite). Stattdessen: Auth UND offlineCache leeren,
  // dann location.reload() — das laedt die SPA an Ort und Stelle neu, und ohne
  // Token rendert die App garantiert die Login-Route.
  private handleBackToLogin = () => {
    Promise.allSettled([
      import('../../services/tokenStore').then((m) => m.clearAuth()),
      import('../../services/offlineCache').then((m) => m.offlineCache.clearAll()),
    ]).finally(() => { window.location.reload(); });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Fehlerseite im Login-Look (gleiche Auth-Optik wie LoginView),
      // damit ein Crash nicht wie ein technischer Totalausfall wirkt.
      return (
        <IonPage>
          <IonContent className="app-auth-background">
            <img
              src="/assets/icon/logo-mark.png"
              alt=""
              className="app-auth-ghost-icon"
              aria-hidden="true"
            />
            <div className="app-auth-bubble" style={{ top: '70px', left: '-55px', width: '150px', height: '150px' }} />
            <div className="app-auth-bubble" style={{ bottom: '-50px', left: '-30px', width: '180px', height: '180px' }} />
            <div className="app-auth-bubble" style={{ bottom: '-25px', right: '-55px', width: '130px', height: '130px' }} />
            <div className="app-auth-star app-auth-star--cyan" style={{ top: '200px', right: '20px', width: '70px', height: '70px' }} />
            <div className="app-auth-star app-auth-star--pink" style={{ bottom: '100px', left: '50px', width: '80px', height: '80px' }} />

            <div className="app-auth-container">
              <div className="app-auth-hero" style={{ marginTop: '90px' }}>
                <h1 className="app-auth-hero__title app-auth-hero__title--cosmic">
                  KONFI<br />QUEST
                </h1>
                <div className="app-auth-hero__divider">
                  <span className="app-auth-hero__divider-icon" />
                </div>
                <p className="app-auth-hero__subtitle app-auth-hero__subtitle--cosmic">
                  Bitte melde dich erneut an
                </p>
              </div>

              <div style={{ padding: '0 32px', marginTop: '32px' }}>
                <IonButton
                  expand="block"
                  className="app-auth-button"
                  onClick={this.handleBackToLogin}
                >
                  Zur Anmeldung
                </IonButton>
              </div>
            </div>
          </IonContent>
        </IonPage>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
