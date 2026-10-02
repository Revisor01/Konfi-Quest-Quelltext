// Welche Dateien die Upload-Routen annehmen -- und was mit Dateien passiert,
// fuer die das Geraet keinen brauchbaren Typ mitschickt.
//
// WOFUER: „Word hab ich mir
// versucht vom Android eine rauszuschicken — eine .docx Datei ging nicht :(
// … schlägt einfach fehl das senden."
//
// Bis dahin liess der multer-Filter jeder Route nur Dateien durch, deren vom
// Geraet GEMELDETER Typ auf einer Liste stand, und verwarf alle anderen STILL
// (cb(null, false)). Kennt das Geraet den Typ einer Datei nicht, schickt das
// WebView sie als application/octet-stream -- die Route sah dann gar keine
// Datei: Chat 400 „Inhalt oder Datei erforderlich" (mit Text dabei ging die
// Nachricht ohne die Datei raus), Material 400 „Keine Dateien hochgeladen",
// Challenges 400 „Bitte wähle eine Datei aus.", Antraege 400 „Kein Foto
// hochgeladen". Im Protokoll steht dazu
// „Datei abgelehnt: Endung .docx, Typ application/octet-stream".
//
// DIE REGEL JETZT:
//   1. Ist die Angabe allgemein (leer, application/octet-stream, ...), gilt
//      der Typ, der zur ENDUNG gehoert -- sofern die Endung erlaubt ist.
//   2. Steht der gemeldete Typ auf der Liste der Route, gilt er (wie bisher).
//   3. Steht er nicht darauf, die Endung aber schon (ein anderer Name fuer
//      denselben Typ, etwa audio/x-m4a bei .m4a), gilt der Typ der Endung.
//   4. Sonst wird die Datei abgewiesen, und zwar HOERBAR: 415 mit einem Satz,
//      den man versteht (DateitypAbgelehnt, zentraler Fehlerbehandler in
//      createApp.js), statt still zu verschwinden.
//
// Die Endung allein laesst nichts durch: Den Inhalt prueft weiter die Route
// an den Kopfbytes (file-type) bzw. bei Text am Inhalt (utils/textDatei.js).
// Ein umbenanntes Programm scheitert dort wie bisher. Der Filter setzt
// file.mimetype auf den ermittelten Typ -- damit prueft die Route eine .txt
// ohne Typ als Text und das Material speichert den richtigen Typ; der
// gemeldete Wert bleibt in file.gemeldeterTyp.

const { dateiFuersProtokoll } = require('./protokoll');

/** Endung -> Typ. Eine Tabelle fuer alle Routen; welche davon gelten, sagt REGELN. */
const TYP_ZUR_ENDUNG = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
};

/**
 * Angaben, die nichts ueber den Inhalt sagen. Dann entscheidet die Endung.
 *
 * text/plain steht nur unter einer Bedingung dabei (siehe istAllgemein):
 * busboy gibt einem Dateiteil OHNE Content-Type-Zeile genau diesen Typ. Eine
 * .docx, die so ankommt, landete sonst in der Textpruefung ("Die Datei ist
 * keine Textdatei.").
 */
const ALLGEMEINE_TYPEN = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

const TEXT_TYPEN = new Set(['text/plain', 'text/csv']);

const BILDER = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
const OFFICE = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const REGELN = {
  chat: {
    typen: new Set([
      ...BILDER,
      'application/pdf',
      'video/mp4', 'video/quicktime', 'video/webm',
      'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
      ...OFFICE,
      'text/plain', 'text/csv',
    ]),
    text: 'Dieser Dateityp kann nicht gesendet werden.',
    protokoll: 'Datei abgelehnt',
  },
  material: {
    typen: new Set([
      ...BILDER,
      'application/pdf',
      'video/mp4', 'video/quicktime', 'video/webm',
      'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
      ...OFFICE,
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.oasis.opendocument.presentation',
      'text/plain', 'text/csv',
    ]),
    text: 'Dieser Dateityp kann nicht hochgeladen werden.',
    protokoll: 'Material-Datei abgelehnt',
  },
  challenge: {
    typen: new Set([
      'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
      'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/aac',
    ]),
    // Challenges nehmen jedes gemeldete Bild an (wie bisher: image/*); die
    // Route prueft an den Kopfbytes, ob es wirklich eins ist.
    jedesBild: true,
    text: 'Dieser Dateityp kann nicht hochgeladen werden.',
    protokoll: 'Challenge-Datei abgelehnt',
  },
  antrag: {
    typen: new Set(),
    jedesBild: true,
    text: 'Dieser Dateityp kann nicht hochgeladen werden.',
    protokoll: 'Antrags-Foto abgelehnt',
  },
};

/** Abweisung durch den Filter; createApp.js macht daraus 415 { error }. */
class DateitypAbgelehnt extends Error {
  constructor(text) {
    super(text);
    this.name = 'DateitypAbgelehnt';
    this.code = 'DATEITYP_ABGELEHNT';
    this.status = 415;
  }
}

function endungVon(dateiname) {
  const name = typeof dateiname === 'string' ? dateiname : '';
  const punkt = name.lastIndexOf('.');
  return punkt >= 0 ? name.slice(punkt + 1).toLowerCase() : '';
}

function erlaubt(regel, typ) {
  if (!typ) return false;
  if (regel.typen.has(typ)) return true;
  return Boolean(regel.jedesBild) && typ.startsWith('image/');
}

/**
 * Sagt die Angabe nichts ueber den Inhalt? Allgemeine Typen immer;
 * text/plain nur, wenn die Endung etwas anderes als Text nennt (busboy-
 * Vorgabe fuer einen Teil ohne Typ-Zeile, siehe ALLGEMEINE_TYPEN).
 */
function istAllgemein(gemeldet, typDerEndung) {
  if (ALLGEMEINE_TYPEN.has(gemeldet)) return true;
  return gemeldet === 'text/plain' && Boolean(typDerEndung) && !TEXT_TYPEN.has(typDerEndung);
}

/**
 * Der Typ, mit dem die Route weiterarbeitet -- oder null, wenn die Datei
 * abzuweisen ist.
 *
 * @param {{ mimetype?: string, originalname?: string }} datei  multer-Datei
 * @param {'chat' | 'material' | 'challenge' | 'antrag'} route
 */
function wirksamerTyp(datei, route) {
  const regel = REGELN[route];
  if (!regel) throw new Error(`Unbekannte Upload-Route: ${route}`);
  const gemeldet = String((datei && datei.mimetype) || '').trim().toLowerCase();
  const endung = endungVon(datei && datei.originalname);
  const typDerEndung = Object.hasOwn(TYP_ZUR_ENDUNG, endung) ? TYP_ZUR_ENDUNG[endung] : null;

  if (istAllgemein(gemeldet, typDerEndung)) {
    return erlaubt(regel, typDerEndung) ? typDerEndung : null;
  }
  if (erlaubt(regel, gemeldet)) return gemeldet;
  // Ein anderer Name fuer denselben Typ (audio/x-m4a statt audio/mp4 bei
  // .m4a, wie Browser ihn fuer Sprachmemos melden): Die Endung entscheidet.
  // Passt der Inhalt nicht, faellt die Datei an den Kopfbytes durch.
  return erlaubt(regel, typDerEndung) ? typDerEndung : null;
}

/** multer-fileFilter fuer eine Route (chatUpload, materialUpload, challengeUpload, requestUpload). */
function dateiFilter(route) {
  const regel = REGELN[route];
  if (!regel) throw new Error(`Unbekannte Upload-Route: ${route}`);
  return (req, file, cb) => {
    const typ = wirksamerTyp(file, route);
    if (!typ) {
      // Endung und Typ, nicht der Dateiname.
      console.warn(`${regel.protokoll}: ${dateiFuersProtokoll(file)}`);
      cb(new DateitypAbgelehnt(regel.text));
      return;
    }
    if (typ !== file.mimetype) {
      file.gemeldeterTyp = file.mimetype;
      file.mimetype = typ;
    }
    cb(null, true);
  };
}

/** Die erlaubten Endungen einer Route (fuer die Auswahl in der App, siehe Test dort). */
function erlaubteEndungen(route) {
  const regel = REGELN[route];
  if (!regel) throw new Error(`Unbekannte Upload-Route: ${route}`);
  return Object.keys(TYP_ZUR_ENDUNG).filter((endung) => erlaubt(regel, TYP_ZUR_ENDUNG[endung]));
}

module.exports = {
  TYP_ZUR_ENDUNG,
  ALLGEMEINE_TYPEN,
  REGELN,
  DateitypAbgelehnt,
  wirksamerTyp,
  dateiFilter,
  erlaubteEndungen,
};
