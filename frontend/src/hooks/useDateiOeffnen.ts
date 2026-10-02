import { useRef, useState } from 'react';
import { useIonModal } from '@ionic/react';
import { haptik, ImpactStyle } from '../utils/haptics';
import { useApp } from '../contexts/AppContext';
import {
  getMediaBlob,
  istGecacht,
  medienApiPfad,
  mimeAusDateiname,
  type MedienQuelle,
} from '../services/mediaCache';
// Native FileViewer über openFileNatively, FileViewerModal als Web-Fallback
import { openFileNatively } from '../utils/nativeFileViewer';
import FileViewerModal, { FileItem } from '../components/shared/FileViewerModal';

// Eine Datei öffnen — nativ (Vorschau mit Teilen und Sichern des Systems) oder
// im Datei-Betrachter der App, der Herunterladen und Teilen anbietet und durch
// die übrigen Dateien der Ansicht wischen lässt.
//
// Nicht für die Nachweisfotos der Anträge: Das native Öffnen legt eine Kopie
// in Documents ab (Datensicherung des Geräts), und diese Fotos sollen das
// Gerät nie erreichen (mediaCache, NUR_ANZEIGEN).

/** Eine Datei der Ansicht, für den Wisch-Kontext im Betrachter. */
export interface OeffenbareDatei {
  pfad: string;
  /** Originalname mit Endung, etwa "foto.jpg"; bestimmt den Typ. */
  name?: string | null;
  /**
   * Typ, wenn der Server ihn kennt (Material führt ihn je Datei). Sonst
   * kommt er aus der Endung des Namens.
   */
  typ?: string | null;
}

interface DateiOeffnenOptionen {
  quelle: MedienQuelle;
  /** Alle Dateien der Ansicht in Anzeigereihenfolge (Wischen im Betrachter). */
  kontext: () => OeffenbareDatei[];
  /** Ort für die Fehlermeldung an die Diagnose, etwa "chat-datei". */
  fehlerOrt: string;
}

export function useDateiOeffnen({ quelle, kontext, fehlerOrt }: DateiOeffnenOptionen) {
  const { setError } = useApp();
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

  // Liefert true, sobald die Datei geladen ist (vom Server oder aus dem
  // Cache) — die anonyme Messung „Material abgerufen" zaehlt erst dann.
  const dateiOeffnen = async (filePath: string, fileName: string, mimeType?: string): Promise<boolean> => {
    // Zweiter Tipp auf dieselbe Datei, waehrend sie laedt: ignorieren statt
    // einen zweiten Download zu starten.
    if (ladendeDatei) return false;
    let geladen = false;
    try {
      await haptik(ImpactStyle.Light);

      // Beim Cache-Treffer gar keine Anzeige zeigen: Sie waere sofort wieder
      // weg und wuerde nur aufblitzen.
      const schonDa = await istGecacht(filePath, quelle);
      if (!schonDa) setLadendeDatei({ pfad: filePath, prozent: 0 });

      const blob = await getMediaBlob(filePath, {
        quelle,
        onFortschritt: (prozent) => {
          setLadendeDatei({ pfad: filePath, prozent });
        },
      });
      geladen = true;
      // Der MIME-Typ kommt aus dem Dateinamen statt aus dem Antwort-Header —
      // beim Cache-Treffer gibt es keine Antwort. mimeType ist der vom
      // Aufrufer gemeldete Typ.
      const mime: string = mimeType || mimeAusDateiname(fileName);

      const openedNatively = await openFileNatively(blob, fileName, mime);
      if (openedNatively) return true;

      // Web-Fallback: FileViewerModal mit Swipe-Kontext. Die übrigen Dateien
      // gehen als API-Pfad hinein; der Betrachter holt sie über denselben
      // Medien-Cache.
      const blobUrl = URL.createObjectURL(new Blob([blob], { type: mime }));
      const alle = kontext();
      const files: FileItem[] = alle.map((d) => {
        if (d.pfad === filePath) {
          return { url: blobUrl, fileName: d.name || fileName, mimeType: mime };
        }
        return {
          url: `/api${medienApiPfad(d.pfad, quelle)}`,
          fileName: d.name || 'Datei',
          mimeType: d.typ || mimeAusDateiname(d.name),
        };
      });
      const clickedIndex = alle.findIndex((d) => d.pfad === filePath);
      viewerRef.current = clickedIndex >= 0
        ? { files, initialIndex: clickedIndex }
        : { files: [{ url: blobUrl, fileName, mimeType: mime }], initialIndex: 0 };
      presentFileViewer({ cssClass: 'file-viewer-modal' });
      return true;
    } catch (err) {
      setError('Fehler beim Öffnen der Datei', { ort: fehlerOrt, fehler: err });
      return geladen;
    } finally {
      // finally statt einzelner Aufrufe: Der Zweig "nativ geoeffnet" steigt
      // per return aus, und ohne finally bliebe die Anzeige dort haengen.
      setLadendeDatei(null);
    }
  };

  return { dateiOeffnen, ladendeDatei };
}
