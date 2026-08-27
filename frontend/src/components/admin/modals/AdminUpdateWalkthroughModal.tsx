import React from 'react';
import { flagOutline, swapHorizontalOutline } from 'ionicons/icons';
import OnboardingTour, { OnboardingSlide } from '../../shared/OnboardingTour';

interface AdminUpdateWalkthroughModalProps {
  onClose: () => void;
}

// Kurzvariante des Update-Walkthroughs 2.0 für Admins/Org-Admins.
// Gleicher Stil wie die normale Admin-Tour.
// SLIDES exportiert für den Textbaustein-Test (onboardingSlides.test.ts).
export const SLIDES: OnboardingSlide[] = [
  {
    icon: flagOutline,
    color: 'var(--app-color-challenges)',
    rgb: '--app-color-challenges-rgb',
    title: 'Neu: Challenges',
    text: 'Challenges begleiten deine Konfis über einen Zeitraum, den du festlegst: Fotos, Texte, Aufnahmen oder Links. Bewusst ohne Punkte, ohne Zähler, ohne Rangliste — es gibt nur einen Stempel fürs Mitmachen. Die Idee: Die Konfis beschäftigen sich eine Zeit lang mit einem Thema, mitten in ihrem Alltag. Sie haben einen eigenen Tab in der Tab-Leiste.',
  },
  {
    icon: flagOutline,
    color: 'var(--app-color-challenges)',
    rgb: '--app-color-challenges-rgb',
    title: 'Anlegen und moderieren',
    text: 'Beim Anlegen legst du Jahrgänge, Zeitraum, erlaubte Medien, Sichtbarkeit und Freigabe fest. Nach dem Start bleiben Sichtbarkeit und Freigabe gesperrt — die Zusage an die Konfis gilt. Bei den Beiträgen kannst du freigeben, einen Beitrag nachträglich anonymisieren oder ihn ausblenden, wenn etwas nicht passt. Und ihr im Team macht mit: Teamer:innen und Leitung nehmen selbst teil, es gibt sogar Runden nur fürs Team.',
  },
  {
    icon: swapHorizontalOutline,
    color: 'var(--app-color-activities)',
    rgb: '--app-color-activities-rgb',
    title: 'Neu: der Mitmachen-Tab',
    text: 'Deine Tab-Leiste ist jetzt Konfis · Chat · Mitmachen · Challenges · Mehr. Der Mitmachen-Tab bündelt Events und Aktivitäten in zwei Reitern: Zu Events melden sich Konfis vorher an, Aktivitäten melden sie hinterher und du bestätigst sie mit einem Tipp. Auch bei Konfis und Teamer:innen heißt der Tab "Mitmachen" — dafür ist der eigene Aktivitäten-Tab weg.',
  },
];

const AdminUpdateWalkthroughModal: React.FC<AdminUpdateWalkthroughModalProps> = ({ onClose }) => (
  <OnboardingTour slides={SLIDES} onClose={onClose} />
);

export default AdminUpdateWalkthroughModal;
