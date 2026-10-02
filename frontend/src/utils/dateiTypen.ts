// Endung -> Dateityp: EINE Tabelle für die ganze App.
//
// Gebraucht an drei Stellen, die früher je eine eigene Tabelle hatten oder
// gar keine: beim Anzeigen und Öffnen einer Datei (der Server vergibt
// Dateinamen ohne Endung, der Typ steht nur im Originalnamen), im
// Medien-Cache (dort liegen nur Bytes) und beim Hochladen, wenn das Gerät
// keinen Typ nennt.
//
// WOFÜR BEIM HOCHLADEN:
// „Word hab ich mir versucht vom Android eine rauszuschicken — eine .docx
// Datei ging nicht :(" Nennt Android für eine Datei keinen Typ, schickt das
// WebView sie als application/octet-stream, und der Server verwarf sie
// still. Der Server entscheidet inzwischen selbst nach der Endung
// (backend/utils/uploadTypen.js); die App schickt trotzdem gleich den
// richtigen Typ mit — für Server, die das noch nicht können, für die
// Verkleinerung von Fotos (die an `image/` hängt) und für die Warteschlange,
// die bei fehlendem Typ bis dahin image/jpeg behauptete.

const TYP_ZUR_ENDUNG: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo', m4v: 'video/mp4',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg',
  zip: 'application/zip',
};

const UNBEKANNT = 'application/octet-stream';

/** Angaben, die nichts über den Inhalt sagen. */
const ALLGEMEINE_TYPEN = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

/**
 * Typ aus einem Dateinamen wie "foto.png" — oder application/octet-stream,
 * wenn die Endung fehlt oder unbekannt ist.
 */
export const mimeAusDateiname = (name: string | null | undefined): string => {
  if (!name || !name.includes('.')) return UNBEKANNT;
  const endung = name.split('.').pop()?.toLowerCase() || '';
  return Object.prototype.hasOwnProperty.call(TYP_ZUR_ENDUNG, endung) ? TYP_ZUR_ENDUNG[endung] : UNBEKANNT;
};

/** Sagt der Typ nichts über den Inhalt (fehlt, leer, application/octet-stream)? */
export const istAllgemeinerTyp = (typ: string | null | undefined): boolean =>
  ALLGEMEINE_TYPEN.has((typ || '').trim().toLowerCase());

/**
 * Der Typ, mit dem eine Datei hochgeht: der gemeldete, solange er etwas sagt,
 * sonst der aus der Endung (notfalls application/octet-stream — dann
 * entscheidet der Server und weist sie verständlich ab).
 */
export const typFuerUpload = (typ: string | null | undefined, name: string | null | undefined): string =>
  istAllgemeinerTyp(typ) ? mimeAusDateiname(name) : (typ as string);

/**
 * Dieselbe Datei, aber mit Typ: Fehlt er oder ist er allgemein, kommt er aus
 * der Endung. Kennt auch die Endung keinen, bleibt die Datei, wie sie ist.
 */
export const mitTypAusEndung = (datei: File): File => {
  if (!istAllgemeinerTyp(datei.type)) return datei;
  const typ = mimeAusDateiname(datei.name);
  if (typ === UNBEKANNT) return datei;
  return new File([datei], datei.name, { type: typ, lastModified: datei.lastModified });
};

/**
 * Was der Chat außer Fotos und Videos annimmt — dieselbe Liste wie der Server
 * (backend/utils/uploadTypen.js, REGELN.chat); der Test dateiTypen.test.ts
 * gleicht beide ab.
 */
export const CHAT_DATEIENDUNGEN = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'csv', 'mp3', 'm4a', 'ogg', 'wav'] as const;

export const CHAT_DATEIAUSWAHL = ['image/*', 'video/*', ...CHAT_DATEIENDUNGEN.map((e) => `.${e}`)].join(',');
