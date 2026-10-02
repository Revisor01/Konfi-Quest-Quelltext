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
const fs = require('fs');
const { pipeline } = require('stream/promises');

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

// ====================================================================
// STROMWEISE VARIANTEN (ohne die ganze Datei im Arbeitsspeicher)
// ====================================================================
//
// Das Dateiformat bleibt BYTE FUER BYTE dasselbe wie bei encryptBuffer:
//   [MAGIC(8)] [IV(12)] [AUTH_TAG(16)] [CIPHERTEXT(...)]
// Damit lesen alte und neue Dateien sich gegenseitig, und decryptBuffer
// versteht weiterhin jede Datei, die hier entsteht.
//
// Der Auth-Tag steht VOR dem Ciphertext, GCM liefert ihn aber erst NACH dem
// letzten Byte. Beim stromweisen Schreiben bleiben die 16 Bytes deshalb
// zunaechst als Nullen stehen und werden am Ende an ihre Position
// zurueckgeschrieben (fs.write mit Offset). Ein Abbruch mitten im Schreiben
// hinterlaesst also eine Datei mit Null-Tag — die schlaegt beim Entschluesseln
// zuverlaessig fehl, statt still falsche Daten zu liefern.

const HEADER_LENGTH = MAGIC.length + IV_LENGTH + AUTH_TAG_LENGTH; // 36

/**
 * Verschluesselt eine Klartext-Datei stromweise in eine Zieldatei.
 * Es liegen nie mehr als die Chunk-Groesse (64 KiB) im Arbeitsspeicher.
 *
 * @param {string} quellPfad - Klartext-Datei (z.B. multer-Temporaerdatei)
 * @param {string} zielPfad - Zieldatei (verschluesselt)
 */
async function encryptFileToFile(quellPfad, zielPfad) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  try {
    // Kopf schreiben; der Tag-Platz bleibt vorerst Null.
    const kopf = await fs.promises.open(zielPfad, 'w');
    try {
      await kopf.write(Buffer.concat([MAGIC, iv, Buffer.alloc(AUTH_TAG_LENGTH)]), 0, HEADER_LENGTH, 0);
    } finally {
      await kopf.close();
    }

    // Ciphertext anhaengen. createWriteStream schliesst seinen Dateizeiger
    // selbst, deshalb laeuft er auf einem eigenen Handle.
    await pipeline(
      fs.createReadStream(quellPfad, { highWaterMark: 64 * 1024 }),
      cipher,
      fs.createWriteStream(zielPfad, { flags: 'r+', start: HEADER_LENGTH })
    );

    // Jetzt steht der Tag fest -> an seine Position zurueckschreiben.
    const tagZiel = await fs.promises.open(zielPfad, 'r+');
    try {
      await tagZiel.write(cipher.getAuthTag(), 0, AUTH_TAG_LENGTH, MAGIC.length + IV_LENGTH);
    } finally {
      await tagZiel.close();
    }
  } catch (err) {
    // Bricht das Schreiben ab (voller Datentraeger, abgebrochener Upload),
    // bliebe sonst eine halbe Datei mit Null-Tag liegen: nicht lesbar, aber
    // auf der Platte. Sie wird deshalb gleich hier entfernt, damit der Aufrufer
    // sich nur um den Fehler kuemmern muss.
    await fs.promises.unlink(zielPfad).catch(() => { /* gab es nie oder schon weg */ });
    throw err;
  }
}

/**
 * Entschluesselt eine Datei stromweise in einen beschreibbaren Strom
 * (in der Regel die HTTP-Antwort). Alte Klartext-Dateien (ohne MAGIC) werden
 * unveraendert durchgereicht — dieselbe Nachsicht wie decryptBuffer.
 *
 * Der Auth-Tag wird erst beim Abschluss geprueft. Bei einer manipulierten
 * Datei sind dann schon Bytes beim Client — das ist bei jedem stromweisen
 * GCM-Abruf so und der Grund, warum pipeline() den Fehler weiterwirft: die
 * Verbindung bricht dann sichtbar ab, statt still zu enden.
 *
 * @param {string} quellPfad - verschluesselte Datei
 * @param {import('stream').Writable} ziel - Ziel-Strom (z.B. res)
 */
async function decryptFileToStream(quellPfad, ziel) {
  const kopf = Buffer.alloc(HEADER_LENGTH);
  const quelle = await fs.promises.open(quellPfad, 'r');
  let gelesen = 0;
  try {
    ({ bytesRead: gelesen } = await quelle.read(kopf, 0, HEADER_LENGTH, 0));
  } finally {
    await quelle.close();
  }

  const verschluesselt = gelesen >= MAGIC.length
    && kopf.subarray(0, MAGIC.length).equals(MAGIC);

  if (!verschluesselt) {
    await pipeline(fs.createReadStream(quellPfad), ziel);
    return;
  }

  const iv = kopf.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
  const authTag = kopf.subarray(MAGIC.length + IV_LENGTH, HEADER_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  await pipeline(
    fs.createReadStream(quellPfad, { start: HEADER_LENGTH, highWaterMark: 64 * 1024 }),
    decipher,
    ziel
  );
}

/**
 * Liest die ersten Bytes einer Datei — genau so viele, wie die
 * Magic-Bytes-Pruefung (file-type) braucht. Ersetzt das Lesen der GANZEN
 * Datei in den Arbeitsspeicher, nur um ihren Typ zu bestimmen.
 *
 * @param {string} pfad
 * @param {number} laenge - Default 4100 Bytes (Empfehlung von file-type)
 * @returns {Promise<Buffer>} Die gelesenen Bytes (kann kuerzer sein)
 */
async function leseKopfBytes(pfad, laenge = 4100) {
  const puffer = Buffer.alloc(laenge);
  const fh = await fs.promises.open(pfad, 'r');
  try {
    const { bytesRead } = await fh.read(puffer, 0, laenge, 0);
    return puffer.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

module.exports = {
  encryptBuffer,
  decryptBuffer,
  isEncrypted,
  encryptFileToFile,
  decryptFileToStream,
  leseKopfBytes,
};
