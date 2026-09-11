import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_CHALLENGE, ICON_CHATS, ICON_HERZ, ICON_SCHUTZ } from '../../shared/icons';
import type { SlideProps, KonfiWrappedData } from '../../../types/wrapped';
import { useCountUp } from '../../../hooks/useCountUp';
import SlideBase from './SlideBase';

interface HighlightSlideProps extends SlideProps {
  data: KonfiWrappedData;
}

/**
 * Die persoenliche Highlight-Seite -- ab Snapshot-Version 3.
 *
 * Rendert die NEUEN Highlight-Typen (chat_star, reaktions_magnet,
 * challenge_fan, verlaesslich). Die klassischen Typen (events_held,
 * badge_collector, ...) haben weiterhin ihre eigenen Slides und laufen
 * nicht ueber diese Komponente -- siehe rendertHighlightSlide unten.
 *
 * Texte variieren per formulierung_seed, damit zwei Konfis mit demselben
 * Highlight nicht denselben Satz lesen. Der Jahrgangsvergleich erscheint
 * NUR, wenn der eigene Wert ueber dem Schnitt liegt (freundliche,
 * anonyme Vergleiche -- nie Namen, nie "weniger als andere").
 */

// Formulierungs-Varianten je Highlight-Typ (Label / Hero / Subtitle).
const VARIANTEN: Record<string, Array<{ label: string; hero: string; sub: string }>> = {
  chat_star: [
    { label: 'Dein Ding: der Chat', hero: 'Chat-Star', sub: 'Nachrichten hast du geschrieben' },
    { label: 'Immer was zu sagen', hero: 'Mitten im Gespräch', sub: 'Nachrichten von dir' },
    { label: 'Im Chat gut zu hören', hero: 'Wortmeldung!', sub: 'Mal hast du dich zu Wort gemeldet' },
  ],
  reaktions_magnet: [
    { label: 'Deine Nachrichten kamen an', hero: 'Reaktions-Magnet', sub: 'Reaktionen hast du bekommen' },
    { label: 'Das kam gut an', hero: 'Daumen hoch!', sub: 'Mal haben andere auf dich reagiert' },
    { label: 'Gehört werden', hero: 'Voll getroffen', sub: 'Reaktionen auf deine Nachrichten' },
  ],
  challenge_fan: [
    { label: 'Dein Ding: Challenges', hero: 'Challenge-Fan', sub: 'Beiträge hast du eingereicht' },
    { label: 'Du bist ins Risiko gegangen', hero: 'Mutig dabei!', sub: 'Challenge-Beiträge von dir' },
    { label: 'Aufgaben liegen dir', hero: 'Angepackt!', sub: 'Mal hast du bei Challenges mitgemacht' },
  ],
  verlaesslich: [
    { label: 'Zugesagt und gekommen', hero: 'Fels in der Brandung', sub: 'Anmeldungen — und keine einzige Absage' },
    { label: 'Zugesagt ist zugesagt', hero: 'Verlässlich!', sub: 'Termine gebucht, alle gehalten' },
    { label: 'Man konnte auf dich zählen', hero: 'Immer da', sub: 'Anmeldungen ohne eine Absage' },
  ],
};

const ICONS: Record<string, string> = {
  chat_star: ICON_CHATS,
  reaktions_magnet: ICON_HERZ,
  challenge_fan: ICON_CHALLENGE,
  verlaesslich: ICON_SCHUTZ,
};

/** Sagt dem Modal, ob dieser Snapshot eine eigene Highlight-Seite bekommt. */
export function rendertHighlightSlide(data: KonfiWrappedData): boolean {
  const h = data.slides.highlight;
  return !!h && h.type in VARIANTEN;
}

const HighlightSlide: React.FC<HighlightSlideProps> = ({ isActive, data }) => {
  const highlight = data.slides.highlight;
  const seed = data.formulierung_seed || 0;
  const animatedWert = useCountUp(highlight?.wert || 0, isActive);

  if (!highlight || !(highlight.type in VARIANTEN)) return null;

  const varianten = VARIANTEN[highlight.type];
  const v = varianten[seed % varianten.length];

  // Anonymer, freundlicher Vergleich: nur oberhalb des Schnitts, nie Namen.
  const zeigeVergleich =
    highlight.jahrgangsschnitt !== null &&
    highlight.jahrgangsschnitt !== undefined &&
    highlight.wert > highlight.jahrgangsschnitt;

  const topChallenge = highlight.type === 'challenge_fan'
    ? data.slides.challenges?.top_challenge
    : null;

  return (
    <SlideBase isActive={isActive} className="highlight-slide">
      {/* Stilisierter Hintergrund: Deko-Kreise plus das Highlight-Symbol
          gross und transparent -- typo-driven, kein Fliesstext, keine
          Emojis (Repo-Regel: nur IonIcons und CSS-Formen). */}
      <div className="wrapped-slide-decoration wrapped-slide-decoration--1" />
      <div className="wrapped-slide-decoration wrapped-slide-decoration--2" />
      <IonIcon icon={ICONS[highlight.type]} className="highlight-bg-icon" aria-hidden="true" />
      <div className="wrapped-anim-fly-left" style={{ opacity: 0 }}>
        <p className="wrapped-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-kompakt)', justifyContent: 'center' }}>
          <IonIcon icon={ICONS[highlight.type]} style={{ fontSize: 'var(--app-text-standard)' }} />
          {v.label}
        </p>
      </div>
      <div className="wrapped-anim-scale wrapped-anim-delay-1" style={{ opacity: 0 }}>
        <p className="wrapped-hero-text">{v.hero}</p>
      </div>
      <div className="wrapped-anim-bounce wrapped-anim-delay-2" style={{ opacity: 0 }}>
        <p className="highlight-zahl">{animatedWert}</p>
      </div>
      <div className="wrapped-anim-fade wrapped-anim-delay-2" style={{ opacity: 0 }}>
        <p className="wrapped-subtitle">{v.sub}</p>
      </div>
      {topChallenge && (
        <div className="wrapped-anim-fade wrapped-anim-delay-3" style={{ opacity: 0 }}>
          <p className="highlight-detail">
            Am meisten bei „{topChallenge.title}“ ({topChallenge.count}×)
          </p>
        </div>
      )}
      {zeigeVergleich && (
        <div className="wrapped-anim-fade wrapped-anim-delay-3" style={{ opacity: 0 }}>
          <p className="highlight-vergleich">
            Mehr als der Durchschnitt deines Jahrgangs ({highlight.jahrgangsschnitt})
          </p>
        </div>
      )}
    </SlideBase>
  );
};

export default HighlightSlide;
