import React, { useState, useEffect, useRef } from 'react';
import { IonIcon } from '@ionic/react';
import {
  ICON_BILD,
  ICON_CHAT_AKTIV,
  ICON_LINK,
  ICON_MUSIK,
  ICON_VIDEO,
} from '../../shared/icons';
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
    case 'photo': return ICON_BILD;
    case 'video': return ICON_VIDEO;
    case 'audio': return ICON_MUSIK;
    case 'link': return ICON_LINK;
    default: return ICON_CHAT_AKTIV;
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
        <IonIcon icon={ICON_BILD} />
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

/**
 * Feste Werte je Position auf der Pinnwand.
 *
 * Deshalb liegen die Momente jetzt uebereinander statt untereinander --
 * leicht gedreht, versetzt, mit Klebestreifen. Wie Fotos, die jemand an eine
 * Wand gepinnt hat.
 *
 * WARUM FESTE WERTE STATT ZUFALL: Der Rueckblick wird geteilt und mehrfach
 * geoeffnet. Wuerden Drehung und Versatz bei jedem Oeffnen neu gewuerfelt,
 * saehe dieselbe Erinnerung jedes Mal anders aus. Die Werte haengen deshalb
 * an der Position, nicht am Zufall -- unregelmaessig genug, dass es
 * handgemacht wirkt, und trotzdem immer gleich.
 */
const PINNWAND = [
  { dreh: -6.5, x: -4, y: 0, z: 6 },
  { dreh: 5.5, x: 8, y: -6, z: 5 },
  { dreh: -3, x: -10, y: -4, z: 4 },
  { dreh: 7, x: 4, y: -8, z: 3 },
  { dreh: -8, x: 10, y: -3, z: 2 },
  { dreh: 3.5, x: -6, y: -7, z: 1 },
];

const ChallengeMomenteSlide: React.FC<ChallengeMomenteSlideProps> = ({ isActive, momente }) => {
  const sichtbar = momente.slice(0, MAX_MOMENTE);

  return (
    <SlideBase isActive={isActive} className="challenge-momente-slide" kachel="challenge-momente">
      <div className="kat-auge">Deine Momente</div>

      <div className="kat-slogan" style={{ marginBottom: 'var(--app-abstand-schmal)'}}>
        <span style={{ display: 'block' }}>Das hast du</span>
        <span style={{ display: 'block' }}>hinterlassen.</span>
      </div>

      <div className="momente-pinnwand">
        {sichtbar.map((moment, i) => {
          const p = PINNWAND[i % PINNWAND.length];
          return (
            <div
              key={`${moment.challenge_title}-${moment.created_at}-${i}`}
              className={`moment-polaroid moment-polaroid--${moment.media_type}`}
              style={{
                // Die Drehung steht als eigene Variable, damit die
                // Schwebe-Animation sie nicht ueberschreibt (sie rechnet
                // mit var(--dreh) weiter).
                '--dreh': `${p.dreh}deg`,
                '--versatz-x': `${p.x}px`,
                '--versatz-y': `${p.y}px`,
                zIndex: p.z,
                animationDelay: `${i * 0.9}s`,
                // Die Karten kommen nacheinander an die Wand.
                '--auftritt': `${0.35 + i * 0.13}s`,
              } as React.CSSProperties}
            >
              {/* Klebestreifen oben -- macht aus dem Kaertchen ein Foto
                  an einer Wand. */}
              <span className="moment-klebeband" aria-hidden="true" />

              {moment.media_type === 'photo' && moment.file_path ? (
                <div className="moment-polaroid__bild">
                  <ChallengeFoto filePath={moment.file_path} fileName={moment.file_name ?? undefined} />
                </div>
              ) : (
                <div className="moment-polaroid__inhalt">
                  <IonIcon
                    className="moment-polaroid__medienicon"
                    icon={iconFuerMedienart(moment.media_type)}
                  />
                  {moment.media_type === 'link' && moment.link_url && (
                    <span className="moment-polaroid__link">{linkBeschriftung(moment)}</span>
                  )}
                  {moment.text_content && (
                    <p className="moment-polaroid__text">{kuerzen(moment.text_content)}</p>
                  )}
                </div>
              )}

              {/* Die Bildunterschrift wie bei einem Polaroid. */}
              <div className="moment-polaroid__fuss">
                <span className="moment-polaroid__abzeichen">
                  <IonIcon icon={getIconFromString(moment.badge_icon)} />
                </span>
                <span className="moment-polaroid__titel">{moment.challenge_title}</span>
              </div>
            </div>
          );
        })}
      </div>

      {momente.length > MAX_MOMENTE && (
        <div className="kat-fussnote">und {momente.length - MAX_MOMENTE} weitere</div>
      )}
    </SlideBase>
  );
};

export default ChallengeMomenteSlide;
