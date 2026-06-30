// Verschlüsselung für Antrags-Nachweisfotos (at-rest).
//
// Fotos von Konfis/Teamern sind personenbezogene Daten (oft Minderjährige).
// Sie werden daher AES-256-GCM-verschlüsselt auf der Festplatte abgelegt und
// erst beim Abruf entschlüsselt im Speicher an den Client gestreamt.
//
// Dateiformat auf der Platte (alles binär hintereinander):
//   [MAGIC(8)] [IV(12)] [AUTH_TAG(16)] [CIPHERTEXT(...)]
// MAGIC erlaubt es, verschlüsselte von alten Klartext-Dateien zu unterscheiden
// (wichtig für die Migration und idempotente Abrufe).

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;        // GCM-Standard
const AUTH_TAG_LENGTH = 16;
const MAGIC = Buffer.from('KQPHOTO1', 'utf8'); // 8 Bytes Kennung für verschlüsselte Dateien

// Schlüssel aus der Umgebung lesen (64 Hex-Zeichen = 32 Byte für AES-256).
// Wird einmalig beim ersten Zugriff gecached.
let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.ACTIVITY_PHOTO_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ACTIVITY_PHOTO_ENCRYPTION_KEY ist nicht gesetzt');
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error('ACTIVITY_PHOTO_ENCRYPTION_KEY muss 64 Hex-Zeichen (32 Byte) lang sein');
  }
  cachedKey = key;
  return cachedKey;
}

// Prüft, ob ein Buffer das verschlüsselte Format hat (Magic-Header).
function isEncrypted(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= MAGIC.length
    && buffer.subarray(0, MAGIC.length).equals(MAGIC);
}

// Verschlüsselt einen Klartext-Buffer und gibt den vollständigen Datei-Buffer
// (inkl. Magic + IV + Auth-Tag) zurück.
function encryptBuffer(plainBuffer) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, authTag, ciphertext]);
}

// Entschlüsselt einen Datei-Buffer. Ist die Datei nicht verschlüsselt (alte
// Klartext-Datei vor der Migration), wird sie unverändert zurückgegeben, damit
// der Abruf nicht bricht.
function decryptBuffer(fileBuffer) {
  if (!isEncrypted(fileBuffer)) {
    return fileBuffer;
  }
  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_LENGTH;
  const dataStart = tagStart + AUTH_TAG_LENGTH;
  const iv = fileBuffer.subarray(ivStart, tagStart);
  const authTag = fileBuffer.subarray(tagStart, dataStart);
  const ciphertext = fileBuffer.subarray(dataStart);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = { encryptBuffer, decryptBuffer, isEncrypted };
