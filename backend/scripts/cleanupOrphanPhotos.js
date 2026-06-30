// Orphan-Cleanup: loescht Medien-Dateien in uploads/requests/ und uploads/chat/,
// die in KEINER DB-Spalte mehr referenziert sind (activity_requests.photo_filename
// bzw. chat_messages.file_path) — z.B. Reste aus der Zeit, bevor das Loeschen
// beim Antrag-/User-/Nachrichten-Loeschen implementiert war.
//
// Eigener Pool (NICHT database.js importieren — das wuerde Migrationen starten).
//
// Aufruf IM CONTAINER:
//   docker exec konfi_quest-backend-1 node scripts/cleanupOrphanPhotos.js
//   docker exec konfi_quest-backend-1 node scripts/cleanupOrphanPhotos.js --dry-run

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DRY_RUN = process.argv.includes('--dry-run');

const TARGETS = [
  {
    dir: path.join(__dirname, '../uploads/requests'),
    query: 'SELECT photo_filename AS f FROM activity_requests WHERE photo_filename IS NOT NULL',
  },
  {
    dir: path.join(__dirname, '../uploads/chat'),
    query: 'SELECT file_path AS f FROM chat_messages WHERE file_path IS NOT NULL',
  },
  {
    dir: path.join(__dirname, '../uploads/material'),
    query: 'SELECT stored_name AS f FROM material_files WHERE stored_name IS NOT NULL',
  },
];

async function cleanupTarget(pool, { dir, query }) {
  if (!fs.existsSync(dir)) {
    console.log(`(uebersprungen, nicht vorhanden) ${dir}`);
    return { deleted: 0, kept: 0 };
  }

  const { rows } = await pool.query(query);
  const referenced = new Set(rows.map(r => r.f));

  const files = await fs.promises.readdir(dir);
  let deleted = 0, kept = 0;

  console.log(`${dir}: ${files.length} Datei(en), ${referenced.size} referenziert${DRY_RUN ? ' (DRY RUN)' : ''}`);

  for (const name of files) {
    const filePath = path.join(dir, name);
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) { continue; }

    if (referenced.has(name)) {
      kept++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`[würde löschen] ${name} (${stat.size} Bytes)`);
      deleted++;
      continue;
    }

    await fs.promises.unlink(filePath);
    deleted++;
    console.log(`[gelöscht] ${name}`);
  }

  return { deleted, kept };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    let totalDel = 0, totalKept = 0;
    for (const target of TARGETS) {
      const r = await cleanupTarget(pool, target);
      totalDel += r.deleted;
      totalKept += r.kept;
    }
    console.log('----------------------------------------');
    console.log(`Gelöscht (verwaist): ${totalDel}`);
    console.log(`Behalten (referenziert): ${totalKept}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Unerwarteter Fehler:', err);
  process.exit(1);
});
