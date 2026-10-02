// storeVersion.js — ermittelt die aktuell im App Store veroeffentlichte
// App-Version fuer den Update-Hinweis in der App (GET /api/app-version).
//
// WARUM DIESELBE VERSION AUCH FUER ANDROID GILT:
// Google bietet keinen offenen Lookup; die Play-Store-Seite zu parsen ist
// erfahrungsgemaess fragil (Markup aendert sich unangekuendigt). Beide Apps
// werden aber IMMER im Gleichschritt aus derselben version.json released
// und der Apple-Review ist in der
// Regel der langsamere der beiden — wenn der App Store eine Version zeigt,
// ist sie bei Google Play praktisch immer schon durch. Der Lookup ist damit
// fuer Android eine KONSERVATIVE Untergrenze: lieber ein paar Stunden zu
// spaet hinweisen als auf ein Update, das es noch nicht gibt.
//
// FEHLERVERHALTEN: Diese Funktion wirft NIE. Ist der Store nicht erreichbar,
// kommt der letzte bekannte Wert (stale) oder null — die App zeigt dann
// schlicht keinen Hinweis. Ein Update-Hinweis ist nie so wichtig, dass er
// einen Fehler wert waere.

const BUNDLE_ID = 'de.godsapp.konfiquest';
const LOOKUP_URL = `https://itunes.apple.com/lookup?bundleId=${BUNDLE_ID}&country=de`;

// Store-Seiten der App — der Hinweis in der App verlinkt direkt dorthin.
// Die iOS-URL kommt normalerweise frisch aus dem Lookup (trackViewUrl);
// dieser Fallback greift nur, falls das Feld einmal fehlt.
const APP_STORE_URL_FALLBACK = 'https://apps.apple.com/de/app/konfi-quest/id6748016619';
const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${BUNDLE_ID}`;

// 6 Stunden Cache: Die veroeffentlichte Version aendert sich hoechstens alle
// paar Wochen — haeufiger fragen wuerde nur Apples Endpunkt belaestigen.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Nach einem Fehlschlag 5 Minuten nicht erneut versuchen, sonst haengt bei
// totem iTunes-Endpunkt JEDER /app-version-Request im 4s-Timeout.
const FEHLER_SPERRE_MS = 5 * 60 * 1000;

// Modul-lokaler Cache (eine Node-Instanz bedient alle Requests).
let cache = { wert: null, geholtAm: 0, letzterVersuch: 0 };

// Versionsformat wie in frontend/scripts/apply-version.sh: x.y oder x.y.z, nur Ziffern.
// Alles andere (leer, "Varies with device", HTML-Fetzen) gilt als Fehlschlag.
function istGueltigeVersion(v) {
  return typeof v === 'string' && /^[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(v);
}

/**
 * Liefert die im App Store veroeffentlichte Version samt Store-URL — oder
 * null, wenn sie (noch) nicht bekannt ist.
 *
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - fetch-Ersatz fuer Tests (nie echtes Netz im Test)
 * @param {number} [options.timeoutMs] - Abbruch des Lookups (Default 4000)
 * @param {Function} [options.jetzt] - Zeitquelle fuer Tests (Default Date.now)
 * @returns {Promise<{version: string, iosUrl: string} | null>}
 */
async function holeStoreVersion({ fetchImpl, timeoutMs = 4000, jetzt = Date.now } = {}) {
  const now = jetzt();

  // Frischer Cache -> direkt zurueck, kein Netz.
  if (cache.wert && now - cache.geholtAm < CACHE_TTL_MS) {
    return cache.wert;
  }
  // Letzter Versuch ist gerade erst gescheitert -> stale Wert (oder null),
  // aber nicht sofort wieder anfragen.
  if (now - cache.letzterVersuch < FEHLER_SPERRE_MS) {
    return cache.wert;
  }

  cache.letzterVersuch = now;
  const doFetch = fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(LOOKUP_URL, { signal: controller.signal });
    if (!res.ok) return cache.wert;
    const data = await res.json();
    const eintrag = data && Array.isArray(data.results) ? data.results[0] : null;
    if (!eintrag || !istGueltigeVersion(eintrag.version)) return cache.wert;
    cache = {
      wert: {
        version: eintrag.version,
        iosUrl: typeof eintrag.trackViewUrl === 'string' && eintrag.trackViewUrl.startsWith('https://')
          ? eintrag.trackViewUrl
          : APP_STORE_URL_FALLBACK,
      },
      geholtAm: now,
      letzterVersuch: now,
    };
    return cache.wert;
  } catch {
    // Netzfehler/Timeout/kaputtes JSON: letzter bekannter Wert oder null.
    return cache.wert;
  } finally {
    clearTimeout(timer);
  }
}

// Nur fuer Tests: Cache zuruecksetzen, damit sich Testfaelle nicht sehen.
function _nurFuerTests_reset() {
  cache = { wert: null, geholtAm: 0, letzterVersuch: 0 };
}

module.exports = {
  holeStoreVersion,
  _nurFuerTests_reset,
  APP_STORE_URL_FALLBACK,
  PLAY_STORE_URL,
  LOOKUP_URL,
};
