// Dateisystem-Helfer fuer Antrags-Nachweisfotos in uploads/requests/.
// Zentralisiert das Loeschen, damit alle Aufrufer (Konfi-Antrag-Loeschen,
// User-Loeschung, manuelles Admin-Loeschen, Orphan-Cleanup) dieselbe sichere
// Logik verwenden.

const fs = require('fs');
const path = require('path');

const REQUESTS_DIR = path.join(__dirname, '../uploads/requests');

// Loescht eine Foto-Datei anhand des in der DB gespeicherten Dateinamens.
// Gibt true zurueck, wenn geloescht wurde, false wenn nichts zu tun war.
// Wirft NICHT — Fehler werden geloggt, damit ein fehlendes File nie eine
// DB-Operation (Antrag/User loeschen) blockiert.
async function deletePhotoFile(filename) {
  if (!filename) return false;

  // Schutz gegen Path-Traversal: nur der reine Basename ist erlaubt.
  const safeName = path.basename(filename);
  if (safeName !== filename) {
    console.error('deletePhotoFile: verdaechtiger Dateiname abgewiesen:', filename);
    return false;
  }

  const filePath = path.join(REQUESTS_DIR, safeName);
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false; // Datei existiert nicht (mehr) — kein Fehler
    }
    console.error('deletePhotoFile: Loeschen fehlgeschlagen fuer', safeName, err.message);
    return false;
  }
}

module.exports = { deletePhotoFile, REQUESTS_DIR };
