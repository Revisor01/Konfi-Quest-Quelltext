import React from 'react';
import { calendarOutline, checkmarkCircleOutline, swapHorizontalOutline } from 'ionicons/icons';
import OnboardingTour, { OnboardingSlide } from './OnboardingTour';

interface MitmachenErklaerungModalProps {
  onClose: () => void;
  displayName?: string;
  /** 'konfi' | 'teamer' | 'admin' — steuert die Ansprache im dritten Bild. */
  rolle?: 'konfi' | 'teamer' | 'admin';
}

// Eigener Erklaertext zum Mitmachen-Tab (Events + Aktivitaeten). Bewusst
// getrennt vom Update-Walkthrough: Dieser hier bleibt dauerhaft im Profil
// erreichbar und erklaert EINE Sache gruendlich, waehrend "Was ist neu" die
// Neuerungen der Version streift.
export const SLIDES_BASIS: OnboardingSlide[] = [
  {
    icon: swapHorizontalOutline,
    color: 'var(--app-color-activities)',
    rgb: '--app-color-activities-rgb',
    title: 'Alles an einem Ort',
    text: 'Events und Aktivitäten wohnen zusammen im Tab "Mitmachen" — oben schaltest du zwischen beiden Reitern um. Einen eigenen Tab für Anträge gibt es nicht mehr: Aus den Anträgen sind die Aktivitäten geworden.',
  },
  {
    icon: calendarOutline,
    color: 'var(--app-color-events)',
    rgb: '--app-color-events-rgb',
    title: 'Events: vorher anmelden',
    text: 'Unter "Events" stehen die Termine, zu denen du dich anmeldest — Gottesdienste, Konfi-Tage, Fahrten. Du meldest dich vorher an, siehst wie viele Plätze frei sind und kommst bei vollen Terminen auf die Warteliste. Pflichttermine erkennst du an der Markierung.',
  },
];

const SLIDE_AKTIVITAETEN_KONFI: OnboardingSlide = {
  icon: checkmarkCircleOutline,
  color: 'var(--app-color-activities)',
  rgb: '--app-color-activities-rgb',
  title: 'Aktivitäten: hinterher melden',
  text: 'Unter "Aktivitäten" meldest du, was du schon gemacht hast — mit Foto, wenn du magst. Dein Team schaut drauf und bestätigt; erst dann zählen die Punkte. Solange etwas offen ist, siehst du es als "wartet auf Bestätigung".',
};

// Nur die Leitung bestätigt Meldungen: PUT /activities/requests/:id ist
// requireAdmin (activities.js:473), Teamer:innen sind dort ausgeschlossen.
const SLIDE_AKTIVITAETEN_LEITUNG: OnboardingSlide = {
  icon: checkmarkCircleOutline,
  color: 'var(--app-color-activities)',
  rgb: '--app-color-activities-rgb',
  title: 'Aktivitäten: bestätigen',
  text: 'Unter "Aktivitäten" landen die Meldungen der Konfis über das, was sie schon gemacht haben. Du siehst sie mit Datum und Foto und bestätigst oder lehnst ab — erst mit der Bestätigung zählen die Punkte. Beim Ablehnen gehört eine Begründung dazu.',
};

const SLIDE_AKTIVITAETEN_TEAMER: OnboardingSlide = {
  icon: checkmarkCircleOutline,
  color: 'var(--app-color-activities)',
  rgb: '--app-color-activities-rgb',
  title: 'Aktivitäten: hinterher melden',
  text: 'Unter "Aktivitäten" meldest du deine eigenen Einsätze — mit Foto, wenn du magst. Die Leitung schaut drauf und bestätigt; erst dann zählen die Punkte. Solange etwas offen ist, siehst du es als "wartet auf Bestätigung". Die Meldungen der Konfis bestätigt die Leitung.',
};

export const slidesFuer = (rolle: 'konfi' | 'teamer' | 'admin' = 'konfi'): OnboardingSlide[] => [
  ...SLIDES_BASIS,
  rolle === 'konfi'
    ? SLIDE_AKTIVITAETEN_KONFI
    : rolle === 'teamer'
      ? SLIDE_AKTIVITAETEN_TEAMER
      : SLIDE_AKTIVITAETEN_LEITUNG,
];

const MitmachenErklaerungModal: React.FC<MitmachenErklaerungModalProps> = ({
  onClose, displayName, rolle = 'konfi'
}) => <OnboardingTour slides={slidesFuer(rolle)} onClose={onClose} displayName={displayName} />;

export default MitmachenErklaerungModal;
