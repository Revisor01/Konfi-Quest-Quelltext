import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { FileViewer } from '@capacitor/file-viewer';

/**
 * Oeffnet eine Datei nativ ueber FileOpener (Bilder) oder FileViewer (Dokumente).
 * Gibt true zurueck bei Erfolg auf nativer Plattform, false auf Web oder bei Fehler.
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
      await Filesystem.mkdir({ path: 'temp', directory: Directory.Documents, recursive: true });
    } catch { /* Verzeichnis existiert bereits */ }

    // Temporaere Datei schreiben
    const ext = fileName.split('.').pop() || 'bin';
    const tempPath = `temp/native_${Date.now()}.${ext}`;

    await Filesystem.writeFile({
      path: tempPath,
      data: base64Data,
      directory: Directory.Documents,
      recursive: true
    });

    const fileUri = await Filesystem.getUri({ directory: Directory.Documents, path: tempPath });

    // Bilder ueber FileOpener (bessere native Anzeige)
    if (mimeType.startsWith('image/')) {
      await FileOpener.open({ filePath: fileUri.uri, contentType: mimeType });
    } else {
      // Dokumente, Videos, PDFs etc. ueber FileViewer
      await FileViewer.openDocumentFromLocalPath({ path: fileUri.uri });
    }

    return true;
  } catch (err) {
    console.warn('Natives Oeffnen fehlgeschlagen:', err);
    return false;
  }
}
