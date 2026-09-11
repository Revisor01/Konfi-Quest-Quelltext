import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_BILD, ICON_CHAT_AKTIV, ICON_LINK, ICON_MUSIK, ICON_VIDEO } from '../../shared/icons';
import SlideBase from './SlideBase';
import type { SlideProps } from '../../../types/wrapped';

interface VielseitigSlideProps extends SlideProps {
  medienarten: string[];
}

/** Nur IonIcons, keine Emojis (Repo-Regel). */
function iconFuer(art: string): string {
  switch (art) {
    case 'photo': return ICON_BILD;
    case 'video': return ICON_VIDEO;
    case 'audio': return ICON_MUSIK;
    case 'link': return ICON_LINK;
    default: return ICON_CHAT_AKTIV;
  }
}

const NAME: Record<string, string> = {
  text: 'Text',
  photo: 'Foto',
  video: 'Video',
  audio: 'Audio',
  link: 'Link',
};

/**
 * "Der Vielseitige" -- auf wie vielen Wegen jemand geantwortet hat.
 *
 * BEWUSST "mehrere Wege" STATT "alle drei": challenges.allowed_media steht
 * per Default auf ["text","photo"], Audio ist in vielen Challenges gar
 * nicht erlaubt. Eine Seite, die alle drei verlangt, traefe fast nie zu --
 * sie waere keine Seite, sondern eine Fussnote. Deshalb zaehlt hier, wie
 * viele VERSCHIEDENE Arten es waren, und die Namen stehen daneben.
 */
const VielseitigSlide: React.FC<VielseitigSlideProps> = ({ isActive, medienarten }) => (
  <SlideBase isActive={isActive} className="vielseitig-slide" kachel="vielseitig">
    <div className="kat-auge">Nicht auf einen Weg festgelegt</div>
    <div className="vielseitig-icons">
      {medienarten.map(art => (
        <span key={art} className="vielseitig-icons__kreis">
          <IonIcon icon={iconFuer(art)} />
        </span>
      ))}
    </div>
    <div className="kat-slogan">
      <span style={{ display: 'block' }}>Du hast auf</span>
      <span style={{ display: 'block' }}>{medienarten.length} Arten</span>
      <span style={{ display: 'block' }}>geantwortet.</span>
    </div>
    <div className="kat-nachsatz">
      {medienarten.map(a => NAME[a] || a).join(', ')}
    </div>
  </SlideBase>
);

export default VielseitigSlide;
