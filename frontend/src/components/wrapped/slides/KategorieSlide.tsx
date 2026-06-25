import React from 'react';
import { IonIcon } from '@ionic/react';
import { compassOutline } from 'ionicons/icons';
import type { SlideProps, KonfiKategorieSlide } from '../../../types/wrapped';
import SlideBase from './SlideBase';

interface KategorieSlideProps extends SlideProps {
  kategorie: KonfiKategorieSlide;
  titel?: string;
}

/** Erster Buchstabe gross */
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const KategorieSlide: React.FC<KategorieSlideProps> = ({ isActive, kategorie, titel }) => {
  const maxCount = kategorie.verteilung.length > 0
    ? Math.max(...kategorie.verteilung.map(k => k.count))
    : 1;

  // Maximal 5 Kategorien anzeigen
  const topKategorien = kategorie.verteilung.slice(0, 5);

  return (
    <SlideBase isActive={isActive} className="kategorie-slide">
      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IonIcon icon={compassOutline} style={{ fontSize: '1rem' }} />
          {titel || 'Dein Schwerpunkt'}
        </p>
      </div>
      {kategorie.top_kategorie ? (
        <>
          <div className="wrapped-anim-bounce wrapped-anim-delay-1">
            <p className="wrapped-hero-text">
              {capitalize(kategorie.top_kategorie)}
            </p>
          </div>
          <div className="wrapped-anim-fade wrapped-anim-delay-2" style={{ width: '100%' }}>
            <div className="kategorie-bars">
              {topKategorien.map((k, i) => (
                <div key={k.kategorie} className="kategorie-bar-row wrapped-anim-fly-left" style={{ animationDelay: `${0.4 + i * 0.15}s` }}>
                  <span className="kategorie-bar-name">{capitalize(k.kategorie)}</span>
                  <div className="kategorie-bar-track">
                    <div
                      className="kategorie-bar-fill"
                      style={{ width: isActive ? `${(k.count / maxCount) * 100}%` : '0%' }}
                    />
                  </div>
                  <span className="kategorie-bar-count">{k.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="wrapped-anim-fade wrapped-anim-delay-1">
          <p className="wrapped-subtitle">Noch keine Aktivitaeten</p>
        </div>
      )}
    </SlideBase>
  );
};

export default KategorieSlide;
