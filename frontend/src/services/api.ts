import axios from 'axios';
import axiosRetry from 'axios-retry';
import { getToken, getRefreshToken, setToken, setRefreshToken, clearAuth, isLoggingOut, getActiveOrgId, setActiveOrgId } from './tokenStore';
import { networkMonitor } from './networkMonitor';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://konfi-quest.de/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  // Timeout, damit ein Request bei totem Netz / Netzwerkwechsel (WLAN<->LTE) nicht
  // ewig haengt: die alte TCP-Verbindung bricht beim Wechsel, ohne Timeout wuerde
  // axios das nicht bemerken und die App "haengen". Mit Timeout wirft axios
  // ECONNABORTED -> axios-retry greift (s.u.) und wiederholt auf der neuen Verbindung.
  timeout: 20000,
});

// Automatischer Retry für transiente Fehler (5xx, 408) — NICHT für 429.
// WICHTIG: 429 (Rate-Limit) darf NICHT retried werden. Ein Retry-auf-429 zaehlt
// erneut gegen das Limit und macht die Ueberschreitung schlimmer (Retry-Lawine) —
// genau das war die Ursache fuer das sporadische "Zu viele Anfragen". Bei 429
// sagt der Server "warte", die richtige Antwort ist warten, nicht sofort 3x nachfeuern.
axiosRetry(api, {
  retries: 3,
  retryDelay: (retryCount) => {
    return axiosRetry.exponentialDelay(retryCount) + Math.random() * 200;
  },
  retryCondition: (error) => {
    const status = error.response?.status;
    if (status === 429) return false;
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
// Request-Burst beim App-Oeffnen erst in 401s und alle haengen ~1s im
// Refresh-Umweg (das war die Hauptquelle der "App haengt kurz"-Momente).
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
// als nie-aufloesende Promises haengen bleiben.
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
// Aktive Org mitsenden, damit das neue Token den Org-Claim behaelt.
const performRefresh = async (refreshToken: string): Promise<string> => {
  const activeOrgId = getActiveOrgId();
  const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
    refresh_token: refreshToken
  }, activeOrgId ? { headers: { 'X-Active-Organization': String(activeOrgId) } } : undefined);

  const { token: newToken, refresh_token: newRefreshToken } = response.data;

  // REIHENFOLGE IST KRITISCH (Android-Session-Verlust, 1.5.0):
  // Der Server rotiert bei jedem Refresh und REVOKED den alten Refresh-Token
  // sofort (Grace-Window nur 30s). Der neue Refresh-Token ist der einzige
  // langlebige (90d) Wiederherstellungs-Schluessel — geht er verloren, ist die
  // Session nach 30s unrettbar tot (kein Push-Token-Send, Chat laedt nur Stale-
  // Cache, Socket 'jwt expired'). Android killt App-Prozesse aggressiver als iOS,
  // daher MUSS der Refresh-Token ZUERST und bestaetigt persistiert werden.
  // Der Access-Token ist unkritisch: geht er bei einem Crash verloren, holt ihn
  // der naechste ensureFreshToken() ueber den (gesicherten) Refresh-Token neu.
  await setRefreshToken(newRefreshToken);
  await setToken(newToken);
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
// Refresh). Gibt bei transienten Fehlern den alten Token zurueck — die Session
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

// Handle auth errors and rate limiting
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // SICHERHEITSNETZ Multi-Org: Wenn ein Request mit aktivem Org-Header ein
    // 403 "Kein Zugriff auf diese Organisation" bekommt (z.B. Mitgliedschaft
    // entzogen, oder Token-Claim nach Refresh verloren), faellt die App auf die
    // Primaer-Org zurueck und laedt neu — statt dauerhaft alles leer zu zeigen.
    if (
      error.response?.status === 403 &&
      error.response?.data?.error === 'Kein Zugriff auf diese Organisation' &&
      getActiveOrgId()
    ) {
      // Aktive Org zuruecksetzen und den AppContext per Event zum Remount bringen
      // (KEIN window.location-Reload -> der zerschiesst den nativen WebView).
      await setActiveOrgId(null);
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

      // Offline: Token behalten, gecachte Daten nutzen
      if (!networkMonitor.isOnline) {
        console.warn('401 während Offline — Token wird behalten');
        return Promise.reject(error);
      }

      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        // Bewusster Logout laeuft → kein "Sitzung abgelaufen", einfach durchreichen.
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
        // wird der wartende Request mit dem Fehler abgewiesen (statt ewig zu haengen).
        return new Promise((resolve, reject) => {
          addRefreshSubscriber(
            (newToken: string) => {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
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

        // Original-Request mit neuem Token wiederholen
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        onTokenRefreshFailed(refreshError);

        // Bewusster Logout laeuft → kein "Sitzung abgelaufen"-Dialog.
        if (isLoggingOut()) {
          await clearAuth();
          return Promise.reject(refreshError);
        }
        // Refresh fehlgeschlagen → Re-Login-Dialog
        await clearAuth();
        window.dispatchEvent(new CustomEvent('auth:relogin-required'));
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
  }
);

export default api;