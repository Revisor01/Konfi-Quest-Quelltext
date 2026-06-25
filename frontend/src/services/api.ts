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

// Add token to requests (synchron aus Memory-Cache)
api.interceptors.request.use((config) => {
  const token = getToken();
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

// Verhindere parallele Refresh-Requests
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

const onTokenRefreshed = (token: string) => {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
};

const addRefreshSubscriber = (cb: (token: string) => void) => {
  refreshSubscribers.push(cb);
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
        // Anderer Request refresht bereits → warten
        return new Promise((resolve) => {
          addRefreshSubscriber((newToken: string) => {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            resolve(api(originalRequest));
          });
        });
      }

      isRefreshing = true;

      try {
        // Refresh-Versuch mit direktem axios (nicht api, um Interceptor-Loop zu vermeiden).
        // Aktive Org mitsenden, damit das neue Token den Org-Claim behaelt.
        const activeOrgId = getActiveOrgId();
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken
        }, activeOrgId ? { headers: { 'X-Active-Organization': String(activeOrgId) } } : undefined);

        const { token: newToken, refresh_token: newRefreshToken } = response.data;
        await setToken(newToken);
        await setRefreshToken(newRefreshToken);

        isRefreshing = false;
        onTokenRefreshed(newToken);

        // Original-Request mit neuem Token wiederholen
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        refreshSubscribers = [];

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