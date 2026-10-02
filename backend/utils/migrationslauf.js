// backend/utils/migrationslauf.js
//
// Der Migrationslauf beim Start: Advisory-Lock, dann jede noch nicht
// vermerkte Datei aus backend/migrations/ in EINER Transaktion.
//
// Herausgeloest aus database.js, damit er testbar ist: Er nimmt
// den Pool und das Verzeichnis entgegen, statt am Modul-Singleton zu haengen.
//
// ZEITGRENZEN. Der App-Pool setzt
// statement_timeout und query_timeout auf 30 s (database.js) -- richtig fuer
// den Anfragepfad, falsch fuer diese beiden Verbindungen:
//
//   - Die WARTENDE Replica rief pg_advisory_lock ueber eine Pool-Verbindung
//     mit 30-s-Grenze auf. Dauerte der Lauf der ersten Replica laenger,
//     brach Postgres den Lock-Aufruf ab (57014), database.js wertete das als
//     "DB nicht erreichbar" und beendete den Prozess; restart: unless-stopped
//     startete ihn neu -- und er wartete wieder 30 s. Reproduziert: Exit 1
//     nach 31 s.
//   - Jedes Statement einer Migration unterlag derselben Grenze. Ein Backfill
//     oder CREATE INDEX ueber Millionen Zeilen bei 0,3 CPU scheiterte, der
//     Server startete trotzdem mit dem alten Schema, und der einzige Hinweis
//     stand im Container-Log.
//
// Beide Verbindungen laufen jetzt OHNE statement_timeout und mit einem
// query_timeout, der nur noch gegen einen wirklich abgerissenen Server
// schuetzt (Stunden statt Sekunden). Dafuer bekommt die Migrationsverbindung
// ein lock_timeout: Eine Migration, die auf eine von der laufenden Anwendung
// gehaltene Sperre wartet, soll nach kurzer Zeit scheitern (und beim
// naechsten Start erneut versucht werden), statt den Start aller Replicas
// anzuhalten. Die Verbindungen werden nach Gebrauch VERWORFEN (release mit
// Fehler), nicht in den Pool zurueckgegeben -- sonst liefe spaeter eine
// beliebige App-Abfrage ohne Zeitgrenze.

const path = require('path');
const fs = require('fs');

// App-weite Lock-ID für den Migrations-Advisory-Lock (beliebig, aber fest).
const MIGRATION_ADVISORY_LOCK_ID = 723001;

// Clientseitige Grenze fuer Lock- und Migrationsabfragen: sechs Stunden.
// Sie faengt nur noch den Fall, dass der Server gar nicht mehr antwortet.
const OHNE_GRENZE_MS = 6 * 60 * 60 * 1000;

// Standard-Verzeichnis der Migrationen, relativ zu backend/.
const STANDARD_VERZEICHNIS = path.join(__dirname, '..', 'migrations');

// Ergebnis des letzten Laufs in diesem Prozess -- fuer GET /api/status
// (checks.migrations), damit eine uebersprungene Migration nicht nur im
// Container-Log steht.
let letzterLauf = null;

/**
 * Holt eine Pool-Verbindung und stellt sie fuer lange Statements frei.
 * Rueckgabe ist ein schmaler Wrapper: query(text, values) ohne 30-s-Grenze,
 * verwerfen() gibt die Verbindung MIT Fehler zurueck (pg-pool schliesst sie).
 */
async function verbindungOhneZeitgrenzen(pool, { lockTimeoutMs }) {
  const client = await pool.connect();
  const query = (text, values) => client.query({ text, values, query_timeout: OHNE_GRENZE_MS });
  try {
    await query('SET statement_timeout = 0');
    await query(`SET lock_timeout = ${Math.max(0, Math.floor(lockTimeoutMs))}`);
  } catch (err) {
    client.release(err);
    throw err;
  }
  return {
    query,
    verwerfen: () => client.release(new Error('Migrationsverbindung verworfen (Zeitgrenzen waren abgeschaltet)')),
  };
}

/**
 * Fuehrt alle offenen Migrationen aus -- unter dem Advisory-Lock.
 *
 * @param {import('pg').Pool} pool
 * @param {object} [optionen]
 * @param {string} [optionen.verzeichnis]   Migrationsverzeichnis (Standard backend/migrations)
 * @param {number} [optionen.lockTimeoutMs] lock_timeout fuer Migrations-Statements (Standard PG_MIGRATION_LOCK_TIMEOUT oder 10 s)
 * @param {{log: Function, error: Function}} [optionen.logger]
 * @returns {Promise<{neu: number, gesamt: number, fehlgeschlagen: Array<{file: string, message: string}>}>}
 */
async function fuehreMigrationenAus(pool, optionen = {}) {
  const verzeichnis = optionen.verzeichnis || STANDARD_VERZEICHNIS;
  const lockTimeoutMs = optionen.lockTimeoutMs
    ?? parseInt(process.env.PG_MIGRATION_LOCK_TIMEOUT || '10000', 10);
  const logger = optionen.logger || console;

  // Advisory-Lock: Beide Backend-Replikas starten beim Deploy
  // PARALLEL und rasten sonst um neue Migrationen (beobachtet bei Migration 109:
  // eine Replika gewann, die andere warf duplicate-key auf pg_type). Der Lock
  // serialisiert die Läufe; die zweite Replika liest danach die frisch
  // eingetragenen schema_migrations und ueberspringt sauber.
  // Session-Lock auf dedizierter Connection — wird im finally freigegeben,
  // bei Prozess-Tod räumt Postgres den Lock automatisch.
  const lock = await verbindungOhneZeitgrenzen(pool, { lockTimeoutMs: 0 });
  try {
    try {
      await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
    } catch (err) {
      // Nicht "DB nicht erreichbar": Die Verbindung steht, der Lock kam nicht.
      throw new Error(`Migrations-Lock nicht bekommen: ${err.message}`, { cause: err });
    }

    // Tracking-Tabelle sicherstellen (idempotent)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const ergebnis = await fuehreMigrationenUnterLockAus(pool, { verzeichnis, lockTimeoutMs, logger });
    letzterLauf = { ...ergebnis, zeitpunkt: new Date().toISOString() };
    return ergebnis;
  } finally {
    try {
      await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
    } catch (unlockErr) {
      // Connection evtl. tot — Postgres gibt Session-Locks dann selbst frei.
      logger.error('Migrations-Lock unlock fehlgeschlagen:', unlockErr.message);
    }
    lock.verwerfen();
  }
}

async function fuehreMigrationenUnterLockAus(pool, { verzeichnis, lockTimeoutMs, logger }) {
  const files = fs.readdirSync(verzeichnis)
    .filter(f => f.endsWith('.sql'))
    .sort();

  // Bereits ausgefuehrte Migrationen laden — bewusst NACH dem Advisory-Lock,
  // damit die zweite Replika die Eintraege der ersten sieht.
  const { rows: applied } = await pool.query('SELECT name FROM schema_migrations');
  const appliedSet = new Set(applied.map(r => r.name));

  let neu = 0;
  const fehlgeschlagen = [];
  for (const file of files) {
    if (appliedSet.has(file)) {
      continue; // Bereits ausgefuehrt, ueberspringen
    }
    const sql = fs.readFileSync(path.join(verzeichnis, file), 'utf8');

    const verbindung = await verbindungOhneZeitgrenzen(pool, { lockTimeoutMs });
    try {
      await verbindung.query('BEGIN');
      await verbindung.query(sql);
      await verbindung.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await verbindung.query('COMMIT');
      neu++;
      logger.log(`Migration applied: ${file}`);
    } catch (err) {
      try { await verbindung.query('ROLLBACK'); } catch (_) { /* Connection evtl. tot */ }
      logger.error(`Migration FAILED (uebersprungen, Server startet trotzdem): ${file}`, err.message);
      fehlgeschlagen.push({ file, message: err.message });
    } finally {
      verbindung.verwerfen();
    }
  }
  if (neu > 0) {
    logger.log(`Migrations applied: ${neu} new (${files.length} total)`);
  } else {
    logger.log(`Migrations: keine neuen (${files.length} total)`);
  }
  if (fehlgeschlagen.length > 0) {
    logger.error(`ACHTUNG: ${fehlgeschlagen.length} Migration(en) fehlgeschlagen und uebersprungen:`);
    fehlgeschlagen.forEach(f => logger.error(`  - ${f.file}: ${f.message}`));
    logger.error('Server laeuft weiter. Bitte fehlgeschlagene Migration(en) pruefen und fixen.');
  }
  return { neu, gesamt: files.length, fehlgeschlagen };
}

/**
 * Ergebnis des letzten Migrationslaufs dieses Prozesses oder null, wenn noch
 * keiner durchgelaufen ist (Start laeuft noch, oder der Lock kam nicht).
 */
function ergebnisLetzterLauf() {
  return letzterLauf;
}

module.exports = {
  MIGRATION_ADVISORY_LOCK_ID,
  fuehreMigrationenAus,
  ergebnisLetzterLauf,
};
