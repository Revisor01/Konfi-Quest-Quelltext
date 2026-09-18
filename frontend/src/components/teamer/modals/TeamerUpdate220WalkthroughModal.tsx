import React from 'react';
import {
  ICON_ABZEICHEN,
  ICON_ANWESEND,
  ICON_FINGERABDRUCK,
  ICON_GRUPPE_GEFUELLT,
  ICON_OFFLINE,
  ICON_TERMIN_GEFUELLT,
} from '../../shared/icons';
import OnboardingTour, { OnboardingSlide } from '../../shared/OnboardingTour';

interface Props {
  onClose: () => void;
}

// Aenderungsanzeige 2.2.0 fuer das TEAM.
//
// ALLES SEIT 2.0 und FARBREGEL -- siehe Kommentar in der Konfi-Fassung.
//
// SLIDES exportiert fuer den Textbaustein-Test (onboardingSlides.test.ts).
export const SLIDES: OnboardingSlide[] = [
  {
    icon: ICON_GRUPPE_GEFUELLT,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Ihr seht, wer kommt',
    text: 'Am Termin steht jetzt die Teilnehmerliste: Konfis und Team getrennt, mit Jahrgang und Stand der Anmeldung. Wer auf eine Freizeit mitfährt, weiß damit vorher, wen er erwartet.',
  },
  {
    icon: ICON_ANWESEND,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Abgemeldet und Notizen',
    text: 'Die Leitung kann jemanden abmelden, etwa nach dem Anruf der Eltern. In eurer Teilnehmerliste steht dann "Abgemeldet" mit dem Grund. Auch Notizen wie "geht um 14 Uhr" seht ihr dort — wer vor Ort ist, weiß Bescheid.',
  },
  {
    icon: ICON_TERMIN_GEFUELLT,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Klarheit bei Absagen',
    text: 'Fällt ein Termin aus, steht der Grund dabei — in der Liste und auf der Startseite. Findet er doch statt, seht ihr das ebenso. Eure eigene Zu- und Absage wirkt jetzt sofort, ohne Neuladen.',
  },
  {
    icon: ICON_FINGERABDRUCK,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Die App abschließen',
    text: 'Die App lässt sich mit Face ID, Touch ID oder Fingerabdruck sperren. Im Profil wählst du, nach welcher Zeit die Abfrage kommt. Angemeldet bleibst du dabei, und von Haus aus ist die Sperre aus.',
  },
  {
    icon: ICON_OFFLINE,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Ohne Netz und im Chat',
    text: 'Was ohne Verbindung eingetragen wird, steht unten als Hinweis und geht raus, sobald wieder Netz da ist. Und beim Senden und Öffnen von Dateien im Chat seht ihr jetzt, wie weit sie sind.',
  },
  {
    icon: ICON_ABZEICHEN,
    color: 'var(--app-color-challenges)',
    rgb: '--app-color-challenges-rgb',
    title: 'Stempel und Tempo',
    text: 'Im Challenges-Tab stehen jetzt auch eure eigenen Stempel — und grau daneben die, die es noch zu holen gibt. Und die App startet schneller.',
  },
];

const TeamerUpdate220WalkthroughModal: React.FC<Props> = ({ onClose }) => (
  <OnboardingTour slides={SLIDES} onClose={onClose} />
);

export default TeamerUpdate220WalkthroughModal;
