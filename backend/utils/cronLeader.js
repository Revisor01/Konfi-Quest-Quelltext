// backend/utils/cronLeader.js
//
// Wahl der Replica, die die Hintergrund-Jobs faehrt -- per Postgres-Advisory-Lock.
//
// JETZT: Jede Replica, die Jobs fahren DARF (RUN_BACKGROUND_JOBS nicht
// 'false'), versucht im Takt `pg_try_advisory_lock(CRON_LEADER_LOCK_ID)` auf
// einer EIGENEN Verbindung. Wer den Lock haelt, ist Leader und startet die
// Jobs. Stirbt der Leader (Prozess, Container, Netz), gibt Postgres den
// Session-Lock frei, und die naechste Replica bekommt ihn beim naechsten Takt.
// Bricht die Datenbankverbindung des Leaders ab, gilt der Lock als verloren:
// die Jobs werden angehalten, die Verbindung neu aufgebaut, die Wahl beginnt
// von vorn -- sonst liefen nach einem Datenbank-Neustart zwei Leader.
//
// Sichtbar in GET /api/status: `cron_leader` (diese Replica) und
// `checks.cron_leader` ('ok', wenn irgendein Prozess den Lock haelt --
// abgelesen aus pg_locks, also von JEDER Replica aus beantwortbar).
//
// Eigene Verbindung statt Pool-Client: Ein Session-Lock haengt an der
// Verbindung; ein dauerhaft ausgecheckter Pool-Client naehme der App einen
// Platz weg (database.js rechnet mit dieser einen Verbindung je Replica).

const { Client } = require('pg');

// App-weite Lock-ID (beliebig, aber fest; 723001 ist der Migrations-Lock).
const CRON_LEADER_LOCK_ID = 723002;

/**
 * Startet die Leader-Wahl und liefert Zugriff auf ihren Zustand.
 *
 * @param {object} optionen
 * @param {() => import('pg').Client} [optionen.verbinde]  Fabrik fuer die eigene Verbindung
 *        (Standard: neuer pg.Client auf DATABASE_URL)
 * @param {number} [optionen.taktMs]  Abstand der Versuche/Pruefungen (Standard 10 s)
 * @param {() => void} optionen.beiUebernahme  Diese Replica ist Leader geworden (Jobs starten)
 * @param {() => void} optionen.beiVerlust     Leader-Rolle verloren (Jobs anhalten)
 * @param {{warn: Function, error: Function}} [optionen.log]
 */
function starteCronLeaderWahl({
  verbinde = () => new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '5000', 10),
    application_name: 'konfi-cron-leader',
  }),
  taktMs = parseInt(process.env.CRON_LEADER_TAKT_MS || '10000', 10),
  beiUebernahme = () => {},
  beiVerlust = () => {},
  log = console,
} = {}) {
  let client = null;
  let leader = false;
  let laeuft = true;
  // Promise des gerade laufenden Takts (oder null). stopp() wartet darauf,
  // damit kein Takt NACH dem Stopp noch den Lock nimmt und die Jobs startet
  // -- genau das passierte, wenn SIGTERM kam, waehrend der erste Takt noch
  // seine Verbindung aufbaute.
  let laufenderTakt = null;

  const rolleVerloren = (grund) => {
    if (!leader) return;
    leader = false;
    log.warn(`Cron-Leader: Rolle verloren (${grund}) -- Hintergrund-Jobs angehalten.`);
    try { beiVerlust(); } catch (err) { log.error('Cron-Leader: beiVerlust fehlgeschlagen:', err.message); }
  };

  const verbindungWegwerfen = () => {
    const alt = client;
    client = null;
    if (alt) {
      alt.removeAllListeners('end');
      alt.end().catch(() => {});
    }
  };

  async function verbinden() {
    const c = verbinde();
    // Ohne 'error'-Zuhoerer wuerde ein Verbindungsabbruch als uncaughtException
    // den Prozess beenden.
    c.on('error', (err) => {
      log.error('Cron-Leader: Verbindung zur Datenbank verloren:', err.message);
    });
    c.on('end', () => {
      if (client !== c) return; // schon ersetzt
      client = null;
      rolleVerloren('Verbindung beendet');
    });
    await c.connect();
    client = c;
  }

  async function einTakt() {
    try {
      if (!client) await verbinden();
      // Waehrend des Verbindens gestoppt? Dann nichts mehr anfassen.
      if (!laeuft) { verbindungWegwerfen(); return; }
      if (!leader) {
        const { rows: [r] } = await client.query(
          'SELECT pg_try_advisory_lock($1) AS gewonnen',
          [CRON_LEADER_LOCK_ID]
        );
        if (r.gewonnen && !laeuft) {
          // Zwischen Abfrage und Antwort gestoppt: Lock sofort zurueckgeben.
          await client.query('SELECT pg_advisory_unlock($1)', [CRON_LEADER_LOCK_ID]).catch(() => {});
          verbindungWegwerfen();
          return;
        }
        if (r.gewonnen) {
          leader = true;
          log.warn('Cron-Leader: Lock bekommen -- diese Replica faehrt die Hintergrund-Jobs.');
          try { beiUebernahme(); } catch (err) { log.error('Cron-Leader: beiUebernahme fehlgeschlagen:', err.message); }
        }
      } else {
        // Lebt die Verbindung noch? Ein Abbruch faellt sonst erst beim
        // naechsten Ereignis auf; hier wird er im Takt erkannt.
        await client.query('SELECT 1');
      }
    } catch (err) {
      if (laeuft) log.error('Cron-Leader: Takt fehlgeschlagen:', err.message);
      verbindungWegwerfen();
      rolleVerloren('Fehler im Takt');
    }
  }

  function takt() {
    if (!laeuft) return Promise.resolve();
    if (laufenderTakt) return laufenderTakt;
    laufenderTakt = einTakt().finally(() => { laufenderTakt = null; });
    return laufenderTakt;
  }

  const timer = setInterval(() => { takt().catch(() => {}); }, taktMs);
  timer.unref();
  const ersterTakt = takt();

  return {
    /** true, wenn DIESE Replica gerade den Lock haelt. */
    istLeader: () => leader,
    /** Promise des ersten Versuchs -- fuer Tests und geordnete Starts. */
    bereit: ersterTakt,
    /** Naechsten Versuch sofort ausfuehren (Tests). */
    takt,
    /**
     * Wahl beenden, Lock abgeben, Verbindung schliessen. Haelt diese Replica
     * den Lock, ruft das beiVerlust -- die Jobs stehen danach.
     */
    async stopp() {
      laeuft = false;
      clearInterval(timer);
      // Einen laufenden Takt zu Ende kommen lassen -- er sieht laeuft=false
      // und nimmt den Lock nicht mehr (oder gibt ihn sofort zurueck).
      if (laufenderTakt) await laufenderTakt.catch(() => {});
      const c = client;
      if (c) {
        try {
          if (leader) await c.query('SELECT pg_advisory_unlock($1)', [CRON_LEADER_LOCK_ID]);
        } catch (_) { /* Verbindung evtl. tot -- Postgres gibt den Lock dann selbst frei */ }
      }
      verbindungWegwerfen();
      rolleVerloren('Stopp');
    },
  };
}

/**
 * Haelt IRGENDEIN Prozess den Cron-Leader-Lock? Aus pg_locks abgelesen,
 * deshalb von jeder Replica aus beantwortbar -- fuer /api/status und eine
 * externe Ueberwachung.
 *
 * pg_try_advisory_lock(bigint) legt den Schluessel als classid = obere,
 * objid = untere 32 Bit ab, objsubid = 1.
 */
async function cronLeaderVorhanden(db) {
  const { rows: [r] } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND granted
          AND classid = $1 AND objid = $2 AND objsubid = 1
     ) AS vorhanden`,
    // eslint-disable-next-line no-bitwise
    [Math.floor(CRON_LEADER_LOCK_ID / 2 ** 32), CRON_LEADER_LOCK_ID % 2 ** 32]
  );
  return r.vorhanden === true;
}

module.exports = { CRON_LEADER_LOCK_ID, starteCronLeaderWahl, cronLeaderVorhanden };
