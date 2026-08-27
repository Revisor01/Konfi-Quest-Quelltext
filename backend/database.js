const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

// Configure pg to parse bigint as integer
const types = require('pg').types;
types.setTypeParser(20, (val) => parseInt(val, 10)); // bigint

// Pool-Konfiguration: PG_POOL_MAX (Standard 20), PG_IDLE_TIMEOUT (Standard 30s), PG_CONN_TIMEOUT (Standard 5s)
// Bei EKD-Skalierung PG_POOL_MAX im Docker-Compose setzen (z.B. 50).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_POOL_MAX || '20', 10),
  idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '5000', 10),
});

// App-weite Lock-ID für den Migrations-Advisory-Lock (beliebig, aber fest).
const MIGRATION_ADVISORY_LOCK_ID = 723001;

async function runMigrations(pool) {
  // Advisory-Lock: Beide Backend-Replikas starten beim Deploy
  // PARALLEL und rasten sonst um neue Migrationen (beobachtet bei Migration 109:
  // eine Replika gewann, die andere warf duplicate-key auf pg_type). Der Lock
  // serialisiert die Läufe; die zweite Replika liest danach die frisch
  // eingetragenen schema_migrations und ueberspringt sauber.
  // Session-Lock auf dedizierter Connection — wird im finally freigegeben,
  // bei Prozess-Tod räumt Postgres den Lock automatisch.
  const lockClient = await pool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID]);

    // Tracking-Tabelle sicherstellen (idempotent)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await runMigrationsLocked(pool);
  } finally {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
    } catch (unlockErr) {
      // Connection evtl. tot — Postgres gibt Session-Locks dann selbst frei.
      console.error('Migrations-Lock unlock fehlgeschlagen:', unlockErr.message);
    }
    lockClient.release();
  }
}

async function runMigrationsLocked(pool) {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  // Bereits ausgefuehrte Migrationen laden — bewusst NACH dem Advisory-Lock,
  // damit die zweite Replika die Eintraege der ersten sieht.
  const { rows: applied } = await pool.query('SELECT name FROM schema_migrations');
  const appliedSet = new Set(applied.map(r => r.name));

  let newCount = 0;
  const failed = [];
  for (const file of files) {
    if (appliedSet.has(file)) {
      continue; // Bereits ausgefuehrt, ueberspringen
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      newCount++;
      console.log(`Migration applied: ${file}`);
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* Connection evtl. tot */ }
      console.error(`Migration FAILED (uebersprungen, Server startet trotzdem): ${file}`, err.message);
      failed.push({ file, message: err.message });
    } finally {
      client.release();
    }
  }
  if (newCount > 0) {
    console.log(`Migrations applied: ${newCount} new (${files.length} total)`);
  } else {
    console.log(`Migrations: keine neuen (${files.length} total)`);
  }
  if (failed.length > 0) {
    console.error(`ACHTUNG: ${failed.length} Migration(en) fehlgeschlagen und uebersprungen:`);
    failed.forEach(f => console.error(`  - ${f.file}: ${f.message}`));
    console.error('Server laeuft weiter. Bitte fehlgeschlagene Migration(en) pruefen und fixen.');
  }
}

// Einmaliger Test beim Starten der Anwendung, um sicherzustellen, dass die DB erreichbar ist.
// Migrationsfehler killen den Start NICHT mehr (siehe runMigrations) — nur eine
// voellig unerreichbare DB ist noch ein harter Startup-Fehler.
pool.query('SELECT NOW()')
  .then(() => runMigrations(pool))
  .catch(err => {
    console.error('Database startup failed (DB nicht erreichbar):', err);
    // In Tests NICHT den Prozess killen: Dieser Selbsttest laeuft beim
    // MODUL-LADEN als unbeaufsichtigter Promise. utils/liveUpdate.js laedt das
    // Singleton lazy mitten im Testlauf; schlaegt der Test dann fehl (z.B.
    // weil globalTeardown die Test-DB gerade droppt), riss process.exit(1)
    // den ganzen vitest-Worker mit — etwa jeder vierte Lauf brach so ohne
    // Fehlermeldung ab. In Produktion bleibt der harte Abbruch gewollt.
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
  });

module.exports = {
  // Die primäre Methode zum Ausführen von Abfragen
  query: (text, params) => pool.query(text, params),

  // Dedizierter Client für Transaktionen (BEGIN/COMMIT/ROLLBACK)
  // pool.query() kann verschiedene Connections nutzen - bei Transaktionen
  // MUSS alles auf derselben Connection laufen!
  getClient: () => pool.connect(),

  // Wir exportieren auch die 'end'-Methode des Pools,
  // damit wir die Verbindungen beim Herunterfahren des Servers sauber beenden können.
  end: () => pool.end(),
};