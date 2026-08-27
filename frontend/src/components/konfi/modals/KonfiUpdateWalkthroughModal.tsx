import React from 'react';
import { flagOutline, swapHorizontalOutline, sparklesOutline } from 'ionicons/icons';
import OnboardingTour, { OnboardingSlide } from '../../shared/OnboardingTour';

interface KonfiUpdateWalkthroughModalProps {
  onClose: () => void;
  displayName?: string;
}

// Update-Walkthrough 2.0 für BESTANDS-Konfis: erklärt einmalig, was sich mit
// dem Update geändert hat. Gleicher Stil/Technik wie die normale Tour
// (OnboardingTour = Vollbild-Overlay, KEIN Modal).
// Reihenfolge bewusst: erst das Neue (Challenges), dann der wichtigste
// Umlern-Punkt (der Mitmachen-Tab bündelt Events und Aktivitäten, die früher
// "Anträge" hießen), zum Schluss kurz das Wrapped.
// SLIDES exportiert für den Textbaustein-Test (onboardingSlides.test.ts).
export const SLIDES: OnboardingSlide[] = [
  {
    icon: flagOutline,
    color: 'var(--app-color-challenges)',
    rgb: '--app-color-challenges-rgb',
    title: 'Neu: Challenges',
    text: 'In der Mitte deiner Tab-Leiste gibt es jetzt die Challenges: eine Aufgabe und eine Zeit lang Ruhe, dich damit zu beschäftigen. Du antwortest darauf mit einem Foto, einem Text, einer Aufnahme oder einem Link — so, wie du es willst.',
  },
  {
    icon: flagOutline,
    color: 'var(--app-color-challenges)',
    rgb: '--app-color-challenges-rgb',
    title: 'Du entscheidest',
    text: 'Bei jedem Beitrag wählst du selbst, ob er mit deinem Namen, anonym oder nur für die Leitung sichtbar ist. Fürs Mitmachen gibt es einen Stempel — und mit Absicht keine Punkte und keine Rangliste. Hier geht es nicht ums Sammeln, sondern um dich und deinen Glauben. Deine Teamer:innen machen übrigens mit.',
  },
  {
    icon: swapHorizontalOutline,
    color: 'var(--app-color-activities)',
    rgb: '--app-color-activities-rgb',
    title: 'Neu: der Mitmachen-Tab',
    text: 'Events und deine bisherigen "Anträge" wohnen jetzt zusammen im Tab "Mitmachen" — mit zwei Reitern oben. Bei Events meldest du dich wie gewohnt vorher an. Aus den Anträgen sind die Aktivitäten geworden: Da meldest du hinterher, dass du dabei warst, und dein Team bestätigt. Einen eigenen Antrags-Tab gibt es nicht mehr.',
  },
  {
    icon: sparklesOutline,
    color: 'var(--app-color-konfis)',
    rgb: '--app-color-konfis-rgb',
    title: 'Dein Jahresrückblick',
    text: 'Dein Rückblick erzählt jetzt deinen Weg statt Platzierungen: deine Challenge-Momente, deine Events und wie weit du gekommen bist. Kein Vergleich mit anderen — nur dein Jahr.',
  },
];

const KonfiUpdateWalkthroughModal: React.FC<KonfiUpdateWalkthroughModalProps> = ({ onClose, displayName }) => (
  <OnboardingTour slides={SLIDES} onClose={onClose} displayName={displayName} />
);

export default KonfiUpdateWalkthroughModal;
