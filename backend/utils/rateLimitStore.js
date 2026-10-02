// backend/utils/rateLimitStore.js
//
// Gemeinsamer Zaehler-Speicher fuer express-rate-limit auf der vorhandenen
// Postgres -- damit alle Replicas DENSELBEN Zaehler fuehren.
//
// ANLASS: Alle
// rateLimit(...)-Bloecke in server.js liefen ohne `store`, also mit dem
// MemoryStore je Prozess. Hinter Traefik mit zwei Replicas (~50/50) galt damit
// jedes Limit doppelt: 40 statt 20 Doku-Passwort-Versuche, 600 statt 300
// Login-Fehlversuche, 120 statt 60 Chat-Nachrichten je Minute -- und 429 kam
// scheinbar zufaellig, je nachdem, welche Replica gerade "voll" war.
// Reproduziert: 21 falsche Doku-Passwoerter an A -> 429, direkt danach an
// B -> 401.
//
// KEIN REDIS im Stack, und das Paket rate-limit-postgresql ist ueber den
// Proxy nicht installierbar (404). Der Store hier ist bewusst klein: ein
// INSERT ... ON CONFLICT DO UPDATE je Treffer auf einer UNLOGGED-Tabelle
// (Migration 167), Fenster-Ablauf in derselben Anweisung, Aufraeumen abgelaufener
// Zeilen im Hintergrund.
//
// FAELLT DIE DATENBANK AUS, zaehlt der Store im Speicher weiter (MemoryStore
// je Prozess -- exakt das Verhalten vor diesem Umbau). Fail-open waere falsch:
// Der Doku-Limiter schuetzt ein Passwort, dessen Pruefung KEINE Datenbank
// braucht; ohne Zaehler liesse es sich waehrend eines Ausfalls durchprobieren.
//
// Schnittstelle: express-rate-limit 8 `Store` (init, increment, decrement,
// resetKey, resetAll, get, shutdown, localKeys=false). Jeder Limiter bekommt
// SEINE EIGENE Instanz mit eigenem Praefix -- express-rate-limit warnt sonst
// vor geteilten Stores (ERR_ERL_STORE_REUSE), und der Schluesselraum bliebe
// nicht getrennt.

const { MemoryStore } = require('express-rate-limit');

const TABELLE = 'rate_limit_zaehler';

// Abgelaufene Zeilen werden je Prozess hoechstens so oft weggeraeumt. Ein
// Timer je Prozess, nicht je Limiter -- das DELETE ist fuer alle dasselbe.
const AUFRAEUM_INTERVALL_MS = 10 * 60 * 1000;
let aufraeumTimer = null;
let aufraeumDb = null;

async function aufraeumen(db) {
  const { rowCount } = await db.query(`DELETE FROM ${TABELLE} WHERE ablauf < NOW() - interval '1 hour'`);
  return rowCount;
}

function starteAufraeumen(db) {
  if (aufraeumTimer) return;
  aufraeumDb = db;
  aufraeumTimer = setInterval(() => {
    aufraeumen(aufraeumDb).catch((err) => {
      console.error('Rate-Limiter: Aufraeumen abgelaufener Zaehler fehlgeschlagen:', err.message);
    });
  }, AUFRAEUM_INTERVALL_MS);
  aufraeumTimer.unref();
}

function stoppeAufraeumen() {
  if (aufraeumTimer) {
    clearInterval(aufraeumTimer);
    aufraeumTimer = null;
  }
}

class PostgresRateLimitStore {
  /**
   * @param {{query: Function}} db  database.js-Singleton oder Test-Pool
   * @param {object} optionen
   * @param {string} optionen.prefix  Name des Limiters (Schluesselraum)
   * @param {Function} [optionen.log]  Logger fuer den Rueckfall (Standard console.error)
   */
  constructor(db, { prefix, log = console.error } = {}) {
    if (!prefix) throw new Error('PostgresRateLimitStore braucht ein prefix je Limiter');
    this.db = db;
    this.prefix = prefix;
    this.log = log;
    this.windowMs = 60 * 1000;
    // Zaehler, die dieser Prozess vergibt, gelten fuer alle -- das ist der Sinn.
    this.localKeys = false;
    // Rueckfall bei Datenbankfehlern: derselbe Speicher wie vor dem Umbau.
    this.notfall = new MemoryStore();
    this.imNotfall = false;
    this.letzteWarnungMs = 0;
  }

  init(options) {
    this.windowMs = options.windowMs;
    this.notfall.init(options);
    starteAufraeumen(this.db);
  }

  schluessel(key) {
    return `${this.prefix}:${key}`;
  }

  // Datenbankfehler: einmal je Minute melden, dann still im Speicher zaehlen.
  rueckfall(err) {
    const jetzt = Date.now();
    if (jetzt - this.letzteWarnungMs > 60 * 1000) {
      this.letzteWarnungMs = jetzt;
      this.log(`Rate-Limiter ${this.prefix}: Datenbank nicht erreichbar, zaehle je Replica im Speicher weiter:`, err.message);
    }
    this.imNotfall = true;
  }

  async increment(key) {
    try {
      const { rows: [r] } = await this.db.query(
        `INSERT INTO ${TABELLE} (schluessel, treffer, ablauf)
         VALUES ($1, 1, NOW() + ($2::int * interval '1 millisecond'))
         ON CONFLICT (schluessel) DO UPDATE SET
           treffer = CASE WHEN ${TABELLE}.ablauf <= NOW() THEN 1
                          ELSE ${TABELLE}.treffer + 1 END,
           ablauf  = CASE WHEN ${TABELLE}.ablauf <= NOW() THEN NOW() + ($2::int * interval '1 millisecond')
                          ELSE ${TABELLE}.ablauf END
         RETURNING treffer, ablauf`,
        [this.schluessel(key), this.windowMs]
      );
      this.imNotfall = false;
      return { totalHits: r.treffer, resetTime: new Date(r.ablauf) };
    } catch (err) {
      this.rueckfall(err);
      return this.notfall.increment(key);
    }
  }

  async decrement(key) {
    try {
      await this.db.query(
        `UPDATE ${TABELLE} SET treffer = GREATEST(treffer - 1, 0) WHERE schluessel = $1`,
        [this.schluessel(key)]
      );
    } catch (err) {
      this.rueckfall(err);
      this.notfall.decrement(key);
    }
  }

  async get(key) {
    try {
      const { rows: [r] } = await this.db.query(
        `SELECT treffer, ablauf FROM ${TABELLE} WHERE schluessel = $1 AND ablauf > NOW()`,
        [this.schluessel(key)]
      );
      return r ? { totalHits: r.treffer, resetTime: new Date(r.ablauf) } : undefined;
    } catch (err) {
      this.rueckfall(err);
      return this.notfall.get(key);
    }
  }

  async resetKey(key) {
    try {
      await this.db.query(`DELETE FROM ${TABELLE} WHERE schluessel = $1`, [this.schluessel(key)]);
    } catch (err) {
      this.rueckfall(err);
    }
    this.notfall.resetKey(key);
  }

  async resetAll() {
    try {
      await this.db.query(`DELETE FROM ${TABELLE} WHERE schluessel LIKE $1`, [`${this.prefix}:%`]);
    } catch (err) {
      this.rueckfall(err);
    }
    this.notfall.resetAll();
  }

  shutdown() {
    this.notfall.shutdown();
    stoppeAufraeumen();
  }
}

module.exports = { PostgresRateLimitStore, aufraeumen, stoppeAufraeumen, TABELLE };
