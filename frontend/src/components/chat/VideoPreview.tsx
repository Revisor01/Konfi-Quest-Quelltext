import React, { useState, useEffect, useRef, useCallback } from 'react';
import { haptik, ImpactStyle } from '../../utils/haptics';
import type { MedienQuelle } from '../../services/mediaCache';
import { useMedienDatei } from '../../hooks/useMedienDatei';
import MedienPlatzhalter from '../shared/MedienPlatzhalter';
import { formatFileSize } from '../../utils/helpers';

interface VideoPreviewProps {
  filePath: string;
  fileName?: string | null;
  fileSize?: number | null;
  /** Woher das Video kommt; ohne Angabe der Chat. */
  quelle?: MedienQuelle;
  onError?: (error: string) => void;
  /** Volle Breite der Karte (Challenge-Beiträge) statt höchstens 280 px. */
  vollbreite?: boolean;
}

// Typ für die Wiedergabe aus dem Dateinamen. Die Server vergeben Dateinamen
// ohne Endung, und aus dem Cache kommt der Blob ohne Typ zurück — ohne
// richtigen Typ spielt iOS das Video nicht ab.
const videoTyp = (name: string | null | undefined): string => {
  const fileName = name?.toLowerCase() || '';
  if (fileName.endsWith('.mov')) return 'video/quicktime';
  if (fileName.endsWith('.mp4')) return 'video/mp4';
  if (fileName.endsWith('.webm')) return 'video/webm';
  if (fileName.endsWith('.avi')) return 'video/x-msvideo';
  if (fileName.endsWith('.m4v')) return 'video/x-m4v';
  return 'video/mp4';
};

const VideoPreview: React.FC<VideoPreviewProps> = ({
  filePath,
  fileName,
  fileSize,
  quelle = 'chat',
  onError,
  vollbreite = false,
}) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('');
  const [abspielFehler, setAbspielFehler] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [duration, setDuration] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);
  // onError als Ref (MessageBubble liefert einen Inline-Arrow, der bei jedem
  // Render neu entsteht). In einer Abhängigkeitsliste würde das den
  // Lade-Effekt ständig neu auslösen -> Video-Reload-Loop.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Eigener, typisierter Blob (typ gesetzt): Die URL gehört dieser Vorschau
  // und wird beim Abhängen freigegeben — auch wenn der Download dann noch lief
  // 
  const { url: videoUrl, zustand, prozent, erneutVersuchen } = useMedienDatei(filePath, {
    quelle,
    typ: videoTyp(fileName),
    onFehler: () => onErrorRef.current?.('Fehler beim Laden des Videos'),
  });

  // Canvas-basierte Thumbnail-Generierung (kein sichtbares play/pause)
  const generateThumbnail = useCallback((blobUrl: string) => {
    const offscreenVideo = document.createElement('video');
    offscreenVideo.preload = 'metadata';
    offscreenVideo.muted = true;
    offscreenVideo.playsInline = true;
    offscreenVideo.crossOrigin = 'anonymous';

    offscreenVideo.addEventListener('loadedmetadata', () => {
      // Dauer formatieren
      const totalSeconds = Math.floor(offscreenVideo.duration);
      if (totalSeconds > 0) {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        setDuration(`${mins}:${secs.toString().padStart(2, '0')}`);
      }
      // Zum Frame bei 0.1s springen
      offscreenVideo.currentTime = Math.min(0.1, offscreenVideo.duration);
    });

    offscreenVideo.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = offscreenVideo.videoWidth || 320;
        canvas.height = offscreenVideo.videoHeight || 240;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          setThumbnailUrl(dataUrl);
        }
      } catch (error) {
        console.warn('Canvas-Thumbnail fehlgeschlagen:', fileName, error);
      }
      // Offscreen-Video aufräumen
      offscreenVideo.removeAttribute('src');
      offscreenVideo.load();
    });

    offscreenVideo.addEventListener('error', () => {
      console.warn('Offscreen-Video-Fehler bei Thumbnail-Generierung:', fileName);
    });

    offscreenVideo.src = blobUrl;
  }, [fileName]);

  useEffect(() => {
    if (videoUrl) generateThumbnail(videoUrl);
    // NUR an der URL — generateThumbnail ändert sich mit dem Namen, nicht
    // mit dem Video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  const handleVideoClick = async () => {
    try {
      await haptik(ImpactStyle.Light);

      if (videoRef.current) {
        if (isPlaying) {
          videoRef.current.pause();
          setIsPlaying(false);
        } else {
          videoRef.current.muted = false;
          await videoRef.current.play();
          setIsPlaying(true);
          setShowControls(true);
        }
      }
    } catch (error) {
      console.error('Video-Wiedergabe-Fehler:', error);
      onErrorRef.current?.('Fehler beim Abspielen des Videos');
    }
  };

  const handleVideoEnd = () => {
    setIsPlaying(false);
    setShowControls(false);
  };

  const breite = vollbreite ? '100%' : '280px';

  const placeholderStyle: React.CSSProperties = {
    position: 'relative',
    maxWidth: breite,
    width: vollbreite ? '100%' : undefined,
    minHeight: '200px',
    borderRadius: 'var(--app-radius-karte)',
    backgroundColor: 'var(--app-surface-dark)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  if (!videoUrl) {
    return (
      <div style={placeholderStyle}>
        <MedienPlatzhalter zustand={zustand} prozent={prozent} was="Das Video" onErneut={erneutVersuchen} dunkel />
      </div>
    );
  }

  if (abspielFehler) {
    return (
      <div style={placeholderStyle}>
        <div style={{ opacity: 0.7, fontSize: 'var(--app-text-sekundaer)' }}>Das Video kann nicht abgespielt werden.</div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', maxWidth: breite, width: vollbreite ? '100%' : undefined, borderRadius: 'var(--app-radius-karte)', overflow: 'hidden' }}>
      <video
        ref={videoRef}
        src={videoUrl}
        poster={thumbnailUrl || undefined}
        style={{
          width: '100%',
          height: 'auto',
          maxHeight: vollbreite ? '320px' : '200px',
          minHeight: '120px',
          display: 'block',
          borderRadius: 'var(--app-radius-karte)',
          backgroundColor: 'var(--app-schwarz)',
          cursor: 'pointer',
          objectFit: 'cover',
          border: '1px solid rgba(255,255,255,0.1)'
        }}
        preload="none"
        muted
        playsInline
        controls={showControls}
        onClick={handleVideoClick}
        onEnded={handleVideoEnd}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onError={() => {
          console.error('Video-Element-Fehler für:', fileName);
          setAbspielFehler(true);
          onErrorRef.current?.('Video kann nicht abgespielt werden');
        }}
      />

      {!isPlaying && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '60px',
            height: '60px',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            borderRadius: 'var(--app-radius-kreis)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            pointerEvents: 'none',
            transition: 'all 0.3s ease',
            zIndex: 10
          }}
        >
          <div style={{
            width: '0',
            height: '0',
            borderLeft: '20px solid white',
            borderTop: '12px solid transparent',
            borderBottom: '12px solid transparent',
            marginLeft: 'var(--app-abstand-mini)'
          }} />
        </div>
      )}

      <div style={{
        position: 'absolute',
        bottom: '8px',
        left: '8px',
        display: 'flex',
        gap: 'var(--app-abstand-kompakt)',
        zIndex: 5
      }}>
        {duration && (
          <div style={{
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: 'var(--app-abstand-mini) var(--app-abstand-eng)',
            borderRadius: 'var(--app-radius-karte)',
            fontSize: 'var(--app-text-klein)',
            fontWeight: 'var(--app-schrift-mittel)',
            pointerEvents: 'none'
          }}>
            {duration}
          </div>
        )}
      </div>

      {fileSize ? (
        <div style={{
          position: 'absolute',
          bottom: '8px',
          right: '8px',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: 'var(--app-abstand-mini) var(--app-abstand-eng)',
          borderRadius: 'var(--app-radius-karte)',
          fontSize: 'var(--app-text-klein)',
          fontWeight: 'var(--app-schrift-mittel)',
          pointerEvents: 'none',
          zIndex: 5
        }}>
          {formatFileSize(fileSize)}
        </div>
      ) : null}
    </div>
  );
};

export default VideoPreview;
