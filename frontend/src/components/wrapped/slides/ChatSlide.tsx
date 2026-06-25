import React from 'react';
import { IonIcon } from '@ionic/react';
import { chatbubblesOutline } from 'ionicons/icons';
import type { SlideProps, KonfiChatSlide } from '../../../types/wrapped';
import { useCountUp } from '../../../hooks/useCountUp';
import SlideBase from './SlideBase';

interface ChatSlideProps extends SlideProps {
  chat: KonfiChatSlide;
  seed?: number;
}

function getChatThreshold(count: number, seed: number): { text: string; glow: boolean } {
  if (count > 50) {
    return { text: 'Kommunikationsprofi!', glow: true };
  }
  if (count < 10) {
    const variants = ['Der schweigsame Typ', 'Die schweigsame Typin'];
    return { text: variants[seed % 2], glow: false };
  }
  return { text: 'Nachrichten gesendet', glow: false };
}

const ChatSlide: React.FC<ChatSlideProps> = ({ isActive, chat, seed = 0 }) => {
  const animatedCount = useCountUp(chat.nachrichten_gesendet, isActive);
  const threshold = getChatThreshold(chat.nachrichten_gesendet, seed);

  return (
    <SlideBase isActive={isActive} className="chat-slide">
      {/* Hintergrund-Dekoration */}
      <div style={{ position: 'absolute', top: '15%', right: '-20px', opacity: 0.06, pointerEvents: 'none' }}>
        <IonIcon icon={chatbubblesOutline} style={{ fontSize: '12rem' }} />
      </div>

      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IonIcon icon={chatbubblesOutline} style={{ fontSize: '1rem' }} />
          Im Chat
        </p>
      </div>
      <div className="wrapped-anim-number-pop wrapped-anim-delay-1">
        <p className="wrapped-big-number">{animatedCount}</p>
      </div>
      <div className="wrapped-anim-bounce wrapped-anim-delay-2">
        <p className="wrapped-subtitle" style={threshold.glow ? {
          fontSize: '1.3rem',
          fontWeight: 700,
          color: '#fbbf24',
          textShadow: '0 0 30px rgba(251,191,36,0.4)',
        } : undefined}>
          {threshold.text}
        </p>
      </div>
    </SlideBase>
  );
};

export default ChatSlide;
