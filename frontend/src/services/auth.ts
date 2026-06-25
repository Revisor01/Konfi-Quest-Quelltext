import api from './api';
import { Device } from '@capacitor/device';
import { Capacitor } from '@capacitor/core';
import { getUser, setToken, setUser, setRefreshToken, getRefreshToken, clearAuth, getDeviceId, setDeviceId, setLoggingOut } from './tokenStore';
import { offlineCache } from './offlineCache';
import { writeQueue } from './writeQueue';
import { networkMonitor } from './networkMonitor';
import { BaseUser } from '../types/user';

// Race Condition User-Wechsel: Backend POST /device-token loescht alte Tokens
// (anderer user_id mit gleichem device_token) automatisch VOR dem INSERT.
// Frontend-seitig wird logout() mit await ausgefuehrt und blockiert bis DELETE durch ist.
export const loginWithAutoDetection = async (username: string, password: string): Promise<BaseUser> => {

  try {
    const response = await api.post('/auth/login', { username, password });
    const { token, refresh_token, user } = response.data;

    if (!token || !user) throw new Error('Fehlender Token oder Benutzer');

    await setToken(token);
    if (refresh_token) await setRefreshToken(refresh_token);
    await setUser(user);

    return user;
  } catch (error: unknown) {
    const err = error as { response?: { status?: number; statusText?: string; data?: { error?: string } }; message?: string; code?: string };
 console.error('Login fehlgeschlagen:', {
      status: err?.response?.status,
      statusText: err?.response?.statusText,
      data: err?.response?.data,
      message: err.message,
      code: err.code,
      fullError: error
    });
    throw new Error('Login fehlgeschlagen: ' + (err?.response?.data?.error || err.message));
  }
};

// ANTI-SPAM: Verhindere mehrfache Logout-Calls
let logoutInProgress = false;

// Erlaubt anderen Modulen (api.ts 401-Interceptor) zu erkennen, dass gerade ein
// BEWUSSTER Logout laeuft — dann darf ein 401 NICHT als "Sitzung abgelaufen"
// gemeldet werden (der User loggt sich ja absichtlich aus).
export const isLoggingOut = (): boolean => logoutInProgress;

export const logout = async (): Promise<void> => {
  if (logoutInProgress) {
 console.warn('Logout bereits in Bearbeitung, wird übersprungen');
    return;
  }
  
  logoutInProgress = true;
  // 401-Interceptor (api.ts) soll waehrend des bewussten Logouts NICHT
  // "Sitzung abgelaufen" melden — der Push-Cleanup-Call nach clearAuth() laeuft
  // ohne Token und liefert sonst einen 401.
  setLoggingOut(true);

  // WICHTIG: Der LOKALE Logout (Token-Revoke + clearAuth) laeuft ZUERST und
  // darf NIEMALS an haengenden Netzwerk-Calls scheitern. Frueher konnte ein
  // offline/haengender Push-Cleanup-Call clearAuth() blockieren -> User blieb
  // nach Reload eingeloggt (nur online ging es). Daher: Server-Revoke mit hartem
  // Timeout, dann clearAuth GARANTIERT, Push-Cleanup best-effort DANACH.

  // Helper: Request mit hartem Timeout, damit ein falsch-positives isOnline
  // (Network-Plugin meldet sporadisch connected trotz keiner Verbindung) nicht haengt.
  const withTimeout = <T>(p: Promise<T>, ms = 4000): Promise<T | undefined> =>
    Promise.race([p, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);

  // SEC-02: Refresh Token serverseitig revokieren (best-effort, mit Timeout)
  try {
    const refreshToken = getRefreshToken();
    if (refreshToken && networkMonitor.isOnline) {
      await withTimeout(api.post('/auth/logout', { refresh_token: refreshToken }));
    }
  } catch (error) {
    console.warn('Serverseitiges Token-Revoke fehlgeschlagen (wird lokal geloescht):', error);
  }

  // GARANTIERT: lokale Auth-Daten loeschen. Ab hier ist der User ausgeloggt.
  await clearAuth();
  try {
    await offlineCache.clearAll();
  } catch (error) {
    console.warn('Cache-Clear beim Logout fehlgeschlagen:', error);
  }

  // Push-Token-Cleanup NACH dem lokalen Logout (blockiert ihn nicht mehr).
  try {
    let deviceId: string | undefined;
    if (Capacitor.isNativePlatform()) {
      try {
        const deviceInfo = await Device.getId();
        deviceId = deviceInfo.identifier;
      } catch (err) {
        console.warn('Could not get device ID via Capacitor, using TokenStore fallback:', err);
        deviceId = getDeviceId() || undefined;
      }
    } else {
      deviceId = getDeviceId() || undefined;
    }

    if (deviceId) {
      const deleteData = { device_id: deviceId, platform: Capacitor.getPlatform() };
      let delivered = false;
      if (networkMonitor.isOnline) {
        try {
          await withTimeout(api.delete('/notifications/device-token', { data: deleteData }));
          delivered = true;
        } catch { /* in Queue fallen lassen */ }
      }
      if (!delivered) {
        await writeQueue.enqueue({
          method: 'DELETE',
          url: '/notifications/device-token',
          body: deleteData,
          maxRetries: 3,
          hasFileUpload: false,
          metadata: { type: 'fire-and-forget', clientId: `push_cleanup_${Date.now()}`, label: 'Push-Token entfernen' }
        });
      }
    }
  } catch (error) {
    console.warn('Push-Token-Cleanup beim Logout fehlgeschlagen (unkritisch):', error);
  }

  // Device ID NICHT loeschen - bleibt fuer das Geraet persistent
  logoutInProgress = false;
  // Kurz verzoegert zuruecksetzen, damit auch ein knapp nachlaufender 401 vom
  // Push-Cleanup noch unterdrueckt wird, dann wieder normales Verhalten.
  setTimeout(() => setLoggingOut(false), 2000);
};

export const checkAuth = (): BaseUser | null => {
  return getUser();
};

export const checkAuthAsync = async (): Promise<BaseUser | null> => {
  return getUser();
};

