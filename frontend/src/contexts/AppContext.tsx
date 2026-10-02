import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Device } from '@capacitor/device';
import api from '../services/api';
import { getUser, setUser as persistUser, getDeviceId, setDeviceId, getPushTokenTimestamp, setPushTokenTimestamp, getActiveOrgId, setActiveOrgId, setToken, getToken } from '../services/tokenStore';
import { networkMonitor } from '../services/networkMonitor';
import { ensureSocketConnected, reconnectWithToken } from '../services/websocket';
import { App } from '@capacitor/app';
import { PushNotifications } from '@capacitor/push-notifications';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { removeDeliveredById, benachrichtigungskanaeleAnlegen, aufraeumenNachholen } from '../services/notifications';
import { appSymbolAngaben } from '../services/appSymbolZahl';
import { writeQueue } from '../services/writeQueue';
import { offlineCache } from '../services/offlineCache';
import { clearMediaCache, medienCacheKontoPruefen } from '../services/mediaCache';
import { logout as performLogout } from '../services/auth';
import { clearAuth } from '../services/tokenStore';
import { BackgroundTask } from '@capawesome/capacitor-background-task';
import { BaseUser } from '../types/user';
import { setAnalyticsRole, trackFehler, trackSitzungsstart, istGueltigeArt, istGueltigerOrt, fehlerStelle } from '../services/analytics';
import { diagnoseMerkmaleSetzen, wegmarke } from '../services/absturzdiagnose';
import { ermittleAppVersion } from '../utils/appVersion';
import { fehlerArt, fehlerFuersProtokoll, herkunftDesFehlertexts } from '../utils/fehler';
import { buildPushTargetUrl, resolveOrgForPush, pushZielMelden, PushUserType } from '../utils/pushNavigation';
import { deepLinksAnschliessen } from '../utils/deepLinks';

// FCM Token wird über Window Events empfangen (siehe AppDelegate.swift)

interface FCMPlugin {
  forceAPNSRegistration(): Promise<void>;
  forceTokenRetrieval(): Promise<void>;
}

// Typsichere Bridge zum nativen FCM-Plugin (registriert via AppDelegate.swift)
const FCM = registerPlugin<FCMPlugin>('FCM');

/*
 * Den Token AKTIV abfragen — der fehlende Weg auf Android.
 *
 * Bis hierher gab es auf Android genau EINEN Weg zum Token: register()
 * aufrufen und darauf warten, dass das System 'registration' feuert. Dieses
 * Ereignis feuert bei UNVERAENDERTER Installation aber nicht wieder — FCM
 * liefert denselben Token und meldet ihn nur einmal pro Installation.
 * MainActivity ist eine reine BridgeActivity und reicht nichts nach; das
 * FCM-Plugin oben haengt an AppDelegate.swift und ist damit iOS-only.
 *
 * Folge: Nach einem App-Update (Installation bleibt, Prozess ist neu, alle
 * Merker leer) kam auf Android kein Token mehr zustande. Nachgemessen an
 * Produktion: Ein Tester meldete sich um 18:25 und 18:30 Uhr an — in den
 * Server-Logs kein einziger POST /device-token, kein Fehler, nichts. Die
 * Berechtigung stand auf 'granted'.
 *
 * FirebaseMessaging.getToken() fragt direkt bei Firebase, ohne Ereignis, auf
 * beiden Plattformen. Die optionale Web-Abhaengigkeit `firebase` wird NICHT
 * mitinstalliert — auf den Geraeten laeuft das native SDK.
 */
/*
 * Fassung der laufenden App — fuer das Protokoll auf dem Server.
 *
 * Ohne diese Angabe war bei der Android-Fehlersuche nicht zu unterscheiden, ob
 * ein Fix nicht wirkt oder auf dem Geraet noch die alte Fassung laeuft. Beides
 * sah serverseitig gleich aus. Einmal ermittelt und gemerkt: App.getInfo() ist
 * ein Bruecken-Aufruf, der sich zur Laufzeit nicht aendert.
 */
let appFassung: { version: string | null; build: string | null } | null = null;

const fassungHolen = async (): Promise<{ version: string | null; build: string | null }> => {
  if (appFassung) return appFassung;
  try {
    const info = await App.getInfo();
    appFassung = { version: info.version || null, build: info.build || null };
  } catch {
    // Im Browser gibt es getInfo nicht — dann bleibt die Angabe leer, und der
    // Server schreibt "unbekannt". Kein Grund, die Registrierung zu stoppen.
    appFassung = { version: null, build: null };
  }
  return appFassung;
};

/*
 * Dem Server melden, wenn KEIN Token zustande kommt.
 */
const pushDiagnoseMelden = async (grund: string, hinweis?: string) => {
  try {
    const fassung = await fassungHolen();
    let berechtigung = '?';
    try {
      berechtigung = (await PushNotifications.checkPermissions()).receive;
    } catch { /* ignorieren */ }
    await api.post('/notifications/push-diagnose', {
      grund,
      berechtigung,
      plattform: Capacitor.getPlatform(),
      app_version: fassung.version,
      app_build: fassung.build,
      ...(hinweis ? { hinweis: String(hinweis).slice(0, 200) } : {}),
    });
  } catch { /* stille Meldung, best effort */ }
};

/*
 * Wartezeiten zwischen den Versuchen, den Token zu holen — 1s, dann 3s
 * 
 *
 * WARUM DREI VERSUCHE UND GENAU DIESE ABSTAENDE: Die App startet in diesem
 * Moment gerade. Wer laenger wartet, hilft niemandem — die Nutzerin ist dann
 * schon in der App unterwegs, und die Wiederholung soll ein kurzer Aussetzer
 * ueberbruecken, keine Dauerkampagne werden. Nach 4 Sekunden Gesamtwartezeit
 * ist der dritte Versuch durch; das deckt die Faelle ab, die es abzudecken
 * gibt (Mobilfunk greift wieder, Flugmodus gerade aus, kurzer Aussetzer bei
 * Firebase) und ist immer noch innerhalb der Zeit, in der die App ohnehin
 * ihre Startdaten laedt. Die Abstaende wachsen, damit ein Geraet ohne Netz
 * nicht dreimal in derselben Sekunde gegen die Wand laeuft.
 *
 * Mehr Versuche brachten nichts: Bleibt der Fehler nach vier Sekunden
 * bestehen, ist er nicht transient, und der naechste App-Start fasst ohnehin
 * neu nach (der Merker `letzterBekannterFcmToken` ist dann leer).
 */
const TOKEN_ABRUF_WARTEZEITEN_MS = [1000, 3000];

/*
 * Den Token aktiv holen, mit Wiederholung bei wachsendem Abstand.
 *
 * DIE LUECKE VORHER: Genau EIN Versuch. Scheiterte der, blieb das Geraet bis
 * zur naechsten Anmeldung ohne Token — still. In den Server-Protokollen ist
 * bei einem Nutzer belegt, dass mehrere Anmeldungen noetig waren, bis
 * ueberhaupt ein Token entstand.
 *
 * DAUERHAFT ODER TRANSIENT — EHRLICH GESAGT NICHT ZU UNTERSCHEIDEN:
 * Auf Android lautet der gemeldete Fehler `java.io.IOException:
 * FIS_AUTH_ERROR`. Das Firebase-SDK faltet darin mehrere Ursachen zusammen:
 * eine falsch gesetzte Anwendungseinschraenkung am API-Schluessel (dauerhaft,
 * nur in der Firebase-Konsole zu beheben) sieht genauso aus wie ein Aussetzer
 * des Installations-Dienstes oder ein abgerissenes Netz (transient). Der
 * Fehlertext traegt weder Statuscode noch Grund. Eine Unterscheidung am Text
 * waere also eine Behauptung, die nicht traegt — deshalb wird in BEIDEN
 * Faellen wiederholt. Drei Versuche in vier Sekunden kosten bei einem
 * dauerhaften Fehler wenig; ein stilles Geraet ohne Push kostet mehr.
 *
 * AUFRAEUMEN NUR VOR DEM LETZTEN VERSUCH: `deleteToken()` verwirft den lokal
 * gespeicherten Token und zwingt Firebase, einen neuen zu beschaffen. Das
 * loest einen verdorbenen lokalen Zustand — kann aber bei einem bloss
 * abgerissenen Netz einen voellig gueltigen Token wegwerfen. Deshalb erst
 * vor dem LETZTEN Versuch, wenn die harmlosen Erklaerungen durch sind.
 *
 * GEMELDET WIRD EINMAL, am Ende, mit der Zahl der Versuche. Drei Meldungen
 * fuer einen Vorgang machen das Protokoll unlesbar und den Zaehler falsch.
 */
const tokenAktivHolen = async (): Promise<string | null> => {
  if (!Capacitor.isNativePlatform()) return null;

  const gesamtVersuche = TOKEN_ABRUF_WARTEZEITEN_MS.length + 1;
  let letzterFehler: unknown = null;

  for (let versuch = 1; versuch <= gesamtVersuche; versuch++) {
    if (versuch > 1) {
      await new Promise<void>((weiter) =>
        setTimeout(weiter, TOKEN_ABRUF_WARTEZEITEN_MS[versuch - 2])
      );
      // Vor dem LETZTEN Versuch den lokalen Zustand raeumen (Begruendung oben).
      if (versuch === gesamtVersuche) {
        try {
          await FirebaseMessaging.deleteToken();
        } catch { /* Raeumen ist eine Zugabe, kein Grund aufzuhoeren */ }
      }
    }

    try {
      const { token } = await FirebaseMessaging.getToken();
      if (token) return token;
      // Kein Fehler, aber auch kein Token: genauso behandeln wie einen Fehler,
      // sonst bleibt der leere Fall ohne zweiten Anlauf.
      letzterFehler = new Error('leere Antwort');
    } catch (err) {
      letzterFehler = err;
      // Kein harter Fehler: Der 'registration'-Weg bleibt daneben bestehen.
      console.warn(`Token konnte nicht aktiv abgefragt werden (Versuch ${versuch}/${gesamtVersuche}):`, err);
    }
  }

  const text = letzterFehler instanceof Error ? letzterFehler.message : String(letzterFehler);
  pushDiagnoseMelden('getToken-fehler', `versuche=${gesamtVersuche} ${text}`);
  return null;
};

// ANTI-SPAM: Verhindere mehrfache Push-Registrierung (Global Scope)
let pushRegistrationInProgress = false;
let pushAlreadyRegistered = false;

// In-Memory Anti-Spam-State für FCM-Token (kein window-Zugriff nötig)
let fcmTokenSent: string | null = null;
let fcmTokenLastSent: number = 0;
let pendingFcmToken: string | null = null;

/*
 * Der LETZTE von Firebase gemeldete Token — unabhaengig davon, ob er schon
 * gesendet wurde.
 *
 * `pendingFcmToken` haelt nur FEHLGESCHLAGENE Sendungen, `fcmTokenSent` nur
 * erfolgreiche, und beide werden beim Abmelden geraeumt. Damit gab es nach
 * einer Anmeldung keinen Weg, einen bereits bekannten Token erneut zu senden:
 * Auf Android feuert 'registration' pro Installation praktisch nur EINMAL,
 * weil FCM bei unveraenderter Installation denselben Token liefert. Wer sich
 * abmeldete und wieder anmeldete, hatte serverseitig keinen Token mehr — und
 * die App keinen Anlass, einen zu schicken.
 *
 * Dieser Merker ueberlebt das Abmelden bewusst: Er ist kein Zustand der
 * Sitzung, sondern eine Eigenschaft der Installation.
 */
let letzterBekannterFcmToken: string | null = null;

// 12 Stunden — Sendefenster für einen UNVERAENDERTEN Token.
const TOKEN_RESEND_WINDOW_MS = 12 * 60 * 60 * 1000;

// Funktion, um Duplikate zu vermeiden
const sendTokenToServer = async (token: string, retryCount = 0) => {
  const now = Date.now();

  // Den Token merken, bevor irgendeine Sperre greift: Nach einer Anmeldung
  // braucht es ihn, und Firebase meldet ihn auf Android pro Installation
  // praktisch nur einmal (siehe letzterBekannterFcmToken oben).
  letzterBekannterFcmToken = token;

  // ANTI-SPAM (In-Memory-Zusatzschutz): gleicher Token in den letzten 10s -> raus.
  // Faengt schnelle Doppel-Feuerungen innerhalb einer Session ab.
  if (fcmTokenSent === token && (now - fcmTokenLastSent) < 10000) {
    return;
  }

  // Sendefenster: AppDelegate feuert das fcmToken-Event
  // bei JEDER App-Aktivierung. Ist der Token UNVERAENDERT und der letzte
  // erfolgreiche Send weniger als 12h her, NICHT erneut senden (spart org-weit
  // dutzende POSTs/90min). Der persistierte Timestamp (getPushTokenTimestamp)
  // ueberlebt App-Neustarts, sodass das Fenster auch nach Kaltstart greift,
  // sobald bekannt ist, dass sich der Token nicht geändert hat.
  // Bei GEAENDERTEM Token (fcmTokenSent !== token) fällt diese Sperre weg ->
  // sofort senden.
  if (fcmTokenSent === token) {
    const lastPersistedSend = getPushTokenTimestamp();
    if (lastPersistedSend > 0 && (now - lastPersistedSend) < TOKEN_RESEND_WINDOW_MS) {
      return;
    }
  }

  // Gespeicherte Device ID nutzen (wird bei App-Start einmalig persistiert).
  //
  // Deshalb wird der Token jetzt wie im POST-Fehlerpfad gemerkt UND kurz
  // darauf erneut versucht. `sendTokenToServer` faengt Doppelsendungen selbst
  // ab, ein Versuch zu viel schadet also nicht.
  const deviceId = getDeviceId();
  if (!deviceId) {
    pendingFcmToken = token;
    const wartezeiten = [500, 2000, 5000];
    if (retryCount < wartezeiten.length) {
      setTimeout(() => sendTokenToServer(token, retryCount + 1), wartezeiten[retryCount]);
    } else {
      console.warn('Keine Device ID verfügbar - Token bleibt fuer den naechsten Anlauf gemerkt');
    }
    return;
  }

  try {
    const fassung = await fassungHolen();
    await api.post('/notifications/device-token', {
      token,
      platform: Capacitor.getPlatform(),
      device_id: deviceId,
      // Damit im Protokoll steht, WELCHE Fassung sich gemeldet hat
      // (Migration 156). Aeltere Server ignorieren die Felder.
      app_version: fassung.version,
      app_build: fassung.build,
      ...(await appSymbolAngaben())
    });

    fcmTokenSent = token; // Markiere Token als gesendet
    fcmTokenLastSent = now; // Timestamp setzen
    await setPushTokenTimestamp(now); // Bug 3: Timestamp nach jedem Send persistieren
  } catch (err) {
    // Nur Status, Code und Servertext: der axios-Fehler traegt den Push-Token
    // im Koerper und das Zugangs-Token im Header.
    console.error('Fehler beim Senden des FCM-Tokens:', fehlerFuersProtokoll(err));
    // Retry mit steigendem Abstand (5s, 15s, 30s), danach bei naechstem Online-Wechsel
    const retryDelays = [5000, 15000, 30000];
    if (retryCount < retryDelays.length) {
      setTimeout(() => sendTokenToServer(token, retryCount + 1), retryDelays[retryCount]);
    } else {
      // Alle Retries fehlgeschlagen — Token für Reconnect-Retry merken
      pendingFcmToken = token;
    }
  }
};

// Eine Organisation, in der der eingeloggte User Mitglied ist (Org-Switcher).
export interface UserOrganization {
  id: number;
  name: string;
  display_name?: string;
  slug?: string;
  role_name: string;
  role_display_name?: string;
  is_active?: boolean;
}

/**
 * Zusatzangaben zu einem Fehler — ausschliesslich fuer die anonyme Messung.
 * Sie erscheinen NIRGENDS auf dem Bildschirm; die angezeigte Meldung bleibt
 * die, die als erstes Argument uebergeben wird.
 *
 * `ort`: kurzes, im Code fest vergebenes Kuerzel der Fundstelle, damit sich
 * gleichlautende Meldungen aus verschiedenen Ansichten unterscheiden lassen
 * (nur Kleinbuchstaben, Ziffern, Bindestriche — nie Daten aus einer Antwort).
 * `fehler`: der gefangene Fehler; daraus wird nur die grobe Ursache gelesen.
 */
export interface FehlerDiagnose {
  ort?: string;
  fehler?: unknown;
}

interface AppContextType {
  user: BaseUser | null;
  error: string;
  success: string;
  isOnline: boolean;
  pushNotificationsPermission: string;
  // Multi-Org Switcher
  organizations: UserOrganization[];
  activeOrgId: number | null;
  orgVersion: number;
  // Liefert ok + den User-Typ in der ZIEL-Org (Rolle kann pro Org anders sein).
  switchOrg: (orgId: number) => Promise<{ ok: boolean; type?: PushUserType }>;
  signOut: () => Promise<void>;
  setUser: (user: BaseUser | null) => void;
  refreshUser: () => Promise<void>;
  setError: (error: string, diagnose?: FehlerDiagnose) => void;
  setSuccess: (success: string) => void;
  clearMessages: () => void;
  requestPushPermissions: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);


export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<BaseUser | null>(getUser());
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isOnline, setIsOnline] = useState<boolean>(true);

  // Jede Fehlermeldung, die tatsaechlich jemand zu sehen bekommt, fliesst in
  // die anonyme Messung ein — DAS beantwortet "wo klemmt es". Den Text selbst
  // gibt es dort nur, wenn er ein Text der App ist (Positivliste in
  // utils/bekannteFehlertexte.ts, Ziffern zu #). Ein Text vom Server kann
  // Namen, Titel oder Dateinamen tragen und wird ersetzt: durch den
  // Ersatztext, den die Aufrufstelle an `fehlerText` gegeben hat, sonst durch
  // `andere-meldung`.
  //
  // Der zweite Parameter ist rein diagnostisch und beruehrt die Anzeige NICHT:
  //   `ort`    — ein im Code fest vergebenes Kuerzel. Loest das Problem, dass
  //              derselbe Meldungstext an mehreren Stellen steht (z.B. steht
  //              "Fehler beim Öffnen der Datei" an vier Stellen und kam bis
  //              dahin als ein einziger Eintrag an).
  //   `fehler` — der gefangene Fehler. Daraus wird NUR die grobe Ursache
  //              abgeleitet (Status, timeout, netz …), siehe `fehlerArt`.
  //              Das Objekt selbst verlaesst diese Funktion nie.
  const setErrorTracked = useCallback((meldung: string, diagnose?: FehlerDiagnose) => {
    setError(meldung);
    if (!meldung) return;

    // Kam der Text gerade aus `fehlerText(err, 'Ersatz')` statt des
    // Ersatztextes? Dann steht der Ersatztext fuer die Stelle, und die Art
    // kommt aus dem Fehlerobjekt — auch wenn die Aufrufstelle keine Diagnose
    // mitgibt (das sind die meisten).
    const herkunft = herkunftDesFehlertexts(meldung);
    const stelle = fehlerStelle(meldung, herkunft?.ersatz);

    // Beide Zusatzangaben werden gegen ihr Muster geprueft, bevor sie das
    // Geraet verlassen. Was nicht passt, faellt weg — lieber ein Eintrag ohne
    // Ursache als einer mit einem durchgereichten Dateinamen.
    const art = diagnose && 'fehler' in diagnose ? fehlerArt(diagnose.fehler) : herkunft?.art;
    const ort = diagnose?.ort;

    const gepruefteArt = art && istGueltigeArt(art) ? art : undefined;
    const geprueftesOrt = ort && istGueltigerOrt(ort) ? ort : undefined;

    trackFehler(stelle, gepruefteArt, geprueftesOrt);

    // Dieselbe entschaerfte Angabe zusaetzlich als WEGMARKE ins
    // Absturzprotokoll. Bewusst `wegmarke` und NICHT `fehlerMelden`:
    //
    // Diese Meldungen sind abgefangene, oft erwartbare Fehler — "keine
    // Verbindung", "Sitzung abgelaufen". Als einzelne Berichte waeren sie
    // Rauschen und wuerden bei vielen tausend Nutzenden die Drosselung
    // verbrauchen, die fuer die ECHTEN Abstuerze gebraucht wird. Als Wegmarke
    // kosten sie nichts und stehen genau dort, wo sie zaehlen: in den letzten
    // Zeilen VOR einem Absturz. Ein Absturz nach drei "keine Verbindung" ist
    // eine andere Geschichte als einer aus dem Stand.
    //
    // Es geht derselbe gepruefte Inhalt raus wie an die Nutzungsmessung —
    // keine weitere Zeichenkette, kein Fehlerobjekt, kein Server-Text. Das
    // Absturzprotokoll ist Firebase Crashlytics (Google): Die Wegmarken
    // stehen im naechsten Absturz- oder Fehlerbericht des Geraets.
    void wegmarke(`fehler ${geprueftesOrt ?? 'ohne-ort'} ${gepruefteArt ?? 'ohne-art'}: ${stelle}`);
  }, []);

  // Rolle für die anonyme Nutzungsmessung mitfuehren (konfi/teamer/admin) —
  // die EINZIGE Eigenschaft, die dorthin übertragen wird. Zentral hier, damit
  // sie bei Login, Logout und Organisationswechsel automatisch stimmt.
  useEffect(() => {
    setAnalyticsRole(user?.role_name);
    // Sitzungsbeginn als Seitenaufruf melden — ohne den zählt Umami weder
    // Besucher noch Sitzungen, die Ereignisse allein erscheinen im Dashboard
    // nicht (11.08.: 130 Ereignisse, aber 0 Besucher). Nur bei vorhandener
    // Rolle, sonst wuerde der Logout als weiterer Besuch gezählt.
    if (user?.role_name) trackSitzungsstart();
  }, [user?.role_name]);

  // Medien-Cache ans angemeldete Konto binden: Meldet sich ein
  // anderes Konto an als das, dessen Chat- und Challenge-Medien auf dem Gerät
  // liegen, wird der Cache geleert. Das Abmelden leert ihn ohnehin; hier geht
  // es um die Wege daran vorbei (abgelaufene Sitzung, Face ID, Fehlerseite).
  // Hier und nicht beim Login, weil JEDER Weg zu einem Konto über diesen
  // Zustand läuft.
  //
  // Dasselbe für den gespeicherten Stand und die Warteschlange:
  // Beide gehören zum Konto (offlineCache.ts,
  // writeQueue.ts, kontoPruefen). Lesen und Senden prüfen das selbst; hier
  // verschwindet der Stand anderer Konten zusätzlich vom Gerät.
  useEffect(() => {
    if (!user?.id) return;
    void medienCacheKontoPruefen(user.id).catch(() => { /* best-effort */ });
    // Über Promise.resolve().then: auch ein synchroner Fehler bleibt hier
    // best-effort und hält den übrigen Effekt nicht auf.
    void Promise.resolve().then(() => offlineCache.fremdeKontenEntfernen()).catch(() => { /* best-effort */ });
    void Promise.resolve().then(() => writeQueue.kontoPruefen()).catch(() => { /* best-effort */ });
  }, [user?.id]);

  // Push notifications state
  const [pushNotificationsPermission, setPushNotificationsPermission] = useState<string>('prompt');

  /*
   * Bei JEDER Anmeldung den bekannten Token registrieren.
   *
   * Vorher stand hier nur die Erkennung eines Account-WECHSELS: `prev !== null
   * && prev !== user.id`. Damit waren zwei Faelle nicht abgedeckt, die in der
   * Praxis genau die haeufigen sind:
   *
   *   1. Abmelden und mit DEMSELBEN Konto wieder anmelden. Der Logout loescht
   *      den Token serverseitig, `prev === user.id` liess den Nachfass-Weg
   *      aber ausfallen — dauerhaft kein Push, ohne Fehler irgendwo.
   *   2. App-Start mit bestehender Sitzung ("bin schon eingeloggt"), wenn
   *      serverseitig kein Token steht. `prev === null` schloss das aus.
   *
   * Jetzt: Sobald eine Nutzer-ID vorliegt UND ein Token bekannt ist, wird er
   * gesendet. `sendTokenToServer` faengt ueberfluessige POSTs selbst ab (10s-
   * Sperre und 12h-Fenster bei UNVERAENDERTEM Token) — bei einem Wechsel
   * hebt der Code hier das Fenster zusaetzlich auf, weil der Server den Token
   * dann umhaengen muss.
   */
  const prevPushUserIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!user?.id) return; // Logout: vorherige ID absichtlich behalten
    const prev = prevPushUserIdRef.current;
    prevPushUserIdRef.current = user.id;

    const bekannt = fcmTokenSent || pendingFcmToken || letzterBekannterFcmToken;

    // Ist kein Token bekannt, AKTIV bei Firebase fragen. Auf Android ist das
    // der einzige Weg nach einem Update: 'registration' feuert dort bei
    // unveraenderter Installation nicht wieder (siehe tokenAktivHolen).
    if (!bekannt) {
      // Nebenher, ohne den Anmeldeweg aufzuhalten: tokenAktivHolen wiederholt
      // bei einem Fehler bis zu vier Sekunden lang.
      tokenAktivHolen()
        .then((t) => {
          if (t) return sendTokenToServer(t);
          return pushDiagnoseMelden('kein-token-nach-anmeldung');
        })
        .catch((err) => console.warn('Aktiver Token-Abruf gescheitert:', err));
      return;
    }
    const token = bekannt;

    const kontoWechsel = prev !== null && prev !== user.id;
    if (kontoWechsel) {
      // Der Token haengt serverseitig noch am alten Konto: Sperren aufheben,
      // damit der POST wirklich rausgeht (der Server haengt ihn dann um).
      fcmTokenSent = null;
      setPushTokenTimestamp(0).finally(() => sendTokenToServer(token));
      return;
    }

    // Erstanmeldung, Wiederanmeldung mit demselben Konto oder App-Start mit
    // bestehender Sitzung. Ohne Aufheben der Sperren: Steht der Token
    // serverseitig schon, greift das 12h-Fenster und es passiert nichts —
    // genau richtig. Fehlt er, geht der POST raus.
    sendTokenToServer(token);
  }, [user?.id]);

  // Multi-Org Switcher state
  const [organizations, setOrganizations] = useState<UserOrganization[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<number | null>(getActiveOrgId());
  // Bei Org-Wechsel und 403-Fallback erhöht; dient als React-key am Router
  // (App.tsx) -> kompletter Remount des Subtrees. Zusammen mit dem
  // 'org:switched'-Event: das Event revalidiert useOfflineQuery-Daten (auch in
  // gecachten Pages), der Remount erwischt zusaetzlich alles, was seinen State
  // selbst haelt. Beides ist nötig — mit dem Event allein blieben Views mit
  // eigenem useState auf den Daten der alten Org stehen.
  // KEIN window.location-Reload (zerschiesst nativen WebView).
  const [orgVersion, setOrgVersion] = useState(0);

  // Badge sync through state updates only (no custom events)

  // Merkmale fuer die Absturzdiagnose mitfuehren (Rolle, Organisation als
  // Zahl, Plattform, Fassung des Web-Teils).
  //
  // WARUM DAS GEBRAUCHT WIRD: Bei vielen tausend Nutzenden ueber viele
  // Gemeinden ist die erste Frage bei einem Absturz "wen trifft es" — eine
  // Rolle oder eine besondere Datenlage einer Gemeinde. Ohne diese Merkmale
  // steht in Crashlytics nur ein Stapelverlauf ohne Kontext.
  //
  // WAS BEWUSST NICHT MITGEHT: keine Nutzer-ID, kein Name, kein Jahrgang,
  // kein Gemeindename und auch KEINE device_id — die Begruendung steht
  // vollstaendig in services/absturzdiagnose.ts. Die Organisation geht als
  // ZAHL, nie als Name.
  //
  // Haengt an denselben Werten wie die Nutzungsmessung, plus der aktiven
  // Organisation: So stimmen die Merkmale nach Login, Logout UND
  // Organisationswechsel ohne weiteres Zutun.
  useEffect(() => {
    void (async () => {
      const fassung = await ermittleAppVersion();
      await diagnoseMerkmaleSetzen({
        rolle: user?.role_name ?? null,
        organisationId: activeOrgId ?? user?.organization_id ?? null,
        appFassung: fassung,
      });
    })();
  }, [user?.role_name, user?.organization_id, activeOrgId]);

  // Device ID einmalig bei App-Start persistieren
  useEffect(() => {
    if (!user) return;
    (async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const deviceInfo = await Device.getId();
          const currentStored = getDeviceId();
          if (!currentStored || currentStored !== deviceInfo.identifier) {
            await setDeviceId(deviceInfo.identifier);
          }
        } catch {
          // Fallback: Generieren falls nicht gespeichert
          if (!getDeviceId()) {
            const fallbackId = `${Capacitor.getPlatform()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await setDeviceId(fallbackId);
          }
        }
      } else {
        // Web: Generieren falls nicht gespeichert
        if (!getDeviceId()) {
          const fallbackId = `web_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await setDeviceId(fallbackId);
        }
      }
    })();
  }, [user]);

  // User-Daten frisch von /me ziehen (Trial-Status, Rolle etc.) und in State +
  // Cache mergen. Wird beim App-Start aufgerufen UND nach Aktionen, die den
  // eigenen User betreffen können (z.B. eigene Org auf Test stellen) — damit
  // der Trial-Banner sofort erscheint/verschwindet, ohne Logout/Neustart.
  const refreshUser = useCallback(async () => {
    const cached = getUser();
    if (!cached) return; // nicht eingeloggt
    try {
      const res = await api.get('/auth/me');
      if (!res?.data) return;
      const merged = {
        ...cached,
        ...res.data,
        trial_ends_at: res.data.trial_ends_at ?? null,
        is_trial: res.data.is_trial === true
      };
      await persistUser(merged);
      setUser(merged);
    } catch {
      // Offline / Token abgelaufen: gecachten User behalten, kein Hard-Fail
    }
  }, []);

  // Einmal beim App-Start
  useEffect(() => {
    refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Multi-Org: Liste der Orgs des Users laden. Der Switcher erscheint nur, wenn
  // mehr als eine Org zurueckkommt. Konfis bekommen ohnehin keine -> kein Switcher.
  const loadOrganizations = useCallback(async () => {
    const cached = getUser();
    if (!cached) return;
    try {
      const res = await api.get('/auth/my-organizations');
      if (Array.isArray(res?.data)) {
        setOrganizations(res.data);
        // Falls die aktuell aktive Org nicht mehr in der Liste ist (z.B. entzogen),
        // auf Primaer-Org zuruecksetzen.
        const current = getActiveOrgId();
        if (current && !res.data.some((o: UserOrganization) => o.id === current)) {
          await setActiveOrgId(null);
          setActiveOrgIdState(null);
        }
      }
    } catch {
      // Offline/Fehler: kein Hard-Fail, Switcher bleibt einfach leer
    }
  }, []);

  useEffect(() => {
    loadOrganizations();
  }, [loadOrganizations, user?.id]);

  // Sicherheitsnetz: Wenn ein Request mit aktiver Org ein 403 "Kein Zugriff"
  // bekommt (api.ts setzt dann die aktive Org auf null und holt ein Token
  // OHNE Org-Claim), hier die App auf die Primaer-Org zuruecksetzen, den
  // Socket mit dem neuen Token neu aufbauen und alle Views remounten.
  useEffect(() => {
    const handler = async () => {
      setActiveOrgIdState(null);
      try { await offlineCache.clearAll(); } catch { /* best-effort */ }
      // Die Medien der entzogenen Gemeinde gehen mit: Chat-
      // Anhänge und Challenge-Dateien, die die Person dort sehen durfte.
      try { await clearMediaCache(); } catch { /* best-effort */ }
      // Wie beim bewussten Wechsel (switchOrg, Schritt 4b): Ohne Neuaufbau
      // liefe der Socket mit dem Token der entzogenen Gemeinde weiter und
      // der Server lehnte jeden Reconnect mit "Kein Zugriff auf diese
      // Organisation" ab.
      try {
        const frischesToken = getToken();
        if (frischesToken) reconnectWithToken(frischesToken);
      } catch (socketErr) {
        console.error('Socket-Neuaufbau nach Gemeinde-Rueckfall fehlgeschlagen:', socketErr);
      }
      setOrgVersion(v => v + 1);
    };
    window.addEventListener('auth:org-fallback', handler);
    return () => window.removeEventListener('auth:org-fallback', handler);
  }, []);

  // Org wechseln. Strategie: neues Token + aktive Org + User-State setzen, ALLE
  // Caches leeren, dann per orgVersion-Bump alle Views REMOUNTEN (React-key am
  // Router) — KEIN window.location-Reload (der zerschiesst im nativen Capacitor-
  // WebView die App: Token/aktive Org sind async in Preferences und der Reload
  // schneidet den Write ab -> "alles 0 + Switcher weg", siehe App.tsx-Kommentar).
  const switchOrg = useCallback(async (orgId: number): Promise<{ ok: boolean; type?: PushUserType }> => {
    let switchedType: PushUserType | undefined;
    // Ungesendetes der ALTEN Organisation JETZT noch zustellen — mit deren
    // Token/Header. Nach dem Wechsel wird die Queue geleert (Schritt 4 unten);
    // ohne diesen Flush verschwanden dabei ungesendete Chat-Nachrichten
    // kommentarlos. Ein Versand NACH dem Wechsel waere falsch (falsche Org).
    try {
      await writeQueue.flush();
    } catch { /* best-effort */ }
    let verbleibendeChatNachrichten = 0;
    try {
      verbleibendeChatNachrichten = (await writeQueue.getAll())
        .filter(item => item.metadata.type === 'chat').length;
    } catch { /* best-effort */ }
    try {
      const res = await api.post('/auth/switch-org', { organization_id: orgId });
      if (!res?.data?.token) {
        throw new Error('Kein Token in switch-org Response');
      }
      // 1. Neues Access-Token (trägt active_organization_id als Claim)
      await setToken(res.data.token);

      // 2. Aktive Org persistieren (oder entfernen, wenn es die Primaer-Org ist).
      // Wird als Header X-Active-Organization bei jedem Request mitgesendet.
      const isPrimary = res.data.is_primary === true;
      await setActiveOrgId(isPrimary ? null : orgId);
      setActiveOrgIdState(isPrimary ? null : orgId);

      // 3. User-State auf die neue Org/Rolle umschreiben (Rolle steuert Routing!).
      // Fallback auf die switch-org-Antwort: beim Kaltstart über einen Push-Tap
      // ist die organizations-Liste oft noch nicht geladen — die Antwort trägt
      // Typ, Rolle und Org-Namen der Ziel-Org.
      switchedType = res.data.type as PushUserType | undefined;
      const target = organizations.find(o => o.id === orgId);
      const cached = getUser();
      if (cached) {
        const merged = {
          ...cached,
          organization: target?.display_name || target?.name || res.data.organization?.name || cached.organization,
          organization_id: orgId,
          role_name: target?.role_name || res.data.role_name || cached.role_name,
          // Typ steuert den Komponentenbaum (admin/teamer/konfi) — aus der
          // Antwort übernehmen, die Rolle kann sich zwischen Orgs unterscheiden.
          ...(switchedType && switchedType !== 'user' ? { type: switchedType } : {})
        };
        await persistUser(merged);
        setUser(merged);
      }

      // 4. ALLE Offline-Caches + Schreib-Queue leeren (keine Daten der alten Org)
      await offlineCache.clearAll();
      // Auch den Medien-Cache — die Chat- und Challenge-Dateien
      // der alten Gemeinde. Best-effort: Ein Dateisystemfehler darf den
      // bereits gelungenen Wechsel nicht als gescheitert melden.
      try { await clearMediaCache(); } catch { /* best-effort */ }
      await writeQueue.clear();

      // Konnte der Flush oben nicht alles zustellen, ist das Verwerfen hier
      // ein Datenverlust — den sagen wir ehrlich, statt still zu leeren.
      if (verbleibendeChatNachrichten > 0) {
        setError(verbleibendeChatNachrichten === 1
          ? 'Eine ungesendete Chat-Nachricht konnte vor dem Wechsel nicht mehr zugestellt werden'
          : `${verbleibendeChatNachrichten} ungesendete Chat-Nachrichten konnten vor dem Wechsel nicht mehr zugestellt werden`);
      }

      // AB HIER ist der Wechsel ERFOLGREICH abgeschlossen (Token + aktive Org +
      // User-State stehen). Die folgenden Schritte sind nur noch Revalidierung
      // und duerfen NICHT mehr den Fehler-Toast auslösen: durch das gleich
      // gefeuerte 'org:switched' starten viele parallele Requests, von denen
      // einer kurz in ein Token-Refresh-Race laufen kann. Frueher lag
      // loadOrganizations() im try-Block -> ein solcher transienter 401 warf
      // faelschlich "Organisation konnte nicht gewechselt werden", obwohl der
      // Wechsel laengst geklappt hatte. Deshalb best-effort + eigenes catch.
    } catch (err) {
      console.error('Org-Wechsel fehlgeschlagen:', err);
      setError('Gemeinde konnte nicht gewechselt werden');
      return { ok: false };
    }

    // 4b. Socket mit dem NEUEN Token neu aufbauen. Ohne diesen Schritt lief der
    // Socket mit dem Token der alten Organisation weiter: initializeWebSocket
    // gibt einen bereits bestehenden Socket unverändert zurück, das frische
    // Token aus switch-org erreichte die Verbindung also nie. Folge: in der
    // Zweit-Organisation kamen gar keine Live-Updates an.
    try {
      const frischesToken = getToken();
      if (frischesToken) reconnectWithToken(frischesToken);
    } catch (socketErr) {
      // Live-Updates sind Komfort — ein Fehler hier darf den bereits
      // erfolgreichen Org-Wechsel nicht nachträglich als gescheitert melden.
      console.error('Socket-Neuaufbau nach Org-Wechsel fehlgeschlagen:', socketErr);
    }

    // 5. window-Event 'org:switched' -> jede useOfflineQuery revalidiert frisch
    // mit dem neuen aktiven-Org-Header. Greift web UND nativ (auch bei im
    // IonRouterOutlet-Stack gecachten Pages, wo ein Router-Remount nicht zieht).
    window.dispatchEvent(new CustomEvent('org:switched'));

    // 5b. orgVersion erhoehen -> React-key am Router (App.tsx) wechselt -> der
    // gesamte Router-Subtree remountet mit frischem State.
    //
    // Ohne diesen Bump blieb der Wechsel unsichtbar: 'org:switched' erreicht nur
    // Komponenten, die useOfflineQuery benutzen UND gerade gemountet sind. Alles,
    // was seine Daten im eigenen useState/useEffect haelt (oder im
    // IonRouterOutlet-Stack geparkt ist), behielt die Daten der alten Org — die
    // Ansicht sah nach dem Umschalten unverändert aus.
    setOrgVersion(v => v + 1);

    // 6. Switcher-Liste für die neue Org neu laden (Rollen/Namen können sich
    // unterscheiden) — best-effort, Fehler hier sind unkritisch und duerfen den
    // bereits erfolgreichen Wechsel nicht als Fehlschlag melden.
    try {
      await loadOrganizations();
    } catch (err) {
      console.warn('Org-Liste nach Wechsel nicht neu geladen (unkritisch):', err);
    }

    return { ok: true, type: switchedType };
  }, [organizations, loadOrganizations]);

  // Immer-aktueller Zugriff auf switchOrg für den Push-Tap-Handler: dessen
  // Effect hat nur [user] als Dependency — ein direkt eingeschlossenes
  // switchOrg wäre eine stale Closure (veraltete organizations-Liste).
  const switchOrgRef = useRef(switchOrg);
  useEffect(() => {
    switchOrgRef.current = switchOrg;
  }, [switchOrg]);

  // Sauberes Abmelden — GARANTIERT zurück zum Login, egal wie verkorkst der
  // Zustand ist. Kein window.location-Reload (zerschiesst den nativen WebView).
  // Reihenfolge: aktive Org weg, logout() (best-effort, räumt Token+Cache),
  // dann IMMER setUser(null) -> AppContent rendert sofort die Login-Route.
  // Selbst wenn logout() wirft, kommt der User raus (clearAuth im catch).
  const signOut = useCallback(async () => {
    try {
      await setActiveOrgId(null);
      setActiveOrgIdState(null);
    } catch { /* best-effort */ }
    try {
      await performLogout();
    } catch (err) {
      console.error('Logout-Fehler (lokaler Logout wird erzwungen):', err);
      try { await clearAuth(); } catch { /* ignore */ }
      try { await offlineCache.clearAll(); } catch { /* ignore */ }
      try { await clearMediaCache(); } catch { /* ignore */ }
    }
    /*
     * Der Logout loescht den Token serverseitig (auth.ts, DELETE
     * /device-token) — die App hielt sich danach aber weiter fuer registriert:
     *
     *   pushAlreadyRegistered   liess requestPushPermissions sofort aussteigen
     *   fcmTokenSent            liess die 12h-Sperre in sendTokenToServer greifen
     *   pushTokenTimestamp      dasselbe, und ueberlebt App-Neustarts
     *   prevPushUserIdRef       liess den Nachfass-Weg bei Wiederanmeldung mit
     *                           DEMSELBEN Konto ausfallen (prev === user.id)
     *
     * Wer sich abmeldete und wieder anmeldete, bekam deshalb dauerhaft keinen
     * Push — ohne Fehler irgendwo. Gemessen an Produktion: zwei Anmeldungen um
     * 14:27 und 14:37 Uhr, kein einziger POST /device-token in den Logs, kein
     * Token in der Datenbank.
     *
     * Der Zeitstempel wird NICHT bloss vergessen, sondern auf 0 geschrieben:
     * Er liegt in Preferences und ueberlebt sonst den Neustart der App.
     */
    pushAlreadyRegistered = false;
    pushRegistrationInProgress = false;
    fcmTokenSent = null;
    fcmTokenLastSent = 0;
    pendingFcmToken = null;
    prevPushUserIdRef.current = null;
    try { await setPushTokenTimestamp(0); } catch { /* best-effort */ }

    // Garantierter Schritt: React-State leeren -> Login-Route. Nie ausgelassen.
    setOrganizations([]);
    setUser(null);
  }, []);

  // Push notifications functions
  const requestPushPermissions = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    if (pushRegistrationInProgress || pushAlreadyRegistered) {
      return;
    }

    pushRegistrationInProgress = true;

    try {
      // Kanaele VOR dem Registrieren anlegen: sonst kann die erste Mitteilung
      // eintreffen, bevor es den Kanal gibt — sie landet dann im Notfallkanal
      // "Sonstiges" und bleibt dort, bis sie weggewischt wird. Auf iOS ein
      // No-op (siehe services/notifications.ts).
      await benachrichtigungskanaeleAnlegen();

      // Check current permission status
      const permStatus = await PushNotifications.checkPermissions();

      if (permStatus.receive === 'prompt') {
        // Request permissions
        const permResult = await PushNotifications.requestPermissions();
        setPushNotificationsPermission(permResult.receive);

        if (permResult.receive === 'granted') {
          // Register for push notifications
          await PushNotifications.register();

          // TESTFLIGHT FIX: Force APNS registration via native plugin
          if (Capacitor.getPlatform() === 'ios') {
            try {
              await FCM.forceAPNSRegistration();

              // Force FCM token retrieval after APNS registration
              setTimeout(async () => {
                try {
                  await FCM.forceTokenRetrieval();
                } catch (error) {
                  console.warn('Could not force FCM token retrieval:', error);
                }
              }, 2000);
            } catch (error) {
              console.warn('Could not force iOS APNS registration:', error);
            }
          }
        }
      } else if (permStatus.receive === 'granted') {
        setPushNotificationsPermission(permStatus.receive);
        // Already granted, just register
        await PushNotifications.register();

        // TESTFLIGHT FIX: Force APNS registration for already granted permissions
        if (Capacitor.getPlatform() === 'ios') {
          try {
            await FCM.forceAPNSRegistration();

            // Force FCM token retrieval after APNS registration
            setTimeout(async () => {
              try {
                await FCM.forceTokenRetrieval();
              } catch (error) {
                console.warn('Could not force FCM token retrieval:', error);
              }
            }, 2000);
          } catch (error) {
            console.warn('Could not force iOS APNS registration:', error);
          }
        }
      } else {
        setPushNotificationsPermission(permStatus.receive);
      }

      pushAlreadyRegistered = true;
    } catch (error) {
      console.error('Error requesting push permissions:', error);
      setError('Push Notifications konnten nicht aktiviert werden');
    } finally {
      pushRegistrationInProgress = false;
    }
  }, []);

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  // Clear messages after 5 seconds
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(clearMessages, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  // NetworkMonitor initialisieren und isOnline State synchronisieren
  useEffect(() => {
    Promise.resolve(networkMonitor.init()).then(() => {
      setIsOnline(networkMonitor.isOnline);
      // Beim Kaltstart liegengebliebene Queue-Items direkt anstossen: die
      // uebrigen Ausloeser (Online-Wechsel, Socket-Reconnect, App-Resume)
      // feuern beim normalen App-Start nicht — eine offline geschriebene
      // Nachricht blieb sonst bis zum naechsten Zufallsausloeser liegen.
      if (networkMonitor.isOnline) {
        writeQueue.flush();
      }
    });
    const unsubscribe = networkMonitor.subscribe((online) => {
      setIsOnline(online);
      // Beim Wiedererlangen der Verbindung (z.B. nach Netzwerkwechsel WLAN<->LTE)
      // den WebSocket aktiv anstossen — er hängt sonst manchmal getrennt fest.
      if (online) {
        ensureSocketConnected();
      }
    });
    // Initialen Status setzen
    setIsOnline(networkMonitor.isOnline);
    return () => { unsubscribe(); };
  }, []);

useEffect(() => {
  // NUR AUSFUEHREN, WENN EIN USER EINGELOGGT IST!
  if (!user) {
    return;
  }

  // Eigenes Fenster-Ereignis der nativen Bruecke; der Token steht in detail.
  const handleNativeFCMToken = (event: Event) => {
    const token = (event as CustomEvent<string>).detail;

    if (token && token.length > 100) {
      // ANTI-SPAM für native Events verwenden
      sendTokenToServer(token);
    }
  };

  window.addEventListener('fcmToken', handleNativeFCMToken);

  // Bei Reconnect: Fehlgeschlagenen Token-Send nachholen
  const handleReconnectTokenRetry = () => {
    const pendingToken = pendingFcmToken;
    if (pendingToken) {
      pendingFcmToken = null;
      sendTokenToServer(pendingToken);
    }
  };
  window.addEventListener('sync:reconnect', handleReconnectTokenRetry);

  // WICHTIG: Nach dem Setup des Listeners manuell den Token abfragen,
  // falls er schon da ist (z.B. bei App-Start mit eingeloggtem User).
  // Deine AppDelegate-Logik sendet ihn bei App-Aktivierung ohnehin,
  // aber dies ist eine zusätzliche Sicherheit.
  // Hinweis: Das fruehere (App as any).fireRestoredResult()-Workaround zum
  // Antriggern des Token-Sends ist in Capacitor 8 entfernt und warf eine
  // unhandled Promise-Rejection ("not implemented on android"). Der Token-Send
  // erfolgt ohnehin über das AppDelegate bei App-Aktivierung sowie über den
  // 'fcmToken'-Listener oben — der Workaround ist damit ersatzlos entfallen.


  return () => {
    window.removeEventListener('fcmToken', handleNativeFCMToken);
    window.removeEventListener('sync:reconnect', handleReconnectTokenRetry);
  };
}, [user]); // <--- WICHTIGSTE ÄNDERUNG: Abhängigkeit von 'user'

  useEffect(() => {
    // Nur EINMAL Push-Permissions anfordern nach Login
    if (user && Capacitor.isNativePlatform() && !pushAlreadyRegistered && !pushRegistrationInProgress) {
      requestPushPermissions();
    }
  }, [user, requestPushPermissions]);

  // App lifecycle events - simplified to avoid duplicate calls
  useEffect(() => {
    if (!user) return;

    let lastRefresh = 0;
    const minRefreshInterval = 5000; // Minimum 5s between refreshes

    const handleAppActive = async () => {
      const now = Date.now();
      if (now - lastRefresh > minRefreshInterval) {
        lastRefresh = now;

        // Token bei App-Resume erneuern (max alle 12 Stunden)
        if (Capacitor.isNativePlatform()) {
          const lastTokenRefresh = getPushTokenTimestamp();
          const twelveHours = 12 * 60 * 60 * 1000;
          // ANDROID BRAUCHT DAS BEI JEDER AKTIVIERUNG:
          // Auf iOS reicht AppDelegate.applicationDidBecomeActive den Token
          // jedes Mal von sich aus an die Oberflaeche nach. Android hat kein
          // solches Netz — MainActivity ist eine leere Klasse, und das
          // 'registration'-Ereignis feuert pro Installation praktisch nur
          // EINMAL, weil FCM bei unveraenderter Installation immer denselben
          // Token liefert. Verpuffte dieser eine Token, gab es keinen zweiten
          // Anlauf: kein Push mehr, dauerhaft, ohne Fehler irgendwo.
          //
          // PushNotifications.register() holt auf Android den Token frisch bei
          // Firebase und feuert 'registration' erneut (siehe register() im
          // Push-Plugin). Deshalb hier ohne Zeitfenster — der Aufruf ist
          // billig, und sendTokenToServer faengt ueberfluessige POSTs selbst ab.
          //
          // Gemessen vor der Korrektur: 8 Android-Token bei Konfis, 0 bei
          // Teamer:innen und Admins ausser einem Testkonto; 29 aktive
          // Nutzer:innen ganz ohne Token.
          const istAndroid = Capacitor.getPlatform() === 'android';
          if (istAndroid || now - lastTokenRefresh > twelveHours) {
            try {
              // NUR registrieren. Den Zeitstempel setzt sendTokenToServer nach
              // einem ERFOLGREICHEN POST — hier stand er frueher direkt
              // dahinter und belegte damit bloss, dass registriert wurde, nicht
              // dass der Token ankam. Ein Token, der es nie zum Server schaffte,
              // sperrte so den naechsten Anlauf fuer zwoelf Stunden.
              await PushNotifications.register();

              // BEWUSST NICHT abgewartet: tokenAktivHolen wiederholt bei einem
              // Fehler bis zu vier Sekunden lang. Das darf den restlichen
              // Aktivierungsweg (Socket, Badges, Aufraeumen) nicht hinhalten.
              // Das .catch() ersetzt das umgebende try/catch, das durch das
              // Nicht-Abwarten nicht mehr greift — sonst waere eine
              // unbehandelte Promise-Ablehnung moeglich.
              tokenAktivHolen()
                .then((aktiv) => { if (aktiv) return sendTokenToServer(aktiv); })
                .catch((err) => console.warn('Token refresh failed:', err));
            } catch (err) {
              console.warn('Token refresh failed:', err);
            }
          }
        }
      }
    };

    let stateChangeListener: PluginListenerHandle | null = null;

    // Setup single listener for app state changes
    const setupListener = async () => {
      stateChangeListener = await App.addListener('appStateChange', async ({ isActive }) => {
        if (isActive) {
          // Beim Wechsel in den Vordergrund zuerst den Socket aktiv anstossen:
          // Nach laengerem Hintergrund (oder Deploy-Downtime) hängt er oft im
          // getrennten Zustand fest, ohne von selbst neu zu verbinden. Der
          // anschliessende Reconnect löst die 'sync:reconnect'-Sequenz (flush ->
          // invalidate -> Badge/View-Refresh) ohnehin aus.
          ensureSocketConnected();

          handleAppActive();

          writeQueue.flush().then(async (result) => {
            if (result.failed.length > 0) {
              console.warn('Queue flush failures:', result.failed.length);
            }
            // Cache invalidieren damit useOfflineQuery revalidiert
            await offlineCache.invalidateAll();
            // Badge-Refresh triggern
            window.dispatchEvent(new CustomEvent('sync:reconnect'));
          });
        } else {
          // Background: Nur Text-Items flushen (keine Datei-Uploads)
          if (Capacitor.isNativePlatform()) {
            const taskId = await BackgroundTask.beforeExit(async () => {
              try {
                await writeQueue.flushTextOnly();
              } finally {
                BackgroundTask.finish({ taskId });
              }
            });
          }
        }
      });
    };

    setupListener();

    // Cleanup
    return () => {
      if (stateChangeListener) {
        stateChangeListener.remove();
      }
    };
  }, [user]);

  // App Links: Ein Link auf konfi-quest.de (Einladung, Passwort-Reset, Login)
  // oeffnet die App, Android und iOS liefern die Adresse ueber 'appUrlOpen'. Bewusst
  // OHNE [user]-Abhaengigkeit und ausserhalb des Push-Effekts: Die Einladung
  // wird gerade von denen angetippt, die noch NICHT angemeldet sind. Das Ziel
  // geht ueber pushZielMelden an den Router (siehe utils/deepLinks.ts).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let abbauen: (() => void) | null = null;
    let abgebaut = false;
    deepLinksAnschliessen()
      .then((f) => {
        if (abgebaut) f();
        else abbauen = f;
      })
      .catch((err) => console.warn('App-Link-Lauscher nicht angeschlossen:', err));
    return () => {
      abgebaut = true;
      abbauen?.();
    };
  }, []);

  // Push notifications setup and listeners
  useEffect(() => {
    if (!user) return;

    const setupPushNotifications = async () => {
      if (!Capacitor.isNativePlatform()) return;
      try {
        // WICHTIG: Registration Listener für Android (und iOS Fallback)
        PushNotifications.addListener('registration', (token) => {
          // Token an Server senden
          sendTokenToServer(token.value);
          aufraeumenNachholen();
        });

        PushNotifications.addListener('registrationError', (error) => {
          console.error('Push registration error:', error);
          // Auch der Fehlschlag hebt die Sperre im iOS-Plugin auf.
          aufraeumenNachholen();
        });

        // Registriere Listener
        PushNotifications.addListener('pushNotificationReceived', () => {
          // BadgeContext lauscht auf dieses Event und ruft refreshAllCounts()
          window.dispatchEvent(new CustomEvent('push:received'));
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          // Counts aktualisieren (BadgeContext lauscht auf push:received)
          window.dispatchEvent(new CustomEvent('push:received'));

          // Angetippte Notification aus dem Mitteilungszentrum entfernen
          // (bewusst geoeffnet -> wie bei den meisten Apps verschwindet sie).
          removeDeliveredById(action.notification.id);

          const notificationData = action.notification.data as Record<string, unknown> | undefined;
          const notificationType = action.notification.data?.type;

          // Hier stand ein `setTimeout(..., 100)` mit der Begruendung, die
          // Navigation solle erst laufen, "wenn die App fertig geladen ist".
          // Die Wartezeit hat das aber nie zugesichert: 100 ms sind kein
          // Zustand, sondern eine Hoffnung — und am Ende stand ein harter
          // Reload, der die gerade hochfahrende Activity abgeraeumt hat.
          //
          // Die Frage "ist der Router schon da?" beantwortet jetzt der
          // Empfaenger selbst: pushZielMelden legt das Ziel ab und feuert;
          // PushZielNavigation holt es beim Montieren nach, falls es zu
          // frueh kam. Damit ist die Wartezeit nicht nur unnoetig, sie waere
          // schaedlich — sie verzoegert die Navigation sichtbar und laesst
          // den Nutzer auf der zuletzt geoeffneten Seite stehen.
          void (async () => {
            // Multi-Org: Der Push trägt die Organisation seines Inhalts. Weicht
            // sie von der gerade aktiven Org ab, ERST über den bestehenden
            // switchOrg-Flow wechseln und den Abschluss abwarten. Frische Werte
            // über die tokenStore-Getter, nicht aus dem Effect-Closure
            // ([user]-Dependency -> stale). Fehlt die Org im Payload oder
            // schlägt der Wechsel fehl, bleibt alles beim heutigen Verhalten
            // (direkt navigieren).
            const currentType = (getUser()?.type || user?.type || 'konfi') as PushUserType;
            const effectiveType = await resolveOrgForPush(notificationData, currentType, {
              getActiveOrgId,
              getUserOrgId: () => getUser()?.organization_id ?? null,
              switchOrg: (orgId) => switchOrgRef.current(orgId)
            });
            const targetUrl = buildPushTargetUrl(notificationType, notificationData, effectiveType);

            // Ziel an den Router uebergeben (siehe PUSH_ZIEL_EVENT in
            // utils/pushNavigation und navigation/PushZielNavigation). Der
            // frueher hier stehende Reload war die Absturzursache.
            pushZielMelden(targetUrl);
          })();
        });

        // Jetzt: Registrierung
        const permStatus = await PushNotifications.checkPermissions();
        setPushNotificationsPermission(permStatus.receive);

        if (permStatus.receive === 'granted') {
          await PushNotifications.register();
        } else if (permStatus.receive === 'prompt') {
          const result = await PushNotifications.requestPermissions();
          setPushNotificationsPermission(result.receive);
          if (result.receive === 'granted') {
            await PushNotifications.register();
          }
        }
      } catch (error) {
        console.error('Fehler bei Push-Setup:', error);
      }
    };

    setupPushNotifications();

    // Cleanup: Ohne Cleanup akkumulieren die vier
    // addListener-Registrierungen bei jedem User-Wechsel (Effect-Dep ist [user]).
    // removeAllListeners ist hier gefahrlos: Dieser Effect ist die EINZIGE Stelle
    // im gesamten Frontend, die PushNotifications-Listener registriert (per grep
    // verifiziert) -- es werden also nur die hier gesetzten vier Listener
    // entfernt, kein fremder Listener wird mitgerissen.
    return () => {
      if (Capacitor.isNativePlatform()) {
        PushNotifications.removeAllListeners();
      }
    };
  }, [user]); // Abhängigkeit ist korrekt

  // hasPermission entfernt - Berechtigung jetzt über user.role_name prüfen

  const value: AppContextType = {
    user,
    error,
    success,
    isOnline,
    pushNotificationsPermission,
    organizations,
    activeOrgId,
    orgVersion,
    switchOrg,
    signOut,
    setUser,
    refreshUser,
    setError: setErrorTracked,
    setSuccess,
    clearMessages,
    requestPushPermissions,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

export default AppContext;
