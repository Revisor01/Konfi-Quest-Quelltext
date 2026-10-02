import React from 'react';
import {
  ICON_GLOCKE,
  ICON_BENACHRICHTIGUNG,
  ICON_MOND,
  ICON_TERMIN_GEFUELLT,
  ICON_CHALLENGE_GEFUELLT,
} from '../../shared/icons';
import OnboardingTour, { OnboardingSlide } from '../../shared/OnboardingTour';

interface Props {
  onClose: () => void;
}

// Aenderungsanzeige 2.3.0 fuer KONFIS.
//
// FARBEN NACH KATEGORIE: Jede Folie traegt die Farbe des
// Bereichs, auf den sie einzahlt -- Termine rot, Challenges indigo, Abzeichen
// bernstein, Chat cyan. Das loest die Dreifarben-Regel der 2.2.0-Anzeige ab
// (dort trugen alle Systemthemen dasselbe Blau).
//
// Das Postfach hat kein eigenes Token: Es faerbt sich sonst nach dem Inhalt
// der jeweiligen Mitteilung, und postfachBereich() faellt auf 'info' zurueck.
// Weil die Glocke hier alle Bereiche zusammenfasst, traegt sie
// --app-color-users -- dieselbe Systemfarbe, die auch die Push-Auswahl und
// der Dunkelmodus tragen, die ebenfalls die ganze App betreffen.
//
// KURZ HALTEN: "Die Leute sind faul zu lesen." Keine Folie ueber 300 Zeichen,
// hoechstens sechs Folien -- der Test haelt beides fest.
//
// SLIDES exportiert fuer den Textbaustein-Test (onboardingSlides.test.ts).
export const SLIDES: OnboardingSlide[] = [
  {
    icon: ICON_GLOCKE,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Dein Postfach',
    text: 'Oben rechts steht jetzt eine Glocke. Dort sammelt sich alles, was die App dir sagen will: Punkte, Badges, Anträge, Events, Stempel. Auch was du als Mitteilung verpasst hast, steht dort. Antippen führt an die passende Stelle.',
  },
  {
    icon: ICON_BENACHRICHTIGUNG,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Du wählst, was aufs Handy kommt',
    text: 'Im Profil stellst du ein, welche Mitteilungen dein Handy erreichen: Nachrichten, Events, Punkte und Badges, einzeln ab- und anschaltbar. Abgeschaltet wird nur der Weg aufs Handy — im Postfach steht trotzdem alles.',
  },
  {
    icon: ICON_MOND,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Dunkelmodus',
    text: 'Steht dein Handy auf Dunkel, wird auch die App dunkel. Umgestellt wird das in den Einstellungen deines Handys, nicht in der App.',
  },
  {
    icon: ICON_CHALLENGE_GEFUELLT,
    color: 'var(--app-color-challenges)',
    rgb: '--app-color-challenges-rgb',
    title: 'Neues bei den Challenges',
    text: 'Wie im Chat siehst du jetzt an einer roten Zahl, wo es etwas Neues gibt: eine neue Challenge, neue Beiträge in der Galerie oder die Entscheidung über deinen Beitrag. Öffnen setzt die Zahl zurück.',
  },
  {
    icon: ICON_TERMIN_GEFUELLT,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Mitteilungen führen zum Ziel',
    text: 'Tippst du eine Mitteilung an, landest du dort, wo sie hingehört: Punkte in der Punkte-Übersicht, ein Stempel bei den Challenges, ein Event beim Event selbst. Mehrtägige Events zeigen jetzt beide Tage.',
  },
];

const KonfiUpdate230WalkthroughModal: React.FC<Props> = ({ onClose }) => (
  <OnboardingTour slides={SLIDES} onClose={onClose} />
);

export default KonfiUpdate230WalkthroughModal;
