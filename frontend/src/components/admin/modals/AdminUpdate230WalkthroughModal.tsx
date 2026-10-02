import React from 'react';
import {
  ICON_GLOCKE,
  ICON_BENACHRICHTIGUNG,
  ICON_MOND,
  ICON_TERMIN_GEFUELLT,
  ICON_GEMEINDE_GEFUELLT,
  ICON_TACHO,
} from '../../shared/icons';
import OnboardingTour, { OnboardingSlide } from '../../shared/OnboardingTour';

interface Props {
  onClose: () => void;
}

// Aenderungsanzeige 2.3.0 fuer die LEITUNG.
//
// FARBEN NACH KATEGORIE: Jede Folie traegt die Farbe des
// Bereichs, auf den sie einzahlt. Siehe KonfiUpdate230WalkthroughModal fuer
// die Begruendung, warum Postfach, Push-Auswahl und Dunkelmodus die
// Systemfarbe --app-color-users tragen.
//
// Die Betriebs-Uebersicht steht nur hier -- sie ist der Leitung vorbehalten.
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
    text: 'Oben rechts steht jetzt eine Glocke. Sie sammelt alles an einem Ort: neue Anträge und Registrierungen, Ab- und Anmeldungen, Beiträge zur Freigabe, Events, die auf Verbuchung warten. Antippen führt an die passende Stelle.',
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
    icon: ICON_GEMEINDE_GEFUELLT,
    color: 'var(--app-color-organizations)',
    rgb: '--app-color-organizations-rgb',
    title: 'Mehrere Gemeinden im Blick',
    text: 'Der Gemeinde-Umschalter oben links steht jetzt auf jeder Seite. Eine rote Zahl zeigt je Gemeinde, wo etwas offen ist. Und die Mitteilungen kommen aus allen Gemeinden, in denen du Leitung bist — nicht mehr nur aus deiner Stamm-Gemeinde.',
  },
  {
    icon: ICON_TERMIN_GEFUELLT,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Klarheit bei Events',
    text: 'Eine Event-Mitteilung führt zum Event selbst. Beim Eintragen von Hand stehen nur noch Personen zur Wahl, die zu einem Jahrgang des Events gehören — ein Hinweis nennt die Jahrgänge. Mehrtägige Events zeigen beide Tage.',
  },
  {
    icon: ICON_TACHO,
    color: 'var(--app-color-organizations)',
    rgb: '--app-color-organizations-rgb',
    title: 'Der Betriebs-Überblick',
    text: 'Aus der Auslastungsanzeige ist ein Überblick geworden: oben in einem Satz, ob alles läuft, darunter Antwortzeiten je Seite, ein Vergleich mit den Vortagen und die Fehler zusammengefasst statt als Rohliste.',
  },
];

const AdminUpdate230WalkthroughModal: React.FC<Props> = ({ onClose }) => (
  <OnboardingTour slides={SLIDES} onClose={onClose} />
);

export default AdminUpdate230WalkthroughModal;
