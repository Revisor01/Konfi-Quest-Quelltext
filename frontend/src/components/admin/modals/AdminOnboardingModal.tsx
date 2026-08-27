import React from 'react';
import {
  sparklesOutline, peopleOutline, chatbubblesOutline, calendarOutline,
  settingsOutline, schoolOutline, documentTextOutline,
  ribbonOutline, statsChartOutline, folderOpenOutline, flagOutline,
} from 'ionicons/icons';
import OnboardingTour, { OnboardingSlide } from '../../shared/OnboardingTour';

interface AdminOnboardingModalProps {
  onClose: () => void;
  displayName?: string;
}

// Admin-Tour: erst die 5 Tabs (Konfis · Chat · Mitmachen · Challenges · Mehr),
// dann die wichtigsten Verwaltungs-Aufgaben (Jahrgang, Badges, Wrapped,
// Material). Der Mitmachen-Tab bündelt Events und Aktivitäten als zwei
// Reiter; die Aktivitäten haben einen EIGENEN Slide DIREKT hinter den Events
// (User-Entscheid 10.08., Umbenennung auf "Mitmachen" 24.08.): nur nebenbei
// erwähnt ging unter, was sie von Events unterscheidet (kein Anmelden,
// sondern Meldung hinterher). Das Anlegen selbst bleibt im Mehr-Tab und wird
// dort genannt. Beispiele stammen aus echten Aktivitäten der Produktivdaten.
// SLIDES exportiert für den Textbaustein-Test (onboardingSlides.test.ts).
export const SLIDES: OnboardingSlide[] = [
  {
    icon: sparklesOutline,
    color: 'var(--app-color-konfis)',
    rgb: '--app-color-konfis-rgb',
    title: 'Willkommen',
    text: 'Schön, dass du dabei bist! Mit Konfi Quest begleitest du deine Konfis durch ihre Konfi-Zeit: Punkte, Aktivitäten, Events, Badges und Chat an einem Ort. Wir zeigen dir, wo du was findest.',
  },
  {
    icon: peopleOutline,
    color: 'var(--app-color-konfis)',
    rgb: '--app-color-konfis-rgb',
    title: 'Konfis',
    text: 'Hier verwaltest du deine Konfis: Punkte vergeben, Fortschritt sehen, Badges und Aktivitäten im Blick behalten. Tippe auf eine Person für alle Details.',
  },
  {
    icon: chatbubblesOutline,
    color: 'var(--app-color-chat)',
    rgb: '--app-color-chat-rgb',
    title: 'Chat',
    text: 'Es gibt automatisch einen Jahrgangs-Chat und einen Team-Chat. Du kannst außerdem Direktchats und eigene Gruppenchats anlegen, und zu jedem Event einen Chat erstellen — die angemeldeten Konfis kommen automatisch hinein. Bilder teilen und Umfragen erstellen geht natürlich auch.',
  },
  {
    icon: calendarOutline,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Mitmachen: Events',
    text: 'Der Tab "Mitmachen" bündelt Events und Aktivitäten in zwei Reitern. Events sind Termine, die du anlegst — einmalig, über mehrere Tage oder als ganze Serie, mit Plätzen, Zeitfenstern und Warteliste. Konfis melden sich vorher an, und du behältst An- und Abwesenheit im Griff. Du kannst auch festlegen, dass Teamer:innen gesucht werden oder ein Termin nur fürs Team ist.',
  },
  {
    icon: documentTextOutline,
    color: 'var(--app-color-activities)',
    rgb: '--app-color-activities-rgb',
    title: 'Mitmachen: Aktivitäten',
    text: 'Der zweite Reiter im Mitmachen-Tab: wiederkehrende Dinge, für die es Punkte gibt — Gottesdienst, Andacht, Taufe oder Hochzeit, aber auch Gemeindebrief verteilen oder Besuchsdienst. Anders als bei Events melden sich Konfis nicht vorher an — sie melden die Aktivität hinterher, du prüfst sie und vergibst mit einem Tipp die Punkte. Auch Teamer:innen reichen hier ihren Einsatz ein.',
  },
  {
    icon: flagOutline,
    color: 'var(--app-color-challenges)',
    rgb: '--app-color-challenges-rgb',
    title: 'Challenges',
    text: 'Challenges begleiten deine Konfis über einen Zeitraum, den du festlegst: Sie antworten mit Foto, Text, Aufnahme oder Link. Bewusst ohne Punkte, ohne Zähler, ohne Rangliste — es gibt nur einen Stempel fürs Mitmachen. Die Idee: sich eine Zeit lang mit einem Thema beschäftigen, mitten im Alltag. Ihr im Team macht mit — und es gibt sogar Runden nur fürs Team.',
  },
  {
    icon: settingsOutline,
    color: 'var(--app-color-users)',
    rgb: '--app-color-users-rgb',
    title: 'Mehr',
    text: 'Im Mehr-Tab steckt die ganze Verwaltung: Jahrgänge, Aktivitäten, Badges, Level, Kategorien, Material und Benutzer. Tippe bei jedem Bereich auf das Info-Symbol für eine kurze Erklärung.',
  },
  {
    icon: schoolOutline,
    color: 'var(--app-color-jahrgang)',
    rgb: '--app-color-jahrgang-rgb',
    title: 'Jahrgänge',
    text: 'Alles beginnt mit einem Jahrgang: Hier legst du die Punkteziele für Gottesdienst und Gemeinde fest. Du gibst außerdem frei, ab wann die Konfis ihren Konfispruch auswählen dürfen. Konfis gehören immer zu einem Jahrgang.',
  },
  {
    icon: ribbonOutline,
    color: 'var(--app-color-badges)',
    rgb: '--app-color-badges-rgb',
    title: 'Badges',
    text: 'Badges belohnen Erfolge — nach Punkten, Anzahl bestimmter Aktivitäten, besuchten (Pflicht-)Events oder Kombinationen. Du wählst die Logik und Schwelle selbst; Konfis erhalten sie automatisch.',
  },
  {
    icon: statsChartOutline,
    color: 'var(--app-color-level)',
    rgb: '--app-color-level-rgb',
    title: 'Level & Wrapped',
    text: 'Über Level machst du den Fortschritt sichtbar und vergibst Belohnungen. Am Jahrgangsende gibt es das Wrapped: ein persönlicher Rückblick für jeden Konfi, den du pro Jahrgang freigibst.',
  },
  {
    icon: folderOpenOutline,
    color: 'var(--app-color-material)',
    rgb: '--app-color-material-rgb',
    title: 'Material',
    text: 'Lege Unterlagen fürs Team ab — allgemein oder direkt einem Event zugeordnet. Dieses Material ist nur fürs Team sichtbar, nicht für die Konfis. So haben alle Teamer:innen die wichtigen Dokumente parat.',
  },
];

const AdminOnboardingModal: React.FC<AdminOnboardingModalProps> = ({ onClose, displayName }) => (
  <OnboardingTour slides={SLIDES} onClose={onClose} displayName={displayName} />
);

export default AdminOnboardingModal;
