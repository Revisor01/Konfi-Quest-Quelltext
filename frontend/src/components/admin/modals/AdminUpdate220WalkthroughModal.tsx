import React from 'react';
import {
  ICON_ANWESEND,
  ICON_FINGERABDRUCK,
  ICON_KOPIEREN_GEFUELLT,
  ICON_OFFLINE,
  ICON_SCHUTZ,
  ICON_TERMIN_GEFUELLT,
} from '../../shared/icons';
import OnboardingTour, { OnboardingSlide } from '../../shared/OnboardingTour';

interface Props {
  onClose: () => void;
}

// Aenderungsanzeige 2.2.0 fuer die LEITUNG.
//
// ALLES SEIT 2.0 und FARBREGEL -- siehe Kommentar in der Konfi-Fassung.
//
// TERMIN KOPIEREN steht bewusst an erster Stelle: Es ist
// die groesste Arbeitserleichterung des Release und betrifft nur die Leitung.
//
// SLIDES exportiert fuer den Textbaustein-Test (onboardingSlides.test.ts).
export const SLIDES: OnboardingSlide[] = [
  {
    icon: ICON_KOPIEREN_GEFUELLT,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Termin kopieren',
    text: 'Wisch einen Termin nach links, oder öffne ihn und tipp oben auf das Kopieren-Symbol: Das Formular geht mit allen Angaben des Originals auf. Der Beginn rückt auf die nächste halbe Stunde, die Dauer bleibt. Material, Chat und Anmeldungen kommen nicht mit. Angelegt wird erst beim Speichern.',
  },
  {
    icon: ICON_TERMIN_GEFUELLT,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Absagen mit Grund',
    text: 'Beim Absagen kannst du einen Grund angeben — alle Teilnehmenden sehen ihn. Nimmst du die Absage zurück, steht jede Person wieder dort, wo sie vorher stand, und bekommt Bescheid. Wer vorher schon abgemeldet war, bleibt es.',
  },
  {
    icon: ICON_ANWESEND,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Abgemeldet und Notizen',
    text: 'Die Anwesenheit kennt "Abgemeldet" — für den Anruf der Eltern. Grund und Notiz stehen danach in der Teilnehmerliste. Darunter steht klein, wer eingetragen hat; ein Check-in per QR-Code weist sich als solcher aus.',
  },
  {
    icon: ICON_SCHUTZ,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Mehr Klarheit bei Rechten',
    text: 'Teamer:innen und Admins sehen und erreichen nur die Konfis ihrer eigenen Jahrgänge — im Chat, in den Listen und bei Terminen. Bleibt eine Liste leer, ist das kein Fehler, sondern diese Grenze.',
  },
  {
    icon: ICON_OFFLINE,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Ohne Netz und neue Passwörter',
    text: 'Was ohne Verbindung eingetragen wird — Anwesenheit, Teilnehmende, Anträge —, steht unten als Hinweis und geht raus, sobald wieder Netz da ist. Und die vergebenen Passwörter sind jetzt echte Bibelstellen zum Aufschlagen.',
  },
  {
    icon: ICON_FINGERABDRUCK,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Sperre, Symbole, Tempo',
    text: 'Die App lässt sich mit Face ID, Touch ID oder Fingerabdruck sperren; im Profil wählst du die Wartezeit. Angemeldet bleibst du dabei, von Haus aus ist die Sperre aus. Dazu 95 Symbole für Abzeichen statt 54 — und die App startet schneller.',
  },
];

const AdminUpdate220WalkthroughModal: React.FC<Props> = ({ onClose }) => (
  <OnboardingTour slides={SLIDES} onClose={onClose} />
);

export default AdminUpdate220WalkthroughModal;
