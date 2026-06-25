import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { getMediaBlob } from '../../services/mediaCache';
import { Message } from '../../types/chat';
import { formatFileSize } from '../../utils/helpers';

interface VideoPreviewProps {
  message: Message;
  onError: (error: string) => void;
}

const VideoPreview: React.FC<VideoPreviewProps> = ({ message, onError }) => {
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [duration, setDuration] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);
  // onError als Ref (MessageBubble liefert einen Inline-Arrow, der bei jedem
  // Render neu entsteht). In der useEffect-Dependency-Liste wuerde das den
  // Lade-Effekt staendig neu ausloesen -> Video-Reload-Loop. Ueber die Ref
  // bleibt der Effekt an `message.file_path` gebunden und laeuft pro Video EINMAL.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

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
        console.warn('Canvas-Thumbnail fehlgeschlagen:', message.file_name, error);
      }
      // Offscreen-Video aufraeumen
      offscreenVideo.removeAttribute('src');
      offscreenVideo.load();
    });

    offscreenVideo.addEventListener('error', () => {
      console.warn('Offscreen-Video-Fehler bei Thumbnail-Generierung:', message.file_name);
    });

    offscreenVideo.src = blobUrl;
  }, [message.file_name]);

  useEffect(() => {
    let blobUrl = '';

    const loadVideoBlob = async () => {
      try {
        setLoading(true);
        setHasError(false);

        // Aus lokalem Cache laden (oder einmalig vom Server + cachen).
        const blob = await getMediaBlob(message.file_path!);
        const fileName = message.file_name?.toLowerCase() || '';
        let mimeType = blob.type;

        if (!mimeType || mimeType === 'application/octet-stream') {
          if (fileName.endsWith('.mov')) {
            mimeType = 'video/quicktime';
          } else if (fileName.endsWith('.mp4')) {
            mimeType = 'video/mp4';
          } else if (fileName.endsWith('.webm')) {
            mimeType = 'video/webm';
          } else if (fileName.endsWith('.avi')) {
            mimeType = 'video/x-msvideo';
          } else if (fileName.endsWith('.m4v')) {
            mimeType = 'video/x-m4v';
          } else {
            mimeType = 'video/mp4';
          }
        }

        const correctedBlob = new Blob([blob], { type: mimeType });
        blobUrl = URL.createObjectURL(correctedBlob);

        setVideoUrl(blobUrl);
        generateThumbnail(blobUrl);
        setLoading(false);
      } catch (error) {
        console.error('Fehler beim Laden des Video-Blobs:', error);
        setHasError(true);
        setLoading(false);
        onErrorRef.current('Fehler beim Laden des Videos');
      }
    };

    if (message.file_path) {
      loadVideoBlob();
    }

    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
    // NUR an file_path gebunden — file_name/generateThumbnail/onError bewusst
    // ausgeklammert, sonst Reload-Loop (s. onErrorRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.file_path]);

  const handleVideoClick = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });

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
      onError('Fehler beim Abspielen des Videos');
    }
  };

  const handleVideoEnd = () => {
    setIsPlaying(false);
    setShowControls(false);
  };

  const placeholderStyle: React.CSSProperties = {
    position: 'relative',
    maxWidth: '280px',
    height: '200px',
    borderRadius: '12px',
    backgroundColor: '#1e1e1e',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  if (loading) {
    return (
      <div style={placeholderStyle}>
        <div style={{ color: 'white', opacity: 0.7 }}>Video wird geladen...</div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div style={placeholderStyle}>
        <div style={{ color: 'white', opacity: 0.7 }}>Fehler beim Laden</div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', maxWidth: '280px', borderRadius: '12px', overflow: 'hidden' }}>
      <video
        ref={videoRef}
        src={videoUrl}
        poster={thumbnailUrl || undefined}
        style={{
          width: '100%',
          height: 'auto',
          maxHeight: '200px',
          minHeight: '120px',
          display: 'block',
          borderRadius: '12px',
          backgroundColor: '#000',
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
          console.error('Video-Element-Fehler für:', message.file_name);
          setHasError(true);
          onError('Video kann nicht abgespielt werden');
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
            borderRadius: '50%',
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
            marginLeft: '4px'
          }} />
        </div>
      )}

      <div style={{
        position: 'absolute',
        bottom: '8px',
        left: '8px',
        display: 'flex',
        gap: '6px',
        zIndex: 5
      }}>
        {duration && (
          <div style={{
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '12px',
            fontSize: '0.75rem',
            fontWeight: '500',
            pointerEvents: 'none'
          }}>
            {duration}
          </div>
        )}
      </div>

      <div style={{
        position: 'absolute',
        bottom: '8px',
        right: '8px',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        padding: '4px 8px',
        borderRadius: '12px',
        fontSize: '0.75rem',
        fontWeight: '500',
        pointerEvents: 'none',
        zIndex: 5
      }}>
        {message.file_size && formatFileSize(message.file_size)}
      </div>
    </div>
  );
};

export default VideoPreview;
