import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_FUNKELN } from '../../shared/icons';
import SlideBase from './SlideBase';
import { konfiUeberschrift } from '../ueberschrift';
import type { SlideProps } from '../../../types/wrapped';

interface IntroSlideProps extends SlideProps {
  displayName: string;
  jahrgangName: string;
  year: number;
  konfirmation?: string | null;
  stand?: string | null;
  /**
   * Name der Ausgabe: "Sonst wird es bei drei
   * Rueckblicken unuebersichtlich." Steht klein unter dem Namen der Person.
   * Der Platzhalter aus dem Backend ("Konfi-Rueckblick 2026/27") wird NICHT
   * gezeigt -- er ist ein Datenbankwert, keine Beschriftung.
   */
  ausgabeTitel?: string | null;
}

const IntroSlide: React.FC<IntroSlideProps> = ({ isActive, displayName, jahrgangName, year: _year, konfirmation, stand, ausgabeTitel }) => {
  const ueberschrift = konfiUeberschrift(konfirmation, stand);

  // Platzhalter aus dem Backend aussortieren: Wer keinen Namen vergeben hat,
  // soll nicht "Konfi-Rueckblick 2026/27" auf seiner Folie lesen.
  const zeigeTitel = ausgabeTitel && !/^Konfi-R(ü|ue)ckblick\s/.test(ausgabeTitel)
    ? ausgabeTitel.trim() : null;

  return (
    <SlideBase isActive={isActive} className="intro-slide">
      <div className="wrapped-slide-decoration wrapped-slide-decoration--1" />
      <div className="wrapped-slide-decoration wrapped-slide-decoration--2" />
      <div className="wrapped-slide-decoration wrapped-slide-decoration--3" />

      <div className="wrapped-anim-fly-left">
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-kompakt)' }}>
          <IonIcon icon={ICON_FUNKELN} style={{ fontSize: 'var(--app-text-standard)' }} />
          Willkommen zu deinem
        </p>
      </div>
      <div className="wrapped-anim-fly-left wrapped-anim-delay-1">
        <h1 className="wrapped-hero-text">
          {ueberschrift.map((zeile, i) => (
            <React.Fragment key={i}>
              {zeile}{i < ueberschrift.length - 1 && <br />}
            </React.Fragment>
          ))}
        </h1>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-2">
        <p className="wrapped-subtitle" style={{ marginTop: 'var(--app-abstand-basis)' }}>{displayName}</p>
        {zeigeTitel && (
          <p className="wrapped-label" style={{ marginTop: 'var(--app-abstand-mini)', opacity: 0.75 }}>{zeigeTitel}</p>
        )}
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-3">
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--app-text-basis)', marginTop: 'var(--app-abstand-mini)' }}>{jahrgangName}</p>
      </div>
    </SlideBase>
  );
};

export default IntroSlide;
