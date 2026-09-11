import type { AxiosRequestConfig } from 'axios';
import { Preferences } from '@capacitor/preferences';
import { fehlerStatus, fehlerTextOderMessage } from '../utils/fehler';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { toastController } from '@ionic/core';
import { networkMonitor } from './networkMonitor';
import api from './api';

// --- Interfaces ---

/**
 * Der eingereihte Request-Rumpf.
 *
 * Muss serialisierbar bleiben (er ueberlebt in Preferences den App-Neustart),
 * darum nur JSON-Werte. Felder mit fuehrendem Unterstrich sind LOKALE
 * Marker fuer Dateien im Capacitor-Filesystem; sie werden beim Senden
 * aufgeloest und nie an den Server geschickt.
 */
export interface QueueBody {
  [feld: string]: unknown;
  /** Nachrichtentext (Chat) bzw. Freitext des Vorgangs. */
  content?: string;
  /**
   * Beschreibung eines gemeldeten Vorgangs — die Liste der wartenden
   * Vorgaenge zeigt sie an. Formulare liefern hier auch null.
   */
  description?: string | null;
  /** Idempotenzschluessel — der Server erkennt daran den Doppelversand. */
  client_id?: string;
  /** Pfad eines lokal zwischengespeicherten Fotos (gemeldete Aktivitaeten). */
  _localPhotoPath?: string;
  _photoFileName?: string;
  photo_filename?: string;
  /** Pfad einer lokal zwischengespeicherten Chat-Datei. */
  _localFilePath?: string;
  _fileName?: string;
  _fileType?: string;
}

export interface QueueItem {
  id: string;
  method: 'POST' | 'PUT' | 'DELETE';
  url: string;
  body?: QueueBody;
  headers?: Record<string, string>;
  maxRetries: number;
  retryCount: number;
  createdAt: number;
  hasFileUpload: boolean;
  metadata: {
    type: 'chat' | 'chat-aktion' | 'request' | 'opt-out' | 'fire-and-forget' | 'admin' | 'teamer';
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

// --- Endgueltig fehlgeschlagene Items melden ---
type FailedListener = (item: FailedQueueItem) => void;
const failedListeners = new Set<FailedListener>();

export function onItemFailed(listener: FailedListener): () => void {
  failedListeners.add(listener);
  return () => { failedListeners.delete(listener); };
}

function notifyFailed(item: FailedQueueItem): void {
  failedListeners.forEach((l) => {
    try { l(item); } catch { /* ein kaputter Melder darf den Flush nicht stoppen */ }
  });
}

// --- Aenderungen an der Warteschlange melden ---
//
// Die Anzeige "Wird gesendet..." lag bisher nur an zwei Stellen und aktuali-
// sierte sich, wenn die zugehoerige Liste neu lud. Leerte sich die Queue im
// Hintergrund (Reconnect, App-Start), blieb der Hinweis stehen, bis jemand
// zog. Ueber diesen Melder erfaehrt jede Ansicht davon, ohne zu pollen.
type ChangeListener = () => void;
const changeListeners = new Set<ChangeListener>();

export function onQueueChanged(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => { changeListeners.delete(listener); };
}

function notifyChanged(): void {
  changeListeners.forEach((l) => {
    try { l(); } catch { /* ein kaputter Melder darf den Flush nicht stoppen */ }
  });
}

// --- Persistenz-Layer ---

const QUEUE_KEY = 'queue:items';
const FAILED_CHAT_KEY = 'queue:failedChat';
const FAILED_CHAT_MAX = 50;
const FAILED_ACTIONS_KEY = 'queue:failedActions';
const FAILED_ACTIONS_MAX = 50;
let _items: QueueItem[] | null = null; // In-Memory-Cache, lazy geladen
let _flushing = false;
// Zaehlt clear()-Aufrufe. Ein laufender flush() vergleicht dagegen: Wurde die
// Queue zwischenzeitlich geleert (Org-Wechsel/Logout), darf er seinen alten
// Arbeitsstand NICHT zurueckschreiben — sonst stehen geleerte Items wieder auf.
let _generation = 0;

// Merker für endgueltig fehlgeschlagene Chat-Nachrichten. Gibt die Queue ein
// Chat-Item nach maxRetries (oder bei 4xx) auf, waere die Nachricht ohne
// geoeffneten Chat spurlos weg: kein Queue-Item mehr, kein Toast (bewusst,
// siehe handleFlushResult), keine Bubble. Der Merker haelt Inhalt und client_id
// fest, damit der Chat sie beim naechsten Oeffnen als fehlgeschlagene Bubble
// mit Retry-Knopf wieder anzeigen kann.
export interface FailedChatMessage {
  clientId: string;
  roomId?: number;
  content: string;
  fileName?: string;
  fileType?: string;
  localFilePath?: string;
  createdAt: number;
  failedAt: number;
  error: { status: number; message: string };
}

let _failedChat: FailedChatMessage[] | null = null;

// Bis dahin gab es fuer sie nur `showFailedToast` — vier Sekunden, und weg.
// Laeuft der Flush im Hintergrund (Reconnect, App-Start) oder startet die App
// zwischendurch neu, sieht die Meldung niemand: Eine offline abgegebene
// Abmeldung konnte verpuffen, waehrend die App "wird gesendet" bestaetigt
// hatte. Chat-Nachrichten hatten diesen Schutz laengst (siehe oben) — hier
// bekommt ihn der Rest, nach demselben Muster.
//
// Der Toast bleibt: Er ist der schnelle Hinweis, wenn jemand gerade hinsieht.
// Der Merker ist das Gedaechtnis fuer alle anderen Faelle.
export interface FailedAction {
  id: string;
  label: string;
  type: string;
  createdAt: number;
  failedAt: number;
  error: { status: number; message: string };
}

let _failedActions: FailedAction[] | null = null;

async function _loadFailedActions(): Promise<FailedAction[]> {
  if (_failedActions !== null) return _failedActions;
  try {
    const result = await Preferences.get({ key: FAILED_ACTIONS_KEY });
    _failedActions = result.value ? (JSON.parse(result.value) as FailedAction[]) : [];
  } catch {
    await Preferences.remove({ key: FAILED_ACTIONS_KEY });
    _failedActions = [];
  }
  return _failedActions;
}

async function _saveFailedActions(list: FailedAction[]): Promise<void> {
  _failedActions = list;
  await Preferences.set({ key: FAILED_ACTIONS_KEY, value: JSON.stringify(list) });
  notifyChanged();
}

async function rememberFailedAction(
  item: QueueItem,
  error: { status: number; message: string }
): Promise<void> {
  const list = await _loadFailedActions();
  const ohneAlten = list.filter(f => f.id !== item.id);
  ohneAlten.push({
    id: item.id,
    label: item.metadata.label || 'Aktion',
    type: item.metadata.type,
    createdAt: item.createdAt,
    failedAt: Date.now(),
    error,
  });
  while (ohneAlten.length > FAILED_ACTIONS_MAX) ohneAlten.shift();
  await _saveFailedActions(ohneAlten);
}

/** Alle gemerkten Fehlschlaege, neueste zuletzt. */
async function getFailedActions(): Promise<FailedAction[]> {
  return [...(await _loadFailedActions())];
}

/** Einen gemerkten Fehlschlag verwerfen (z.B. nachdem jemand ihn gesehen hat). */
async function forgetFailedAction(id: string): Promise<void> {
  const list = await _loadFailedActions();
  if (!list.some(f => f.id === id)) return;
  await _saveFailedActions(list.filter(f => f.id !== id));
}

/** Alle gemerkten Fehlschlaege verwerfen. */
async function forgetAllFailedActions(): Promise<void> {
  await _saveFailedActions([]);
}

async function _loadFailedChat(): Promise<FailedChatMessage[]> {
  if (_failedChat !== null) return _failedChat;
  try {
    const result = await Preferences.get({ key: FAILED_CHAT_KEY });
    _failedChat = result.value ? (JSON.parse(result.value) as FailedChatMessage[]) : [];
  } catch {
    await Preferences.remove({ key: FAILED_CHAT_KEY });
    _failedChat = [];
  }
  return _failedChat;
}

async function _saveFailedChat(list: FailedChatMessage[]): Promise<void> {
  _failedChat = list;
  await Preferences.set({ key: FAILED_CHAT_KEY, value: JSON.stringify(list) });
}

async function rememberFailedChat(item: QueueItem, error: { status: number; message: string }): Promise<void> {
  if (item.metadata.type !== 'chat') return;
  const list = await _loadFailedChat();
  const ohneAlten = list.filter(f => f.clientId !== item.metadata.clientId);
  ohneAlten.push({
    clientId: item.metadata.clientId,
    roomId: item.metadata.roomId,
    content: item.body?.content || '',
    fileName: item.body?._fileName,
    fileType: item.body?._fileType,
    localFilePath: item.body?._localFilePath,
    createdAt: item.createdAt,
    failedAt: Date.now(),
    error,
  });
  while (ohneAlten.length > FAILED_CHAT_MAX) ohneAlten.shift();
  await _saveFailedChat(ohneAlten);
}

async function forgetFailedChat(clientId?: string | null): Promise<void> {
  if (!clientId) return;
  const list = await _loadFailedChat();
  if (!list.some(f => f.clientId === clientId)) return;
  await _saveFailedChat(list.filter(f => f.clientId !== clientId));
}

async function forgetFailedChatMany(clientIds: Array<string | undefined | null>): Promise<void> {
  const ids = new Set(clientIds.filter((id): id is string => !!id));
  if (ids.size === 0) return;
  const list = await _loadFailedChat();
  const rest = list.filter(f => !ids.has(f.clientId));
  if (rest.length !== list.length) await _saveFailedChat(rest);
}

async function getFailedChat(roomId?: number): Promise<FailedChatMessage[]> {
  const list = await _loadFailedChat();
  return roomId ? list.filter(f => f.roomId === roomId) : [...list];
}

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
    // Korruptes JSON — zuruecksetzen. Das Aufraeumen darf selbst nicht werfen:
    // Beim Beenden (und in Tests nach dem Abbau der Speicher-Simulation) ist
    // der Speicher schon weg, und ein Fehler hier riss den ganzen Lauf mit.
    try {
      await Preferences.remove({ key: QUEUE_KEY });
    } catch {
      // Speicher nicht mehr verfuegbar — die Warteschlange ist ohnehin leer.
    }
    _items = [];
    return _items;
  }
}

async function _save(items: QueueItem[]): Promise<void> {
  _items = items;
  await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(items) });
  notifyChanged();
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

// Wird von flush() abgewartet: Der Merker muss geschrieben sein, bevor der
// Aufrufer weiterarbeitet -- sonst sieht ein direkt folgender Lesezugriff
// (oder ein App-Wechsel im selben Moment) ihn noch nicht.
async function handleFlushResult(result: FlushResult): Promise<void> {
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
    await rememberFailedAction(item, item.error);
  }
}

// --- Foto-Upload Helfer für Queue-Items mit _localPhotoPath ---

async function resolveLocalPhoto(body: QueueBody): Promise<void> {
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

// Konvertiert die lokal gespeicherte Chat-Datei zu FormData für den Request.
// WICHTIG: Ueberschreibt NICHT item.body (FormData ist nicht serialisierbar und
// wuerde beim _save zu {} werden -> Datenverlust bei Retry). Gibt FormData zurück;
// das persistierte Item behält _localFilePath, damit ein Retry erneut lesen kann.
// Die lokale Datei wird erst nach erfolgreichem Request gelöscht (siehe flush()).
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
    // Ignorieren — wird beim nächsten Cleanup aufgeraeumt
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
  // Offline gar nicht erst versuchen: jeder aussichtslose Versuch erhoeht
  // retryCount — nach genug Offline-Anlaeufen (z.B. wiederholte Kaltstarts im
  // Funkloch) war das Retry-Budget verbrannt, bevor je ein echter Versand
  // moeglich war, und die Nachricht wurde aufgegeben.
  if (!networkMonitor.isOnline) return { succeeded: [], failed: [] };
  _flushing = true;

  const result: FlushResult = { succeeded: [], failed: [] };
  const gen = _generation;
  const zwischenzeitlichGeleert = () => gen !== _generation;

  try {
    const items = await _load();

    while (items.length > 0) {
      const item = items[0];
      try {
        // Lokales Foto zuerst hochladen falls vorhanden (gemeldete Aktivitäten)
        if (item.body?._localPhotoPath) {
          await resolveLocalPhoto(item.body);
          await _save(items); // Body-Update persistieren
        }

        // Chat-Bild aus lokalem Filesystem zu FormData konvertieren.
        // requestBody ist FLUECHTIG — item.body bleibt unverändert (serialisierbar),
        // damit ein Retry nach transientem Fehler die Datei erneut lesen kann.
        let requestBody: QueueBody | FormData | undefined = item.body;
        let requestHeaders = item.headers;
        if (item.body?._localFilePath) {
          const formData = await resolveLocalFile(item);
          if (formData) {
            requestBody = formData;
            requestHeaders = { 'Content-Type': 'multipart/form-data' };
          }
        }

        const config: AxiosRequestConfig = {};
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

        // Wurde die Queue waehrend des Requests geleert (Org-Wechsel/Logout),
        // den alten Arbeitsstand NICHT zurueckschreiben.
        if (zwischenzeitlichGeleert()) break;

        // Erfolg: lokale Datei aufräumen, dann Item entfernen
        await cleanupLocalFile(item);
        if (item.metadata.type === 'chat') await forgetFailedChat(item.metadata.clientId);
        result.succeeded.push(item);
        items.shift();
        await _save(items);
      } catch (err) {
        if (zwischenzeitlichGeleert()) break;
        const status = fehlerStatus(err) || 0;
        const message = fehlerTextOderMessage(err, 'Unbekannter Fehler');

        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          // 4xx (außer 408/429): Item entfernen, als failed markieren
          const failedItem: FailedQueueItem = { ...item, error: { status, message } };
          await rememberFailedChat(item, failedItem.error);
          result.failed.push(failedItem);
          notifyFailed(failedItem);
          items.shift();
          await _save(items);
        } else {
          // 5xx, 408, 429, Netzwerkfehler: retryCount erhöhen
          item.retryCount++;
          if (item.retryCount >= item.maxRetries) {
            const failedItem: FailedQueueItem = { ...item, error: { status, message } };
            await rememberFailedChat(item, failedItem.error);
            result.failed.push(failedItem);
            notifyFailed(failedItem);
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

  await handleFlushResult(result);
  return result;
}

async function flushTextOnly(): Promise<FlushResult> {
  if (_flushing) return { succeeded: [], failed: [] };
  if (!networkMonitor.isOnline) return { succeeded: [], failed: [] };
  _flushing = true;

  const result: FlushResult = { succeeded: [], failed: [] };
  const gen = _generation;
  const zwischenzeitlichGeleert = () => gen !== _generation;

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
        const config: AxiosRequestConfig = {};
        if (item.headers) config.headers = item.headers;

        if (item.method === 'DELETE') {
          await api.delete(item.url, config);
        } else if (item.method === 'PUT') {
          await api.put(item.url, item.body, config);
        } else {
          await api.post(item.url, item.body, config);
        }

        if (zwischenzeitlichGeleert()) break;
        if (item.metadata.type === 'chat') await forgetFailedChat(item.metadata.clientId);
        result.succeeded.push(item);
        items.splice(i, 1);
        await _save(items);
      } catch (err) {
        if (zwischenzeitlichGeleert()) break;
        const status = fehlerStatus(err) || 0;
        const message = fehlerTextOderMessage(err, 'Unbekannter Fehler');

        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          const failedItem: FailedQueueItem = { ...item, error: { status, message } };
          await rememberFailedChat(item, failedItem.error);
          result.failed.push(failedItem);
          notifyFailed(failedItem);
          items.splice(i, 1);
          await _save(items);
        } else {
          item.retryCount++;
          if (item.retryCount >= item.maxRetries) {
            const failedItem: FailedQueueItem = { ...item, error: { status, message } };
            await rememberFailedChat(item, failedItem.error);
            result.failed.push(failedItem);
            notifyFailed(failedItem);
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

  await handleFlushResult(result);
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
  // Laufende flush()-Durchgaenge abbrechen lassen (siehe _generation oben).
  _generation++;
  const items = await _load();
  // Lokal zwischengespeicherte Dateien der Items nicht verwaisen lassen.
  const pfade = new Set<string>();
  for (const item of items) {
    if (item.body?._localFilePath) pfade.add(item.body._localFilePath);
    if (item.body?._localPhotoPath) pfade.add(item.body._localPhotoPath);
  }
  for (const f of await _loadFailedChat()) {
    if (f.localFilePath) pfade.add(f.localFilePath);
  }
  for (const pfad of pfade) {
    try {
      await Filesystem.deleteFile({ path: pfad, directory: Directory.Data });
    } catch { /* best-effort */ }
  }
  await _save([]);
  await _saveFailedChat([]);
}

// --- Auto-Flush bei Online-Wechsel ---

networkMonitor.subscribe((isOnline) => {
  if (isOnline) {
    flush();
  }
});

// --- Export ---

export const writeQueue = {
  onQueueChanged,
  enqueue,
  flush,
  flushTextOnly,
  remove,
  getAll,
  getByMetadata,
  getFailedChat,
  forgetFailedChat,
  forgetFailedChatMany,
  getFailedActions,
  forgetFailedAction,
  forgetAllFailedActions,
  clear,
};
