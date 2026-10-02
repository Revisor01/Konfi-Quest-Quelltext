import React, { useState, useRef, useCallback, useEffect } from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_DATEI, ICON_EXTERN_OEFFNEN, ICON_HERUNTERLADEN, ICON_SCHLIESSEN, ICON_TEILEN } from './icons';
import { Capacitor } from '@capacitor/core';
import { dateiExternOeffnen, teilen } from '../../services/systemDialoge';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import api, { DATEI_TIMEOUT_MS } from '../../services/api';
import { getMediaBlob, medienAusApiPfad } from '../../services/mediaCache';
import { pdfImAppBetrachter, zeigtAppBetrachter } from '../../utils/nativeFileViewer';
import type { PdfSeitenProps } from './PdfSeiten';
import './FileViewerModal.css';

// --- Hilfsfunktion: API-Pfade erkennen und per Auth-fetch in Blob-URL wandeln ---
const isApiPath = (url: string): boolean => {
  return url.startsWith('/api/') || url.startsWith('api/');
};

const resolveUrl = async (url: string, mimeType: string): Promise<string> => {
  if (!isApiPath(url)) return url;
  // Relativer API-Pfad → per axios (mit Auth-Header) laden
  const cleanPath = url.startsWith('/api/') ? url.substring(4) : url.startsWith('api/') ? '/' + url.substring(4) : url;
  // Dateien aus Chat, Challenges und Material über den Medien-Cache
  // Wer im Betrachter zu den übrigen Dateien wischt, lud jede
  // davon bisher an
  // ihm vorbei — bei jedem Wischen neu. Der Typ kommt aus dem Dateinamen;
  // beim Treffer im Cache gibt es keinen Antwort-Header.
  const medium = medienAusApiPfad(cleanPath);
  if (medium) {
    const blob = await getMediaBlob(medium.datei, { quelle: medium.quelle });
    return URL.createObjectURL(new Blob([blob], { type: mimeType || blob.type }));
  }
  const response = await api.get(cleanPath, { responseType: 'blob', timeout: DATEI_TIMEOUT_MS });
  const contentType = response.headers?.['content-type'];
  const mime: string = typeof contentType === 'string' ? contentType : 'application/octet-stream';
  return URL.createObjectURL(new Blob([response.data], { type: mime }));
};

// --- Interfaces ---

export interface FileItem {
  url: string;
  fileName: string;
  mimeType: string;
}

interface FileViewerModalProps {
  // Multi-Datei-Modus
  files?: FileItem[];
  initialIndex?: number;
  // Einzel-Datei-Modus (Rueckwaerts-Kompatibilitaet)
  blobUrl?: string;
  fileName?: string;
  mimeType?: string;
  // Callback
  onClose: () => void;
}

// --- Hilfsfunktionen ---

const getFileCategory = (mimeType: string): 'image' | 'pdf' | 'video' | 'document' | 'fallback' => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || mimeType === 'application/msword'
    || mimeType === 'application/vnd.oasis.opendocument.text') return 'document';
  return 'fallback';
};

const openFileNatively = async (resolvedUrl: string, fileName: string, mimeType: string): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const response = await fetch(resolvedUrl);
    const blob = await response.blob();
    const reader = new FileReader();
    return new Promise<boolean>((resolve) => {
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const result = await Filesystem.writeFile({
            path: fileName,
            data: base64,
            directory: Directory.Cache
          });
          // Durch die Hülle: Auf Android geht die Datei in einer fremden App
          // auf, und die App-Sperre darf das nicht für "verlassen" halten
          // 
          await dateiExternOeffnen(() => FileOpener.open({
            filePath: result.uri,
            contentType: mimeType
          }));
          resolve(true);
        } catch {
          resolve(false);
        }
      };
      reader.onerror = () => resolve(false);
      reader.readAsDataURL(blob);
    });
  } catch {
    return false;
  }
};

const getDistance = (t1: React.Touch, t2: React.Touch): number => {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
};

// --- Komponente ---

const FileViewerModal: React.FC<FileViewerModalProps> = (props) => {
  const {
    files: filesProp,
    initialIndex = 0,
    blobUrl,
    fileName,
    mimeType,
    onClose
  } = props;

  // Einzel-Datei in Array wrappen wenn nötig
  const files: FileItem[] = (filesProp && filesProp.length > 0)
    ? filesProp
    : (blobUrl ? [{ url: blobUrl, fileName: fileName || 'Datei', mimeType: mimeType || 'application/octet-stream' }] : []);

  // State
  const [currentIndex, setCurrentIndex] = useState(Math.min(initialIndex, Math.max(files.length - 1, 0)));
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [nativeOpening, setNativeOpening] = useState(false);

  // Refs für Touch-Handling
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTapRef = useRef<number>(0);
  const pinchStartDistRef = useRef<number>(0);
  const pinchStartScaleRef = useRef<number>(1);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Cache für aufgelöste URLs (API-Pfade → Blob-URLs)
  const resolvedUrlsRef = useRef<Record<string, string>>({});

  // Desktop Mouse-Refs
  const mouseDownRef = useRef<{ x: number; y: number } | null>(null);
  const mousePanStartRef = useRef<{ x: number; y: number } | null>(null);

  // Dateien, die der Betrachter selbst nicht darstellen konnte (pdf.js
  // gescheitert, Bild- oder Videoformat unbekannt). Auf Android gehen sie dann
  // doch in eine fremde App, im Browser zeigt das iframe die PDF.
  const [nichtDarstellbar, setNichtDarstellbar] = useState<ReadonlySet<number>>(() => new Set());
  // Die PDF-Ansicht samt pdf.js, erst beim ersten Öffnen einer PDF geladen.
  const [PdfAnsicht, setPdfAnsicht] = useState<React.ComponentType<PdfSeitenProps> | null>(null);

  const currentFile = files[currentIndex];
  const isNative = Capacitor.isNativePlatform();
  const category = currentFile ? getFileCategory(currentFile.mimeType) : 'fallback';
  const gescheitert = nichtDarstellbar.has(currentIndex);
  // Zeigt der Betrachter diese Datei selbst? Auf Android Bilder, Videos, PDFs;
  // im Browser alles; auf iOS gehen PDFs und Dokumente in die Vorschau des
  // Systems (siehe utils/nativeFileViewer.ts).
  const pdfInDerApp = category === 'pdf' && pdfImAppBetrachter() && !gescheitert;
  // Auf Android: in eine fremde App ausweichen, wenn die eigene Anzeige
  // scheitert. Auf iOS bleibt alles, wie es war.
  const darfAusweichen = isNative && !!currentFile && zeigtAppBetrachter(currentFile.mimeType);
  const externOeffnen = isNative && !!currentFile && (
    category === 'document'
    || (category === 'pdf' && !pdfInDerApp)
    || (darfAusweichen && gescheitert)
  );

  const ausweichen = useCallback((index: number) => {
    setNichtDarstellbar((vorher) => (vorher.has(index) ? vorher : new Set(vorher).add(index)));
  }, []);

  // URL-Aufloesung: API-Pfade per Auth-fetch in Blob-URL wandeln
  useEffect(() => {
    if (!currentFile) return;
    const url = currentFile.url;

    // Bereits aufgelöste URL aus Cache nutzen
    if (resolvedUrlsRef.current[url]) {
      setResolvedUrl(resolvedUrlsRef.current[url]);
      setUrlLoading(false);
      return;
    }

    // Kein API-Pfad → direkt verwenden
    if (!isApiPath(url)) {
      setResolvedUrl(url);
      setUrlLoading(false);
      return;
    }

    // API-Pfad → async laden
    setUrlLoading(true);
    setResolvedUrl(null);
    resolveUrl(url, currentFile.mimeType).then(resolved => {
      resolvedUrlsRef.current[url] = resolved;
      setResolvedUrl(resolved);
      setUrlLoading(false);
    }).catch(() => {
      setResolvedUrl(null);
      setUrlLoading(false);
    });
  }, [currentFile]);

  // Reset Zoom bei Index-Wechsel
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [currentIndex]);

  // Beim Unmount alle gecachten Blob-URLs freigeben (sonst Leak bei Multi-Datei)
  useEffect(() => {
    return () => {
      Object.values(resolvedUrlsRef.current).forEach((u) => {
        if (u.startsWith('blob:')) {
          try { URL.revokeObjectURL(u); } catch { /* Freigeben darf scheitern */ }
        }
      });
      resolvedUrlsRef.current = {};
    };
  }, []);

  // Automatisch nativ öffnen: Dokumente (Word …) auf iOS und Android, PDFs
  // auf iOS, auf Android alles, was der Betrachter nicht darstellen konnte.
  useEffect(() => {
    if (!resolvedUrl || !currentFile || !externOeffnen) return;

    setNativeOpening(true);
    openFileNatively(resolvedUrl, currentFile.fileName, currentFile.mimeType).then((success) => {
      setNativeOpening(false);
      if (success) {
        onClose();
      }
      // Bei Fehler: Fallback zum bestehenden Rendering (iframe/Download)
    });
  }, [resolvedUrl, currentFile, externOeffnen]);

  // pdf.js erst laden, wenn eine PDF in der App zu zeigen ist (eigener Chunk,
  // siehe utils/pdfDokument.ts). Scheitert schon das Laden — etwa weil im
  // Browser nach einem Update der alte Chunk fehlt —, weicht der Betrachter aus.
  useEffect(() => {
    if (!pdfInDerApp || PdfAnsicht) return;
    let aus = false;
    import('./PdfSeiten')
      .then((modul) => { if (!aus) setPdfAnsicht(() => modul.default); })
      .catch(() => { if (!aus) ausweichen(currentIndex); });
    return () => { aus = true; };
  }, [pdfInDerApp, PdfAnsicht, ausweichen, currentIndex]);

  // --- Navigation ---
  const goToNext = useCallback(() => {
    if (currentIndex < files.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  }, [currentIndex, files.length]);

  const goToPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  }, [currentIndex]);

  // --- Wischen über einem Video ---
  // Bisher ließ sich ein Video nur ansehen: Wer aus einer Folge von Fotos auf
  // ein Video wischte, kam dort nicht weiter. Auf Android öffnen Videos jetzt
  // im Betrachter, damit wurde die Lücke sichtbar.
  // Das untere Viertel gehört der Zeitleiste des Videos — ein Wisch, der dort
  // beginnt, spult und wechselt nicht die Datei.
  const videoWischRef = useRef<{ x: number; y: number; zeit: number } | null>(null);

  const handleVideoTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    const box = e.currentTarget.getBoundingClientRect();
    if (e.touches.length !== 1 || !t || t.clientY > box.bottom - box.height / 4) {
      videoWischRef.current = null;
      return;
    }
    videoWischRef.current = { x: t.clientX, y: t.clientY, zeit: Date.now() };
  }, []);

  const handleVideoTouchEnd = useCallback((e: React.TouchEvent) => {
    const start = videoWischRef.current;
    videoWischRef.current = null;
    const ende = e.changedTouches[0];
    if (!start || !ende) return;
    const dx = ende.clientX - start.x;
    const dy = ende.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - start.zeit < 500) {
      if (dx < 0) goToNext();
      else goToPrev();
    }
  }, [goToNext, goToPrev]);

  // --- Touch-Handler (Bild) ---
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch Start
      pinchStartDistRef.current = getDistance(e.touches[0], e.touches[1]);
      pinchStartScaleRef.current = scale;
      return;
    }
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };

      if (scale > 1) {
        // Pan-Modus wenn gezoomt
        panStartRef.current = { x: position.x, y: position.y };
        setIsDragging(true);
      } else {
        // Swipe-Modus
        swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
      }
    }
  }, [scale, position]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault(); // iOS: Standard-Scroll/Zoom unterdruecken
    if (e.touches.length === 2) {
      // Pinch Zoom
      const dist = getDistance(e.touches[0], e.touches[1]);
      const newScale = Math.max(0.5, Math.min(5, pinchStartScaleRef.current * (dist / pinchStartDistRef.current)));
      setScale(newScale);
      return;
    }
    if (e.touches.length === 1 && isDragging && panStartRef.current && touchStartRef.current) {
      // Pan
      const dx = e.touches[0].clientX - touchStartRef.current.x;
      const dy = e.touches[0].clientY - touchStartRef.current.y;
      setPosition({
        x: panStartRef.current.x + dx,
        y: panStartRef.current.y + dy
      });
    }
  }, [isDragging]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Doppeltap-Erkennung
    const now = Date.now();
    if (touchStartRef.current && now - lastTapRef.current < 300) {
      // Doppeltap: Toggle Zoom
      if (scale > 1) {
        setScale(1);
        setPosition({ x: 0, y: 0 });
      } else {
        setScale(2.5);
      }
      lastTapRef.current = 0;
      touchStartRef.current = null;
      setIsDragging(false);
      return;
    }
    lastTapRef.current = now;

    // Swipe-Erkennung (nur wenn nicht gezoomt)
    if (swipeStartRef.current && touchStartRef.current && scale <= 1) {
      const dx = (e.changedTouches[0]?.clientX ?? 0) - swipeStartRef.current.x;
      const dy = (e.changedTouches[0]?.clientY ?? 0) - swipeStartRef.current.y;
      const elapsed = now - touchStartRef.current.time;

      // Horizontaler Swipe für Navigation
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && elapsed < 500) {
        if (dx < 0) goToNext();
        else goToPrev();
      }

      // Vertikaler Swipe-Down zum Schliessen
      if (dy > 150 && Math.abs(dy) > Math.abs(dx)) {
        onClose();
      }
    }

    // Snap zurück bei Zoom < 1
    if (scale < 1) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }

    touchStartRef.current = null;
    panStartRef.current = null;
    swipeStartRef.current = null;
    setIsDragging(false);
  }, [scale, goToNext, goToPrev, onClose]);

  // --- Desktop Mouse-Handler ---
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    setScale(prev => Math.max(0.5, Math.min(5, prev + delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale > 1) {
      mouseDownRef.current = { x: e.clientX, y: e.clientY };
      mousePanStartRef.current = { x: position.x, y: position.y };
      setIsDragging(true);
    }
  }, [scale, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && mouseDownRef.current && mousePanStartRef.current) {
      const dx = e.clientX - mouseDownRef.current.x;
      const dy = e.clientY - mouseDownRef.current.y;
      setPosition({
        x: mousePanStartRef.current.x + dx,
        y: mousePanStartRef.current.y + dy
      });
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    mouseDownRef.current = null;
    mousePanStartRef.current = null;
    setIsDragging(false);
    if (scale < 1) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [scale]);

  // --- Download ---
  const handleDownload = useCallback(async () => {
    if (!currentFile || !resolvedUrl) return;

    if (Capacitor.isNativePlatform()) {
      try {
        // Datei als Blob laden (resolvedUrl ist immer blob: oder direkte URL)
        const response = await fetch(resolvedUrl);
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1];
          const result = await Filesystem.writeFile({
            path: currentFile.fileName,
            data: base64,
            directory: Directory.Cache
          });
          // Nach dem Speichern: Share öffnen für "Speichern unter"
          await teilen({
            title: currentFile.fileName,
            url: result.uri,
            dialogTitle: 'Datei speichern'
          });
        };
        reader.readAsDataURL(blob);
      } catch {
        // Fallback: Browser-Download
        triggerBrowserDownload(resolvedUrl, currentFile.fileName);
      }
    } else {
      triggerBrowserDownload(resolvedUrl, currentFile.fileName);
    }
  }, [currentFile, resolvedUrl]);

  const triggerBrowserDownload = (url: string, name: string) => {
    const a = window.document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
  };

  // --- Share (nur nativ) ---
  const handleShare = useCallback(async () => {
    if (!currentFile || !resolvedUrl || !Capacitor.isNativePlatform()) return;

    try {
      const response = await fetch(resolvedUrl);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const result = await Filesystem.writeFile({
          path: currentFile.fileName,
          data: base64,
          directory: Directory.Cache
        });
        await teilen({
          title: currentFile.fileName,
          url: result.uri,
          dialogTitle: 'Datei teilen'
        });
      };
      reader.readAsDataURL(blob);
    } catch {
      // Share fehlgeschlagen — still ignorieren
    }
  }, [currentFile, resolvedUrl]);

  // --- Keyboard-Handler ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goToPrev();
      if (e.key === 'ArrowRight') goToNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, goToPrev, goToNext]);

  // --- Rendering ---
  if (!currentFile) return null;

  const istAndroid = isNative && Capacitor.getPlatform() === 'android';

  // Die Datei geht in die Vorschau des Systems (iOS) oder in eine fremde App
  // (Android). Der Block steht, solange das läuft, und bietet danach einen
  // zweiten Versuch an.
  const renderNativOeffnen = () => (
    <div className="file-viewer-fallback">
      <IonIcon icon={ICON_DATEI} className="file-viewer-fallback-icon" />
      <p className="file-viewer-fallback-name">{currentFile.fileName}</p>
      {gescheitert && (
        <p className="file-viewer-fallback-type">Die App kann diese Datei nicht selbst anzeigen.</p>
      )}
      <p className="file-viewer-fallback-type">
        {nativeOpening ? 'Wird geöffnet...' : 'Tippe zum erneut Öffnen'}
      </p>
      {!nativeOpening && (
        <button className="file-viewer-fallback-btn" onClick={() => {
          if (resolvedUrl) {
            setNativeOpening(true);
            openFileNatively(resolvedUrl, currentFile.fileName, currentFile.mimeType).then((success) => {
              setNativeOpening(false);
              if (success) onClose();
            });
          }
        }}>
          <IonIcon icon={istAndroid ? ICON_EXTERN_OEFFNEN : ICON_DATEI} />
          {istAndroid ? 'Mit anderer App öffnen' : 'Nativ öffnen'}
        </button>
      )}
    </div>
  );

  const renderContent = () => {
    // Ladeindikator für API-Pfade
    if (urlLoading || !resolvedUrl) {
      return (
        <div className="file-viewer-fallback">
          <p className="file-viewer-fallback-name">Datei wird geladen...</p>
        </div>
      );
    }

    // Auf Android konnte der Betrachter die Datei nicht zeigen (etwa ein
    // Videoformat, das das WebView nicht abspielt): fremde App.
    if (darfAusweichen && gescheitert) return renderNativOeffnen();

    switch (category) {
      case 'image':
        return (
          <div
            ref={containerRef}
            className="file-viewer-image-container"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <img
              src={resolvedUrl}
              alt={currentFile.fileName}
              className={`file-viewer-image${!isDragging ? ' transitioning' : ''}`}
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`
              }}
              draggable={false}
              onError={darfAusweichen ? () => ausweichen(currentIndex) : undefined}
            />
          </div>
        );

      case 'pdf':
        if (pdfInDerApp) {
          if (!PdfAnsicht) {
            return (
              <div className="file-viewer-fallback">
                <p className="file-viewer-fallback-name">PDF wird geladen…</p>
              </div>
            );
          }
          return (
            <PdfAnsicht
              key={resolvedUrl}
              url={resolvedUrl}
              titel={currentFile.fileName}
              onFehler={() => ausweichen(currentIndex)}
              onWischen={(richtung) => (richtung === 'weiter' ? goToNext() : goToPrev())}
            />
          );
        }
        if (isNative) return renderNativOeffnen();
        return (
          <iframe
            src={resolvedUrl}
            title={currentFile.fileName}
            className="file-viewer-pdf"
            allow="fullscreen"
          />
        );

      case 'document':
        if (isNative) return renderNativOeffnen();
        return (
          <div className="file-viewer-fallback">
            <IonIcon icon={ICON_DATEI} className="file-viewer-fallback-icon" />
            <p className="file-viewer-fallback-name">{currentFile.fileName}</p>
            <p className="file-viewer-fallback-type">{currentFile.mimeType}</p>
            <button className="file-viewer-fallback-btn" onClick={handleDownload}>
              <IonIcon icon={ICON_HERUNTERLADEN} />
              Herunterladen
            </button>
          </div>
        );

      case 'video':
        return (
          <div
            className="file-viewer-video-rahmen"
            onTouchStart={handleVideoTouchStart}
            onTouchEnd={handleVideoTouchEnd}
          >
            <video
              src={resolvedUrl}
              className="file-viewer-video"
              controls
              playsInline
              autoPlay={false}
              onError={darfAusweichen ? () => ausweichen(currentIndex) : undefined}
            />
          </div>
        );

      case 'fallback':
      default:
        return (
          <div className="file-viewer-fallback">
            <IonIcon icon={ICON_DATEI} className="file-viewer-fallback-icon" />
            <p className="file-viewer-fallback-name">{currentFile.fileName}</p>
            <p className="file-viewer-fallback-type">
              {currentFile.mimeType || 'Unbekannter Dateityp'}
            </p>
            <button className="file-viewer-fallback-btn" onClick={handleDownload}>
              <IonIcon icon={ICON_HERUNTERLADEN} />
              Herunterladen
            </button>
          </div>
        );
    }
  };

  return (
    // Name des Dialogs fuer Vorlesehilfen: der Dateiname, der auch oben in
    // der Leiste steht (keine ion-title hier, siehe utils/modalNamen.ts).
    <div className="file-viewer-overlay" data-dialogname={currentFile.fileName || 'Datei'}>
      {/* Toolbar */}
      <div className="file-viewer-toolbar">
        <div className="file-viewer-toolbar-left">
          <button className="file-viewer-btn" onClick={onClose} aria-label="Schließen">
            <IonIcon icon={ICON_SCHLIESSEN} />
          </button>
        </div>

        <div className="file-viewer-toolbar-center">
          {currentFile.fileName}
        </div>

        <div className="file-viewer-toolbar-right">
          {isNative ? (
            <button className="file-viewer-btn" onClick={handleShare} aria-label="Teilen">
              <IonIcon icon={ICON_TEILEN} />
            </button>
          ) : (
            <button className="file-viewer-btn" onClick={handleDownload} aria-label="Herunterladen">
              <IonIcon icon={ICON_HERUNTERLADEN} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="file-viewer-content">
        {renderContent()}
      </div>

      {/* Counter */}
      {files.length > 1 && (
        <div className="file-viewer-counter">
          {currentIndex + 1} / {files.length}
        </div>
      )}
    </div>
  );
};

export default FileViewerModal;
