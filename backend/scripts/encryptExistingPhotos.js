// Einmal-Migration: bestehende Klartext-Medien at-rest verschluesseln.
//
// Hintergrund: Antrags-Nachweisfotos (uploads/requests/) UND Chat-Medien
// (uploads/chat/) lagen bisher unverschluesselt. Dieses Skript verschluesselt
// alle vorhandenen Dateien mit AES-256-GCM (siehe utils/photoCrypto.js).
// Es ist IDEMPOTENT: bereits verschluesselte Dateien (erkennbar am Magic-
// Header) werden uebersprungen, ein zweiter Lauf richtet keinen Schaden an.
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
const DIRS = [
  path.join(__dirname, '../uploads/requests'),
  path.join(__dirname, '../uploads/chat'),
  path.join(__dirname, '../uploads/material'),
];

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

main().catch((err) => {
  console.error('Unerwarteter Fehler:', err);
  process.exit(1);
});
