import { fehlerStatus } from '../../utils/fehler';
import { Capacitor } from '@capacitor/core';
import { teilen } from '../../services/systemDialoge';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import api, { DATEI_TIMEOUT_MS } from '../../services/api';
import { getMediaBlob } from '../../services/mediaCache';
import { Message } from '../../types/chat';

/**
 * Teilen und Exportieren aus dem Chat (beim Aufteilen von ChatRoom.tsx
 * hierher gezogen, Verhalten unveraendert): eine einzelne Nachricht (Text
 * oder Datei) ueber das Teilen-Blatt weitergeben und den kompletten Verlauf
 * als Textdatei exportieren.
 */

/** Nachricht (Text oder Datei) ueber das native Teilen-Blatt weitergeben. */
export async function nachrichtTeilen(
  message: Message,
  setError: (msg: string) => void
): Promise<void> {
  try {
    if (message.file_path) {
      // Die Datei über den Medien-Cache holen: Was schon im
      // Chat angezeigt wurde, liegt auf dem Gerät — Teilen lud es bisher
      // trotzdem noch einmal vom Server.
      const blob = await getMediaBlob(message.file_path);
      const fileName = message.file_name || 'file';

      // In den CACHE schreiben, nicht nach Documents. Documents
      // ist auf Android der OEFFENTLICHE Ordner "Dokumente" -- dort lesen
      // andere Apps und jeder Dateimanager mit --, auf dem iPhone der
      // Documents-Ordner der App. Geteilt werden Chat-Anhaenge, oft Fotos
      // von Jugendlichen, und sie blieben dort liegen. Aus dem Cache nimmt
      // das Teilen-Blatt sie genauso (Android: cache-path in file_paths.xml),
      // der Chat-Export unten macht es schon so.
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(blob);
      });

      const path = `share/${fileName}`;
      await Filesystem.writeFile({
        path,
        data: base64Data,
        directory: Directory.Cache,
        recursive: true
      });

      // Get local file URI for sharing
      const fileUri = await Filesystem.getUri({
        directory: Directory.Cache,
        path
      });

      await teilen({
        title: 'Datei aus Konfi Quest',
        text: message.content || fileName,
        url: fileUri.uri
      });
    } else {
      // For text messages, share text content
      await teilen({
        text: message.content,
        title: 'Nachricht aus Konfi Quest'
      });
    }
  } catch (error) {
    console.error('Error sharing:', error);
    if (error instanceof Error && error.name !== 'AbortError') {
      setError('Fehler beim Teilen');
    }
  }
}

/**
 * Chat-Export (nur Leitung): laedt den kompletten Verlauf als Textdatei.
 * Anlass: Inhalte aus Konfi-Chats für die Gottesdienst-Vorbereitung
 * aufbereiten. Auf dem Geraet über das Teilen-Blatt, im Web als Download.
 */
export async function chatVerlaufExportieren(
  roomId: number,
  anzeigename: string,
  setError: (msg: string) => void
): Promise<void> {
  try {
    const res = await api.get(`/chat/rooms/${roomId}/export`, { responseType: 'blob', timeout: DATEI_TIMEOUT_MS });
    const dateiname = `${anzeigename.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 50) || 'chat'}_${new Date().toISOString().slice(0, 10)}.txt`;

    if (Capacitor.isNativePlatform()) {
      // Auf dem Geraet: in den Dokumenten ablegen und das Teilen-Blatt oeffnen,
      // damit die Datei in Mail, Notizen o.ae. weiterwandern kann.
      const text = await (res.data as Blob).text();
      await Filesystem.writeFile({
        path: dateiname,
        data: text,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      const { uri } = await Filesystem.getUri({ path: dateiname, directory: Directory.Cache });
      await teilen({ title: 'Chat-Verlauf', url: uri });
    } else {
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = dateiname;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    if (fehlerStatus(err) === 403) {
      setError('Nur die Leitung darf Chats exportieren');
    } else {
      setError('Export fehlgeschlagen');
    }
  }
}
