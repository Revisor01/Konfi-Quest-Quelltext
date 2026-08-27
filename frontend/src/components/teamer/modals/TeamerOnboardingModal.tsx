import React from 'react';
import {
  sparklesOutline, homeOutline, chatbubblesOutline, calendarOutline,
  ribbonOutline, folderOpenOutline, flagOutline, documentTextOutline,
} from 'ionicons/icons';
import OnboardingTour, { OnboardingSlide } from '../../shared/OnboardingTour';

interface TeamerOnboardingModalProps {
  onClose: () => void;
  displayName?: string;
}

// Teamer-Tour: folgt den Teamer-Tabs (Start · Chat · Mitmachen · Challenges ·
// Badges). Der Mitmachen-Tab bündelt Events und Aktivitäten als zwei Reiter;
// beide bekommen einen EIGENEN Slide (User-Entscheid 10.08., Umbenennung auf
// "Mitmachen" 24.08.) — im Events-Slide nur nebenbei erwähnt ging unter, was
// Aktivitäten überhaupt sind. Kernunterschied in beiden Slides: zu Events
// meldet man sich VORHER an, Aktivitäten reicht man HINTERHER ein. Die
// Beispiele stammen aus den echten Teamer-Anträgen (Gottesdienst
// mitgestalten, Andacht, Schulung) — "Gottesdienstbesuch" wäre die
// Konfi-Welt, nicht die des Teams.
// SLIDES exportiert für den Textbaustein-Test (onboardingSlides.test.ts).
export const SLIDES: OnboardingSlide[] = [
  {
    icon: sparklesOutline,
    color: 'var(--app-color-teamer)',
    rgb: '--app-color-teamer-rgb',
    title: 'Willkommen im Team',
    text: 'Schön, dass du als Teamer:in dabei bist! Hier begleitest du deine Gruppe, behältst Termine im Blick und sammelst selbst Badges für dein Engagement. Wir zeigen dir kurz, wie alles funktioniert.',
  },
  {
    icon: homeOutline,
    color: 'var(--app-color-teamer)',
    rgb: '--app-color-teamer-rgb',
    title: 'Dein Start',
    text: 'Auf der Startseite siehst du deine wichtigsten Infos auf einen Blick: anstehende Termine, deine Badges, deine Zertifikate und alles, was für dich gerade ansteht.',
  },
  {
    icon: chatbubblesOutline,
    color: 'var(--app-color-chat)',
    rgb: '--app-color-chat-rgb',
    title: 'Dein Chat',
    text: 'Bleib mit deinem Jahrgang und dem Team in Kontakt — dafür gibt es automatische Chats. Du kannst auch Direktchats und Gruppenchats nutzen, und zu Events gibt es eigene Chats. Bilder teilen geht ebenfalls. An Umfragen nimmst du teil; anlegen kann sie die Leitung.',
  },
  {
    icon: calendarOutline,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Mitmachen: Events',
    text: 'Der Tab "Mitmachen" bündelt Events und Aktivitäten in zwei Reitern. Bei den Events findest du alle Termine und meldest dich vorher dort an, wo Teamer:innen gebraucht werden. Manche Termine sind nur fürs Team. Angelegt werden Termine von der Leitung.',
  },
  {
    icon: documentTextOutline,
    color: 'var(--app-color-activities)',
    rgb: '--app-color-activities-rgb',
    title: 'Mitmachen: Aktivitäten',
    text: 'Der zweite Reiter im Mitmachen-Tab. Anmelden musst du dich hier nicht: Hast du einen Gottesdienst mitgestaltet, eine Andacht gehalten oder warst bei einer Teamer-Schulung? Dann reichst du das hinterher dort ein, die Leitung bestätigt — so bleibt dein Einsatz dokumentiert und fließt in deine Badges ein.',
  },
  {
    icon: flagOutline,
    color: 'var(--app-color-challenges)',
    rgb: '--app-color-challenges-rgb',
    title: 'Challenges',
    text: 'Challenges begleiten die Konfis über einen Zeitraum, den du festlegst: Sie antworten mit Foto, Text, Aufnahme oder Link. Ohne Punkte, ohne Zähler, ohne Rangliste — nur ein Stempel fürs Mitmachen. Und das Wichtigste: Du machst mit. Teamer:innen und Leitung sind bei Challenges keine Zuschauer, sondern antworten selbst — es gibt sogar Runden nur fürs Team.',
  },
  {
    icon: ribbonOutline,
    color: 'var(--app-color-badges)',
    rgb: '--app-color-badges-rgb',
    title: 'Deine Badges',
    text: 'Auch du sammelst Abzeichen — für dein Engagement im Team. Schau hier, welche Badges du schon hast und welche du als Nächstes erreichen kannst.',
  },
  {
    icon: folderOpenOutline,
    color: 'var(--app-color-material)',
    rgb: '--app-color-material-rgb',
    title: 'Material',
    text: 'Im Material-Bereich findest du alle Unterlagen fürs Team — allgemein oder direkt einem Event zugeordnet. Diese Materialien sind nur für euch im Team sichtbar, nicht für die Konfis.',
  },
];

const TeamerOnboardingModal: React.FC<TeamerOnboardingModalProps> = ({ onClose, displayName }) => (
  <OnboardingTour slides={SLIDES} onClose={onClose} displayName={displayName} />
);

export default TeamerOnboardingModal;
