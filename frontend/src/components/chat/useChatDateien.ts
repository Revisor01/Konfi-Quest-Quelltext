import { useState, useEffect } from 'react';
import { useApp } from '../../contexts/AppContext';
import { fuerUploadVorbereiten, DateiZuGrossFehler, UPLOAD_GRENZE } from '../../services/mediaCompression';
import { useDateiOeffnen } from '../../hooks/useDateiOeffnen';
import { dateiAuswaehlen } from '../../services/systemDialoge';
import { CHAT_DATEIAUSWAHL } from '../../utils/dateiTypen';
import { Message } from '../../types/chat';

/**
 * Datei-Handling des Chatraums (beim Aufteilen von ChatRoom.tsx hierher
 * gezogen): Datei-/Foto-Auswahl samt Kompression und Groessengrenze, Kamera
 * und Galerie, sowie das Oeffnen empfangener Dateien (nativ, mit
 * FileViewerModal als Web-Fallback inklusive Swipe-Kontext).
 */

interface ChatDateienDeps {
  // Fuer den Swipe-Kontext im Viewer: alle Datei-Nachrichten des Raums.
  messages: Message[];
}

export function useChatDateien({ messages }: ChatDateienDeps) {
  const { setError } = useApp();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFilePreview, setSelectedFilePreview] = useState<string | null>(null);

  // Empfangene Dateien oeffnen: Ladeanzeige mit Prozent, Medien-Cache, nativ
  // oder im Betrachter mit allen Dateien des Raums zum Wischen.
  const { dateiOeffnen: handleFileClick, ladendeDatei } = useDateiOeffnen({
    quelle: 'chat',
    fehlerOrt: 'chat-datei',
    kontext: () => messages
      .filter(m => m.file_path)
      .map(m => ({ pfad: m.file_path!, name: m.file_name })),
  });

  // Die Auswahl des Systems oeffnen — ueber die Huelle, damit die App-Sperre
  // sie nicht fuer "App verlassen" haelt.
  // Die Huelle legt je Auswahl ein frisches Feld an: dieselbe Datei ist gleich
  // wieder waehlbar.
  const dateiWaehlen = async () => {
    const auswahl = await dateiAuswaehlen({ accept: CHAT_DATEIAUSWAHL });
    if (auswahl) await dateiUebernehmen(auswahl[0]);
  };

  const dateiUebernehmen = async (picked: File) => {
    // Bilder vor Upload resizen + komprimieren (max 1920px lange Kante), dann
    // gegen die Grenze pruefen — derselbe Weg wie bei den Challenges
    // Andere Dateien (Videos, PDFs) bleiben unverändert.
    try {
      const { file, bildVorschau } = await fuerUploadVorbereiten(picked, UPLOAD_GRENZE.chat);
      setSelectedFile(file);
      setSelectedFilePreview(bildVorschau);
    } catch (err) {
      setError(err instanceof DateiZuGrossFehler ? err.message : 'Datei konnte nicht ausgewählt werden');
    }
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

  return {
    selectedFile,
    selectedFilePreview,
    dateiWaehlen,
    dateiUebernehmen,
    clearSelectedFile,
    handleFileClick,
    ladendeDatei,
  };
}
