import { useState } from 'react';
import { useIonViewDidEnter } from '@ionic/react';
import { Preferences } from '@capacitor/preferences';

// Flag-Praefix des Update-Hinweises 2.0 (Challenges + der neue
// Mitmachen-Tab, der Events und Aktivitäten bündelt). Rollenuebergreifend
// derselbe Praefix, der Account-Suffix trennt die Nutzer. Dasselbe Flag
// steuert Karte UND Walkthrough — es gibt bewusst nur EIN Erinnerungssystem.
// Version, auf die sich die aktuellen Neuerungs-Banner beziehen. Sie steckt
// im Schluesselnamen: Wird sie hochgezaehlt, entstehen neue Schluessel, und
// die Banner erscheinen bei allen wieder — auch bei denen, die die alten
// weggeklickt hatten. Die alten Flags bleiben liegen und stoeren nicht.
export const NEUERUNGEN_VERSION = '2_0';

export const UPDATE_WALKTHROUGH_KEY = `update_walkthrough_${NEUERUNGEN_VERSION}_gesehen`;

export const MITMACHEN_HINWEIS_KEY = `mitmachen_hinweis_${NEUERUNGEN_VERSION}_gesehen`;

// Zeigt eine Onboarding-Tour EINMAL pro Account (geraetelokal via Preferences).
// `keyPrefix` trennt die Rollen (z.B. 'admin_onboarding_seen'), `userId` macht
// den Marker accountspezifisch. Rueckgabe: [show, close] — `show` rendert das
// Tour-Overlay, `close` schließt es. Der Marker wird beim ERSTEN Anzeigen
// gesetzt (nicht erst beim Schliessen), damit die Tour nicht doppelt aufpoppt.
export function useOnboardingOnce(keyPrefix: string, userId?: number | string): [boolean, () => void] {
  const [show, setShow] = useState(false);
  const storageKey = `${keyPrefix}_${userId ?? 'x'}`;

  useIonViewDidEnter(() => {
    if (userId === undefined || userId === null) return;
    Preferences.get({ key: storageKey }).then(({ value }) => {
      if (!value) {
        Preferences.set({ key: storageKey, value: '1' });
        // Kleiner Versatz, damit die Seite erst sauber rendert.
        setTimeout(() => setShow(true), 400);
      }
    }).catch(() => { /* Preferences nicht verfuegbar -> Tour ueberspringen */ });
  });

  return [show, () => setShow(false)];
}

export interface OnboardingWithUpdate {
  // Normale Rollen-Tour (erster Start eines Accounts).
  showOnboarding: boolean;
  closeOnboarding: () => void;
  // Neuigkeiten-Karte auf der Startseite, NUR für Bestandsnutzer.
  showUpdateHinweis: boolean;
  // Markiert den Hinweis dauerhaft als gesehen (X gedrückt ODER Walkthrough
  // über die Karte geöffnet) und blendet die Karte aus.
  markUpdateHinweisGesehen: () => void;
  // Zweite Karte: Hinweis auf den Mitmachen-Tab (Events + Aktivitäten).
  // Unabhaengig vom Update-Hinweis, eigenes Flag, eigenes X.
  showMitmachenHinweis: boolean;
  markMitmachenHinweisGesehen: () => void;
}

// Entscheidet in EINEM Ablauf, ob die normale Onboarding-Tour oder die
// Neuigkeiten-Karte ("Was ist neu in Version 2.0") gezeigt wird — nie beides:
//
// - Onboarding-Flag fehlt  -> frischer Account: volle Tour zeigen und den
//   Update-Hinweis direkt als gesehen markieren. Neue Nutzer lernen die
//   Neuerungen ohnehin in der Tour kennen und brauchen keine Karte.
// - Onboarding-Flag gesetzt, Update-Flag fehlt -> Bestandsnutzer: die Karte
//   auf der Startseite zeigen. Das Flag wird dabei NICHT gesetzt — die Karte
//   bleibt über App-Starts hinweg stehen, bis die Person sie mit dem X
//   ausblendet oder darüber den "Was ist neu"-Walkthrough öffnet
//   (markUpdateHinweisGesehen). Erst dann verschwindet sie dauerhaft.
// - beide gesetzt -> nichts.
export function useOnboardingWithUpdateOnce(
  onboardingKeyPrefix: string,
  userId?: number | string
): OnboardingWithUpdate {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showUpdateHinweis, setShowUpdateHinweis] = useState(false);
  const [showMitmachenHinweis, setShowMitmachenHinweis] = useState(false);
  const onboardingKey = `${onboardingKeyPrefix}_${userId ?? 'x'}`;
  const updateKey = `${UPDATE_WALKTHROUGH_KEY}_${userId ?? 'x'}`;
  const mitmachenKey = `${MITMACHEN_HINWEIS_KEY}_${userId ?? 'x'}`;

  useIonViewDidEnter(() => {
    if (userId === undefined || userId === null) return;
    Promise.all([
      Preferences.get({ key: onboardingKey }),
      Preferences.get({ key: updateKey }),
      Preferences.get({ key: mitmachenKey })
    ]).then(([onboarding, update, mitmachen]) => {
      if (!onboarding.value) {
        // Frischer Account: die Tour erklaert beides, keine Karten noetig.
        Preferences.set({ key: onboardingKey, value: '1' });
        Preferences.set({ key: updateKey, value: '1' });
        Preferences.set({ key: mitmachenKey, value: '1' });
        setTimeout(() => setShowOnboarding(true), 400);
        return;
      }
      // Bestandsnutzer: beide Karten unabhaengig voneinander zeigen. Flags
      // werden NICHT gesetzt — erst eine bewusste Aktion (X oder Öffnen)
      // markiert den jeweiligen Hinweis als gesehen.
      if (!update.value) setShowUpdateHinweis(true);
      if (!mitmachen.value) setShowMitmachenHinweis(true);
    }).catch(() => { /* Preferences nicht verfuegbar -> Hinweise ueberspringen */ });
  });

  return {
    showOnboarding,
    closeOnboarding: () => setShowOnboarding(false),
    showUpdateHinweis,
    markUpdateHinweisGesehen: () => {
      setShowUpdateHinweis(false);
      Preferences.set({ key: updateKey, value: '1' })
        .catch(() => { /* Preferences nicht verfuegbar -> beim naechsten Start erneut */ });
    },
    showMitmachenHinweis,
    markMitmachenHinweisGesehen: () => {
      setShowMitmachenHinweis(false);
      Preferences.set({ key: mitmachenKey, value: '1' })
        .catch(() => { /* Preferences nicht verfuegbar -> beim naechsten Start erneut */ });
    }
  };
}
