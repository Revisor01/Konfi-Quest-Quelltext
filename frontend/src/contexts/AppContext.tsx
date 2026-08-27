import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Device } from '@capacitor/device';
import api from '../services/api';
import { getUser, setUser as persistUser, getDeviceId, setDeviceId, getPushTokenTimestamp, setPushTokenTimestamp, getActiveOrgId, setActiveOrgId, setToken, getToken } from '../services/tokenStore';
import { networkMonitor } from '../services/networkMonitor';
import { ensureSocketConnected, reconnectWithToken } from '../services/websocket';
import { App } from '@capacitor/app';
import { PushNotifications } from '@capacitor/push-notifications';
import { removeDeliveredById, removeAllDelivered } from '../services/notifications';
import { writeQueue } from '../services/writeQueue';
import { offlineCache } from '../services/offlineCache';
import { logout as performLogout } from '../services/auth';
import { clearAuth } from '../services/tokenStore';
import { BackgroundTask } from '@capawesome/capacitor-background-task';
import { BaseUser } from '../types/user';
import { setAnalyticsRole, trackFehler, trackSitzungsstart } from '../services/analytics';
import { buildPushTargetUrl, resolveOrgForPush, PushUserType } from '../utils/pushNavigation';

// FCM Token wird über Window Events empfangen (siehe AppDelegate.swift)

interface FCMPlugin {
  forceAPNSRegistration(): Promise<void>;
  forceTokenRetrieval(): Promise<void>;
}

// Typsichere Bridge zum nativen FCM-Plugin (registriert via AppDelegate.swift)
const FCM = registerPlugin<FCMPlugin>('FCM');

// ANTI-SPAM: Verhindere mehrfache Push-Registrierung (Global Scope)
let pushRegistrationInProgress = false;
let pushAlreadyRegistered = false;

// In-Memory Anti-Spam-State für FCM-Token (kein window-Zugriff nötig)
let fcmTokenSent: string | null = null;
let fcmTokenLastSent: number = 0;
let pendingFcmToken: string | null = null;

// 12 Stunden — Sendefenster für einen UNVERAENDERTEN Token.
const TOKEN_RESEND_WINDOW_MS = 12 * 60 * 60 * 1000;

// Funktion, um Duplikate zu vermeiden
const sendTokenToServer = async (token: string, retryCount = 0) => {
  const now = Date.now();

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

  // Gespeicherte Device ID nutzen (wird bei App-Start einmalig persistiert)
  const deviceId = getDeviceId();
  if (!deviceId) {
    console.warn('Keine Device ID verfügbar - Token-Send wird übersprungen');
    return;
  }

  try {
    await api.post('/notifications/device-token', {
      token,
      platform: Capacitor.getPlatform(),
      device_id: deviceId
    });

    fcmTokenSent = token; // Markiere Token als gesendet
    fcmTokenLastSent = now; // Timestamp setzen
    await setPushTokenTimestamp(now); // Bug 3: Timestamp nach jedem Send persistieren
  } catch (err) {
    console.error('Fehler beim Senden des FCM-Tokens:', err);
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

interface AppContextType {
  user: BaseUser | null;
  loading: boolean;
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
  setError: (error: string) => void;
  setSuccess: (success: string) => void;
  clearMessages: () => void;
  requestPushPermissions: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);


export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<BaseUser | null>(getUser());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isOnline, setIsOnline] = useState<boolean>(true);

  // Jede Fehlermeldung, die tatsaechlich jemand zu sehen bekommt, fliesst in
  // die anonyme Messung ein — DAS beantwortet "wo klemmt es". Uebertragen wird
  // nur eine gekuerzte, entschaerfte Fassung des Textes: keine Namen, keine
  // IDs, keine Freitexte aus Beitraegen (Zahlen werden ersetzt).
  const setErrorTracked = useCallback((meldung: string) => {
    setError(meldung);
    if (meldung) {
      const anonym = meldung
        .replace(/\d+/g, '#')
        .slice(0, 80);
      trackFehler(anonym);
    }
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

  // Push notifications state
  const [pushNotificationsPermission, setPushNotificationsPermission] = useState<string>('prompt');

  // Account-Wechsel-Erkennung für den FCM-Token: Nach Logout+Login mit einem
  // ANDEREN Account hängt der Token serverseitig noch am alten User (das
  // 12h-Sendefenster verhindert den erneuten POST). Bei einem Wechsel innerhalb
  // der Session das Fenster aufheben und den bekannten Token sofort für den
  // neuen User registrieren — der Server hängt ihn dabei um (DELETE fremder
  // Bindungen in POST /device-token).
  const prevPushUserIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!user?.id) return; // Logout: vorherige ID absichtlich behalten
    const prev = prevPushUserIdRef.current;
    prevPushUserIdRef.current = user.id;
    if (prev !== null && prev !== user.id && fcmTokenSent) {
      const t = fcmTokenSent;
      fcmTokenSent = null; // In-Memory-Sperre aufheben
      setPushTokenTimestamp(0).finally(() => sendTokenToServer(t));
    }
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
  // bekommt (api.ts setzt dann die aktive Org auf null), hier die App auf die
  // Primaer-Org zuruecksetzen und alle Views remounten.
  useEffect(() => {
    const handler = async () => {
      setActiveOrgIdState(null);
      try { await offlineCache.clearAll(); } catch { /* best-effort */ }
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
      setError('Organisation konnte nicht gewechselt werden');
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
    }
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

  const handleNativeFCMToken = (event: any) => {
    const token = event.detail;

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
          if (now - lastTokenRefresh > twelveHours) {
            try {
              await PushNotifications.register();
              await setPushTokenTimestamp(now);
            } catch (err) {
              console.warn('Token refresh failed:', err);
            }
          }
        }
      }
    };

    let stateChangeListener: any = null;

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

          // Admins bekommen ohnehin laufend Erinnerungen -> beim Aktiv-werden
          // global aufräumen. Konfis/Teamer NICHT (dort gezielt pro Bereich/
          // beim Antippen, damit ungelesene Erinnerungen nicht verschwinden).
          if (user?.type === 'admin') {
            removeAllDelivered();
          }
          // Koordinierte Resume-Sequenz: flush -> invalidate -> badges
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
        });

        PushNotifications.addListener('registrationError', (error) => {
          console.error('Push registration error:', error);
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

          // Use timeout to ensure navigation happens after app is fully loaded
          setTimeout(async () => {
            // Multi-Org: Der Push trägt die Organisation seines Inhalts. Weicht
            // sie von der gerade aktiven Org ab, ERST über den bestehenden
            // switchOrg-Flow wechseln und den Abschluss abwarten — der harte
            // Reload unten würde die asynchronen Preferences-Writes sonst
            // abschneiden. Frische Werte über die tokenStore-Getter, nicht aus
            // dem Effect-Closure ([user]-Dependency -> stale). Fehlt die Org im
            // Payload oder schlägt der Wechsel fehl, bleibt alles beim heutigen
            // Verhalten (direkt navigieren).
            const currentType = (getUser()?.type || user?.type || 'konfi') as PushUserType;
            const effectiveType = await resolveOrgForPush(notificationData, currentType, {
              getActiveOrgId,
              getUserOrgId: () => getUser()?.organization_id ?? null,
              switchOrg: (orgId) => switchOrgRef.current(orgId)
            });
            const targetUrl = buildPushTargetUrl(notificationType, notificationData, effectiveType);

            if (targetUrl) {
              // Hard navigation (intentional): App kommt aus Background/Killed-State,
              // React Router State kann veraltet sein. Full Reload sichert frische Daten.
              window.location.href = targetUrl;
            }
          }, 100);
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
    loading,
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
