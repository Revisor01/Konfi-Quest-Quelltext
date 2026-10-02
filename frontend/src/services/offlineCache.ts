import { Preferences } from '@capacitor/preferences';
import { getUser } from './tokenStore';

const CACHE_PREFIX = 'cache:';

// Der gespeicherte Stand gehört zum Konto:
// Jeder Schlüssel trägt die Kennung des angemeldeten Kontos.
// Der bewusste Logout leert den Cache; eine ABGELAUFENE Sitzung nicht — meldete
// sich danach jemand anderes am Gerät an, zeigte die App dessen Listen und
// Chat-Verläufe der vorigen Person. Mit der Kennung im Schlüssel findet ein
// anderes Konto nichts, dieselbe Person nach neuer Anmeldung ihren Stand.
// Einträge aus der Zeit davor (ohne Kennung) findet niemand mehr; sie werden
// neu geladen und beim nächsten Konto-Abgleich entfernt.
const kontoPraefix = (): string => `${CACHE_PREFIX}${getUser()?.id ?? '-'}:`;
const schluessel = (key: string): string => kontoPraefix() + key;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export const CACHE_TTL = {
  DASHBOARD: 5 * 60 * 1000,         // 5 Min
  EVENTS: 10 * 60 * 1000,           // 10 Min
  CHAT_ROOMS: 2 * 60 * 1000,        // 2 Min
  CHAT_MESSAGES: 60 * 60 * 1000,    // 1 Std
  STAMMDATEN: 60 * 60 * 1000,       // 1 Std
  PROFILE: 15 * 60 * 1000,          // 15 Min
  BADGES: 30 * 60 * 1000,           // 30 Min
  REQUESTS: 5 * 60 * 1000,          // 5 Min
  SETTINGS: 30 * 60 * 1000,         // 30 Min
  TAGESLOSUNG: 24 * 60 * 60 * 1000, // 24 Std
  KONFIS: 5 * 60 * 1000,            // 5 Min
};

async function get<T>(key: string): Promise<CacheEntry<T> | null> {
  const prefKey = schluessel(key);
  try {
    const result = await Preferences.get({ key: prefKey });
    if (!result.value) return null;
    return JSON.parse(result.value) as CacheEntry<T>;
  } catch {
    // Korruptes JSON — Key löschen und null zurückgeben
    await Preferences.remove({ key: prefKey });
    return null;
  }
}

async function set<T>(key: string, data: T, ttl: number): Promise<void> {
  const prefKey = schluessel(key);
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    ttl,
  };
  await Preferences.set({ key: prefKey, value: JSON.stringify(entry) });
}

function isStale(entry: CacheEntry<unknown>): boolean {
  return Date.now() - entry.timestamp > entry.ttl;
}

async function remove(key: string): Promise<void> {
  const prefKey = schluessel(key);
  await Preferences.remove({ key: prefKey });
}

async function clearAll(): Promise<void> {
  const { keys } = await Preferences.keys();
  const cacheKeys = keys.filter(k => k.startsWith(CACHE_PREFIX));
  for (const key of cacheKeys) {
    await Preferences.remove({ key });
  }
}

/**
 * Entfernt den gespeicherten Stand aller ANDEREN Konten (und Einträge ohne
 * Kennung aus der Zeit vor der Kontobindung) — beim Konto-Abgleich nach der
 * Anmeldung. Ohne angemeldetes Konto tut es nichts.
 */
async function fremdeKontenEntfernen(): Promise<void> {
  if (getUser()?.id === undefined || getUser()?.id === null) return;
  const eigenes = kontoPraefix();
  const { keys } = await Preferences.keys();
  for (const key of keys) {
    if (key.startsWith(CACHE_PREFIX) && !key.startsWith(eigenes)) {
      await Preferences.remove({ key });
    }
  }
}

async function invalidateAll(): Promise<void> {
  const { keys } = await Preferences.keys();
  const cacheKeys = keys.filter(k => k.startsWith(CACHE_PREFIX));
  for (const key of cacheKeys) {
    try {
      const result = await Preferences.get({ key });
      if (!result.value) continue;
      const entry = JSON.parse(result.value) as CacheEntry<unknown>;
      entry.timestamp = 0; // Macht isStale() => true
      await Preferences.set({ key, value: JSON.stringify(entry) });
    } catch {
      // Korrupter Eintrag — ignorieren
    }
  }
}

export const offlineCache = {
  get,
  set,
  isStale,
  remove,
  clearAll,
  invalidateAll,
  fremdeKontenEntfernen,
};
