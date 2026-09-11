import React, { useEffect, useRef, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_ABSPIELEN, ICON_PAUSE } from './icons';

// Gestylter, kompakter Audio-Player für Challenge-Beitraege (Galerie, eigene
// Beitraege, Aufnahme-Vorschau). Ersetzt den nackten <audio controls>-Player.
//
// iOS-WebView-Falle: "duration" kann direkt nach dem Setzen von src erstmal
// Infinity oder NaN sein (kaputte/fehlende Content-Length bei Blob-URLs bzw.
// MediaRecorder-Output ohne Duration-Header). Deshalb wird die Dauer NICHT aus
// "loadedmetadata" uebernommen, wenn sie nicht endlich ist, sondern erst aus
// "durationchange", sobald ein brauchbarer Wert reinkommt. Bis dahin "-:--".
//
// Seekbar-Styling: Die native "accent-color" des range-inputs (Safari/iOS)
// faerbt Track UND Thumb in der uebergebenen Akzentfarbe ein und wirkt dabei
// auf iOS verfaelscht. Deshalb wird die Seekbar komplett selbst gestylt: der
// abgespielte Teil bekommt per Gradient-Overlay (Inline-Style) die echte
// Challenge-Farbe (color-Prop, Default var(--app-color-challenges)), der
// Rest-Track bleibt neutral grau. Der Thumb wird über die CSS-Variable
// --app-audio-seek-color in derselben Farbe gehalten (siehe .app-audio-seekbar
// in variables.css).

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '-:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

interface AudioPlayerProps {
  src: string;
  /** Akzentfarbe für den Play/Pause-Button. */
  color?: string;
}

// Neutraler Rest-Track — der abgespielte Teil nutzt die color-Prop (echte
// Challenge-Farbe), nur der noch nicht abgespielte Teil bleibt neutral grau.
const SEEK_TRACK_COLOR = 'rgba(0, 0, 0, 0.12)';

const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, color = 'var(--app-color-challenges)' }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);

  // Beim Quellenwechsel Zustand zuruecksetzen.
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(null);
  }, [src]);

  const handleDurationChange = () => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    const value = audioEl.duration;
    if (Number.isFinite(value) && value > 0) {
      setDuration(value);
    }
  };

  const handleLoadedMetadata = () => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    const value = audioEl.duration;
    if (Number.isFinite(value) && value > 0) {
      setDuration(value);
    }
    // Manche iOS-WebViews liefern bei Blob-Quellen erst Infinity und wuerden
    // erst durch kurzes Ans-Ende-Springen eine brauchbare Dauer preisgeben.
    // Der Trick funktioniert nicht ueberall zuverlaessig — daher nur als
    // best-effort Ergaenzung zu "durationchange", nicht als einzige Quelle.
    else if (value === Infinity) {
      const el = audioEl;
      const onTimeUpdate = () => {
        if (Number.isFinite(el.duration) && el.duration > 0) {
          setDuration(el.duration);
        }
        el.currentTime = 0;
        el.removeEventListener('timeupdate', onTimeUpdate);
      };
      el.addEventListener('timeupdate', onTimeUpdate);
      el.currentTime = 1e7;
    }
  };

  const handleTimeUpdate = () => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    setCurrentTime(audioEl.currentTime);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) audioRef.current.currentTime = 0;
  };

  const togglePlay = () => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    if (isPlaying) {
      audioEl.pause();
    } else {
      audioEl.play().catch(() => undefined);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    const value = Number(e.target.value);
    audioEl.currentTime = value;
    setCurrentTime(value);
  };

  const seekMax = duration && Number.isFinite(duration) ? duration : 0;
  const seekValue = Math.min(currentTime, seekMax);
  const seekPercent = seekMax > 0 ? (seekValue / seekMax) * 100 : 0;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-schmal)',
        width: '100%', marginTop: 'var(--app-abstand-eng)', padding: 'var(--app-abstand-eng) var(--app-abstand-schmal)', borderRadius: 'var(--app-radius-knopf)',
        background: 'rgba(0,0,0,0.03)'
      }}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onDurationChange={handleDurationChange}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEnded}
        style={{ display: 'none' }}
      />

      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Abspielen'}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '34px', height: '34px', borderRadius: 'var(--app-radius-kreis)', flexShrink: 0,
          border: 'none', background: color, color: 'white', cursor: 'pointer',
          padding: 0
        }}
      >
        <IonIcon icon={isPlaying ? ICON_PAUSE : ICON_ABSPIELEN} style={{ fontSize: 'var(--app-text-standard)' }} />
      </button>

      <input
        type="range"
        className="app-audio-seekbar"
        min={0}
        max={seekMax}
        step={0.1}
        value={seekValue}
        onChange={handleSeek}
        disabled={!seekMax}
        style={{
          flex: '1 1 auto', minWidth: 0, width: '100%', height: '4px',
          cursor: seekMax ? 'pointer' : 'default',
          background: `linear-gradient(to right, ${color} ${seekPercent}%, ${SEEK_TRACK_COLOR} ${seekPercent}%)`,
          ['--app-audio-seek-color' as string]: color
        }}
      />

      <span
        style={{
          fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', flexShrink: 0,
          minWidth: '68px', textAlign: 'right', fontVariantNumeric: 'tabular-nums'
        }}
      >
        {formatTime(currentTime)} / {duration !== null ? formatTime(duration) : '-:--'}
      </span>
    </div>
  );
};

export default AudioPlayer;
