// backend/scripts/schemaVergleich.js
//
// Fingerabdruck des Datenbankschemas -- und Vergleich zweier Staende.
//
// Anlass: Der Waechter
// tests/schema/neuinstallation.test.js verglich nur Tabellen, Spaltentypen,
// CHECKs und Views. Ein fehlender Index, eine andere Loeschregel, ein
// fehlendes UNIQUE, ein anderer Default oder ein fehlendes NOT NULL zwischen
// Neuinstallation und Deploy-Weg waere ihm entgangen. Und ob die Produktion
// heute dem Repo entspricht, liess sich nur mit Zugang und von Hand pruefen.
//
// Dieses Modul liest NUR den Katalog (keine Daten, keine Aenderung) und
// liefert je Objektart eine sortierte Liste von Zeilen. Zwei Staende sind
// gleich, wenn alle Listen gleich sind. Genutzt von:
//   - tests/schema/neuinstallation.test.js (init-scripts gegen Dump-Weg),
//   - tests/schema/wiederherstellung.test.js (Sicherung zurueckgespielt),
//   - der Messung in Produktion.
//
// Aufruf (eigener Pool -- NICHT database.js, das startet Migrationen):
//   node scripts/schemaVergleich.js erfassen [DATABASE_URL] > stand.json
//   node scripts/schemaVergleich.js vergleichen <a.json|URL> <b.json|URL>
// "erfassen" nimmt ohne Argument DATABASE_URL aus der Umgebung -- im
// Backend-Container ist das die Produktionsdatenbank. "vergleichen" endet mit
// Exit 1, sobald eine Objektart abweicht, und nennt die Zeilen, die nur auf
// einer Seite stehen.

const fs = require('fs');

// Objektarten und ihre Katalogabfragen. Jede Abfrage liefert genau eine
// Spalte `zeile`; die Reihenfolge der Ergebnisliste ist egal, sortiert wird
// unten.
const ABFRAGEN = {
  tabellen: `
    SELECT c.relname AS zeile
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')`,

  // Typ, NOT NULL und Default je Spalte -- die drei Dinge, die der alte
  // Waechter nicht sah (nur data_type).
  spalten: `
    SELECT c.relname || '.' || a.attname
           || ' ' || format_type(a.atttypid, a.atttypmod)
           || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
           || CASE WHEN a.attidentity <> '' THEN ' IDENTITY ' || a.attidentity::text ELSE '' END
           || CASE WHEN a.attgenerated <> '' THEN ' GENERATED' ELSE '' END
           || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '') AS zeile
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      AND a.attnum > 0 AND NOT a.attisdropped`,

  // Primaerschluessel, UNIQUE, Fremdschluessel (mit Loeschregel), CHECK,
  // EXCLUDE -- mit Namen, weil der Code Constraints auch beim Namen nennt
  // (ON CONFLICT ON CONSTRAINT, DROP CONSTRAINT in Migrationen).
  constraints: `
    SELECT t.relname || ' ' || c.conname || ' ' || c.contype::text || ': ' || pg_get_constraintdef(c.oid) AS zeile
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relnamespace = 'public'::regnamespace`,

  // Vollstaendige Definition samt Name, Methode, Spalten, Praedikat.
  indizes: `
    SELECT pg_get_indexdef(i.indexrelid) AS zeile
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE t.relnamespace = 'public'::regnamespace`,

  views: `
    SELECT c.relname || ': ' || regexp_replace(pg_get_viewdef(c.oid, true), '\\s+', ' ', 'g') AS zeile
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')`,

  // Name, Typ, Schrittweite und Besitzer-Spalte -- nicht der Stand (Daten).
  sequenzen: `
    SELECT s.relname || ' ' || format_type(q.seqtypid, NULL) || ' +' || q.seqincrement
           || COALESCE(' OWNED BY ' || t.relname || '.' || a.attname, '') AS zeile
    FROM pg_class s
    JOIN pg_sequence q ON q.seqrelid = s.oid
    LEFT JOIN pg_depend dep ON dep.objid = s.oid AND dep.classid = 'pg_class'::regclass
         AND dep.refclassid = 'pg_class'::regclass AND dep.deptype IN ('a', 'i')
    LEFT JOIN pg_class t ON t.oid = dep.refobjid
    LEFT JOIN pg_attribute a ON a.attrelid = dep.refobjid AND a.attnum = dep.refobjsubid
    WHERE s.relnamespace = 'public'::regnamespace AND s.relkind = 'S'`,

  trigger: `
    SELECT pg_get_triggerdef(tg.oid) AS zeile
    FROM pg_trigger tg
    JOIN pg_class t ON t.oid = tg.tgrelid
    WHERE t.relnamespace = 'public'::regnamespace AND NOT tg.tgisinternal`,

  // Funktionen des Schemas mit Signatur und einer Pruefsumme des Koerpers.
  funktionen: `
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
           || md5(pg_get_functiondef(p.oid)) AS zeile
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`,

  // Nur der Name: Die Version haengt am Image, nicht am Repo.
  erweiterungen: `
    SELECT extname AS zeile FROM pg_extension WHERE extname <> 'plpgsql'`,
};

/**
 * Liest den Fingerabdruck einer Datenbank.
 * @param {{query: Function}} db  Pool oder Client
 * @returns {Promise<Record<string, string[]>>} je Objektart die sortierten Zeilen
 */
async function schemaFingerabdruck(db) {
  const ergebnis = {};
  for (const [art, sql] of Object.entries(ABFRAGEN)) {
    const { rows } = await db.query(sql);
    const zeilen = rows.map((r) => r.zeile);
    ergebnis[art] = (art === 'constraints' ? zeilen.map(checkOhneTypumwandlung) : zeilen).sort();
  }
  return ergebnis;
}

/**
 * CHECK-Definitionen ohne Typumwandlungen und Klammern.
 */
function checkOhneTypumwandlung(zeile) {
  const m = zeile.match(/^(\S+ \S+ c: )(.*)$/);
  if (!m) return zeile;
  const rumpf = m[2]
    .replace(/::[a-z]+(?: [a-z]+)*(\[\])?/g, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return m[1] + rumpf;
}

/**
 * Unterschiede zweier Fingerabdruecke je Objektart.
 * @returns {Record<string, {nurA: string[], nurB: string[]}>} nur Arten mit Abweichung
 */
function vergleiche(a, b) {
  const unterschiede = {};
  const arten = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const art of [...arten].sort()) {
    const setA = new Set(a[art] || []);
    const setB = new Set(b[art] || []);
    const nurA = [...setA].filter((z) => !setB.has(z)).sort();
    const nurB = [...setB].filter((z) => !setA.has(z)).sort();
    if (nurA.length || nurB.length) unterschiede[art] = { nurA, nurB };
  }
  return unterschiede;
}

module.exports = { schemaFingerabdruck, vergleiche, checkOhneTypumwandlung, ABFRAGEN };

// ---------------------------------------------------------------------------
// Kommandozeile

async function ausQuelle(quelle) {
  if (/^postgres(ql)?:\/\//.test(quelle)) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: quelle, max: 1 });
    try {
      return await schemaFingerabdruck(pool);
    } finally {
      await pool.end();
    }
  }
  return JSON.parse(fs.readFileSync(quelle, 'utf8'));
}

async function main(argv) {
  const [befehl, ...args] = argv;
  if (befehl === 'erfassen') {
    const url = args[0] || process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL fehlt (Argument oder Umgebung).');
    const abdruck = await ausQuelle(url);
    process.stdout.write(JSON.stringify(abdruck, null, 2) + '\n');
    return 0;
  }
  if (befehl === 'vergleichen' && args.length === 2) {
    const [a, b] = await Promise.all(args.map(ausQuelle));
    const unterschiede = vergleiche(a, b);
    const arten = Object.keys(unterschiede);
    if (arten.length === 0) {
      process.stdout.write(`Gleich: ${Object.keys(a).map((k) => `${a[k].length} ${k}`).join(', ')}\n`);
      return 0;
    }
    for (const art of arten) {
      const { nurA, nurB } = unterschiede[art];
      process.stdout.write(`\n## ${art}: ${nurA.length} nur in A, ${nurB.length} nur in B\n`);
      nurA.forEach((z) => process.stdout.write(`- A: ${z}\n`));
      nurB.forEach((z) => process.stdout.write(`+ B: ${z}\n`));
    }
    return 1;
  }
  process.stderr.write(
    'Aufruf:\n' +
    '  node scripts/schemaVergleich.js erfassen [DATABASE_URL] > stand.json\n' +
    '  node scripts/schemaVergleich.js vergleichen <a.json|URL> <b.json|URL>\n'
  );
  return 2;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      process.stderr.write(`FEHLER: ${err.message}\n`);
      process.exitCode = 2;
    });
}
