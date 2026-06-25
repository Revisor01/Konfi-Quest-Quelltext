import React from 'react';
import { IonIcon } from '@ionic/react';
import { podiumOutline } from 'ionicons/icons';
import SlideBase from './SlideBase';
import type { SlideProps } from '../../../types/wrapped';

interface RankSlideProps extends SlideProps {
  rank: number;
  totalInJahrgang: number;
  displayName: string;
}

// Konfetti fuer Platz 1
const KONFETTI_FARBEN = ['#fbbf24', '#f59e0b', '#fcd34d', '#a78bfa', '#ffffff', '#f97316'];

function getRankText(rank: number, total: number): { text: string; color: string; glow: boolean } {
  if (rank === 1) return { text: 'Du bist die Nummer 1!', color: '#fbbf24', glow: true };
  if (rank <= 3) return { text: 'Auf dem Treppchen!', color: '#fbbf24', glow: true };
  if (total > 0 && rank <= total / 2) return { text: 'Obere Haelfte!', color: '#a78bfa', glow: false };
  return { text: 'Jeder Punkt zaehlt!', color: 'rgba(255,255,255,0.7)', glow: false };
}

const RankSlide: React.FC<RankSlideProps> = ({ isActive, rank, totalInJahrgang, displayName }) => {
  const rankInfo = getRankText(rank, totalInJahrgang);
  const showKonfetti = rank === 1;

  return (
    <SlideBase isActive={isActive} className="rank-slide">
      {showKonfetti && (
        <div className="konfetti-container">
          {Array.from({ length: 20 }, (_, i) => (
            <div
              key={i}
              className="konfetti-piece"
              style={{ background: KONFETTI_FARBEN[i % KONFETTI_FARBEN.length] }}
            />
          ))}
        </div>
      )}

      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IonIcon icon={podiumOutline} style={{ fontSize: '1rem' }} />
          Dein Jahrgangs-Ranking
        </p>
      </div>
      <div className="wrapped-anim-bounce wrapped-anim-delay-1">
        <p className="wrapped-hero-text" style={rank <= 3 ? {
          color: '#fbbf24',
          textShadow: '0 0 40px rgba(251,191,36,0.4)',
        } : undefined}>
          Platz<br />{rank}
        </p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-2">
        <p className="wrapped-subtitle">
          von {totalInJahrgang} in deinem Jahrgang
        </p>
      </div>
      <div className="wrapped-anim-bounce wrapped-anim-delay-3">
        <p style={{
          color: rankInfo.color,
          fontSize: '1.2rem',
          fontWeight: 700,
          marginTop: '20px',
          textShadow: rankInfo.glow ? `0 0 30px ${rankInfo.color}40` : 'none',
        }}>
          {rankInfo.text}
        </p>
      </div>
    </SlideBase>
  );
};

export default RankSlide;
