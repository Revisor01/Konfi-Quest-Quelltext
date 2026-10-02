import React from 'react';
import {
  ICON_GLOCKE,
  ICON_BENACHRICHTIGUNG,
  ICON_MOND,
  ICON_TERMIN_GEFUELLT,
  ICON_GEMEINDE_GEFUELLT,
} from '../../shared/icons';
import OnboardingTour, { OnboardingSlide } from '../../shared/OnboardingTour';

interface Props {
  onClose: () => void;
}

// Aenderungsanzeige 2.3.0 fuer TEAMER:INNEN.
//
// FARBEN NACH KATEGORIE: Jede Folie traegt die Farbe des
// Bereichs, auf den sie einzahlt. Siehe KonfiUpdate230WalkthroughModal fuer
// die Begruendung, warum Postfach, Push-Auswahl und Dunkelmodus die
// Systemfarbe --app-color-users tragen.
//
// Die Gemeinde-Folie traegt --app-color-organizations (wertgleich mit users,
// aber semantisch die Gemeinden) -- sie steht nur hier und bei der Leitung,
// weil Konfis immer nur einer Gemeinde angehoeren.
//
// KURZ HALTEN: hoechstens sechs Folien, keine ueber 300 Zeichen.
//
// SLIDES exportiert fuer den Textbaustein-Test (onboardingSlides.test.ts).
export const SLIDES: OnboardingSlide[] = [
  {
    icon: ICON_GLOCKE,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Das Postfach',
    text: 'Oben rechts steht jetzt eine Glocke. Sie sammelt alles an einem Ort: Anträge und Entscheidungen, Ab- und Anmeldungen, Events, Challenge-Beiträge, Badges. Auch verpasste Mitteilungen stehen dort. Antippen führt an die passende Stelle.',
  },
  {
    icon: ICON_BENACHRICHTIGUNG,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Du wählst, was aufs Handy kommt',
    text: 'Unter „Mehr" stellst du ein, welche Mitteilungen dein Handy erreichen: Nachrichten, Events, Punkte und Badges sowie Anfragen und Freigaben. Abgeschaltet wird nur der Weg aufs Handy — im Postfach steht trotzdem alles.',
  },
  {
    icon: ICON_MOND,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Dunkelmodus',
    text: 'Steht das Handy auf Dunkel, wird auch die App dunkel. Umgestellt wird das in den Systemeinstellungen, nicht in der App.',
  },
  {
    icon: ICON_TERMIN_GEFUELLT,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Direkt zum Event',
    text: 'Eine Event-Mitteilung führt dich jetzt zum Event selbst statt nur zur Liste. Auch ein zweiter Link auf ein anderes Event öffnet das zweite. Mehrtägige Events zeigen in den Details beide Tage.',
  },
  {
    icon: ICON_GEMEINDE_GEFUELLT,
    color: 'var(--app-color-organizations)',
    rgb: '--app-color-organizations-rgb',
    title: 'Mehrere Gemeinden im Blick',
    text: 'Wer mehrere Gemeinden betreut, hat den Umschalter oben links jetzt auf jeder Seite. Eine rote Zahl an einer Gemeinde zeigt, dass dort etwas offen ist — ohne dass du erst hineinwechseln musst.',
  },
];

const TeamerUpdate230WalkthroughModal: React.FC<Props> = ({ onClose }) => (
  <OnboardingTour slides={SLIDES} onClose={onClose} />
);

export default TeamerUpdate230WalkthroughModal;
