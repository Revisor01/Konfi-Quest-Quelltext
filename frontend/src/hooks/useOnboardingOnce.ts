import { useState } from 'react';
import { useIonViewDidEnter } from '@ionic/react';
import { Preferences } from '@capacitor/preferences';

// Zeigt eine Onboarding-Tour EINMAL pro Account (geraetelokal via Preferences).
// `keyPrefix` trennt die Rollen (z.B. 'admin_onboarding_seen'), `userId` macht
// den Marker accountspezifisch. Rueckgabe: [show, close] — `show` rendert das
// Tour-Overlay, `close` schliesst es. Der Marker wird beim ERSTEN Anzeigen
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
