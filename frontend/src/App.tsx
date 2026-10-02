import React, { useEffect, useCallback } from 'react';
import { Navigate, Route } from 'react-router-dom';
import { IonApp, IonRouterOutlet, IonSpinner, setupIonicReact, isPlatform, useIonAlert } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
// Animationen des iOS-Themes (ios27)
import { iosTransitionAnimation, popoverEnterAnimation, popoverLeaveAnimation } from '@rdlabo/ionic-theme-ios27';
import { segmentGlasAnschalten } from './utils/segmentGlas';
import { modalNamenAnschalten } from './utils/modalNamen';
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
import MainTabs from './components/layout/MainTabs';
import ErrorBoundary from './components/common/ErrorBoundary';
import GlobalToasts from './components/common/GlobalToasts';
import PostfachModal from './components/common/PostfachModal';
import AppSperrbildschirm from './components/common/AppSperrbildschirm';
import AppAbdeckung from './components/common/AppAbdeckung';
import MindestversionHinweis from './components/common/MindestversionHinweis';
import { beobachteBetriebsstatus } from './services/betriebsstatus';
import { useAppSperre } from './hooks/useAppSperre';
import { useSeitenBereit } from './navigation/useSeitenBereit';
import PushZielNavigation from './navigation/PushZielNavigation';

/**
 * Ladebildschirm VOR dem Router — bewusst KEINE IonPage.
 *
 * Eine IonPage waere eine Seite und wuerde, sobald sie in einem Outlet
 * landet, genau den Tausch ausloesen, den dieser Bildschirm vermeiden soll.
 * Hier steht deshalb schlichtes Markup ausserhalb jedes Outlets.
 */
const AppLaedt: React.FC = () => (
  <div className="app-laedt">
    <IonSpinner name="crescent" />
  </div>
);

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
// float-elements.css (Ionics Hilfsklassen zum Umfliessen) steht hier nicht
// Keine Stelle der App nutzt diese
// Klassen, und die Datei war die einzige Quelle der Build-Warnung
// "'host-context' is not recognized" (zehn :host-context([dir=rtl])-Regeln,
// 2.952 Bytes). startBuendel.test.ts schlaegt an, wenn eine Klasse davon
// auftaucht.
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/**
 * Dunkelmodus: folgt der Systemeinstellung des Geraets.
 * -----------------------------------------------------
 * Ionics System-Palette stellt Hintergrund, Text und die ion-color-Stufen
 * um. Die passende Variante des iOS-Themes (-dark-system) liegt in
 * theme/variables.css bei den Theme-Imports, die dunklen Werte unserer
 * eigenen Farbtokens stehen dort in EINEM @media-Block. Die Palette muss
 * VOR variables.css geladen werden, damit unsere Werte gewinnen.
 */
import '@ionic/react/css/palettes/dark.system.css';

/* Theme variables */
import './theme/variables.css';
/* Fokusringe, nackte Knöpfe und Links der Anmeldeseiten -- muss NACH
   variables.css kommen, siehe Kopf der Datei. */
import './theme/barrierefreiheit.css';
import { bewegungReduziert } from './utils/bewegung';
import { anmeldeHinweisMerken } from './utils/anmeldeHinweis';

setupIonicReact({
  // Seitenuebergaenge, Modale und Popover laufen als Web Animations, nicht
  // per CSS -- wer im System „Bewegung reduzieren" eingeschaltet hat,
  // bekommt sie hier abgeschaltet.
  animated: !bewegungReduziert(),
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
  const { user, setUser, orgVersion, signOut } = useApp();

  // Glas-Effekt fuer alle Segmente anschalten (Begruendung in segmentGlas.ts).
  // Einmal fuer die ganze App: Der Beobachter dort faengt auch Segmente, die
  // erst spaeter in einem Modal auftauchen.
  useEffect(() => segmentGlasAnschalten(), []);

  // Jedes Modal traegt seinen Titel als Namen fuer Vorlesehilfen (Begruendung
  // in modalNamen.ts). Ebenfalls einmal fuer die ganze App: Es gilt fuer die
  // 92 per useIonModal geoeffneten Modale und jedes kuenftige.
  useEffect(() => modalNamenAnschalten(), []);

  // Mindestversion und Wartungshinweis: EINE Pruefung
  // fuer die ganze App, beim Start und bei jeder Rueckkehr in die App.
  // Die Hinweise lesen nur den Stand (services/betriebsstatus.ts).
  // Laeuft auch vor der Anmeldung -- der Endpunkt braucht keine, und ein zu
  // altes Geraet soll schon an der Anmeldeseite erfahren, dass es ein Update
  // braucht.
  useEffect(() => beobachteBetriebsstatus(), []);

  // App-Sperre: Face ID / Fingerabdruck vor der bereits angemeldeten App.
  // Der Hook laeuft immer mit (er muss den Hintergrundwechsel auch dann
  // mitbekommen, wenn gerade niemand angemeldet ist), der Sperrbildschirm
  // erscheint aber nur ueber der angemeldeten App — auf der Anmeldeseite gibt
  // es nichts zu verdecken, und ein Schloss vor dem Login waere eine Sackgasse.
  const { gesperrt, startGeklaert, verdeckt, entsperren } = useAppSperre();

  // Seitenbaum der Rolle vorladen. Das Ergebnis entscheidet unten, ob der
  // Router schon montiert werden darf — siehe die Begruendung dort.
  const seitenBereit = useSeitenBereit();

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

  // Bei abgelaufenem Refresh-Token zurück zum Login — OHNE harten Reload.
  // Frueher: window.location.href = '/' — im nativen Capacitor-WebView laedt das
  // die App komplett neu (capacitor://localhost) und konnte beim Wiederaufbau
  // crashen. Jetzt setzen wir nur den User auf null -> React rendert sofort die
  // Login-Route (AppContent unten). Der Hinweis "Sitzung abgelaufen" geht per
  // sessionStorage an die LoginView.
  // Bei einer Zugangs-Sperre traegt das Ereignis die Meldung des Servers; sie
  // ersetzt dann "Sitzung abgelaufen".
  useEffect(() => {
    const handler = (ereignis: Event) => {
      const detail = (ereignis as CustomEvent<{ sperrMeldung?: string | null } | undefined>).detail;
      anmeldeHinweisMerken(detail?.sperrMeldung);
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

  // ---------------------------------------------------------------------------
  // EIN EINZIGER EINHAENGEPUNKT fuer Sperrbildschirm und Abdeckung.
  //
  // Vorher stand der Sperrbildschirm in JEDEM Rueckgabezweig einmal — im
  // Ladezweig an zweiter Stelle hinter dem Ladebildschirm, im fertigen Zweig an
  // vierter hinter Router, Toasts und Vorgangsleiste. React gleicht Kinder nach
  // POSITION ab: verschiebt sich die Stelle, wird die Komponente nicht
  // abgeglichen, sondern NEU MONTIERT. Nachgemessen in
  // __tests__/components/appSperreErsterVersuch.test.tsx: gleiche Position ->
  // eine Montage, verschobene Position -> zwei.
  //
  // Beim Kaltstart mit eingeschalteter Sperre passiert genau das. `gesperrt`
  // steht fruehestens (useAppSperre braucht zwei Aufrufe ueber die
  // Capacitor-Bruecke), `seitenBereit` spaeter (useSeitenBereit wartet auf
  // dynamische Importe). Der Sperrbildschirm erscheint also erst im Ladezweig
  // und wandert dann in den fertigen — und sein Effekt beim Einblenden, der die
  // Biometrie von selbst abfragt, lief ein ZWEITES Mal.
  //
  // Nur der INHALT wechselt jetzt den Zweig, die Huelle steht fest. Damit
  // wandert der Sperrbildschirm nie mehr, wird nie mehr neu montiert und fragt
  // genau einmal.
  // ---------------------------------------------------------------------------
  const inhalt = (() => {
    if (!user) {
      return (
        <IonReactRouter>
          {/* Auch hier, nicht nur im angemeldeten Zweig: Ein App-Link auf
              /register?code=... oder /reset-password?token=... wird gerade von
              denen angetippt, die noch nicht angemeldet sind (utils/deepLinks).
              Das Ziel kommt ueber denselben Merker wie ein Push-Ziel; ohne
              diese Komponente holte es im Login-Router niemand ab. */}
          <PushZielNavigation />
          <IonRouterOutlet>
            <Route path="/login" element={<LoginView />} />
            <Route path="/register" element={<KonfiRegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/" element={<Navigate to="/login" replace />} />
            {/* Catch-all fuer ALLE uebrigen URLs: nach dem Logout steht die URL
                noch auf einer Admin-/Konfi-Route (z.B. /admin/organizations).
                Ohne diesen Fallback matcht im Login-Outlet KEINE Route -> weisse
                Seite. Der "/"-Fall wird bereits oben exakt behandelt, damit der
                Default-Render (Tests) die simple /->/login-Transition nutzt. */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </IonRouterOutlet>
        </IonReactRouter>
      );
    }

    // Angemeldet, aber noch nicht bereit: Ladebildschirm. Die Begruendung, WARUM
    // hier gewartet wird statt zu rendern, steht unten ausfuehrlich.
    if (!seitenBereit || !startGeklaert) return <AppLaedt />;

    return (
      <>
        <IonReactRouter key={orgVersion}>
          <PushZielNavigation />
          <IonRouterOutlet>
            {/* Anstatt die Tabs hier inline zu rendern, rendern wir nur noch eine Route auf MainTabs */}
            <Route path="/*" element={<MainTabs />} />
          </IonRouterOutlet>
        </IonReactRouter>
        <GlobalToasts />
        {/* Das Postfach (Mitteilungen + Warteschlange) haengt EINMAL hier und
            wird von der Glocke in der Kopfzeile geoeffnet (shared/PostfachGlocke,
            utils/postfach). Neben dem Router, nicht darin: kein Seitenwechsel,
            und es ueberlebt den Remount bei einem Gemeinde-Wechsel. */}
        <PostfachModal />
      </>
    );
  })();

  // Die Render-Logik wird jetzt super einfach:
  // key={orgVersion}: Bei einem Org-Wechsel (Multi-Org-Switcher) wird orgVersion
  // erhöht -> der gesamte Router-Subtree remountet frisch und alle Views laden
  // mit dem neuen aktiven-Org-Header neu. Ersetzt den fragilen location-Reload.
  // Der Seitenbaum der Rolle muss stehen, BEVOR der Router montiert wird.
  //
  // Jetzt wird der Router erst montiert, wenn der Baum endgueltig ist. Das
  // Outlet sieht dadurch nie einen Tausch. Bis dahin steht ein Ladebildschirm
  // AUSSERHALB jedes Outlets -- er ist keine Seite und kann keine verdraengen.
  //
  // `startGeklaert` beantwortet genau diese Frage, und sie wird hier
  // beantwortet: VOR dem Rendern, wie beim Seitenbaum daneben. Bis dahin
  // steht derselbe neutrale Ladebildschirm, den der Kaltstart ohnehin zeigt —
  // bewusst NICHT die Abdeckung mit dem Logo: Wer die Sperre auf 'aus' hat
  // (die Voreinstellung), saehe sonst ein Logo aufblitzen, das gleich wieder
  // verschwindet. Ein Aufblitzen gegen ein anderes zu tauschen waere kein
  // Gewinn. Im Browser steht `startGeklaert` sofort auf true und diese
  // Bedingung kostet dort nichts.
  return (
    <IonApp>
      {inhalt}
      {/* Der Sperrbildschirm liegt OBEN DRAUF, statt den Baum zu ersetzen.
          Ein Austausch wuerde MainTabs bei jedem Sperren neu montieren — genau
          das Muster, das in dieser App schon zu weissen Seiten gefuehrt hat
          (siehe Kommentar zum orgVersion-Schluessel oben). Verdeckt wird
          vollstaendig und deckend, es scheint nichts durch.
          */}
      {gesperrt && (
        <AppSperrbildschirm
          onEntsperrt={entsperren}
          onAbmelden={async () => {
            // Erst die Sperre loesen, dann abmelden. Andernfalls stuende das
            // Schloss nach dem naechsten Anmelden sofort wieder da — der
            // Rueckweg fuehrte im Kreis statt heraus.
            entsperren();
            await signOut();
          }}
        />
      )}
      <MindestversionHinweis zurueckhalten={gesperrt || !startGeklaert} />
      {/* Die Abdeckung steht ZULETZT und damit ueber dem Sperrbildschirm.
          Beim Wegwechseln kann beides gleichzeitig anstehen — dann gehoert
          ins Vorschaubild die neutrale Flaeche, nicht der bedienbare
          Sperrbildschirm.

          Sie liegt ueber JEDEM Zustand, auch ueber der Anmeldeseite: Dort kann
          ein eingetippter Benutzername stehen, und nach dem Abmelden ist die
          letzte Ansicht unter Umstaenden noch im Vorschaubild. */}
      {verdeckt && <AppAbdeckung />}
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
