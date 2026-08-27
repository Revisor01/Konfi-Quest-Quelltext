import React from 'react';
import {
  sparklesOutline, homeOutline, chatbubblesOutline, calendarOutline,
  starOutline, documentTextOutline, flagOutline
} from 'ionicons/icons';
import OnboardingTour, { OnboardingSlide } from '../../shared/OnboardingTour';

interface KonfiOnboardingModalProps {
  onClose: () => void;
  displayName?: string;
}

// Inhalt der Tab-Tour. Reihenfolge nach Nutzerfeedback:
// Willkommen · Dein Start (Dashboard) · Deine Chats · Mitmachen (zwei Slides:
// Events + Aktivitäten, beide Reiter EINES Tabs — seit 2.0 kein eigener
// Antrags-Tab mehr) · Deine Badges · Deine Challenges. Die Aktivitäten folgen
// bewusst direkt auf die Events, weil beide im Mitmachen-Tab wohnen; der
// Kernunterschied (vorher anmelden vs. hinterher melden) steht in beiden
// Slides. Die Challenges stehen als Neuheit am Schluss.
// Dargestellt wird die Tour über die geteilte OnboardingTour — hier liegen
// nur noch die Konfi-Texte (frueher war diese Datei eine Vollkopie der Tour).
// Exportiert für den Textbaustein-Test (onboardingSlides.test.ts), der die
// Benennung des Mitmachen-Tabs über alle Rollen hinweg absichert.
export const SLIDES: OnboardingSlide[] = [
  {
    icon: sparklesOutline,
    color: 'var(--app-color-konfis)',
    rgb: '--app-color-konfis-rgb',
    title: 'Konfi Quest',
    text: 'Herzlich willkommen bei deiner Konfi-Zeit! Dein Abenteuer in der Gemeinde beginnt jetzt. Hier sammelst du Punkte, meldest dich zu Events an und bleibst mit deinem Jahrgang in Kontakt. Komm mit, wir zeigen dir alles.',
  },
  {
    icon: homeOutline,
    color: 'var(--app-color-konfis)',
    rgb: '--app-color-konfis-rgb',
    title: 'Dein Start',
    text: 'Hier landest du immer als Erstes. Du siehst auf einen Blick deine Punkte, dein aktuelles Level und was als Nächstes für dich ansteht.',
  },
  {
    icon: chatbubblesOutline,
    color: 'var(--app-color-chat)',
    rgb: '--app-color-chat-rgb',
    title: 'Dein Chat',
    text: 'Schreib mit deinem Jahrgang und deinen Teamer:innen. Hier bekommst du auch wichtige Infos und Ankündigungen direkt mit.',
  },
  {
    icon: calendarOutline,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Mitmachen: Events',
    text: 'Unten in der Tab-Leiste findest du "Mitmachen" — mit zwei Reitern: Events und Aktivitäten. Events sind Termine, zu denen du dich vorher anmeldest — bis hin zu deiner Konfirmation. Bei manchen wählst du einen Platz oder ein Zeitfenster: einfach tippen und buchen.',
  },
  {
    icon: documentTextOutline,
    color: 'var(--app-color-activities)',
    rgb: '--app-color-activities-rgb',
    title: 'Mitmachen: Aktivitäten',
    text: 'Der zweite Reiter im Mitmachen-Tab: Aktivitäten sind Dinge, die immer wieder gehen und für die es Punkte gibt — im Gottesdienst gewesen, bei einer Andacht, bei einer Taufe oder Hochzeit dabei. Hier meldest du dich nicht vorher an, sondern erzählst hinterher davon. Dein Team bestätigt und du bekommst deine Punkte.',
  },
  {
    icon: starOutline,
    color: 'var(--app-color-badges)',
    rgb: '--app-color-badges-rgb',
    title: 'Deine Badges',
    text: 'Für deine Aktivitäten bekommst du Abzeichen. Sammle Badges und steig im Level auf — je mehr du machst, desto mehr schaltest du frei.',
  },
  {
    icon: flagOutline,
    color: 'var(--app-color-challenges)',
    rgb: '--app-color-challenges-rgb',
    title: 'Deine Challenges',
    text: 'Zum Schluss das Neueste: In der Mitte deiner Tab-Leiste warten die Challenges — eine Aufgabe und eine Zeit lang Ruhe, dich damit zu beschäftigen. Du antwortest mit einem Foto, einem Text, einer Aufnahme oder einem Link. Du entscheidest, ob dein Beitrag mit Namen, anonym oder nur für die Leitung sichtbar ist. Fürs Mitmachen gibt es einen Stempel und mit Absicht keine Punkte: Hier geht es nicht ums Sammeln, sondern um dich und deinen Glauben. Deine Teamer:innen machen übrigens mit.',
  },
];

const KonfiOnboardingModal: React.FC<KonfiOnboardingModalProps> = ({ onClose, displayName }) => (
  <OnboardingTour slides={SLIDES} onClose={onClose} displayName={displayName} />
);

export default KonfiOnboardingModal;
