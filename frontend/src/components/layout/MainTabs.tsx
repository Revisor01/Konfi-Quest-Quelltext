// MainTabs.tsx
import React, { useEffect } from 'react';
// react-router nur noch fuer die Routen-Bausteine — der Standort kommt
// ueber useAppLocation aus navigation/.
import { Navigate, Route, useParams } from 'react-router-dom';
import {
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  IonBadge
} from '@ionic/react';
import { useIonRouter, isPlatform } from '@ionic/react';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren
import { useApp } from '../../contexts/AppContext';
import { BAEUME } from '../../navigation/rollenBaeume';
import { istTabLeisteVersteckt } from '../../navigation/routes';
import type { Rolle, BadgeKey } from '../../navigation/routes';
import { useAppLocation } from '../../navigation/useAppLocation';
import { useBadge } from '../../contexts/BadgeContext';
import { bereichAusPfad, trackBereich } from '../../services/analytics';
import { ModalProvider } from '../../contexts/ModalContext'; // Behalten
// Statisch: Das Theme laden App.tsx und
// segmentGlas.ts ohnehin beim Start; das fruehere `await import()` hier
// brachte keinen eigenen Chunk, nur die Build-Warnung
// INEFFECTIVE_DYNAMIC_IMPORT.
import { registerTabBarEffect } from '@rdlabo/ionic-theme-ios27';
// AdminRolesPage entfernt - Rollen sind jetzt hardcoded


// Eine Seite, die einen Routen-Parameter braucht. Sie bekommt ihn als Zahl
// unter ihrem eigenen Prop-Namen (konfiId, eventId, roomId) plus onBack —
// vorher stand dafuer fuer JEDE dieser Routen eine eigene Wrapper-Komponente
// in dieser Datei, fuenf fast identische Bloecke.
// Rendert die Seite einer Route — OHNE eigenen Ladezustand.
//
// Warum das wichtig ist: IonRouterOutlet verwaltet seine Kinder als
// Seiten-Stack und registriert die IonPage beim Einhaengen. Wird sie danach
// gegen eine andere getauscht — egal ob durch <Suspense> oder durch einen
// eigenen State — bekommt Ionic den Tausch nicht mit und die neue Seite
// bleibt unsichtbar.
//
// Deshalb darf hier NIE ein Platzhalter stehen. Dass der Chunk da ist,
// stellt MainTabs sicher, BEVOR es das Outlet ueberhaupt rendert.
const SeiteMitChunk: React.FC<{
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
  Siehe Begruendung an ParamSeite: Props sind kontravariant. */
  Seite: React.ComponentType<any>;
  param?: string;
  propName?: string;
  zurueckZu: string;
}> = ({ Seite, param, propName, zurueckZu }) => (
  param && propName
    ? <ParamSeite Seite={Seite} prop={propName} param={param} zurueckZu={zurueckZu} />
    : <Seite />
);

// Platzhalter einer Umleitung aus den URL-Parametern fuellen:
// '/teamer/events?eventId=:id' mit { id: '7' } -> '/teamer/events?eventId=7'.
// Ein Platzhalter ohne Wert faellt weg, statt woertlich in der Adresse zu
// stehen -- die Zielseite sieht dann schlicht keinen Parameter.
export const umleitungsZiel = (
  to: string,
  params: Readonly<Record<string, string | undefined>>
): string => to.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => params[name] ?? '');

// Eine Umleitung aus rollenBaeume.ts. <Navigate> allein kennt keine
// Parameter: '/teamer/events/:id' -> '/teamer/events?eventId=:id' haette
// woertlich ":id" in die Adresse geschrieben. Statische Umleitungen ohne
// Platzhalter laufen unveraendert durch.
export const Umleitung: React.FC<{ to: string }> = ({ to }) => {
  const params = useParams();
  return <Navigate to={umleitungsZiel(to, params)} replace />;
};

// Uebergeordnete Seite einer Parameter-Route: '/konfi/chat/room/:roomId'
// wird zu '/konfi/chat'. Dorthin fuehrt der Zurueck-Knopf, wenn es keinen
// Verlauf gibt. Die Segmente ab dem Parameter fallen weg.
export const elternPfad = (routenPfad: string): string => {
  const teile = routenPfad.split('/').filter(Boolean);
  const bisParameter = teile.findIndex((t) => t.startsWith(':'));
  const ohneParameter = bisParameter === -1 ? teile.slice(0, -1) : teile.slice(0, bisParameter);
  // Rolle + Bereich genuegen: '/konfi/chat/room' -> '/konfi/chat'. Mehr
  // Segmente sind Zwischenstuecke ohne eigene Seite.
  return '/' + ohneParameter.slice(0, 2).join('/');
};

const ParamSeite: React.FC<{
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
  Props sind kontravariant: Eine Tabelle, die Seiten mit UND ohne
  Parameter-Props traegt, laesst sich nur ueber any gemeinsam typisieren
  (ComponentType<Record<string, unknown>> nimmt die spezielleren Seiten
  gerade nicht an). Dass Route und Props zusammenpassen, sichert
  stattdessen __tests__/navigation/. */
  Seite: React.ComponentType<any>;
  prop: string;
  param: string;
  /** Wohin, wenn es keinen Verlauf gibt (Einstieg per Push/Deep-Link). */
  zurueckZu: string;
}> = ({ Seite, prop, param, zurueckZu }) => {
  // react-router 6 reicht Parameter nicht mehr als Props durch (kein
  // RouteComponentProps mehr) — sie kommen ueber useParams.
  const params = useParams();
  const router = useIonRouter();

  // Ohne Verlauf ersetzen wir den Eintrag durch die Uebersicht ('root'),
  // damit dort nicht wieder ein toter Zurueck-Knopf steht.
  const zurueck = () => {
    if (router.canGoBack()) {
      router.goBack();
    } else {
      router.push(zurueckZu, 'back', 'replace');
    }
  };

  return <Seite {...{ [prop]: parseInt(params[param] ?? '0', 10) }} onBack={zurueck} />;
};

const MainTabs: React.FC = () => {
  const { user } = useApp();
  // Alle fuenf Zahlen an den Reitern kommen aus EINER Quelle: dem BadgeContext,
  // gespeist aus GET /notifications/badge-counts. Aktualisiert werden sie
  // gemeinsam mit refreshAllCounts().
  const { chatUnreadTotal, pendingRequestsCount, pendingEventsCount, pendingChallengesCount, challengeUpdatesTotal, newBadgesCount } = useBadge();
  // super_admin bekommt eine eigene, reduzierte Navigation
  const isSuperAdmin = user?.role_name === 'super_admin';
  const location = useAppLocation();

  // Anonyme Nutzungsmessung: WELCHER Bereich wird geoeffnet. Zentral am
  // Routenwechsel statt an 15 einzelnen Tab-Buttons — so zählt auch
  // Navigation, die nicht über die Tab-Leiste läuft. Uebertragen wird nur
  // der Bereichsname (z.B. "challenges") plus die Rolle, NIE die volle Route:
  // die kann IDs enthalten (/admin/konfis/42). Wie der Name entsteht, steht
  // in bereichAusPfad (services/analytics.ts).
  useEffect(() => {
    if (!user) return;
    const bereich = bereichAusPfad(location.pathname);
    if (bereich) trackBereich(bereich);
  }, [location.pathname, user?.id]);

  // iOS-Tab-Leiste: gleitendes Glas beim Wechsel (rdlabo registerTabBarEffect)
  useEffect(() => {
    if (!isPlatform('ios')) return;
    if (!user) return;

    let cleanupFns: Array<() => void> = [];
    let cancelled = false;

    const setup = () => {
      try {
        const register = registerTabBarEffect;
        if (typeof register !== 'function') return;

        let attempts = 0;
        const tryRegister = () => {
          if (cancelled) return;
          const bars = document.querySelectorAll<HTMLElement>('ion-tab-bar');
          if (bars.length > 0) {
            bars.forEach((bar) => {
              try {
                const reg = register(bar);
                if (reg && typeof reg.destroy === 'function') {
                  cleanupFns.push(() => {
                    try { reg.destroy(); } catch { /* Abraeumen darf scheitern */ }
                  });
                }
              } catch (e) {
                console.warn('registerTabBarEffect skip:', e);
              }
            });
          } else if (++attempts < 20) {
            setTimeout(tryRegister, 150);
          }
        };
        tryRegister();
      } catch (e) {
        console.warn('TabBar effect setup failed:', e);
      }
    };

    setup();

    return () => {
      cancelled = true;
      cleanupFns.forEach((fn) => fn());
      cleanupFns = [];
    };
  }, [user?.role_name, user?.type]);

  // Zähler ungesehener Badges (Konfi). KEIN 60s-Polling mehr: Der Server sendet
  // beim Vergeben eines Badges ein LiveUpdate ('badges'), das checkAndAwardBadges
  // an genau den Punktevergabe-Stellen (Aktivität/Bonus/Event) ausloest. Bei
  // Verbindungsabriss/Push feuert zusaetzlich der initiale Load beim Reconnect.
  // Der Abzeichen-Zaehler kommt jetzt aus dem BadgeContext (siehe oben) --
  // hier stand frueher ein eigener Loader plus useEffect plus
  // useLiveRefresh('badges'). Der Kanal 'badges' bleibt fuer die Listen-Seiten
  // bestehen, der Zaehler haengt aber nicht mehr daran.

  const rolle: Rolle = isSuperAdmin
    ? 'super_admin'
    : user?.type === 'admin'
      ? 'admin'
      : user?.type === 'teamer'
        ? 'teamer'
        : 'konfi';

  // Offline-Versicherung fuers Code-Splitting: Kurz nach dem Start alle
  // Seiten der eigenen Rolle im Hintergrund nachladen. Einmal importiert,
  // haelt die Modul-Registry sie im Speicher — ein Tab-Wechsel braucht dann
  // kein Netz mehr, auch im Browser ohne Service Worker. Die Verzoegerung
  // laesst den Start-Datenverkehr (Login, Badge-Zaehler) zuerst durch.
  // Schlaegt das Laden fehl (offline), schluckt ladeRolleVor den Fehler;
  // die Seite laedt dann eben beim ersten Besuch.
  // Alle Seiten der Rolle laden, BEVOR das Outlet zum ersten Mal rendert.

  // WICHTIG: Hier steht KEIN Ladezustand mehr.
  //
  // Dass der Tausch IMMER passiert, ist nachgesehen und nicht vermutet:
  // ladeRolleVor() wartet auf dynamische Importe (rollenBaeume.ts:133,
  // `await Promise.allSettled`), kommt also fruehestens einen Microtask
  // spaeter zurueck -- seitenBereit ist im ersten Durchgang zwangslaeufig
  // false.
  //
  // Der Ladezustand liegt jetzt in App.tsx OBERHALB des Routers: Dort wird
  // der Router erst montiert, wenn der Baum endgueltig ist, und das Outlet
  // sieht nie einen Tausch. Siehe AppContent in App.tsx.
  //
  // Der Test __tests__/navigation/keinTauschImOutlet.test.ts haelt das fest.

  // EIN Renderer fuer alle Rollen — die Routen, Tabs und Umleitungen stehen
  // als Daten in navigation/rollenBaeume.ts.
  const baum = BAEUME[rolle];
  const tabLeisteZeigen = baum.tabs.length > 0 && !istTabLeisteVersteckt(location.pathname);

  const zaehler: Record<BadgeKey, number> = {
    chat: chatUnreadTotal,
    events: pendingEventsCount + pendingRequestsCount,
    // Ein Reiter, eine Bedeutung je Rolle: Team und Leitung zaehlen offene
    // Freigaben, Konfis ihre Challenge-Neuigkeiten. Der Server
    // liefert je Rolle nur den einen Anteil, der andere ist 0 -- die Summe
    // ist also nie eine Mischung.
    challenges: pendingChallengesCount + challengeUpdatesTotal,
    badges: newBadgesCount,
  };

  // Die Routen des Baums plus die Einstiege von "/" und "/login".
  const outlet = (
    // key an der ROLLE: Meldet sich nach einem Konfi
    // eine Leitung an, wechselt der Routen-Satz komplett -- ohne frischen
    // Baum behielte das Outlet Seiten der alten Rolle (Tab-Leiste Konfi,
    // Inhalt Admin). Bewusst NICHT am IonReactRouter und NICHT an der
    // Benutzer-ID: dort montierte jede Anmeldung neu, seitenBereit fiel auf
    // false zurueck und das Outlet bekam einen Platzhalter -- weisse Seite
    // beim ersten Laden. An der Rolle wechselt der Schluessel nur, wenn sich
    // wirklich der Routen-Satz aendert.
    <IonRouterOutlet key={rolle}>
      {baum.routes.map(({ path, page: Seite, param, propName }) => (
        <Route
          key={path}
          path={path}
          element={
            <SeiteMitChunk
              Seite={Seite}
              param={param}
              propName={propName}
              zurueckZu={elternPfad(path)}
            />
          }
        />
      ))}
      {baum.redirects.map(({ from, to }) => (
        <Route key={from} path={from} element={<Umleitung to={to} />} />
      ))}
      <Route path="/login" element={<Navigate to={baum.home} replace />} />
      <Route path="/" element={<Navigate to={baum.home} replace />} />
      <Route path="*" element={<Navigate to={baum.home} replace />} />
    </IonRouterOutlet>
  );

  // Super-Admin: nur das Outlet, keine Tab-Leiste.
  if (baum.tabs.length === 0) {
    return <ModalProvider>{outlet}</ModalProvider>;
  }

  return (
    <ModalProvider>
      <IonTabs>
        {outlet}
        {tabLeisteZeigen && (
          <IonTabBar slot="bottom">
            {baum.tabs.map(({ tab, href, icon, label, badge }) => {
              const n = badge ? zaehler[badge] : 0;
              return (
                <IonTabButton key={tab} tab={tab} href={href}>
                  <IonIcon icon={icon} />
                  <IonLabel>{label}</IonLabel>
                  {n > 0 && <IonBadge color="danger">{n > 9 ? '9+' : n}</IonBadge>}
                </IonTabButton>
              );
            })}
          </IonTabBar>
        )}
      </IonTabs>
    </ModalProvider>
  );
};

export default MainTabs;
