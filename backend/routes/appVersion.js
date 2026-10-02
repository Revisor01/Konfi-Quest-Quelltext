// appVersion.js — GET /api/app-version: meldet der App, welche Version
// aktuell in den Stores veroeffentlicht ist (fuer den dezenten Update-Hinweis),
// ab welcher Version sie noch unterstuetzt wird und ob ein Wartungshinweis
// ansteht.
//
// BEWUSST OHNE AUTHENTIFIZIERUNG (wie /api/health und /api/status):
// Die veroeffentlichte Store-Version ist oeffentlich — jede:r kann sie im
// Store nachsehen. Der Hinweis soll ausserdem VOR dem Login funktionieren
// koennen; eine Auth-Pflicht wuerde nur die Antwortkette verkomplizieren.
// Der globale Rate-Limiter (createApp) gilt trotzdem.

const express = require('express');
const {
  holeStoreVersion: holeStoreVersionStandard,
  APP_STORE_URL_FALLBACK,
  PLAY_STORE_URL,
} = require('../utils/storeVersion');
const { betriebshinweise } = require('../utils/betriebshinweise');

module.exports = (deps = {}) => {
  // Injektion fuer Tests: nie echtes Netz im Test (Muster wie musikLinks).
  const holeStoreVersion = deps.holeStoreVersion || holeStoreVersionStandard;
  const router = express.Router();

  router.get('/', async (req, res) => {
    const store = await holeStoreVersion();
    // Bei JEDER Anfrage aus der Umgebung, nicht beim Start gemerkt.
    const hinweise = betriebshinweise(process.env);
    res.json({
      ios: {
        version: store ? store.version : null,
        url: store && store.iosUrl ? store.iosUrl : APP_STORE_URL_FALLBACK,
        min_version: hinweise.minVersion.ios,
      },
      android: {
        version: store ? store.version : null,
        url: PLAY_STORE_URL,
        min_version: hinweise.minVersion.android,
      },
      wartung: hinweise.wartung,
    });
  });

  return router;
};
