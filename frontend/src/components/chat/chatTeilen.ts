import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import api from '../../services/api';
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
      // For files, share the actual file natively (with auth token)
      const response = await api.get(`/chat/files/${message.file_path}`, { responseType: 'blob' });
      const blob = response.data;
      const fileName = message.file_name || 'file';

      // Write to Documents directory for sharing
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
        directory: Directory.Documents,
        recursive: true
      });

      // Get local file URI for sharing
      const fileUri = await Filesystem.getUri({
        directory: Directory.Documents,
        path
      });

      await Share.share({
        title: 'Datei aus Konfi Quest',
        text: message.content || fileName,
        url: fileUri.uri
      });
    } else {
      // For text messages, share text content
      await Share.share({
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
    const res = await api.get(`/chat/rooms/${roomId}/export`, { responseType: 'blob' });
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
      await Share.share({ title: 'Chat-Verlauf', url: uri });
    } else {
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = dateiname;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (err: any) {
    if (err?.response?.status === 403) {
      setError('Nur die Leitung darf Chats exportieren');
    } else {
      setError('Export fehlgeschlagen');
    }
  }
}
