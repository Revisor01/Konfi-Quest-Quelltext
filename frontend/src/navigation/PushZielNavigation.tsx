import { useEffect } from 'react';
import { useIonRouter } from '@ionic/react';
import { PUSH_ZIEL_EVENT, pushZielAbholen, PushZiel } from '../utils/pushNavigation';

/**
 * Navigiert dorthin, wohin ein angetippter Push zeigt — ueber den Router,
 * nicht ueber einen Neuaufbau der App.
 *
 * Der Tap-Handler in AppContext setzte `window.location.href` auf die
 * Ziel-Route. Im nativen WebView ist das ein vollstaendiger Neuaufbau der App
 * (capacitor://localhost) — ausgeloest genau in dem Moment, in dem Android die
 * Activity gerade hochfaehrt. Dieselbe Ursache war in App.tsx schon behoben
 * (Handler fuer 'auth:relogin-required'), und der Kopfkommentar von
 * pushNavigation.ts warnt selbst davor; an der Absturzstelle war die
 * Konsequenz nur nicht gezogen.
 *
 * AppContext hat keinen Router-Zugriff. Er meldet das Ziel deshalb ueber ein
 * CustomEvent (dasselbe Muster wie 'auth:relogin-required', 'org:switched',
 * 'push:received') und diese Komponente — innerhalb des Routers — navigiert.
 * Fuer einen angetippten Push 'root'/'replace' wie im OrgSwitcherButton: Der
 * Seiten-Stack des vorherigen Standes wird geleert, damit im WebView keine
 * gecachte Seite stehenbleibt.
 *
 * Das Ziel wird zusaetzlich aus dem Merker geholt, sobald diese Komponente
 * montiert: Ein Org-Wechsel vor der Navigation erhoeht orgVersion und montiert
 * den ganzen Router-Subtree neu (siehe App.tsx) — das Ereignis kann dann in
 * der Luecke zwischen Abbau und Aufbau landen und niemand hoert es. Der
 * Merker gibt sein Ziel nur einmal heraus, sonst sprang die App bei jedem
 * Neu-Montieren erneut auf das alte Push-Ziel.
 */
const PushZielNavigation: React.FC = () => {
  const router = useIonRouter();

  useEffect(() => {
    const hin = (eintrag: PushZiel | null) => {
      if (!eintrag) return;
      if (eintrag.herkunft === 'inApp') {
        router.push(eintrag.ziel, 'forward', 'push');
        return;
      }
      router.push(eintrag.ziel, 'root', 'replace');
    };

    // 1. Beim Montieren: liegt schon ein Ziel bereit (Kaltstart ueber einen
    //    Push, Org-Wechsel mit Router-Remount), sofort dorthin.
    hin(pushZielAbholen());

    // 2. Danach: jedes weitere gemeldete Ziel.
    const lauscher = () => hin(pushZielAbholen());
    window.addEventListener(PUSH_ZIEL_EVENT, lauscher);
    return () => window.removeEventListener(PUSH_ZIEL_EVENT, lauscher);
  }, [router]);

  return null;
};

export default PushZielNavigation;
