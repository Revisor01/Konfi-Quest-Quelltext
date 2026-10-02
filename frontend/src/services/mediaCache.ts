// Lokaler Cache für geschützte Medien der App: Chat-Anhänge, die Dateien der
// Challenge-Beiträge und die Material-Dateien. Die Nachweisfotos der Anträge
// laufen durch denselben Lader, landen aber nie im Cache (siehe NUR_ANZEIGEN).
//
// Problem davor: LazyImage/VideoPreview luden jedes Medium bei jedem
// Sichtbarwerden NEU vom Server (GET /chat/files/:path) und erzeugten dabei
// Object-URLs, die nie freigegeben wurden (Memory-Leak). Bei jedem Chat-Oeffnen
// + Scrollen = wiederholte grosse Downloads.
//
// Lösung: geladene Medien werden binaer im Filesystem (Directory.Cache)
// abgelegt. Beim erneuten Anzeigen kommt das Medium aus dem Cache statt vom
// Server. Es gibt eine "Cache leeren"-Funktion samt Groessenanzeige.
//
// Hinweis Object-URLs: getMediaObjectUrl() liefert eine GETEILTE blob:-URL, die
// der Aufrufer NICHT freigeben darf (siehe dort).

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import api, { DATEI_TIMEOUT_MS } from './api';
import { mimeAusDateiname } from '../utils/dateiTypen';

const CACHE_DIR = 'media-cache';

/**
 * Die geschützten Medien-Routen der App. Eine neue Route kommt hier dazu —
 * sonst nirgends.
 */
export type MedienQuelle = 'chat' | 'challenges' | 'material' | 'nachweisfoto' | 'nachweisfotoLeitung';

// Route = davor + Datei + danach. Chat, Challenges und Material nennen die
// Datei beim Namen (64 Hexzeichen), die Nachweisfotos hängen am Antrag:
// ".../requests/41/photo".
const ROUTEN: Record<MedienQuelle, { davor: string; danach: string }> = {
  chat: { davor: '/chat/files/', danach: '' },
  challenges: { davor: '/challenges/files/', danach: '' },
  material: { davor: '/material/files/', danach: '' },
  nachweisfoto: { davor: '/konfi/activity-requests/', danach: '/photo' },
  nachweisfotoLeitung: { davor: '/admin/activities/requests/', danach: '/photo' },
};

/**
 * Warum nicht cachen:
 *  - Der Server legt sie verschlüsselt ab (eigener Schlüssel) und gibt sie nur
 *    an die Verantwortlichen der Jahrgänge heraus. Der Cache läge
 *    unverschlüsselt im App-Speicher, im Browser in IndexedDB.
 *  - Ein Leitungsgerät sammelte so die Fotos vieler fremder, meist
 *    minderjähriger Konfis. Entzieht die Gemeinde jemandem einen Jahrgang,
 *    leert das den Cache nicht (er hängt am Konto, nicht an den Jahrgängen) —
 *    ohne Netz stünden die Fotos weiter da, an der Prüfung des Servers vorbei.
 *  - Konfis und Team sehen ihr Foto nur, solange der Antrag offen ist. Ein
 *    entschiedener oder gelöschter Antrag darf sein Foto nicht aus dem Speicher
 *    weiter zeigen.
 *  - Der Gewinn wäre klein: Ein Nachweisfoto wird zum Entscheiden ein-, zweimal
 *    angesehen, nicht wie ein Chat-Bild immer wieder.
 */
const NUR_ANZEIGEN: ReadonlySet<MedienQuelle> = new Set<MedienQuelle>(['nachweisfoto', 'nachweisfotoLeitung']);

/** false: Dateien dieser Quelle werden nur angezeigt, nie auf dem Gerät abgelegt. */
export const bleibtAufDemGeraet = (quelle: MedienQuelle): boolean => !NUR_ANZEIGEN.has(quelle);

/** Pfad der Datei-Route relativ zur API, etwa `/challenges/files/ab12…`. */
export const medienApiPfad = (datei: string, quelle: MedienQuelle = 'chat'): string =>
  `${ROUTEN[quelle].davor}${datei}${ROUTEN[quelle].danach}`;

/**
 * Umkehrung von medienApiPfad: erkennt eine geschützte Medien-Route in einem
 * API-Pfad (mit oder ohne führendes /api). Damit laufen auch Dateien, die als
 * Adresse weitergereicht werden (Wisch-Kontext im Datei-Betrachter), über
 * diesen Cache statt am ihm vorbei. Nur Quellen, die auf dem Gerät bleiben —
 * ein Nachweisfoto geht nie in den Betrachter.
 */
export const medienAusApiPfad = (pfad: string): { quelle: MedienQuelle; datei: string } | null => {
  const ohneApi = pfad.replace(/^\/?api(?=\/)/, '');
  for (const quelle of Object.keys(ROUTEN) as MedienQuelle[]) {
    const { davor, danach } = ROUTEN[quelle];
    if (!bleibtAufDemGeraet(quelle) || danach) continue;
    if (ohneApi.startsWith(davor)) {
      const datei = ohneApi.slice(davor.length);
      if (datei && !datei.includes('/')) return { quelle, datei };
    }
  }
  return null;
};

// In-Memory-Promise-Cache: verhindert parallele Doppel-Downloads derselben
// Datei (z.B. wenn dasselbe Bild mehrfach im Viewport erscheint).
const inflight = new Map<string, Promise<Blob>>();

// Persistenter In-Memory-Object-URL-Cache: haelt fertige blob:-URLs über
// Mount/Unmount der Anzeige-Komponenten hinweg. So ist ein Bild beim erneuten
// Oeffnen des Chats oder einer Challenge SOFORT da (kein Re-Download aus dem
// Filesystem, kein Spinner, kein Layout-Sprung). Die URLs werden NICHT
// pro-Komponente revoked (das wuerde den geteilten Cache zerstoeren) — nur
// clearMediaCache(), die Grenze und medienVergessen() räumen auf.
const objectUrlCache = new Map<string, string>();

// djb2-Hash — nur noch für Dateinamen, die nicht dateisystemsicher sind. Die
// Server vergeben 64 Hexzeichen, die kommen unverändert in den Schlüssel.
const hash = (text: string): string => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
};

// Schlüssel = Quelle + Dateiname, etwa "challenges-3a96…". Die Quelle steht
// vorn, damit eine Chat- und eine Challenge-Datei gleichen Namens nie
// denselben Eintrag treffen.
const cacheKey = (datei: string, quelle: MedienQuelle): string => {
  const sicher = /^[A-Za-z0-9_]+(\.[A-Za-z0-9]{1,5})?$/.test(datei) ? datei : `h${hash(datei)}`;
  return `${quelle}-${sicher}`;
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
const mimeFromKey = (key: string): string => mimeAusDateiname(key);

/**
 * MIME-Typ aus einem Dateinamen wie "foto.png". Die Server vergeben
 * Dateinamen ohne Endung; der Typ steht deshalb nur im Originalnamen des
 * Beitrags oder der Nachricht — und genau daraus leiten ihn die Anzeigen ab.
 * Hier weitergereicht, damit bestehende Aufrufer nichts umstellen muessen.
 */
export { mimeAusDateiname };

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

async function downloadBlob(route: string, onFortschritt?: FortschrittHandler): Promise<Blob> {
  const response = await api.get(route, {
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
 * Wie ein Medium geholt wird. `quelle` fehlt nur bei den Chat-Aufrufen aus der
 * Zeit vor der Verallgemeinerung — sie bleiben so unverändert gültig.
 */
export interface MedienAbruf {
  quelle?: MedienQuelle;
  /** Wird nur beim echten Download gerufen, nicht beim Cache-Treffer. */
  onFortschritt?: FortschrittHandler;
  /**
   * Erst den Server fragen, den Cache nur ohne Netz nehmen. Für Ansichten,
   * deren Liste ein eingefrorener Stand ist (Jahresrückblick): Dort entscheidet
   * so weiter der Server, ob eine Datei noch gezeigt werden darf — ein
   * inzwischen gelöschter Beitrag kommt nicht mehr aus dem Cache.
   */
  netzZuerst?: boolean;
}

const abrufLesen = (abruf?: FortschrittHandler | MedienAbruf): Required<Pick<MedienAbruf, 'quelle' | 'netzZuerst'>> & Pick<MedienAbruf, 'onFortschritt'> => {
  const a: MedienAbruf = typeof abruf === 'function' ? { onFortschritt: abruf } : (abruf || {});
  return { quelle: a.quelle || 'chat', netzZuerst: a.netzZuerst === true, onFortschritt: a.onFortschritt };
};

/**
 * Hat der Server gesagt, dass es die Datei für diese Person nicht (mehr) gibt?
 * 403: kein Zugriff (mehr), 404/410: gelöscht. Netzfehler und 5xx zählen
 * nicht — dann darf der Cache weiter aushelfen.
 */
const endgueltigWeg = (err: unknown): boolean => {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 403 || status === 404 || status === 410;
};

/**
 * Liegt die Datei schon im Cache? Erlaubt es dem Aufrufer, bei einem Treffer
 * gar keine Ladeanzeige zu zeigen — ein Spinner, der sofort wieder verschwindet,
 * blitzt nur unangenehm auf.
 */
export async function istGecacht(filePath: string, quelle: MedienQuelle = 'chat'): Promise<boolean> {
  if (!bleibtAufDemGeraet(quelle)) return false;
  try {
    await Filesystem.stat({ path: `${CACHE_DIR}/${cacheKey(filePath, quelle)}`, directory: Directory.Cache });
    return true;
  } catch {
    return false;
  }
}

/**
 * Liefert das Medium als Blob — aus dem lokalen Cache, sonst per Download
 * (und legt es danach in den Cache).
 *
 * Zweites Argument: der Fortschritts-Rückruf (so rufen es die Chat-Stellen
 * seit jeher) oder ein MedienAbruf mit Quelle.
 */
export async function getMediaBlob(filePath: string, abruf?: FortschrittHandler | MedienAbruf): Promise<Blob> {
  const { quelle, onFortschritt, netzZuerst } = abrufLesen(abruf);

  // Nachweisfotos: nur laden, nie ablegen und nie aus dem Cache nehmen (siehe
  // NUR_ANZEIGEN).
  if (!bleibtAufDemGeraet(quelle)) {
    return downloadBlob(medienApiPfad(filePath, quelle), onFortschritt);
  }

  const key = cacheKey(filePath, quelle);

  if (netzZuerst) {
    try {
      const blob = await downloadBlob(medienApiPfad(filePath, quelle), onFortschritt);
      await writeToCache(key, blob);
      return blob;
    } catch (err) {
      if (endgueltigWeg(err)) {
        await eintragEntfernen(key);
        throw err;
      }
      const cached = await readFromCache(key);
      if (cached) return cached;
      throw err;
    }
  }

  const cached = await readFromCache(key);
  if (cached) return cached;

  // Laufenden Download wiederverwenden statt parallel doppelt zu laden.
  let promise = inflight.get(key);
  if (!promise) {
    promise = (async () => {
      const blob = await downloadBlob(medienApiPfad(filePath, quelle), onFortschritt);
      await writeToCache(key, blob);
      return blob;
    })();
    inflight.set(key, promise);
  }
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

/**
 * Synchron: liefert die bereits im In-Memory-Cache liegende Object-URL — oder
 * null, wenn das Medium (noch) nicht geladen wurde. Erlaubt es, gecachte Bilder
 * SOFORT beim Render anzuzeigen (ohne Lazy-Load/Ruckeln), und nur ungecachte
 * Bilder lazy nachzuladen.
 */
export function getCachedObjectUrl(filePath: string, quelle: MedienQuelle = 'chat'): string | null {
  return objectUrlCache.get(cacheKey(filePath, quelle)) ?? null;
}

/**
 * Liefert eine persistente blob:-Object-URL für das Medium. Die URL wird im
 * In-Memory-Cache gehalten und über Mount/Unmount hinweg wiederverwendet — der
 * AUFRUFER darf sie NICHT selbst revoken (nur clearMediaCache() räumt auf).
 */
export async function getMediaObjectUrl(filePath: string, abruf?: MedienAbruf): Promise<string> {
  const { quelle } = abrufLesen(abruf);
  // Eine geteilte URL überdauert das Schließen der Ansicht — genau das darf ein
  // Nachweisfoto nicht (siehe NUR_ANZEIGEN). useMedienDatei nimmt dafür einen
  // eigenen Blob, den es beim Abhängen freigibt.
  if (!bleibtAufDemGeraet(quelle)) {
    throw new Error(`Medien-Cache: ${quelle} wird nicht geteilt`);
  }
  const key = cacheKey(filePath, quelle);
  const cached = objectUrlCache.get(key);
  if (cached) return cached;
  const blob = await getMediaBlob(filePath, abruf);
  // Doppelpruefung: ein paralleler Aufruf könnte die URL inzwischen gesetzt
  // haben -> dann die eigene verwerfen und die geteilte nehmen.
  const existing = objectUrlCache.get(key);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(key, url);
  return url;
}

// Eine Datei samt Object-URL aus dem Cache nehmen.
async function eintragEntfernen(key: string): Promise<void> {
  const url = objectUrlCache.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrlCache.delete(key);
  }
  letzterZugriff.delete(key);
  try {
    await Filesystem.deleteFile({ path: `${CACHE_DIR}/${key}`, directory: Directory.Cache });
  } catch {
    // Lag gar nicht im Cache -> nichts zu tun.
  }
}

/**
 * Wirft EINE Datei aus dem Cache — etwa nachdem die Leitung einen Beitrag
 * gelöscht hat. Sonst läge die Datei weiter auf diesem Gerät, obwohl es sie
 * auf dem Server nicht mehr gibt.
 */
export async function medienVergessen(filePath: string, quelle: MedienQuelle = 'chat'): Promise<void> {
  await eintragEntfernen(cacheKey(filePath, quelle));
}

// Obergrenze des Caches. Darueber fliegt raus, was am laengsten nicht benutzt
// wurde, bis die Groesse wieder darunter liegt.
//
// Warum ueberhaupt eine Grenze: Bis dahin wuchs der Cache monoton
// und wurde nur geleert, wenn jemand von Hand "Medien-Cache leeren" drueckte.
// Solange nur Bilder und Videos aus dem Chat hineinliefen, fiel das kaum auf.
// Seit auch Dokumente und Audio gecacht werden, waechst er deutlich schneller.
//
// 500 MB, weil die groesste Einzeldatei ein Challenge-Beitrag mit 50 MB ist
// (Material: 20 MB, Chat: 5 MB) — es passen also immer mindestens zehn davon
// hinein, und der uebliche Bestand aus Bildern liegt um Groessenordnungen
// darunter.
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
          // weiter auf einen Blob, den der Cache nicht mehr kennt. Der
          // Dateiname IST der Schlüssel der Object-URL.
          const url = objectUrlCache.get(e.name);
          if (url) {
            URL.revokeObjectURL(url);
            objectUrlCache.delete(e.name);
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

/** Gesamtgroesse des Medien-Caches in Bytes — alle Quellen zusammen. */
export async function getMediaCacheSize(): Promise<number> {
  try {
    const eintraege = await eintraegeLesen();
    return eintraege.reduce((summe, e) => summe + e.size, 0);
  } catch {
    return 0; // Verzeichnis existiert (noch) nicht
  }
}

/**
 * Loescht den kompletten Medien-Cache aller Quellen — Chat, Challenges,
 * Material (Filesystem + In-Memory-Object-URLs). Läuft von Hand
 * ("Medien-Cache leeren") und beim Abmelden sowie beim Wechsel der Gemeinde.
 */
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

// Für welches Konto der Cache gerade gefüllt wird.
const KONTO_SCHLUESSEL = 'medien_cache_konto';

/**
 * Bindet den Cache an das angemeldete Konto: Meldet sich ein ANDERES Konto an
 * als das, für das der Cache gefüllt wurde, wird er vorher geleert.
 *
 * Das Abmelden leert den Cache ohnehin (auth.ts). Dieser Weg fängt ab, was am
 * Abmelden vorbeigeht: eine abgelaufene Sitzung, nach der sich jemand anderes
 * anmeldet, die Anmeldung per Face ID in ein anderes Konto, ein Neustart über
 * die Fehlerseite. Ohne ihn lägen die Medien der vorigen Person weiter auf dem
 * Gerät.
 */
export async function medienCacheKontoPruefen(kontoId: number | string): Promise<void> {
  const konto = String(kontoId);
  let bisher: string | null;
  try {
    bisher = (await Preferences.get({ key: KONTO_SCHLUESSEL })).value;
  } catch {
    bisher = null;
  }
  if (bisher === konto) return;
  await clearMediaCache();
  try {
    await Preferences.set({ key: KONTO_SCHLUESSEL, value: konto });
  } catch {
    // Ohne Markierung wird beim nächsten Start noch einmal geleert — sicher.
  }
}
