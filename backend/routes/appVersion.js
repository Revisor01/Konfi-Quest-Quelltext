// appVersion.js — GET /api/app-version: meldet der App, welche Version
// aktuell in den Stores veroeffentlicht ist (fuer den dezenten Update-Hinweis).
//
// BEWUSST OHNE AUTHENTIFIZIERUNG (wie /api/health und /api/status):
// Die veroeffentlichte Store-Version ist oeffentlich — jede:r kann sie im
// Store nachsehen. Der Hinweis soll ausserdem VOR dem Login funktionieren
// koennen; eine Auth-Pflicht wuerde nur die Antwortkette verkomplizieren.
// Der globale Rate-Limiter (createApp) gilt trotzdem.
//
// ANTWORTFORM (Vertrag fuer ausgelieferte Apps, nie aendern, nur ergaenzen):
//   {
//     "ios":     { "version": "2.1.1" | null, "url": "https://apps.apple.com/..." },
//     "android": { "version": "2.1.1" | null, "url": "https://play.google.com/..." }
//   }
// version=null heisst: Store-Version gerade nicht bekannt (Lookup down) —
// die App zeigt dann einfach keinen Hinweis. Beide Plattformen tragen
// dieselbe Version, weil beide Apps im Gleichschritt aus version.json
// released werden (Begruendung in utils/storeVersion.js). Getrennte Felder
// trotzdem von Anfang an, damit ein spaeterer plattformgetrennter Abgleich
// KEINE Formaenderung braucht.

const express = require('express');
const {
  holeStoreVersion: holeStoreVersionStandard,
  APP_STORE_URL_FALLBACK,
  PLAY_STORE_URL,
} = require('../utils/storeVersion');

module.exports = (deps = {}) => {
  // Injektion fuer Tests: nie echtes Netz im Test (Muster wie musikLinks).
  const holeStoreVersion = deps.holeStoreVersion || holeStoreVersionStandard;
  const router = express.Router();

  router.get('/', async (req, res) => {
    const store = await holeStoreVersion();
    res.json({
      ios: {
        version: store ? store.version : null,
        url: store && store.iosUrl ? store.iosUrl : APP_STORE_URL_FALLBACK,
      },
      android: {
        version: store ? store.version : null,
        url: PLAY_STORE_URL,
      },
    });
  });

  return router;
};
