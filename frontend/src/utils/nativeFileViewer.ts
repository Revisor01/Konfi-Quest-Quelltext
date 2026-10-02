import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { FileViewer } from '@capacitor/file-viewer';
import { dateiExternOeffnen } from '../services/systemDialoge';

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
 * Zeigt der Betrachter der App (FileViewerModal) PDFs selbst an — Seiten
 * untereinander, per pdf.js?
 *
 * Auf Android und im Browser ja, auf iOS nein: Dort zeigt die Vorschau des
 * Systems (QuickLook) PDFs in der App, mit Suche, Teilen und Sichern, und das
 * bleibt so.
 *
 * WARUM ANDROID: Auf
 * Android zeigt keines der beiden Plugins eine Datei IN der App. Beide starten
 * nur Intent.ACTION_VIEW (FileOpenerPlugin.java; die Doku von
 * @capacitor/file-viewer: „previewMediaContentFromLocalPath: Only implemented
 * in iOS. Android defaults to openDocumentFromLocalPath"). Die Datei ging in
 * einer fremden App auf, und bei eingeschalteter App-Sperre kam bei der
 * Rückkehr jedes Mal die Biometrie-Abfrage. Das WebView zeigt PDFs im iframe
 * auch nicht an — deshalb pdf.js.
 *
 * WARUM AUCH IM BROWSER: Wie eine PDF im iframe aussieht, entscheidet jeder
 * Browser selbst — am Rechner mit seiner eigenen Leiste, auf dem Handy je nach
 * Browser anders oder gar nicht; das Android-WebView ist dafür das deutlichste
 * Beispiel. Mit pdf.js sieht die PDF überall gleich aus, bedient sich wie in
 * der App, und es gibt einen Weg zu testen statt drei. Scheitert pdf.js,
 * bleibt das iframe als Rückfall (FileViewerModal).
 */
export const pdfImAppBetrachter = (): boolean =>
  !Capacitor.isNativePlatform() || Capacitor.getPlatform() === 'android';

/**
 * Soll diese Datei im Betrachter der App aufgehen statt in der Vorschau des
 * Systems oder einer fremden App?
 *
 * - Browser: immer — es gibt nichts anderes.
 * - Android: Bilder, Videos und PDFs (siehe pdfImAppBetrachter). Alles andere
 *   (Word, Excel, Präsentationen …) kann das WebView nicht darstellen; das
 *   geht weiter in eine passende App, dann über dateiExternOeffnen.
 * - iOS: nie — die Vorschau des Systems zeigt alles in der App.
 */
export const zeigtAppBetrachter = (mimeType: string): boolean => {
  if (!Capacitor.isNativePlatform()) return true;
  if (Capacitor.getPlatform() !== 'android') return false;
  return mimeType.startsWith('image/')
    || mimeType.startsWith('video/')
    || mimeType === 'application/pdf';
};

/**
 * Oeffnet eine Datei nativ über FileOpener (Bilder) oder FileViewer (Dokumente).
 * Gibt true zurück, wenn die Datei nativ geöffnet wurde. False heißt: Der
 * Aufrufer zeigt sie im Betrachter der App (FileViewerModal) — im Browser, auf
 * Android bei Bildern, Videos und PDFs (siehe zeigtAppBetrachter) oder wenn
 * das native Öffnen scheitert.
 *
 * Jeder native Aufruf läuft durch dateiExternOeffnen: Auf Android geht die
 * Datei in einer fremden App auf, auf iOS kann das Teilen-Blatt aus der
 * Vorschau die App ebenso in den Hintergrund legen. Beides darf die App-Sperre
 * nicht auslösen.
 */
export async function openFileNatively(
  blobOrUrl: Blob | string,
  fileName: string,
  mimeType: string
): Promise<boolean> {
  // Browser und Android bei Bildern, Videos, PDFs: sofort false, ohne Kopie
  // auf dem Gerät — der Betrachter der App übernimmt.
  if (zeigtAppBetrachter(mimeType)) return false;

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

    // Bilder über FileOpener (bessere native Anzeige; erreicht diese Stelle
    // nur noch auf iOS, siehe zeigtAppBetrachter)
    if (mimeType.startsWith('image/')) {
      await dateiExternOeffnen(() => FileOpener.open({ filePath: fileUri.uri, contentType: mimeType }));
    } else {
      // Dokumente, Videos, PDFs etc. über FileViewer
      await dateiExternOeffnen(() => FileViewer.openDocumentFromLocalPath({ path: fileUri.uri }));
    }

    return true;
  } catch (err) {
    console.warn('Natives Oeffnen fehlgeschlagen:', err);
    return false;
  }
}
