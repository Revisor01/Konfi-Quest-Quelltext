// Dateisystem-Helfer für hochgeladene Medien (Antrags-Nachweisfotos in
// uploads/requests/, Challenge-Beitraege in uploads/challenges/).
// Zentralisiert das Löschen, damit alle Aufrufer (Konfi-Antrag-Löschen,
// User-Löschung, manuelles Admin-Löschen, Orphan-Cleanup, Challenge-Beitrag
// zuruecknehmen) dieselbe sichere Logik verwenden.

const fs = require('fs');
const path = require('path');

const REQUESTS_DIR = path.join(__dirname, '../uploads/requests');
const CHALLENGES_DIR = path.join(__dirname, '../uploads/challenges');
const CHAT_DIR = path.join(__dirname, '../uploads/chat');
const MATERIAL_DIR = path.join(__dirname, '../uploads/material');

// Loescht eine Datei aus einem der Upload-Verzeichnisse anhand des in der DB
// gespeicherten Dateinamens. Gibt true zurück, wenn gelöscht wurde, false
// wenn nichts zu tun war. Wirft NICHT — Fehler werden geloggt, damit ein
// fehlendes File nie eine DB-Operation (Antrag/User/Beitrag löschen) blockiert.
// Die Upload-Routen erzeugen ihre Dateinamen als
// crypto.randomBytes(32).toString('hex') — also immer genau 64 Hexzeichen.
// Etwas anderes darf gar nicht erst in einen Pfad geraten.
const HEX_NAME = /^[a-f0-9]{64}$/;

/**
 * Ist das ein unbedenklicher, selbst erzeugter Dateiname?
 *
 * Gedacht fuer den LESEpfad, wo ein Wert aus der Datenbank in path.join()
 * geht: Bestandsdaten koennen aus der Zeit vor der Eingangspruefung stammen
 * 
 * Deshalb wird am Ausgang erneut geprueft, nicht nur am Eingang.
 *
 * Strenger als basename(): '..' allein waere auch ein gueltiger Basename.
 */
function istSichererDateiname(filename) {
  return typeof filename === 'string' && HEX_NAME.test(filename);
}

async function deleteFileInDir(dir, filename, label) {
  if (!filename) return false;

  // Schutz gegen Path-Traversal: nur der reine Basename ist erlaubt.
  const safeName = path.basename(filename);
  if (safeName !== filename) {
    console.error(`${label}: verdaechtiger Dateiname abgewiesen:`, filename);
    return false;
  }

  const filePath = path.join(dir, safeName);
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false; // Datei existiert nicht (mehr) — kein Fehler
    }
    console.error(`${label}: Loeschen fehlgeschlagen fuer`, safeName, err.message);
    return false;
  }
}

async function deletePhotoFile(filename) {
  return deleteFileInDir(REQUESTS_DIR, filename, 'deletePhotoFile');
}

// Challenge-Beitraege (Foto/Audio/Video) liegen verschlüsselt in
// uploads/challenges/ unter einem zufaelligen Hex-Namen.
async function deleteChallengeFile(filename) {
  return deleteFileInDir(CHALLENGES_DIR, filename, 'deleteChallengeFile');
}

// Chat-Anhaenge (chat_messages.file_path) liegen verschlüsselt in
// uploads/chat/ unter einem Hex-Namen. Genutzt von den Personen- und
// Org-Löschpfaden — der Raum-Delete in routes/chat.js räumt selbst auf.
async function deleteChatFile(filename) {
  return deleteFileInDir(CHAT_DIR, filename, 'deleteChatFile');
}

// Material-Dateien (material_files.stored_name) in uploads/material/.
// Genutzt vom Org-Löschpfad — die Material-Routen räumen selbst auf.
async function deleteMaterialFile(filename) {
  return deleteFileInDir(MATERIAL_DIR, filename, 'deleteMaterialFile');
}

module.exports = {
  deletePhotoFile, deleteChallengeFile, deleteChatFile, deleteMaterialFile,
  istSichererDateiname,
  REQUESTS_DIR, CHALLENGES_DIR, CHAT_DIR, MATERIAL_DIR,
};
