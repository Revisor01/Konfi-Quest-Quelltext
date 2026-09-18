import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { FileViewer } from '@capacitor/file-viewer';

const TEMP_DIR = 'temp';

// Wie lange eine temporaere Kopie liegen bleiben darf.
//
// Warum ueberhaupt aufraeumen: Jedes native Oeffnen schreibt eine
// Kopie nach Documents/temp — und loeschte sie nie. Wer eine PDF zwanzigmal
// oeffnet, hatte zwanzig Kopien auf dem Geraet. Schlimmer als der reine Platz:
// Documents wird ins Backup uebernommen und vom Betriebssystem NICHT von allein
// geraeumt (anders als Directory.Cache).
//
// Nicht sofort nach dem Oeffnen loeschen: Die native Anzeige liest die Datei
// noch, waehrend openFileNatively laengst zurueckgekehrt ist — ein Loeschen
// direkt danach zeigt ein leeres Dokument. Eine Stunde ist grosszuegig genug,
// dass keine offene Ansicht betroffen ist.
const TEMP_MAX_ALTER_MS = 60 * 60 * 1000;

/**
 * Loescht temporaere Kopien in Documents/temp, die aelter als eine Stunde sind.
 * Best-effort: Fehler werden geschluckt, der Aufrufer wartet nicht darauf.
 *
 * Wird beim App-Start gerufen (main.tsx) — dort ist sicher keine native Ansicht
 * mehr offen, die auf eine der Dateien zeigt.
 */
export async function tempDateienAufraeumen(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { files } = await Filesystem.readdir({ path: TEMP_DIR, directory: Directory.Documents });
    const grenze = Date.now() - TEMP_MAX_ALTER_MS;

    for (const f of files as unknown[]) {
      const roh = f as { name?: unknown; mtime?: unknown };
      const name = typeof f === 'string' ? f : (typeof roh.name === 'string' ? roh.name : null);
      if (!name) continue;

      // Der Dateiname traegt den Zeitstempel der Erzeugung (native_<ms>.<ext>).
      // Das ist verlaesslicher als die mtime, die manche Plattformen beim
      // Sichern oder Wiederherstellen neu setzen.
      const ausName = name.match(/^native_(\d+)\./);
      const erzeugt = ausName
        ? parseInt(ausName[1], 10)
        : (typeof roh.mtime === 'number' ? roh.mtime : null);
      if (erzeugt === null || erzeugt >= grenze) continue;

      try {
        await Filesystem.deleteFile({ path: `${TEMP_DIR}/${name}`, directory: Directory.Documents });
      } catch {
        // Naechste Datei versuchen.
      }
    }
  } catch {
    // Verzeichnis existiert (noch) nicht -> nichts aufzuraeumen.
  }
}

/**
 * Oeffnet eine Datei nativ über FileOpener (Bilder) oder FileViewer (Dokumente).
 * Gibt true zurück bei Erfolg auf nativer Plattform, false auf Web oder bei Fehler.
 * Bei false kann der Caller das FileViewerModal als Web-Fallback nutzen.
 */
export async function openFileNatively(
  blobOrUrl: Blob | string,
  fileName: string,
  mimeType: string
): Promise<boolean> {
  // Web-Plattform: sofort false, Caller nutzt FileViewerModal
  if (!Capacitor.isNativePlatform()) return false;

  try {
    // Blob beschaffen
    let blob: Blob;
    if (typeof blobOrUrl === 'string') {
      const response = await fetch(blobOrUrl);
      blob = await response.blob();
    } else {
      blob = blobOrUrl;
    }

    // Blob zu Base64 konvertieren
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    // Temp-Verzeichnis sicherstellen
    try {
      await Filesystem.mkdir({ path: TEMP_DIR, directory: Directory.Documents, recursive: true });
    } catch { /* Verzeichnis existiert bereits */ }

    // Temporaere Datei schreiben. Der Zeitstempel im Namen ist nicht nur
    // Eindeutigkeit — tempDateienAufraeumen() liest daran das Alter ab.
    const ext = fileName.split('.').pop() || 'bin';
    const tempPath = `${TEMP_DIR}/native_${Date.now()}.${ext}`;

    await Filesystem.writeFile({
      path: tempPath,
      data: base64Data,
      directory: Directory.Documents,
      recursive: true
    });

    const fileUri = await Filesystem.getUri({ directory: Directory.Documents, path: tempPath });

    // Bilder über FileOpener (bessere native Anzeige)
    if (mimeType.startsWith('image/')) {
      await FileOpener.open({ filePath: fileUri.uri, contentType: mimeType });
    } else {
      // Dokumente, Videos, PDFs etc. über FileViewer
      await FileViewer.openDocumentFromLocalPath({ path: fileUri.uri });
    }

    return true;
  } catch (err) {
    console.warn('Natives Oeffnen fehlgeschlagen:', err);
    return false;
  }
}
