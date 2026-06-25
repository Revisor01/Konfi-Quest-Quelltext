import React, { useEffect, useCallback } from 'react';
import { Redirect, Route } from 'react-router-dom';
import {
  IonApp,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonSpinner,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonItem,
  IonBadge,
  setupIonicReact,
  isPlatform,
  useIonAlert
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
// iOS26 Theme Animationen
import { iosTransitionAnimation, popoverEnterAnimation, popoverLeaveAnimation } from '@rdlabo/ionic-theme-ios26';
// Material Design 3 Animationen
import { mdTransitionAnimation } from '@rdlabo/ionic-theme-md3';
// Icons sind jetzt in MainTabs.tsx
import { AppProvider, useApp } from './contexts/AppContext';
import { BadgeProvider } from './contexts/BadgeContext';
import { LiveUpdateProvider } from './contexts/LiveUpdateContext';
import LoginView from './components/auth/LoginView';
import KonfiRegisterPage from './components/auth/KonfiRegisterPage';
import ForgotPasswordPage from './components/auth/ForgotPasswordPage';
import ResetPasswordPage from './components/auth/ResetPasswordPage';
import LoadingSpinner from './components/common/LoadingSpinner';
import MainTabs from './components/layout/MainTabs';
import ErrorBoundary from './components/common/ErrorBoundary';
import GlobalToasts from './components/common/GlobalToasts';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/**
 * Ionic Dark Mode - DISABLED
 * -----------------------------------------------------
 * Dark Mode ist deaktiviert bis zur vollständigen Implementierung
 */

/* import '@ionic/react/css/palettes/dark.always.css'; */
/* import '@ionic/react/css/palettes/dark.class.css'; */
/* import '@ionic/react/css/palettes/dark.system.css'; */

/* Theme variables */
import './theme/variables.css';

setupIonicReact({
  rippleEffect: true,
  inputBlurring: true,
  scrollPadding: true,
  backButtonText: '',
  backButtonIcon: 'arrow-back-outline',
  innerHTMLTemplatesEnabled: true,
  // Plattform-spezifische Theme-Animationen
  navAnimation: isPlatform('ios') ? iosTransitionAnimation : mdTransitionAnimation,
  popoverEnter: isPlatform('ios') ? popoverEnterAnimation : undefined,
  popoverLeave: isPlatform('ios') ? popoverLeaveAnimation : undefined
});


const AppContent: React.FC = () => {
  const { user, loading, setUser, orgVersion } = useApp();

  // HINWEIS: Push-Listener (Empfang, Tap-Navigation, Counts-Refresh) liegen
  // zentral in AppContext. Frueher rief AppContent hier removeAllListeners()
  // auf und ueberschrieb damit die Navigations-Listener aus AppContext
  // (Tap auf Push navigierte dann nicht mehr). Daher hier KEINE eigenen
  // Push-Listener mehr — BadgeContext lauscht auf das 'push:received'-Event.

  // Generischer 429 Rate-Limit Alert-Handler
  const [presentAlert] = useIonAlert();

  const handleRateLimit = useCallback((event: Event) => {
    const detail = (event as CustomEvent).detail;
    presentAlert({
      header: 'Zu viele Anfragen',
      message: detail?.message || 'Bitte warte einen Moment und versuche es erneut.',
      buttons: ['OK']
    });
  }, [presentAlert]);

  useEffect(() => {
    window.addEventListener('rate-limit', handleRateLimit);
    return () => {
      window.removeEventListener('rate-limit', handleRateLimit);
    };
  }, [handleRateLimit]);

  // Bei abgelaufenem Refresh-Token zurueck zum Login — OHNE harten Reload.
  // Frueher: window.location.href = '/' — im nativen Capacitor-WebView laedt das
  // die App komplett neu (capacitor://localhost) und konnte beim Wiederaufbau
  // crashen. Jetzt setzen wir nur den User auf null -> React rendert sofort die
  // Login-Route (AppContent unten). Der Hinweis "Sitzung abgelaufen" geht per
  // sessionStorage an die LoginView.
  useEffect(() => {
    const handler = () => {
      try {
        sessionStorage.setItem('session_expired', '1');
      } catch {
        // sessionStorage nicht verfuegbar -> Hinweis entfaellt, Login kommt trotzdem
      }
      setUser(null);
    };
    window.addEventListener('auth:relogin-required', handler);
    return () => window.removeEventListener('auth:relogin-required', handler);
  }, [setUser]);

  // Auto-refresh every 30 seconds - DISABLED wegen Spam
  // useEffect(() => {
  //   if (!user) return;
  //   const interval = setInterval(refreshFromAPI, 30000);
  //   return () => {
  //     clearInterval(interval);
  //   };
  // }, [user, refreshFromAPI]);

  if (loading) {
    return (
      <IonApp>
        <LoadingSpinner fullScreen message="Deine Quest wird vorbereitet..." />
      </IonApp>
    );
  }

  if (!user) {
    return (
      <IonApp>
        <IonReactRouter>
          <IonRouterOutlet>
            <Route path="/login" component={LoginView} exact />
            <Route path="/register" component={KonfiRegisterPage} exact />
            <Route path="/forgot-password" component={ForgotPasswordPage} exact />
            <Route path="/reset-password" component={ResetPasswordPage} exact />
            <Redirect exact from="/" to="/login" />
            {/* Catch-all fuer ALLE uebrigen URLs: nach dem Logout steht die URL
                noch auf einer Admin-/Konfi-Route (z.B. /admin/organizations).
                Ohne diesen Fallback matcht im Login-Outlet KEINE Route -> weisse
                Seite. Der "/"-Fall wird bereits oben exakt behandelt, damit der
                Default-Render (Tests) die simple /->/login-Transition nutzt. */}
            <Route render={() => <Redirect to="/login" />} />
          </IonRouterOutlet>
        </IonReactRouter>
      </IonApp>
    );
  }

  // Die Render-Logik wird jetzt super einfach:
  // key={orgVersion}: Bei einem Org-Wechsel (Multi-Org-Switcher) wird orgVersion
  // erhoeht -> der gesamte Router-Subtree remountet frisch und alle Views laden
  // mit dem neuen aktiven-Org-Header neu. Ersetzt den fragilen location-Reload.
  return (
    <IonApp>
      <IonReactRouter key={orgVersion}>
        <IonRouterOutlet>
          {/* Anstatt die Tabs hier inline zu rendern, rendern wir nur noch eine Route auf MainTabs */}
          <Route path="/" component={MainTabs} />
        </IonRouterOutlet>
      </IonReactRouter>
      <GlobalToasts />
    </IonApp>
  );
};

const App: React.FC = () => (
  <AppProvider>
    {/* LiveUpdateProvider MUSS aussen liegen: BadgeProvider abonniert via
        useLiveRefresh die 'events'/'requests'-Updates. Lag BadgeProvider aussen,
        bekam er die No-op-Fallback-Instanz von useLiveUpdate -> Tab-Badge (z.B.
        "Verbuchen") aktualisierte sich erst beim 30s-Poll statt sofort. */}
    <LiveUpdateProvider>
      <BadgeProvider>
        <ErrorBoundary>
          <AppContent />
        </ErrorBoundary>
      </BadgeProvider>
    </LiveUpdateProvider>
  </AppProvider>
);

export default App;
