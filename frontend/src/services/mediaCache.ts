// Lokaler Cache fuer Chat-Medien (Bilder + Videos).
//
// Problem davor: LazyImage/VideoPreview luden jedes Medium bei jedem
// Sichtbarwerden NEU vom Server (GET /chat/files/:path) und erzeugten dabei
// Object-URLs, die nie freigegeben wurden (Memory-Leak). Bei jedem Chat-Oeffnen
// + Scrollen = wiederholte grosse Downloads.
//
// Loesung: geladene Medien werden binaer im Filesystem (Directory.Cache)
// abgelegt (key = Hash des filePath). Beim erneuten Anzeigen kommt das Medium
// aus dem Cache statt vom Server. Es gibt eine "Cache leeren"-Funktion samt
// Groessenanzeige.
//
// Hinweis Object-URLs: getMediaObjectUrl() erzeugt eine blob:-URL, die der
// AUFRUFER beim Unmount per URL.revokeObjectURL() freigeben muss.

import { Filesystem, Directory } from '@capacitor/filesystem';
import api from './api';

const CACHE_DIR = 'media-cache';

// In-Memory-Promise-Cache: verhindert parallele Doppel-Downloads desselben
// filePath (z.B. wenn dasselbe Bild mehrfach im Viewport erscheint).
const inflight = new Map<string, Promise<Blob>>();

// Persistenter In-Memory-Object-URL-Cache: haelt fertige blob:-URLs ueber
// Mount/Unmount der Chat-Komponenten hinweg. So ist ein Bild beim erneuten
// Oeffnen des Chats SOFORT da (kein Re-Download aus dem Filesystem, kein
// Spinner, kein Layout-Sprung). Die URLs werden NICHT pro-Komponente revoked
// (das wuerde den geteilten Cache zerstoeren) — nur clearMediaCache() raeumt auf.
const objectUrlCache = new Map<string, string>();

// Stabiler, dateisystemsicherer Schluessel aus dem filePath (djb2-Hash).
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

const mimeFromKey = (key: string): string => {
  const ext = key.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo', m4v: 'video/mp4',
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
    return base64ToBlob(data, mimeFromKey(key));
  } catch {
    return null; // Nicht im Cache
  }
}

async function writeToCache(key: string, blob: Blob): Promise<void> {
  try {
    await ensureDir();
    const base64 = await blobToBase64(blob);
    await Filesystem.writeFile({ path: `${CACHE_DIR}/${key}`, data: base64, directory: Directory.Cache });
  } catch (err) {
    // Cache-Schreiben ist best-effort; Fehler (z.B. Speicher voll) nicht fatal.
    console.warn('Media-Cache: Schreiben fehlgeschlagen', err);
  }
}

async function downloadBlob(filePath: string): Promise<Blob> {
  const response = await api.get(`/chat/files/${filePath}`, { responseType: 'blob' });
  return response.data as Blob;
}

/**
 * Liefert das Medium als Blob — aus dem lokalen Cache, sonst per Download
 * (und legt es danach in den Cache).
 */
export async function getMediaBlob(filePath: string): Promise<Blob> {
  const key = cacheKey(filePath);

  const cached = await readFromCache(key);
  if (cached) return cached;

  // Laufenden Download wiederverwenden statt parallel doppelt zu laden.
  let promise = inflight.get(filePath);
  if (!promise) {
    promise = (async () => {
      const blob = await downloadBlob(filePath);
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
 * Liefert eine persistente blob:-Object-URL fuer das Medium. Die URL wird im
 * In-Memory-Cache gehalten und ueber Mount/Unmount hinweg wiederverwendet — der
 * AUFRUFER darf sie NICHT selbst revoken (nur clearMediaCache() raeumt auf).
 */
export async function getMediaObjectUrl(filePath: string): Promise<string> {
  const cached = objectUrlCache.get(filePath);
  if (cached) return cached;
  const blob = await getMediaBlob(filePath);
  // Doppelpruefung: ein paralleler Aufruf koennte die URL inzwischen gesetzt
  // haben -> dann die eigene verwerfen und die geteilte nehmen.
  const existing = objectUrlCache.get(filePath);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(filePath, url);
  return url;
}

/** Gesamtgroesse des Medien-Caches in Bytes. */
export async function getMediaCacheSize(): Promise<number> {
  try {
    const { files } = await Filesystem.readdir({ path: CACHE_DIR, directory: Directory.Cache });
    let total = 0;
    for (const f of files) {
      // Capacitor >=5 liefert FileInfo-Objekte mit size; aeltere nur Namen.
      if (typeof f === 'object' && f !== null && 'size' in f && typeof (f as any).size === 'number') {
        total += (f as any).size;
      } else {
        const name = typeof f === 'string' ? f : (f as any).name;
        try {
          const stat = await Filesystem.stat({ path: `${CACHE_DIR}/${name}`, directory: Directory.Cache });
          total += stat.size || 0;
        } catch {
          // Datei verschwand -> ignorieren
        }
      }
    }
    return total;
  } catch {
    return 0; // Verzeichnis existiert (noch) nicht
  }
}

/** Loescht den kompletten Medien-Cache (Filesystem + In-Memory-Object-URLs). */
export async function clearMediaCache(): Promise<void> {
  inflight.clear();
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
