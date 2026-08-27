import React, { useState, useEffect, useRef } from 'react';
import { IonIcon } from '@ionic/react';
import {
  flagOutline,
  imageOutline,
  linkOutline,
  musicalNotesOutline,
  videocamOutline,
  chatbubbleEllipsesOutline,
} from 'ionicons/icons';
import SlideBase from './SlideBase';
import api from '../../../services/api';
import { getIconFromString } from '../../../utils/badgeIcons';
import { linkBeschriftung } from '../../../utils/linkDisplay';
import type { SlideProps, KonfiChallengeMoment } from '../../../types/wrapped';

interface ChallengeMomenteSlideProps extends SlideProps {
  momente: KonfiChallengeMoment[];
}

// Maximal so viele Momente zeigen — der Rest bleibt bewusst ungezaehlt.
const MAX_MOMENTE = 6;

/** Icon passend zur Medienart (nur IonIcons, keine Emojis). */
function iconFuerMedienart(mediaType: string): string {
  switch (mediaType) {
    case 'photo': return imageOutline;
    case 'video': return videocamOutline;
    case 'audio': return musicalNotesOutline;
    case 'link': return linkOutline;
    default: return chatbubbleEllipsesOutline;
  }
}

/**
 * Laedt ein Challenge-Foto über GET /api/challenges/files/:filename.
 * Der Auth-Header kommt automatisch aus dem api-Interceptor (services/api.ts),
 * daher ist KEIN ?token=-Parameter nötig. Die erzeugte Object-URL wird beim
 * Unmount wieder freigegeben (kein geteilter Cache wie bei den Chat-Medien —
 * Wrapped-Bilder werden genau einmal angezeigt).
 */
const ChallengeFoto: React.FC<{ filePath: string; fileName?: string }> = ({ filePath, fileName }) => {
  const [src, setSrc] = useState<string>('');
  const [fehler, setFehler] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;

    const laden = async () => {
      try {
        const res = await api.get(`/challenges/files/${filePath}`, { responseType: 'blob' });
        if (abgebrochen) return;
        const url = URL.createObjectURL(res.data as Blob);
        urlRef.current = url;
        setSrc(url);
      } catch {
        if (!abgebrochen) setFehler(true);
      }
    };
    laden();

    return () => {
      abgebrochen = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [filePath]);

  if (fehler) {
    return (
      <div className="challenge-moment-foto challenge-moment-foto--leer">
        <IonIcon icon={imageOutline} />
      </div>
    );
  }

  if (!src) {
    return <div className="challenge-moment-foto challenge-moment-foto--laedt" />;
  }

  return (
    <div className="challenge-moment-foto">
      <img src={src} alt={fileName || 'Dein Beitrag'} />
    </div>
  );
};

/** Text auf eine handliche Laenge bringen (Backend kuerzt bereits auf 200). */
function kuerzen(text: string, max = 140): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

const ChallengeMomenteSlide: React.FC<ChallengeMomenteSlideProps> = ({ isActive, momente }) => {
  const sichtbar = momente.slice(0, MAX_MOMENTE);

  return (
    <SlideBase isActive={isActive} className="challenge-momente-slide">
      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IonIcon icon={flagOutline} style={{ fontSize: '1rem' }} />
          Deine Challenges
        </p>
      </div>
      <div className="wrapped-anim-bounce wrapped-anim-delay-1">
        <p className="wrapped-hero-text">Deine Momente</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-1">
        <p className="wrapped-subtitle">Das hast du beigetragen</p>
      </div>

      <div className="challenge-momente-liste wrapped-anim-fade wrapped-anim-delay-2">
        {sichtbar.map((moment, i) => (
          <div
            key={`${moment.challenge_title}-${moment.created_at}-${i}`}
            className={`challenge-moment challenge-moment--${moment.media_type} wrapped-anim-fly-left`}
            style={{ animationDelay: `${0.5 + i * 0.14}s` }}
          >
            <div className="challenge-moment-kopf">
              <span className="challenge-moment-abzeichen">
                <IonIcon icon={getIconFromString(moment.badge_icon)} />
              </span>
              <span className="challenge-moment-titel">{moment.challenge_title}</span>
              <IonIcon
                className="challenge-moment-medienart"
                icon={iconFuerMedienart(moment.media_type)}
              />
            </div>

            {moment.media_type === 'photo' && moment.file_path && (
              <ChallengeFoto filePath={moment.file_path} fileName={moment.file_name ?? undefined} />
            )}

            {moment.media_type === 'link' && moment.link_url && (
              <div className="challenge-moment-link">
                <IonIcon icon={linkOutline} />
                <span>{linkBeschriftung(moment)}</span>
              </div>
            )}

            {moment.text_content && (
              <p className="challenge-moment-text">{kuerzen(moment.text_content)}</p>
            )}
          </div>
        ))}
      </div>
    </SlideBase>
  );
};

export default ChallengeMomenteSlide;
