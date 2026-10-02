import React from 'react';
import { ICON_CHALLENGE, ICON_FUNKELN, ICON_LINK, ICON_ZUSAGE } from '../../shared/icons';
import OnboardingTour, { OnboardingSlide } from '../../shared/OnboardingTour';

interface Props {
  onClose: () => void;
}

// Update-Walkthrough 2.1.1 für BESTANDS-Teamer:innen.
//
// Der wichtigste Punkt steht vorn: Zusagen und Absagen sind neu und ändern,
// wie Teamer:innen mit Terminen umgehen. Der Rückblick kommt danach, das
// Material zum Schluss.
//
// SLIDES exportiert für den Textbaustein-Test (onboardingSlides.test.ts).
export const SLIDES: OnboardingSlide[] = [
  {
    icon: ICON_CHALLENGE,
    color: 'var(--app-color-challenges)',
    rgb: '--app-color-challenges-rgb',
    title: 'Was Challenges sind',
    text: 'Challenges sind Aufgaben, die eure Konfis über einen Zeitraum begleiten — Fotos, Texte, Aufnahmen oder Links. Bewusst ohne Punkte, ohne Zähler, ohne Rangliste: es gibt nur einen Stempel fürs Mitmachen. Die Idee ist, dass sie sich mitten im Alltag eine Weile mit einem Thema beschäftigen. Ihr macht selbst mit — es gibt sogar Runden nur fürs Team.',
  },
  {
    icon: ICON_ZUSAGE,
    // Termin-Rot, nicht Aktivitaeten-Gruen: Die Folie
    // handelt vom Zusagen zu TERMINEN -- Gruen gehoert den Aktivitaeten.
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Zusagen und absagen',
    text: 'Bei einem Event sagst du jetzt ausdrücklich zu oder ab — „Bin dabei" oder „Bin nicht dabei". Du kannst deine Antwort jederzeit ändern, auch zurück zur Zusage. Ein Grund ist freiwillig; nur wenn du nach einer Zusage doch absagst, brauchen wir einen, damit die Leitung umplanen kann. Bei einer Absage wird dein Platz frei und die Warteliste rückt nach.',
  },
  {
    icon: ICON_FUNKELN,
    color: 'var(--app-color-wrapped)',
    rgb: '--app-color-wrapped-rgb',
    title: 'Dein Jahresrückblick',
    text: 'Auch du hast einen Rückblick — mit den Events, die du begleitet hast, deinen Badges und deinen Jahren im Team. Er liegt auf deiner Startseite und dauerhaft in deinem Profil. Jedes Jahr kommt ein neuer dazu, die alten bleiben stehen.',
  },
  {
    icon: ICON_LINK,
    color: 'var(--app-color-material)',
    rgb: '--app-color-material-rgb',
    title: 'Material mit Dateien und Links',
    text: 'Material trägt jetzt beides zusammen: eine Datei und dazu mehrere Links, zum Beispiel ein PDF und zwei Videos. Wer das Material sieht, entscheidet allein der Jahrgang — ohne Jahrgang sieht es das ganze Team der Gemeinde. Aus einem Event heraus kommst du direkt zum passenden Material.',
  },
];

const TeamerUpdate211WalkthroughModal: React.FC<Props> = ({ onClose }) => (
  <OnboardingTour slides={SLIDES} onClose={onClose} />
);

export default TeamerUpdate211WalkthroughModal;
