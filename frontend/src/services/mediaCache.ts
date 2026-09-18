// Lokaler Cache für Chat-Medien (Bilder + Videos).
//
// Problem davor: LazyImage/VideoPreview luden jedes Medium bei jedem
// Sichtbarwerden NEU vom Server (GET /chat/files/:path) und erzeugten dabei
// Object-URLs, die nie freigegeben wurden (Memory-Leak). Bei jedem Chat-Oeffnen
// + Scrollen = wiederholte grosse Downloads.
//
// Lösung: geladene Medien werden binaer im Filesystem (Directory.Cache)
// abgelegt (key = Hash des filePath). Beim erneuten Anzeigen kommt das Medium
// aus dem Cache statt vom Server. Es gibt eine "Cache leeren"-Funktion samt
// Groessenanzeige.
//
// Hinweis Object-URLs: getMediaObjectUrl() erzeugt eine blob:-URL, die der
// AUFRUFER beim Unmount per URL.revokeObjectURL() freigeben muss.

import { Filesystem, Directory } from '@capacitor/filesystem';
import api, { DATEI_TIMEOUT_MS } from './api';

const CACHE_DIR = 'media-cache';

// In-Memory-Promise-Cache: verhindert parallele Doppel-Downloads desselben
// filePath (z.B. wenn dasselbe Bild mehrfach im Viewport erscheint).
const inflight = new Map<string, Promise<Blob>>();

// Persistenter In-Memory-Object-URL-Cache: haelt fertige blob:-URLs über
// Mount/Unmount der Chat-Komponenten hinweg. So ist ein Bild beim erneuten
// Oeffnen des Chats SOFORT da (kein Re-Download aus dem Filesystem, kein
// Spinner, kein Layout-Sprung). Die URLs werden NICHT pro-Komponente revoked
// (das wuerde den geteilten Cache zerstoeren) — nur clearMediaCache() räumt auf.
const objectUrlCache = new Map<string, string>();

// Stabiler, dateisystemsicherer Schlüssel aus dem filePath (djb2-Hash).
const cacheKey = (filePath: string): string => {
  let hash = 5381;
  for (let i = 0; i < filePath.length; i++) {
    hash = ((hash << 5) + hash + filePath.charCodeAt(i)) | 0;
  }
  // Endung mitnehmen, damit der korrekte MIME-Typ rekonstruierbar bleibt.
  const extMatch = filePath.match(/\.([a-zA-Z0-9]{1,5})$/);
  const ext = extMatch ? '.' + extMatch[1].toLowerCase() : '';
  return `${(hash >>> 0).toString(36)}${ext}`;
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // dataURL -> nur den Base64-Teil
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
};

// Der MIME-Typ muss aus dem Schluessel rekonstruierbar sein, weil im Cache nur
// die Bytes liegen — nicht der Content-Type der Antwort. Ein falscher Typ faellt
// bei PDFs sofort auf: der native Betrachter oeffnet sie dann nicht.
const mimeFromKey = (key: string): string => {
  const ext = key.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
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
    txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg',
    zip: 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
};

async function ensureDir(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: CACHE_DIR, directory: Directory.Cache, recursive: true });
  } catch {
    // Existiert bereits -> ok.
  }
}

async function readFromCache(key: string): Promise<Blob | null> {
  try {
    const res = await Filesystem.readFile({ path: `${CACHE_DIR}/${key}`, directory: Directory.Cache });
    const data = res.data as string; // Base64 (ohne encoding-Angabe liefert Capacitor Base64)
    beruehren(key);
    return base64ToBlob(data, mimeFromKey(key));
  } catch {
    return null; // Nicht im Cache
  }
}

// Zeitpunkt des letzten ZUGRIFFS, im Speicher gefuehrt.
//
// Warum nicht die mtime der Datei: Die aendert sich nur beim Schreiben. Wer eine
// PDF ein Jahr lang jede Woche oeffnet, haette weiter die mtime vom ersten Tag
// und floege als "aeltestes" raus, waehrend ein einmal geladenes Video von
// gestern bliebe. Genau falsch herum. Das Beruehren beim Lesen macht aus
// "aeltestes geschrieben" ein "am laengsten nicht benutzt".
//
// Die Karte ueberlebt keinen App-Neustart. Das ist hinnehmbar: Nach einem
// Neustart faellt die Reihenfolge auf die mtime zurueck (siehe letzteNutzung),
// und die ist als grobe Naeherung brauchbar. Sie in die Datei zu schreiben
// hiesse, bei jedem Anzeigen eines Bildes erneut zu schreiben — teurer als der
// Gewinn.
const letzterZugriff = new Map<string, number>();

const beruehren = (key: string): void => {
  letzterZugriff.set(key, Date.now());
};

async function writeToCache(key: string, blob: Blob): Promise<void> {
  try {
    await ensureDir();
    const base64 = await blobToBase64(blob);
    await Filesystem.writeFile({ path: `${CACHE_DIR}/${key}`, data: base64, directory: Directory.Cache });
    beruehren(key);
    // Nach dem Schreiben aufraeumen, nicht davor: Die eben geladene Datei soll
    // auf jeden Fall drin sein. Bewusst nicht abgewartet — der Nutzer wartet
    // sonst auf das Aufraeumen, obwohl seine Datei laengst da ist.
    void grenzeDurchsetzen();
  } catch (err) {
    // Cache-Schreiben ist best-effort; Fehler (z.B. Speicher voll) nicht fatal.
    console.warn('Media-Cache: Schreiben fehlgeschlagen', err);
  }
}

/** Fortschritt eines Downloads: Prozent, oder null wenn der Server keine
 *  Groesse meldet (dann laeuft die Anzeige unbestimmt statt auf einer
 *  geratenen Zahl). */
export type FortschrittHandler = (prozent: number | null) => void;

async function downloadBlob(filePath: string, onFortschritt?: FortschrittHandler): Promise<Blob> {
  const response = await api.get(`/chat/files/${filePath}`, {
    responseType: 'blob',
    // Eigenes, hoeheres Zeitlimit fuer Dateien (siehe api.ts): Das globale
    // von 20 s liess grosse Anhaenge auf langsamer Leitung scheitern.
    timeout: DATEI_TIMEOUT_MS,
    onDownloadProgress: onFortschritt
      ? (ereignis) => {
          const gesamt = ereignis.total;
          onFortschritt(gesamt ? Math.min(Math.round((ereignis.loaded / gesamt) * 100), 100) : null);
        }
      : undefined,
  });
  return response.data as Blob;
}

/**
 * Liegt die Datei schon im Cache? Erlaubt es dem Aufrufer, bei einem Treffer
 * gar keine Ladeanzeige zu zeigen — ein Spinner, der sofort wieder verschwindet,
 * blitzt nur unangenehm auf.
 */
export async function istGecacht(filePath: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path: `${CACHE_DIR}/${cacheKey(filePath)}`, directory: Directory.Cache });
    return true;
  } catch {
    return false;
  }
}

/**
 * Liefert das Medium als Blob — aus dem lokalen Cache, sonst per Download
 * (und legt es danach in den Cache).
 *
 * `onFortschritt` wird nur beim echten Download gerufen, nicht beim
 * Cache-Treffer.
 */
export async function getMediaBlob(filePath: string, onFortschritt?: FortschrittHandler): Promise<Blob> {
  const key = cacheKey(filePath);

  const cached = await readFromCache(key);
  if (cached) return cached;

  // Laufenden Download wiederverwenden statt parallel doppelt zu laden.
  let promise = inflight.get(filePath);
  if (!promise) {
    promise = (async () => {
      const blob = await downloadBlob(filePath, onFortschritt);
      await writeToCache(key, blob);
      return blob;
    })();
    inflight.set(filePath, promise);
  }
  try {
    return await promise;
  } finally {
    inflight.delete(filePath);
  }
}

/**
 * Synchron: liefert die bereits im In-Memory-Cache liegende Object-URL — oder
 * null, wenn das Medium (noch) nicht geladen wurde. Erlaubt es, gecachte Bilder
 * SOFORT beim Render anzuzeigen (ohne Lazy-Load/Ruckeln), und nur ungecachte
 * Bilder lazy nachzuladen.
 */
export function getCachedObjectUrl(filePath: string): string | null {
  return objectUrlCache.get(filePath) ?? null;
}

/**
 * Liefert eine persistente blob:-Object-URL für das Medium. Die URL wird im
 * In-Memory-Cache gehalten und über Mount/Unmount hinweg wiederverwendet — der
 * AUFRUFER darf sie NICHT selbst revoken (nur clearMediaCache() räumt auf).
 */
export async function getMediaObjectUrl(filePath: string): Promise<string> {
  const cached = objectUrlCache.get(filePath);
  if (cached) return cached;
  const blob = await getMediaBlob(filePath);
  // Doppelpruefung: ein paralleler Aufruf könnte die URL inzwischen gesetzt
  // haben -> dann die eigene verwerfen und die geteilte nehmen.
  const existing = objectUrlCache.get(filePath);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(filePath, url);
  return url;
}

// Obergrenze des Caches. Darueber fliegt raus, was am laengsten nicht benutzt
// wurde, bis die Groesse wieder darunter liegt.
//
// Warum ueberhaupt eine Grenze: Bis dahin wuchs der Cache monoton
// und wurde nur geleert, wenn jemand von Hand "Medien-Cache leeren" drueckte.
// Solange nur Bilder und Videos aus dem Chat hineinliefen, fiel das kaum auf.
// Seit auch Dokumente und Audio gecacht werden, waechst er deutlich schneller.
//
// 500 MB, weil eine einzelne Chat-Datei hoechstens 10 MB gross sein darf
// (useChatDateien.ts) — es passen also immer mindestens 50 Dateien hinein, und
// der uebliche Bestand aus Bildern liegt um Groessenordnungen darunter.
const MAX_CACHE_BYTES = 500 * 1024 * 1024;

type CacheEintrag = { name: string; size: number; mtime: number };

// Listet den Cache mit Groesse und Zeitstempel je Datei.
async function eintraegeLesen(): Promise<CacheEintrag[]> {
  const { files } = await Filesystem.readdir({ path: CACHE_DIR, directory: Directory.Cache });
  const eintraege: CacheEintrag[] = [];

  for (const f of files as unknown[]) {
    // Capacitor >=5 liefert FileInfo-Objekte mit size/mtime; aeltere nur Namen.
    const roh = f as { size?: unknown; name?: unknown; mtime?: unknown };
    const name = typeof f === 'string' ? f : (typeof roh.name === 'string' ? roh.name : null);
    if (!name) continue;

    let size = typeof roh.size === 'number' ? roh.size : null;
    let mtime = typeof roh.mtime === 'number' ? roh.mtime : null;

    if (size === null || mtime === null) {
      try {
        const stat = await Filesystem.stat({ path: `${CACHE_DIR}/${name}`, directory: Directory.Cache });
        size = size ?? stat.size ?? 0;
        mtime = mtime ?? stat.mtime ?? 0;
      } catch {
        continue; // Datei verschwand -> ignorieren
      }
    }
    eintraege.push({ name, size: size ?? 0, mtime: mtime ?? 0 });
  }
  return eintraege;
}

// Der Zeitpunkt, nach dem sortiert wird: der Zugriff dieser Sitzung, sonst die
// mtime als Naeherung fuer alles, was vor dem letzten App-Start geladen wurde.
const letzteNutzung = (e: CacheEintrag): number =>
  letzterZugriff.get(e.name) ?? e.mtime;

// Nur ein Aufraeumlauf gleichzeitig: writeToCache stoesst das nach JEDEM
// Schreiben an, und bei mehreren Downloads kurz hintereinander wuerden sich
// sonst mehrere Laeufe gegenseitig Dateien wegloeschen, die der andere gerade
// noch eingerechnet hat.
let laufendesAufraeumen: Promise<void> | null = null;

/**
 * Wirft die am laengsten nicht benutzten Dateien raus, bis der Cache wieder
 * unter MAX_CACHE_BYTES liegt. Fehler sind nicht fatal — der Cache ist dann
 * eben zu gross, aber die App funktioniert.
 */
export async function grenzeDurchsetzen(): Promise<void> {
  if (laufendesAufraeumen) return laufendesAufraeumen;

  laufendesAufraeumen = (async () => {
    try {
      const eintraege = await eintraegeLesen();
      let gesamt = eintraege.reduce((summe, e) => summe + e.size, 0);
      if (gesamt <= MAX_CACHE_BYTES) return;

      // Aeltester Zugriff zuerst — der fliegt als Erstes.
      eintraege.sort((a, b) => letzteNutzung(a) - letzteNutzung(b));

      for (const e of eintraege) {
        if (gesamt <= MAX_CACHE_BYTES) break;
        try {
          await Filesystem.deleteFile({ path: `${CACHE_DIR}/${e.name}`, directory: Directory.Cache });
          gesamt -= e.size;
          letzterZugriff.delete(e.name);
          // Die Object-URL derselben Datei muss mitgehen, sonst zeigt die App
          // weiter auf einen Blob, den der Cache nicht mehr kennt.
          for (const [pfad, url] of objectUrlCache.entries()) {
            if (cacheKey(pfad) === e.name) {
              URL.revokeObjectURL(url);
              objectUrlCache.delete(pfad);
            }
          }
        } catch {
          // Loeschen fehlgeschlagen -> naechste Datei versuchen.
        }
      }
    } catch {
      // Verzeichnis existiert (noch) nicht -> nichts aufzuraeumen.
    } finally {
      laufendesAufraeumen = null;
    }
  })();

  return laufendesAufraeumen;
}

/** Gesamtgroesse des Medien-Caches in Bytes. */
export async function getMediaCacheSize(): Promise<number> {
  try {
    const eintraege = await eintraegeLesen();
    return eintraege.reduce((summe, e) => summe + e.size, 0);
  } catch {
    return 0; // Verzeichnis existiert (noch) nicht
  }
}

/** Loescht den kompletten Medien-Cache (Filesystem + In-Memory-Object-URLs). */
export async function clearMediaCache(): Promise<void> {
  inflight.clear();
  letzterZugriff.clear();
  // In-Memory-Object-URLs freigeben (sonst Memory-Leak) und Cache leeren.
  for (const url of objectUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  objectUrlCache.clear();
  try {
    await Filesystem.rmdir({ path: CACHE_DIR, directory: Directory.Cache, recursive: true });
  } catch {
    // Verzeichnis existierte nicht -> nichts zu tun.
  }
}
