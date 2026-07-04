import { Preferences } from '@capacitor/preferences';
import { BaseUser } from '../types/user';

// In-Memory-Cache — synchrone Reads, async Writes nach Preferences
let _token: string | null = null;
let _user: BaseUser | null = null;
let _deviceId: string | null = null;
let _pushTokenTimestamp: number = 0;
let _refreshToken: string | null = null;
// Aktive Multi-Org (Org-Switcher). null = Primaer-Org. Wird als Header
// X-Active-Organization bei jedem Request mitgesendet (api.ts).
let _activeOrgId: number | null = null;
// Markiert einen BEWUSSTEN Logout. Solange true, darf ein 401 (z.B. vom
// Push-Token-Cleanup nach clearAuth) NICHT als "Sitzung abgelaufen" gemeldet
// werden. Liegt hier statt in auth.ts, um Circular-Import mit api.ts zu vermeiden.
let _loggingOut: boolean = false;

// --- Synchrone Getter (lesen nur aus Memory) ---

export const getToken = (): string | null => _token;

export const isLoggingOut = (): boolean => _loggingOut;

export const setLoggingOut = (value: boolean): void => { _loggingOut = value; };

export const getUser = (): BaseUser | null => _user;

export const getDeviceId = (): string | null => _deviceId;

export const getPushTokenTimestamp = (): number => _pushTokenTimestamp;

export const getRefreshToken = (): string | null => _refreshToken;

export const getActiveOrgId = (): number | null => _activeOrgId;

// --- Async Setter (schreiben in Memory + Preferences) ---

export const setToken = async (token: string): Promise<void> => {
  _token = token;
  await Preferences.set({ key: 'konfi_token', value: token });
};

export const setUser = async (user: BaseUser): Promise<void> => {
  _user = user;
  await Preferences.set({ key: 'konfi_user', value: JSON.stringify(user) });
};

export const setDeviceId = async (id: string): Promise<void> => {
  _deviceId = id;
  await Preferences.set({ key: 'device_id', value: id });
};

export const setPushTokenTimestamp = async (ts: number): Promise<void> => {
  _pushTokenTimestamp = ts;
  await Preferences.set({ key: 'push_token_last_refresh', value: ts.toString() });
};

export const setRefreshToken = async (token: string): Promise<void> => {
  _refreshToken = token;
  await Preferences.set({ key: 'konfi_refresh_token', value: token });
};

// Aktive Org setzen (null = zurueck zur Primaer-Org). Synchroner Memory-Write
// fuer den Request-Interceptor + async Persistenz.
export const setActiveOrgId = async (orgId: number | null): Promise<void> => {
  _activeOrgId = orgId;
  if (orgId === null) {
    await Preferences.remove({ key: 'konfi_active_org' });
  } else {
    await Preferences.set({ key: 'konfi_active_org', value: String(orgId) });
  }
};

// --- Auth löschen (Device-ID bleibt erhalten) ---

export const clearAuth = async (): Promise<void> => {
  _token = null;
  _user = null;
  _refreshToken = null;
  _activeOrgId = null;
  // Push-Sendefenster zuruecksetzen: Nach Logout+Login muss der FCM-Token
  // SOFORT neu registriert werden koennen (Server haengt ihn dann an den neuen
  // User um) — sonst blockt das 12h-Fenster und der alte Account bekommt
  // weiter Pushes auf diesem Geraet.
  _pushTokenTimestamp = 0;
  await Preferences.remove({ key: 'konfi_token' });
  await Preferences.remove({ key: 'konfi_user' });
  await Preferences.remove({ key: 'konfi_refresh_token' });
  await Preferences.remove({ key: 'konfi_active_org' });
  await Preferences.remove({ key: 'push_token_last_refresh' });
};

// --- Initialisierung: Preferences -> Memory laden ---

export const initTokenStore = async (): Promise<void> => {
  const tokenResult = await Preferences.get({ key: 'konfi_token' });
  _token = tokenResult.value;

  const userResult = await Preferences.get({ key: 'konfi_user' });
  if (userResult.value) {
    try {
      _user = JSON.parse(userResult.value);
    } catch {
      console.error('Fehler beim Parsen von konfi_user aus Preferences');
      _user = null;
      await Preferences.remove({ key: 'konfi_user' });
    }
  }

  const deviceIdResult = await Preferences.get({ key: 'device_id' });
  _deviceId = deviceIdResult.value;

  const pushResult = await Preferences.get({ key: 'push_token_last_refresh' });
  _pushTokenTimestamp = pushResult.value ? parseInt(pushResult.value, 10) || 0 : 0;

  const refreshResult = await Preferences.get({ key: 'konfi_refresh_token' });
  _refreshToken = refreshResult.value;

  const activeOrgResult = await Preferences.get({ key: 'konfi_active_org' });
  _activeOrgId = activeOrgResult.value ? parseInt(activeOrgResult.value, 10) || null : null;
};
