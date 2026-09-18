import { useState, useEffect, useRef } from 'react';
import { useIonModal } from '@ionic/react';
import { haptik, ImpactStyle } from '../../utils/haptics';
import { useApp } from '../../contexts/AppContext';
import { compressImage } from '../../services/mediaCompression';
import { getMediaBlob, istGecacht } from '../../services/mediaCache';
// Native FileViewer über openFileNatively, FileViewerModal als Web-Fallback
import { openFileNatively } from '../../utils/nativeFileViewer';
import FileViewerModal, { FileItem } from '../shared/FileViewerModal';
import { Message } from '../../types/chat';

/**
 * Datei-Handling des Chatraums (beim Aufteilen von ChatRoom.tsx hierher
 * gezogen, Verhalten unveraendert): Datei-/Foto-Auswahl samt Kompression und
 * 10MB-Grenze, Kamera und Galerie, sowie das Oeffnen empfangener Dateien
 * (nativ, mit FileViewerModal als Web-Fallback inklusive Swipe-Kontext).
 */

// MIME-Type aus Dateiname ableiten
const getMimeFromFileName = (name: string): string => {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', webm: 'video/webm', m4v: 'video/mp4',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  return map[ext] || 'application/octet-stream';
};

interface ChatDateienDeps {
  // Fuer den Swipe-Kontext im Viewer: alle Datei-Nachrichten des Raums.
  messages: Message[];
}

export function useChatDateien({ messages }: ChatDateienDeps) {
  const { setError } = useApp();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFilePreview, setSelectedFilePreview] = useState<string | null>(null);
  // Welche Datei gerade geladen wird und wie weit. Ohne Rueckmeldung sieht man
  // beim Antippen einer PDF gar nichts passieren und tippt weiter.
  // `prozent` ist null, solange der Server keine Groesse meldet —
  // dann laeuft die Anzeige unbestimmt statt auf einer geratenen Zahl.
  const [ladendeDatei, setLadendeDatei] = useState<{ pfad: string; prozent: number | null } | null>(null);
  const viewerRef = useRef<{ files: FileItem[]; initialIndex: number }>({ files: [], initialIndex: 0 });

  // FileViewer Modal mit useIonModal Hook (universeller Datei-Viewer)
  const [presentFileViewer, dismissFileViewer] = useIonModal(FileViewerModal, {
    get files() { return viewerRef.current.files; },
    get initialIndex() { return viewerRef.current.initialIndex; },
    onClose: () => {
      dismissFileViewer();
      viewerRef.current.files.forEach(f => {
        if (f.url.startsWith('blob:')) URL.revokeObjectURL(f.url);
      });
      viewerRef.current = { files: [], initialIndex: 0 };
    }
  });

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // Input zuruecksetzen, damit dieselbe Datei erneut waehlbar ist.
    event.target.value = '';
    if (!picked) return;

    // Bilder vor Upload resizen + komprimieren (max 1920px lange Kante). Andere
    // Dateien (Videos, PDFs) bleiben unverändert.
    let file = picked;
    let previewUrl: string | null = null;
    if (picked.type.startsWith('image/')) {
      try {
        const result = await compressImage(picked);
        file = result.file;
        previewUrl = result.previewUrl;
      } catch {
        file = picked;
        previewUrl = URL.createObjectURL(picked);
      }
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit (nach Kompression)
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setError('Datei ist zu groß (max. 10MB)');
      return;
    }

    setSelectedFile(file);
    setSelectedFilePreview(previewUrl);
  };

  // Cleanup preview URL on unmount or file change
  useEffect(() => {
    return () => {
      if (selectedFilePreview) {
        URL.revokeObjectURL(selectedFilePreview);
      }
    };
  }, [selectedFilePreview]);

  const clearSelectedFile = () => {
    if (selectedFilePreview) {
      URL.revokeObjectURL(selectedFilePreview);
    }
    setSelectedFile(null);
    setSelectedFilePreview(null);
  };

  const handleFileClick = async (filePath: string, fileName: string, mimeType: string) => {
    // Zweiter Tipp auf dieselbe Datei, waehrend sie laedt: ignorieren statt
    // einen zweiten Download zu starten.
    if (ladendeDatei) return;
    try {
      await haptik(ImpactStyle.Light);

      // Beim Cache-Treffer gar keine Anzeige zeigen: Sie waere sofort wieder
      // weg und wuerde nur aufblitzen.
      const schonDa = await istGecacht(filePath);
      if (!schonDa) setLadendeDatei({ pfad: filePath, prozent: 0 });

      const blob = await getMediaBlob(filePath, (prozent) => {
        setLadendeDatei({ pfad: filePath, prozent });
      });
      // Der MIME-Typ kommt jetzt aus dem Dateinamen statt aus dem
      // Antwort-Header — beim Cache-Treffer gibt es keine Antwort mehr.
      // mimeType ist der vom Aufrufer gemeldete Typ der Nachricht.
      const mime: string = mimeType || getMimeFromFileName(fileName);

      const openedNatively = await openFileNatively(blob, fileName, mime);
      if (openedNatively) return;

      // Web-Fallback: FileViewerModal mit Swipe-Kontext
      const blobUrl = URL.createObjectURL(new Blob([blob], { type: mime }));
      const allFileMessages = messages.filter(m => m.file_path);
      const files: FileItem[] = allFileMessages.map(m => {
        if (m.file_path === filePath) {
          return { url: blobUrl, fileName: m.file_name || fileName, mimeType: mime };
        }
        return {
          url: `/api/chat/files/${m.file_path}`,
          fileName: m.file_name || 'Datei',
          mimeType: m.file_name ? getMimeFromFileName(m.file_name) : 'application/octet-stream'
        };
      });
      const clickedIndex = allFileMessages.findIndex(m => m.file_path === filePath);
      viewerRef.current = { files, initialIndex: Math.max(0, clickedIndex) };
      presentFileViewer({ cssClass: 'file-viewer-modal' });
    } catch (err) {
      setError('Fehler beim Öffnen der Datei', { ort: 'chat-datei', fehler: err });
    } finally {
      // finally statt einzelner Aufrufe: Der Zweig "nativ geoeffnet" steigt
      // per return aus, und ohne finally bliebe die Anzeige dort haengen.
      setLadendeDatei(null);
    }
  };

  return {
    selectedFile,
    selectedFilePreview,
    handleFileSelect,
    clearSelectedFile,
    handleFileClick,
    ladendeDatei,
  };
}
