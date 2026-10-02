import React from 'react';
import LazyImage from '../chat/LazyImage';
import VideoPreview from '../chat/VideoPreview';
import AudioPlayer from './AudioPlayer';
import MedienPlatzhalter from './MedienPlatzhalter';
import { useMedienDatei } from '../../hooks/useMedienDatei';
import { mimeAusDateiname } from '../../services/mediaCache';
import type { ChallengeMediaType } from '../../types/challenges';

// Foto, Video oder Aufnahme eines Challenge-Beitrags — EINE Anzeige für die
// Konfi-Ansicht (Galerie, eigene Beiträge) und die Leitungsansicht
// 

interface ChallengeMediumProps {
  filePath: string;
  fileName?: string | null;
  mediaType: ChallengeMediaType;
  /** Höchste Höhe des Fotos in px. */
  maxHoehe?: number;
  /** Foto antippen: öffnen (nativ oder im Betrachter). */
  onOeffnen?: (filePath: string, fileName: string) => void;
}

/** Tonaufnahme: laden wie ein Video (eigener, typisierter Blob), abspielen im AudioPlayer. */
const ChallengeAufnahme: React.FC<{ filePath: string; fileName?: string | null }> = ({ filePath, fileName }) => {
  const { url, zustand, prozent, erneutVersuchen } = useMedienDatei(filePath, {
    quelle: 'challenges',
    // Derselbe Typ, den der Server aus dem Originalnamen setzt.
    typ: mimeAusDateiname(fileName),
  });

  if (!url) {
    return (
      <div
        style={{
          marginTop: 'var(--app-abstand-eng)',
          minHeight: '64px',
          borderRadius: 'var(--app-radius-knopf)',
          background: 'var(--app-surface-dim)',
          color: 'var(--app-text-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <MedienPlatzhalter zustand={zustand} prozent={prozent} was="Die Aufnahme" onErneut={erneutVersuchen} />
      </div>
    );
  }
  return <AudioPlayer src={url} />;
};

const ChallengeMedium: React.FC<ChallengeMediumProps> = ({ filePath, fileName, mediaType, maxHoehe = 320, onOeffnen }) => {
  const name = fileName || 'Beitrag';

  if (mediaType === 'photo') {
    return (
      <div style={{ marginTop: 'var(--app-abstand-eng)' }}>
        <LazyImage
          quelle="challenges"
          filePath={filePath}
          fileName={name}
          vollbreite
          maxHoehe={maxHoehe}
          onClick={onOeffnen ? () => onOeffnen(filePath, name) : undefined}
        />
      </div>
    );
  }

  if (mediaType === 'video') {
    return (
      <div style={{ marginTop: 'var(--app-abstand-eng)' }}>
        <VideoPreview quelle="challenges" filePath={filePath} fileName={fileName} vollbreite />
      </div>
    );
  }

  if (mediaType === 'audio') {
    return <ChallengeAufnahme filePath={filePath} fileName={fileName} />;
  }

  return null;
};

export default ChallengeMedium;
