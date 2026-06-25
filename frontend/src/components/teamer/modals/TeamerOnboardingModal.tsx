import React from 'react';
import {
  sparklesOutline, homeOutline, chatbubblesOutline, calendarOutline,
  ribbonOutline, documentTextOutline, folderOpenOutline,
} from 'ionicons/icons';
import OnboardingTour, { OnboardingSlide } from '../../shared/OnboardingTour';

interface TeamerOnboardingModalProps {
  onClose: () => void;
  displayName?: string;
}

// Teamer-Tour: folgt den Teamer-Tabs (Start · Chat · Events · Badges · Aktivitaeten).
// Gleicher Stil wie die Konfi-/Admin-Tour.
const SLIDES: OnboardingSlide[] = [
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
    text: 'Bleib mit deinem Jahrgang und dem Team in Kontakt — dafür gibt es automatische Chats. Du kannst auch Direktchats und Gruppenchats nutzen, und zu Events gibt es eigene Chats. Bilder teilen und Umfragen erstellen geht ebenfalls.',
  },
  {
    icon: calendarOutline,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Deine Events',
    text: 'Hier findest du alle Termine und meldest dich dort an, wo Teamer:innen gebraucht werden. So weiß das Team immer, wer wann dabei ist.',
  },
  {
    icon: ribbonOutline,
    color: 'var(--app-color-badges)',
    rgb: '--app-color-badges-rgb',
    title: 'Deine Badges',
    text: 'Auch du sammelst Abzeichen — für dein Engagement im Team. Schau hier, welche Badges du schon hast und welche du als Nächstes erreichen kannst.',
  },
  {
    icon: documentTextOutline,
    color: 'var(--app-color-activities)',
    rgb: '--app-color-activities-rgb',
    title: 'Deine Aktivitäten',
    text: 'Warst du bei einer Aktion dabei? Reiche deine Aktivitäten hier ein. So bleibt dein Einsatz dokumentiert und fließt in deine Badges ein.',
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
