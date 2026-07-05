import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { toastController } from '@ionic/core';
import { networkMonitor } from './networkMonitor';
import api from './api';

// --- Interfaces ---

export interface QueueItem {
  id: string;
  method: 'POST' | 'PUT' | 'DELETE';
  url: string;
  body?: any;
  headers?: Record<string, string>;
  maxRetries: number;
  retryCount: number;
  createdAt: number;
  hasFileUpload: boolean;
  metadata: {
    type: 'chat' | 'request' | 'opt-out' | 'fire-and-forget' | 'admin' | 'teamer';
    clientId: string;
    roomId?: number;
    label?: string;
  };
}

export interface FailedQueueItem extends QueueItem {
  error: { status: number; message: string };
}

export interface FlushResult {
  succeeded: QueueItem[];
  failed: FailedQueueItem[];
}

// --- Persistenz-Layer ---

const QUEUE_KEY = 'queue:items';
let _items: QueueItem[] | null = null; // In-Memory-Cache, lazy geladen
let _flushing = false;

async function _load(): Promise<QueueItem[]> {
  if (_items !== null) return _items;
  try {
    const result = await Preferences.get({ key: QUEUE_KEY });
    if (!result.value) {
      _items = [];
      return _items;
    }
    _items = JSON.parse(result.value) as QueueItem[];
    return _items;
  } catch {
    // Korruptes JSON — zurücksetzen
    await Preferences.remove({ key: QUEUE_KEY });
    _items = [];
    return _items;
  }
}

async function _save(items: QueueItem[]): Promise<void> {
  _items = items;
  await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(items) });
}

// --- UUID Helper ---

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// --- Fehler-Toast ---

async function showFailedToast(label: string): Promise<void> {
  try {
    const toast = await toastController.create({
      message: `${label} konnte nicht gesendet werden`,
      duration: 4000,
      position: 'bottom',
      color: 'danger',
    });
    await toast.present();
  } catch {
    // Toast nicht verfügbar (z.B. im Background)
  }
}

function handleFlushResult(result: FlushResult): void {
  for (const item of result.failed) {
    // 'fire-and-forget' sind stille Hintergrund-Cleanups (z.B. Push-Token beim
    // Logout entfernen). Sie scheitern nach dem Logout zwangslaeufig (kein
    // Auth-Token mehr) und gehen den User nichts an -> KEIN Fehler-Toast.
    // Sonst erscheint "Push-Token entfernen konnte nicht gesendet werden" aus
    // dem Nichts auf der Login-Seite.
    if (item.metadata.type === 'fire-and-forget') continue;
    // 'chat': fehlgeschlagene Nachrichten werden bereits IN der Bubble mit
    // Retry-Button angezeigt (queueStatus 'error'). Ein zusaetzlicher globaler
    // Toast erscheint sonst "aus dem Nichts", wenn ein Hintergrund-Flush
    // (Reconnect/Online) eine alte Queue-Nachricht erneut nicht senden kann.
    if (item.metadata.type === 'chat') continue;
    const label = item.metadata.label || 'Aktion';
    showFailedToast(label);
  }
}

// --- Foto-Upload Helfer für Queue-Items mit _localPhotoPath ---

async function resolveLocalPhoto(body: any): Promise<void> {
  if (!body?._localPhotoPath) return;

  // Datei aus Capacitor Filesystem lesen
  const fileResult = await Filesystem.readFile({
    path: body._localPhotoPath,
    directory: Directory.Data,
  });

  // Base64 zu Blob konvertieren
  const base64Data = typeof fileResult.data === 'string'
    ? fileResult.data
    : '';
  // data URL prefix entfernen falls vorhanden
  const rawBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const byteChars = atob(rawBase64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteArray[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([byteArray], { type: 'image/jpeg' });

  // Upload via FormData
  const formData = new FormData();
  formData.append('photo', blob, body._photoFileName || 'photo.jpg');
  const uploadResponse = await api.post('/konfi/upload-photo', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // Foto-Upload auf Mobilfunk kann laenger dauern als die globalen 20s
    timeout: 60000,
  });

  // Filename in body setzen, lokale Felder entfernen
  body.photo_filename = uploadResponse.data.filename;

  // Lokale Datei löschen (best-effort)
  try {
    await Filesystem.deleteFile({
      path: body._localPhotoPath,
      directory: Directory.Data,
    });
  } catch {
    // Ignorieren — wird beim nächsten Cleanup aufgeräumt
  }

  delete body._localPhotoPath;
  delete body._photoFileName;
}

// --- Chat-Bild-Upload Helfer für Queue-Items mit _localFilePath ---

// Konvertiert die lokal gespeicherte Chat-Datei zu FormData fuer den Request.
// WICHTIG: Ueberschreibt NICHT item.body (FormData ist nicht serialisierbar und
// wuerde beim _save zu {} werden -> Datenverlust bei Retry). Gibt FormData zurueck;
// das persistierte Item behaelt _localFilePath, damit ein Retry erneut lesen kann.
// Die lokale Datei wird erst nach erfolgreichem Request geloescht (siehe flush()).
async function resolveLocalFile(item: QueueItem): Promise<FormData | null> {
  const body = item.body;
  if (!body?._localFilePath) return null;

  // Datei aus Capacitor Filesystem lesen
  const fileResult = await Filesystem.readFile({
    path: body._localFilePath,
    directory: Directory.Data,
  });

  // Base64 zu Blob konvertieren
  const base64Data = typeof fileResult.data === 'string'
    ? fileResult.data
    : '';
  const rawBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const byteChars = atob(rawBase64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteArray[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([byteArray], { type: body._fileType || 'image/jpeg' });

  // FormData aufbauen (Chat-Bild-Upload)
  const formData = new FormData();
  formData.append('content', body.content || '');
  formData.append('file', blob, body._fileName || 'image.jpg');
  if (body.client_id) formData.append('client_id', body.client_id);

  return formData;
}

// Loescht die lokale Chat-Datei nach erfolgreichem Upload (best-effort).
async function cleanupLocalFile(item: QueueItem): Promise<void> {
  const path = item.body?._localFilePath;
  if (!path) return;
  try {
    await Filesystem.deleteFile({ path, directory: Directory.Data });
  } catch {
    // Ignorieren — wird beim naechsten Cleanup aufgeraeumt
  }
}

// --- Öffentliche API ---

async function enqueue(
  item: Omit<QueueItem, 'id' | 'retryCount' | 'createdAt'>
): Promise<QueueItem> {
  const items = await _load();
  const newItem: QueueItem = {
    ...item,
    id: generateId(),
    retryCount: 0,
    createdAt: Date.now(),
  };
  items.push(newItem);
  await _save(items);
  return newItem;
}

async function flush(): Promise<FlushResult> {
  if (_flushing) return { succeeded: [], failed: [] };
  _flushing = true;

  const result: FlushResult = { succeeded: [], failed: [] };

  try {
    const items = await _load();

    while (items.length > 0) {
      const item = items[0];
      try {
        // Lokales Foto zuerst hochladen falls vorhanden (Aktivitäts-Anträge)
        if (item.body?._localPhotoPath) {
          await resolveLocalPhoto(item.body);
          await _save(items); // Body-Update persistieren
        }

        // Chat-Bild aus lokalem Filesystem zu FormData konvertieren.
        // requestBody ist FLUECHTIG — item.body bleibt unveraendert (serialisierbar),
        // damit ein Retry nach transientem Fehler die Datei erneut lesen kann.
        let requestBody: any = item.body;
        let requestHeaders = item.headers;
        if (item.body?._localFilePath) {
          const formData = await resolveLocalFile(item);
          if (formData) {
            requestBody = formData;
            requestHeaders = { 'Content-Type': 'multipart/form-data' };
          }
        }

        const config: any = {};
        if (requestHeaders) config.headers = requestHeaders;
        // Medien-Replays (FormData) brauchen auf Mobilfunk mehr als die globalen 20s
        if (typeof FormData !== 'undefined' && requestBody instanceof FormData) {
          config.timeout = 60000;
        }

        if (item.method === 'DELETE') {
          await api.delete(item.url, config);
        } else if (item.method === 'PUT') {
          await api.put(item.url, requestBody, config);
        } else {
          await api.post(item.url, requestBody, config);
        }

        // Erfolg: lokale Datei aufraeumen, dann Item entfernen
        await cleanupLocalFile(item);
        result.succeeded.push(item);
        items.shift();
        await _save(items);
      } catch (err: any) {
        const status = err?.response?.status || 0;
        const message = err?.response?.data?.error || err?.message || 'Unbekannter Fehler';

        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          // 4xx (ausser 408/429): Item entfernen, als failed markieren
          const failedItem: FailedQueueItem = { ...item, error: { status, message } };
          result.failed.push(failedItem);
          items.shift();
          await _save(items);
        } else {
          // 5xx, 408, 429, Netzwerkfehler: retryCount erhöhen
          item.retryCount++;
          if (item.retryCount >= item.maxRetries) {
            const failedItem: FailedQueueItem = { ...item, error: { status, message } };
            result.failed.push(failedItem);
            items.shift();
          } else {
            // Item behalten mit erhöhtem retryCount
          }
          await _save(items);
          // Bei transientem Fehler restliche Items nicht weiter abarbeiten
          break;
        }
      }
    }
  } finally {
    _flushing = false;
  }

  handleFlushResult(result);
  return result;
}

async function flushTextOnly(): Promise<FlushResult> {
  if (_flushing) return { succeeded: [], failed: [] };
  _flushing = true;

  const result: FlushResult = { succeeded: [], failed: [] };

  try {
    const items = await _load();
    let i = 0;

    while (i < items.length) {
      const item = items[i];

      // Datei-Uploads überspringen
      if (item.hasFileUpload) {
        i++;
        continue;
      }

      try {
        const config: any = {};
        if (item.headers) config.headers = item.headers;

        if (item.method === 'DELETE') {
          await api.delete(item.url, config);
        } else if (item.method === 'PUT') {
          await api.put(item.url, item.body, config);
        } else {
          await api.post(item.url, item.body, config);
        }

        result.succeeded.push(item);
        items.splice(i, 1);
        await _save(items);
      } catch (err: any) {
        const status = err?.response?.status || 0;
        const message = err?.response?.data?.error || err?.message || 'Unbekannter Fehler';

        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          const failedItem: FailedQueueItem = { ...item, error: { status, message } };
          result.failed.push(failedItem);
          items.splice(i, 1);
          await _save(items);
        } else {
          item.retryCount++;
          if (item.retryCount >= item.maxRetries) {
            const failedItem: FailedQueueItem = { ...item, error: { status, message } };
            result.failed.push(failedItem);
            items.splice(i, 1);
          } else {
            i++;
          }
          await _save(items);
          break;
        }
      }
    }
  } finally {
    _flushing = false;
  }

  handleFlushResult(result);
  return result;
}

async function remove(id: string): Promise<void> {
  const items = await _load();
  const filtered = items.filter(item => item.id !== id);
  await _save(filtered);
}

async function getAll(): Promise<QueueItem[]> {
  const items = await _load();
  return [...items];
}

async function getByMetadata(filter: Partial<QueueItem['metadata']>): Promise<QueueItem[]> {
  const items = await _load();
  return items.filter(item => {
    for (const key of Object.keys(filter) as Array<keyof QueueItem['metadata']>) {
      if (item.metadata[key] !== filter[key]) return false;
    }
    return true;
  });
}

async function clear(): Promise<void> {
  await _save([]);
}

// --- Auto-Flush bei Online-Wechsel ---

networkMonitor.subscribe((isOnline) => {
  if (isOnline) {
    flush();
  }
});

// --- Export ---

export const writeQueue = {
  enqueue,
  flush,
  flushTextOnly,
  remove,
  getAll,
  getByMetadata,
  clear,
};
