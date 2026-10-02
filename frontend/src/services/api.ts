import axios from 'axios';
import axiosRetry from 'axios-retry';
import { getToken, getRefreshToken, setToken, setRefreshToken, clearAuth, isLoggingOut, getActiveOrgId, setActiveOrgId } from './tokenStore';
import { networkMonitor } from './networkMonitor';
// Kein Zirkelbezug: biometrics.ts importiert nur tokenStore/Preferences, nie api.
import { rotationUebernehmen, istBiometrieAktiv } from './biometrics';

import { API_BASE_URL } from './apiBasis';
import { refreshAnfordern } from './refreshAnfrage';
import { sperrMeldungAus } from '../utils/anmeldeHinweis';
import { fehlerFuersProtokoll, fehlerEntschaerfen, istEntschaerft } from '../utils/fehler';

const api = axios.create({
  baseURL: API_BASE_URL,
  // Timeout, damit ein Request bei totem Netz / Netzwerkwechsel (WLAN<->LTE) nicht
  // ewig hängt: die alte TCP-Verbindung bricht beim Wechsel, ohne Timeout wuerde
  // axios das nicht bemerken und die App "hängen". Mit Timeout wirft axios
  // ECONNABORTED -> axios-retry greift (s.u.) und wiederholt auf der neuen Verbindung.
  timeout: 20000,
});

/**
 * Zeitlimit fuer Datei-Downloads (Blob), getrennt vom globalen der API.
 *
 * 180 s reichen fuer 20 MB ab etwa 0,9 Mbit/s. Ein totes Netz faengt weiterhin
 * der networkMonitor ab; hier geht es um langsame, nicht um fehlende Leitungen.
 */
export const DATEI_TIMEOUT_MS = 180000;

/**
 * Header, mit dem ein Aufrufer einen schreibenden Request als wiederholbar
 * kennzeichnet. Wer ihn setzt, verspricht: Der Server erkennt den zweiten
 * Versuch am Schluessel und fuehrt ihn nicht doppelt aus. Die Server-Seite
 * dafuer ist ein eigener Schritt (bisher kennt das Backend nur client_id
 * fuer Antraege); bis dahin setzt ihn niemand, und POST/PATCH werden nie
 * wiederholt.
 */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

// Methoden, die der Server nicht folgenlos zweimal ausfuehren kann.
const NICHT_IDEMPOTENT = new Set(['post', 'patch']);

const hatIdempotenzSchluessel = (config: { headers?: unknown } | undefined): boolean => {
  const headers = config?.headers as
    | { get?: (name: string) => unknown; [key: string]: unknown }
    | undefined;
  if (!headers) return false;
  const wert = typeof headers.get === 'function'
    ? headers.get(IDEMPOTENCY_HEADER)
    : headers[IDEMPOTENCY_HEADER];
  return typeof wert === 'string' && wert.length > 0;
};

// Automatischer Retry für transiente Fehler (5xx, 408) — NICHT für 429.
// WICHTIG: 429 (Rate-Limit) darf NICHT retried werden. Ein Retry-auf-429 zählt
// erneut gegen das Limit und macht die Ueberschreitung schlimmer (Retry-Lawine) —
// genau das war die Ursache für das sporadische "Zu viele Anfragen". Bei 429
// sagt der Server "warte", die richtige Antwort ist warten, nicht sofort 3x nachfeuern.
//
// NUR IDEMPOTENTE METHODEN: axios-retry
// schliesst POST in isNetworkOrIdempotentRequestError bewusst aus; die
// Klauseln `status >= 500` und ECONNABORTED darunter hoben das fuer jede
// Methode auf. Ein POST, dessen Antwort nach 20 s nicht da war, obwohl der
// Server laengst geschrieben hatte, ging bis zu dreimal neu hinaus -- 3
// Bonuspunkte wurden 6, 9 oder 12, ein Termin entstand mehrfach, eine
// Anmeldung endete als Fehler "bereits angemeldet", obwohl sie stand. Ob der
// Request angekommen ist, laesst sich beim Timeout nicht unterscheiden;
// deshalb werden POST/PATCH nur wiederholt, wenn der Aufrufer einen
// Idempotency-Key mitgibt (siehe IDEMPOTENCY_HEADER).
axiosRetry(api, {
  retries: 3,
  retryDelay: (retryCount) => {
    return axiosRetry.exponentialDelay(retryCount) + Math.random() * 200;
  },
  retryCondition: (error) => {
    const status = error.response?.status;
    if (status === 429) return false;
    const methode = (error.config?.method || 'get').toLowerCase();
    if (NICHT_IDEMPOTENT.has(methode) && !hatIdempotenzSchluessel(error.config)) return false;
    // Timeout (ECONNABORTED/ETIMEDOUT) durch Netzwerkwechsel ebenfalls wiederholen.
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return true;
    return axiosRetry.isNetworkOrIdempotentRequestError(error) || (status !== undefined && status >= 500);
  },
  onRetry: () => {}
});

// Export API_BASE_URL für andere Komponenten
export const API_URL = API_BASE_URL;

// Add token to requests. Laeuft der Token in Kuerze ab (oder ist er schon
// abgelaufen), wird VOR dem Senden einmal refresht — sonst rennt z.B. der
// Request-Burst beim App-Oeffnen erst in 401s und alle hängen ~1s im
// Refresh-Umweg (das war die Hauptquelle der "App hängt kurz"-Momente).
api.interceptors.request.use(async (config) => {
  const url = config.url || '';
  const isAuthFree = url.includes('/login') || url.includes('/refresh');
  let token = getToken();
  if (token && !isAuthFree) {
    token = (await ensureFreshToken()) ?? token;
  }
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Aktive Multi-Org mitsenden (Org-Switcher). Ohne aktive Org bleibt der Server
  // bei der Primaer-Org.
  const activeOrgId = getActiveOrgId();
  if (activeOrgId) {
    config.headers['X-Active-Organization'] = String(activeOrgId);
  }
  return config;
});

// Verhindere parallele Refresh-Requests. Subscriber haben einen Fehlerpfad:
// ohne ihn wuerden Requests, die auf einen fehlschlagenden Refresh warten,
// als nie-aufloesende Promises hängen bleiben.
let isRefreshing = false;
let refreshSubscribers: { onSuccess: (token: string) => void; onFail: (err: unknown) => void }[] = [];

const onTokenRefreshed = (token: string) => {
  refreshSubscribers.forEach(s => s.onSuccess(token));
  refreshSubscribers = [];
};

const onTokenRefreshFailed = (err: unknown) => {
  refreshSubscribers.forEach(s => s.onFail(err));
  refreshSubscribers = [];
};

const addRefreshSubscriber = (onSuccess: (token: string) => void, onFail: (err: unknown) => void) => {
  refreshSubscribers.push({ onSuccess, onFail });
};

// Refresh-Request selbst (direktes axios, nicht api — vermeidet Interceptor-Loop).
// Aktive Org mitsenden, damit das neue Token den Org-Claim behält.
// Mit Zeitlimit 20 s wie die Instanz:
// ohne es hing bei einem Netzwechsel die ganze App am Refresh.
const performRefresh = async (refreshToken: string): Promise<string> => {
  const activeOrgId = getActiveOrgId();
  const response = await refreshAnfordern(
    { refresh_token: refreshToken },
    activeOrgId ? { 'X-Active-Organization': String(activeOrgId) } : undefined
  );

  const { token: newToken, refresh_token: newRefreshToken } = response.data;

  const nurGesichert = await istBiometrieAktiv();

  // REIHENFOLGE IST KRITISCH (Android-Session-Verlust, 1.5.0):
  // Der Server rotiert bei jedem Refresh und REVOKED den alten Refresh-Token
  // sofort (Grace-Window nur 30s). Der neue Refresh-Token ist der einzige
  // langlebige (90d) Wiederherstellungs-Schlüssel — geht er verloren, ist die
  // Session nach 30s unrettbar tot (kein Push-Token-Send, Chat laedt nur Stale-
  // Cache, Socket 'jwt expired'). Android killt App-Prozesse aggressiver als iOS,
  // daher MUSS der Refresh-Token ZUERST und bestaetigt persistiert werden.
  // Der Access-Token ist unkritisch: geht er bei einem Crash verloren, holt ihn
  // der nächste ensureFreshToken() über den (gesicherten) Refresh-Token neu.
  // Bei eingeschalteter Biometrie ist die dauerhafte Ablage der sichere
  // Speicher (rotationUebernehmen unten); hier nur der Arbeitsspeicher.
  await setRefreshToken(newRefreshToken, { klartext: !nurGesichert });
  await setToken(newToken);

  // Ist die biometrische Anmeldung aktiv, muss die gesichert abgelegte Sitzung
  // denselben rotierten Token bekommen — sonst ist sie beim naechsten Start
  // tot (der Server macht den alten Token nach 5 Minuten ungueltig).
  // Best-effort: ein Fehler hier darf den laufenden Refresh NICHT scheitern
  // lassen, sonst zerlegt eine Kleinigkeit im sicheren Speicher die Sitzung.
  try {
    await rotationUebernehmen(newRefreshToken);
  } catch (fehler) {
    console.warn('Biometrisch gesicherte Sitzung nicht aktualisiert:', fehler);
  }

  return newToken;
};

// exp-Claim aus dem JWT lesen (Base64url), gecacht pro Token-String.
let _expCache: { token: string; exp: number | null } | null = null;
const getTokenExp = (token: string): number | null => {
  if (_expCache?.token === token) return _expCache.exp;
  let exp: number | null = null;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64));
    if (typeof payload.exp === 'number') exp = payload.exp;
  } catch {
    // Kein dekodierbares JWT — exp bleibt null, der 401-Interceptor regelt es.
  }
  _expCache = { token, exp };
  return exp;
};

// Sorgt dafuer, dass der Access-Token noch mindestens marginSeconds gueltig ist,
// und refresht sonst proaktiv EINMAL (parallel wartende Aufrufer teilen sich den
// Refresh). Gibt bei transienten Fehlern den alten Token zurück — die Session
// wird hier bewusst NICHT zerstoert, das entscheidet allein der 401-Interceptor.
export const ensureFreshToken = async (marginSeconds = 30): Promise<string | null> => {
  const token = getToken();
  if (!token) return null;
  const exp = getTokenExp(token);
  if (exp === null) return token;
  if (exp * 1000 - Date.now() > marginSeconds * 1000) return token;
  if (!networkMonitor.isOnline) return token;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return token;

  if (isRefreshing) {
    return new Promise((resolve) => {
      addRefreshSubscriber(resolve, () => resolve(getToken()));
    });
  }

  isRefreshing = true;
  try {
    const newToken = await performRefresh(refreshToken);
    isRefreshing = false;
    onTokenRefreshed(newToken);
    return newToken;
  } catch (err) {
    isRefreshing = false;
    onTokenRefreshFailed(err);
    return token;
  }
};

// Ein Token OHNE Org-Claim beschaffen.
//
// Nach dem Rueckfall auf die Stamm-Gemeinde reicht es nicht, den Header
// X-Active-Organization wegzulassen: Das Access-Token traegt weiter den
// Claim active_organization_id der entzogenen Gemeinde, und rbac.js greift
// OHNE Header genau auf diesen Claim zurueck -> wieder 403, bei jedem
// Request, bis das Token ablaeuft (bis zu 15 Minuten). Der Weg zu einem
// Token ohne Claim ist POST /auth/refresh ohne Org-Header (auth.js laesst den
// Claim dann weg); switch-org auf die Stamm-Gemeinde ginge nicht, es verlangt
// eine Zeile in user_organizations, die es fuer die Stamm-Gemeinde meist
// nicht gibt.
//
// Muss NACH setActiveOrgId(null) laufen -- performRefresh liest die aktive
// Org fuer den Header. Ein bereits laufender Refresh kann noch mit dem alten
// Header unterwegs sein; auf ihn warten und dann selbst einmal refreshen.
// Scheitert der Refresh (Funkloch), bleibt die Sitzung bestehen -- das
// entscheidet allein der 401-Interceptor -- und der Zustand ist der von
// vorher: das alte Token wirkt bis zu seinem Ablauf nach.
const tokenOhneOrgClaimBeschaffen = async (): Promise<string | null> => {
  if (isRefreshing) {
    await new Promise<void>((resolve) => addRefreshSubscriber(() => resolve(), () => resolve()));
  }
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  isRefreshing = true;
  try {
    const neu = await performRefresh(refreshToken);
    isRefreshing = false;
    onTokenRefreshed(neu);
    return neu;
  } catch (err) {
    isRefreshing = false;
    onTokenRefreshFailed(err);
    // Nur Status und Code: `config.data` des Refresh-Fehlers traegt den
    // Refresh-Token im Klartext.
    console.warn('Token ohne Gemeinde-Claim konnte nicht beschafft werden:', fehlerFuersProtokoll(err));
    return null;
  }
};

// Handle auth errors and rate limiting
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- axios reicht den Fehler untypisiert herein; wie bisher im Interceptor.
const fehlerBehandeln = async (error: any): Promise<unknown> => {
    const originalRequest = error.config;

    const daten = error.response?.data;
    if (
      error.response?.status === 403 &&
      (daten?.error_code === 'org_kein_zugriff' || daten?.error === 'Kein Zugriff auf diese Organisation') &&
      getActiveOrgId()
    ) {
      // Aktive Org zuruecksetzen, ein Token OHNE Org-Claim holen und erst
      // dann den AppContext per Event zum Remount bringen -- der baut damit
      // auch den Socket mit dem neuen Token auf (KEIN window.location-Reload
      // -> der zerschiesst den nativen WebView).
      await setActiveOrgId(null);
      await tokenOhneOrgClaimBeschaffen();
      window.dispatchEvent(new CustomEvent('auth:org-fallback'));
      return Promise.reject(error);
    }

    if (error.response?.status === 401) {
      const isLoginRequest = originalRequest?.url?.includes('/login');
      const isRefreshRequest = originalRequest?.url?.includes('/refresh');

      // Login- und Refresh-Requests nicht retry'en
      if (isLoginRequest || isRefreshRequest) {
        return Promise.reject(error);
      }

      // Schon einmal nach einem Refresh wiederholt und wieder 401? Dann liegt
      // es nicht am Token -- durchreichen. Ohne
      // diesen Merker drehte der Client im Kreis, rotierte in jeder Runde den
      // Refresh-Token und kam nie zurueck (gemessen: 8 Versuche, 7 Refreshs
      // bis zur Notbremse des Tests). Die Sitzung bleibt bestehen: Sie wurde
      // gerade erst erneuert.
      if (originalRequest?._retry) {
        return Promise.reject(error);
      }

      // Offline: Token behalten, gecachte Daten nutzen
      if (!networkMonitor.isOnline) {
        console.warn('401 während Offline — Token wird behalten');
        return Promise.reject(error);
      }

      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        // Bewusster Logout läuft → kein "Sitzung abgelaufen", einfach durchreichen.
        if (isLoggingOut()) {
          return Promise.reject(error);
        }
        // Kein Refresh-Token → direkt Re-Login
        await clearAuth();
        window.dispatchEvent(new CustomEvent('auth:relogin-required'));
        return Promise.reject(error);
      }

      if (isRefreshing) {
        // Anderer Request refresht bereits → warten. Schlaegt der Refresh fehl,
        // wird der wartende Request mit dem Fehler abgewiesen (statt ewig zu hängen).
        return new Promise((resolve, reject) => {
          addRefreshSubscriber(
            (newToken: string) => {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              originalRequest._retry = true;
              resolve(api(originalRequest));
            },
            (err) => reject(err)
          );
        });
      }

      isRefreshing = true;

      try {
        const newToken = await performRefresh(refreshToken);

        isRefreshing = false;
        onTokenRefreshed(newToken);

        // Original-Request mit neuem Token wiederholen -- genau einmal (_retry).
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        originalRequest._retry = true;
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        onTokenRefreshFailed(refreshError);

        // Bewusster Logout läuft → kein "Sitzung abgelaufen"-Dialog.
        if (isLoggingOut()) {
          await clearAuth();
          return Promise.reject(refreshError);
        }
        // Keine Antwort des Servers (Zeitlimit, Netz weg): Die Sitzung
        // bleibt, die Anfrage scheitert als Netzfehler -- wie im
        // Offline-Zweig oben. Seit der Refresh ein Zeitlimit hat,
        // kaeme ein Netzwechsel sonst nach 20 s als
        // "Sitzung abgelaufen" an; vorher hing die App, und ein Neustart
        // behielt die Sitzung. Ob der Token noch gilt, sagt nur der Server.
        if (!(refreshError as { response?: unknown })?.response) {
          return Promise.reject(refreshError);
        }
        // Refresh vom Server abgelehnt → Re-Login-Dialog. Ist es eine
        // Zugangs-Sperre (403 mit error_code: Konto deaktiviert, Gemeinde
        // gesperrt, Testphase vorbei), geht die Meldung des Servers mit --
        // die Anmeldeseite zeigt dann den Grund statt "Sitzung abgelaufen"
        // 
        await clearAuth();
        window.dispatchEvent(new CustomEvent('auth:relogin-required', {
          detail: { sperrMeldung: sperrMeldungAus(refreshError) },
        }));
        return Promise.reject(refreshError);
      }
    }

    // Rate-Limit: Benutzerfreundliche Meldung bereitstellen
    if (error.response?.status === 429) {
      const retryAfter = error.response.headers['retry-after'];
      const minutes = retryAfter ? Math.ceil(parseInt(retryAfter) / 60) : 15;
      error.rateLimitMessage = `Zu viele Versuche. Bitte warte ${minutes} Minuten.`;
      // Falls Backend bereits eine Message hat, diese bevorzugen
      if (error.response.data?.error) {
        error.rateLimitMessage = error.response.data.error;
      }
      // Generisches Rate-Limit Event für nicht-Login Requests
      const isLoginRequest = error.config?.url?.includes('/login');
      if (!isLoginRequest) {
        window.dispatchEvent(new CustomEvent('rate-limit', {
          detail: { message: error.rateLimitMessage }
        }));
      }
    }

    return Promise.reject(error);
};

// Jeder Fehler, den die Instanz an einen Aufrufer weitergibt, ist vorher
// entschaerft: ohne Zugangs-Token, Anfragekoerper und Leitung.
// Rund
// 100 Stellen geben gefangene Fehler roh an die Konsole -- hier wird es EINMAL
// geloest statt an jeder Stelle.
//
// ERST AM ENDE: fehlerBehandeln braucht Kopfzeilen und Koerper noch, um die
// Anfrage nach einem Refresh zu wiederholen; axios-retry (vor diesem
// Interceptor registriert) hat seine Entscheidung schon getroffen. Ein Fehler,
// der hier schon einmal durchlief -- er kommt aus der Kette einer Wiederholung
// zurueck --, geht unveraendert weiter; sonst liefen Rueckfall, Refresh und
// Rate-Limit-Meldung doppelt.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (istEntschaerft(error)) throw error;
    try {
      return await fehlerBehandeln(error);
    } catch (endgueltig) {
      throw fehlerEntschaerfen(endgueltig);
    }
  }
);

export default api;
