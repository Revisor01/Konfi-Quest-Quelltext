import React from 'react';
import {
  ICON_ABZEICHEN,
  ICON_FINGERABDRUCK,
  ICON_TACHO,
  ICON_TERMIN_GEFUELLT,
  ICON_OFFLINE,
} from '../../shared/icons';
import OnboardingTour, { OnboardingSlide } from '../../shared/OnboardingTour';

interface Props {
  onClose: () => void;
}

// Aenderungsanzeige 2.2.0 fuer KONFIS.
//
// ALLES SEIT 2.0: Auf dem einen System ist 2.1 nie
// erschienen, dort steht noch 2.0. Deshalb decken alle drei Fassungen 2.0
// bis 2.2 ab -- die 2.1-Punkte stehen mit drin.
//
// FARBEN: Rot (--app-color-events) fuer Termine und
// Anwesenheit, Indigo (--app-color-challenges) fuer Challenges, und als
// SYSTEMFARBE das helle Blau --app-color-users (#667eea) -- dasselbe, das
// der Profilkopf der Leitung traegt. Es steht fuer App-Sperre, Offline,
// Tempo und Rechte. Nicht --app-color-jahrgang (#007aff): Das ist kraeftiger
// und meint die Jahrgaenge, nicht die Systemfunktionen. Beere, Orange und
// Violett kommen in der Aenderungsanzeige nicht mehr vor.
//
// KURZ HALTEN: "Die Leute sind faul zu lesen." Keine Folie ueber 300 Zeichen,
// hoechstens fuenf Folien -- der Test haelt beides fest.
//
// SLIDES exportiert fuer den Textbaustein-Test (onboardingSlides.test.ts).
export const SLIDES: OnboardingSlide[] = [
  {
    icon: ICON_TERMIN_GEFUELLT,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Klarheit bei Events',
    text: 'Fällt ein Event aus, steht jetzt dabei, warum. Findet es doch statt, bekommst du Bescheid und stehst wieder da, wo du vorher standst. Abgesagte Events stehen an ihrem Datum, durchgestrichen.',
  },
  {
    icon: ICON_ABZEICHEN,
    color: 'var(--app-color-challenges)',
    rgb: '--app-color-challenges-rgb',
    title: 'Deine Stempel',
    text: 'Unter Challenges stehen jetzt deine Stempel. Tippst du einen an, siehst du, wofür es ihn gab. Was du noch holen kannst, steht grau daneben.',
  },
  {
    icon: ICON_FINGERABDRUCK,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Die App abschließen',
    text: 'Du kannst die App mit Face ID, Touch ID oder deinem Fingerabdruck sperren. Im Profil stellst du ein, nach welcher Zeit gefragt wird. Angemeldet bleibst du dabei, und von Haus aus ist die Sperre aus.',
  },
  {
    icon: ICON_OFFLINE,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Ohne Netz geht nichts verloren',
    text: 'Was du ohne Verbindung einträgst, steht unten als Hinweis und wird gesendet, sobald du wieder Netz hast. Was endgültig nicht ankam, bleibt sichtbar, bis du es gelesen hast — statt nach vier Sekunden zu verschwinden.',
  },
  {
    icon: ICON_TACHO,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Schneller und sparsamer',
    text: 'Die App startet schneller. Beim Senden und Öffnen von Dateien im Chat siehst du jetzt, wie weit sie sind. Und einmal geladen, sind sie beim zweiten Antippen sofort da — auch ohne Netz.',
  },
];

const KonfiUpdate220WalkthroughModal: React.FC<Props> = ({ onClose }) => (
  <OnboardingTour slides={SLIDES} onClose={onClose} />
);

export default KonfiUpdate220WalkthroughModal;
