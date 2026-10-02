// Einmal-Migration: bestehende Klartext-Medien at-rest verschluesseln.
//
// Aufruf IM CONTAINER (dort ist ACTIVITY_PHOTO_ENCRYPTION_KEY gesetzt und
// /app/uploads gemountet):
//   docker exec konfi_quest-backend-1 node scripts/encryptExistingPhotos.js
//
// Optional Trockenlauf (nichts schreiben):
//   docker exec konfi_quest-backend-1 node scripts/encryptExistingPhotos.js --dry-run

const fs = require('fs');
const path = require('path');
const { encryptBuffer, isEncrypted } = require('../utils/photoCrypto');

const DRY_RUN = process.argv.includes('--dry-run');
function verzeichnisseFuer(uploadsDir) {
  return ['requests', 'chat', 'material', 'challenges'].map((name) => path.join(uploadsDir, name));
}

const DIRS = verzeichnisseFuer(path.join(__dirname, '../uploads'));

async function migrateDir(dir) {
  if (!fs.existsSync(dir)) {
    console.log(`(uebersprungen, nicht vorhanden) ${dir}`);
    return { encrypted: 0, skipped: 0, failed: 0 };
  }

  const files = await fs.promises.readdir(dir);
  let encrypted = 0, skipped = 0, failed = 0;

  console.log(`${files.length} Datei(en) in ${dir}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  for (const name of files) {
    const filePath = path.join(dir, name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) { continue; }

      const buffer = await fs.promises.readFile(filePath);

      if (isEncrypted(buffer)) {
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`[würde verschlüsseln] ${name} (${stat.size} Bytes)`);
        encrypted++;
        continue;
      }

      // Atomar: in temporaere Datei schreiben, dann umbenennen
      const enc = encryptBuffer(buffer);
      const tmpPath = filePath + '.enc.tmp';
      await fs.promises.writeFile(tmpPath, enc);
      await fs.promises.rename(tmpPath, filePath);
      encrypted++;
      console.log(`[verschlüsselt] ${name}`);
    } catch (err) {
      failed++;
      console.error(`[FEHLER] ${name}:`, err.message);
    }
  }

  return { encrypted, skipped, failed };
}

async function main() {
  if (!process.env.ACTIVITY_PHOTO_ENCRYPTION_KEY) {
    console.error('FEHLER: ACTIVITY_PHOTO_ENCRYPTION_KEY ist nicht gesetzt. Abbruch.');
    process.exit(1);
  }

  let totalEnc = 0, totalSkip = 0, totalFail = 0;
  for (const dir of DIRS) {
    const r = await migrateDir(dir);
    totalEnc += r.encrypted;
    totalSkip += r.skipped;
    totalFail += r.failed;
  }

  console.log('----------------------------------------');
  console.log(`Verschlüsselt: ${totalEnc}`);
  console.log(`Übersprungen (bereits verschlüsselt): ${totalSkip}`);
  console.log(`Fehler: ${totalFail}`);
  if (totalFail > 0) { process.exit(1); }
}

// Nur als Skript starten, nicht beim require aus einem Test.
if (require.main === module) {
  main().catch((err) => {
    console.error('Unerwarteter Fehler:', err);
    process.exit(1);
  });
}

module.exports = { verzeichnisseFuer, migrateDir };
