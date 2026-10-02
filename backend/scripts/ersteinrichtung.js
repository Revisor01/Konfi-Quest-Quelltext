// backend/scripts/ersteinrichtung.js
//
// Der erste Zugang einer NEUEN Instanz: eine Gemeinde fuer den Betrieb, ihre
// vier Standardrollen und ein Konto mit Super-Admin-Recht.
//
// Das Skript legt nur das Noetigste an. Die eigentlichen Gemeinden entstehen
// danach in der App ("Gemeinde anlegen") -- mit Abzeichen, Zertifikatstypen
// und Stufen, wie jede andere auch.
//
// Aufruf IM BACKEND-CONTAINER, nachdem das Backend einmal gestartet ist (dann
// sind alle Migrationen gelaufen):
//   docker exec -e ERST_BENUTZERNAME=... -e ERST_PASSWORT=... \
//     -e ERST_ANZEIGENAME=... [-e ERST_EMAIL=...] [-e ERST_GEMEINDE="Betrieb"] \
//     <backend-container> node scripts/ersteinrichtung.js
// Das Passwort muss die Regeln der App erfuellen (utils/passwordUtils.js).
// Danach in der App mit diesem Konto anmelden und das Passwort aendern.
//
// Laeuft nur auf einer LEEREN Datenbank: Gibt es schon eine Gemeinde oder
// ein Konto, bricht es ab und aendert nichts.
//
// Eigener Pool (NICHT database.js importieren -- das wuerde Migrationen starten).

const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const { validatePassword } = require('../utils/passwordUtils');

// Dieselben Rollen wie beim Anlegen einer Gemeinde (routes/organizations.js).
const STANDARDROLLEN = [
  { name: 'org_admin', display_name: 'Gemeindeleitung', description: 'Vollzugriff auf alle Jahrgänge der Gemeinde' },
  { name: 'admin', display_name: 'Leitung', description: 'Vollzugriff mit Jahrgangs-Beschränkungen' },
  { name: 'teamer', display_name: 'Teamer:in', description: 'Kann Anträge bearbeiten und zugewiesene Jahrgänge verwalten' },
  { name: 'konfi', display_name: 'Konfirmand:in', description: 'Konfirmand:innen haben Zugriff auf eigene Daten und können Aktivitäten beantragen' },
];

function slugAus(name) {
  const slug = name.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'betrieb';
}

/**
 * @param {import('pg').Pool} pool
 * @param {{gemeinde?: string, benutzername: string, passwort: string, anzeigename: string, email?: string}} angaben
 * @returns {Promise<{organisation: number, konto: number, slug: string}>}
 */
async function ersteinrichtung(pool, angaben) {
  const gemeinde = (angaben.gemeinde || 'Betrieb').trim();
  const benutzername = (angaben.benutzername || '').trim();
  const anzeigename = (angaben.anzeigename || '').trim();
  const email = (angaben.email || '').trim() || null;
  const passwort = angaben.passwort || '';

  if (!benutzername || !anzeigename) {
    throw new Error('ERST_BENUTZERNAME und ERST_ANZEIGENAME fehlen.');
  }
  const passwortFehler = validatePassword(passwort);
  if (passwortFehler) throw new Error(`ERST_PASSWORT: ${passwortFehler}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Nur auf einer leeren Datenbank -- auch nicht "nachlegen", wenn schon
    // eine Gemeinde da ist: Dafuer gibt es den Weg in der App.
    const { rows: [bestand] } = await client.query(
      'SELECT (SELECT count(*) FROM organizations)::int AS gemeinden, (SELECT count(*) FROM users)::int AS konten'
    );
    if (bestand.gemeinden > 0 || bestand.konten > 0) {
      throw new Error(
        `Die Datenbank ist nicht leer (${bestand.gemeinden} Gemeinden, ${bestand.konten} Konten). `
        + 'Die Ersteinrichtung laeuft nur auf einer neuen Instanz; weitere Gemeinden legt ein Super-Admin in der App an.'
      );
    }

    const slug = slugAus(gemeinde);
    const { rows: [org] } = await client.query(
      `INSERT INTO organizations (name, slug, display_name, description, is_trial, trial_ends_at, is_active)
       VALUES ($1, $2, $1, 'Gemeinde des Betriebs (Ersteinrichtung)', false, NULL, true) RETURNING id`,
      [gemeinde, slug]
    );

    let orgAdminRolle = null;
    for (const rolle of STANDARDROLLEN) {
      const { rows: [r] } = await client.query(
        `INSERT INTO roles (organization_id, name, display_name, description, is_system_role)
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [org.id, rolle.name, rolle.display_name, rolle.description]
      );
      if (rolle.name === 'org_admin') orgAdminRolle = r.id;
    }

    const hash = await bcrypt.hash(passwort, 10);
    const { rows: [konto] } = await client.query(
      `INSERT INTO users (organization_id, role_id, username, email, password_hash, display_name, is_active, is_super_admin)
       VALUES ($1, $2, $3, $4, $5, $6, true, true) RETURNING id`,
      [org.id, orgAdminRolle, benutzername, email, hash, anzeigename]
    );

    await client.query('COMMIT');
    return { organisation: org.id, konto: konto.id, slug };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { ersteinrichtung, STANDARDROLLEN };

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('FEHLER: DATABASE_URL fehlt.\n');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  ersteinrichtung(pool, {
    gemeinde: process.env.ERST_GEMEINDE,
    benutzername: process.env.ERST_BENUTZERNAME,
    passwort: process.env.ERST_PASSWORT,
    anzeigename: process.env.ERST_ANZEIGENAME,
    email: process.env.ERST_EMAIL,
  })
    .then(({ organisation, konto, slug }) => {
      process.stdout.write(
        `OK: Gemeinde ${organisation} (${slug}) und Konto ${konto} mit Super-Admin-Recht angelegt.\n`
        + 'Jetzt in der App anmelden, das Passwort aendern und die Gemeinden anlegen.\n'
      );
      return pool.end().then(() => process.exit(0));
    })
    .catch((err) => {
      process.stderr.write(`FEHLER: ${err.message}\n`);
      return pool.end().then(() => process.exit(1));
    });
}
