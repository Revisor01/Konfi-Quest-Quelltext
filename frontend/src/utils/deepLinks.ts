// Welche Links die App annimmt, steht hier, im AndroidManifest (intent-filter
// mit autoVerify) und in public/.well-known/apple-app-site-association. Alle
// drei Listen muessen deckungsgleich sein; __tests__/navigation/
// appLinksAndroid.test.ts und appLinksIos.test.ts pruefen das, der zweite
// auch die Hosts in den iOS-Entitlements.
import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { pushZielMelden } from './pushNavigation';

/** Hosts, fuer die Android und iOS der App die Links zuweisen (android:host, applinks:). */
export const APP_LINK_HOSTS: readonly string[] = ['konfi-quest.de'];

/**
 * Pfad-Anfaenge, die die App oeffnen (android:pathPrefix). Nur Seiten, die
 * die App wirklich hat: die Einladung aus QR-Code und Elternbrief
 * (/register?code=...), der Link aus der Passwort-vergessen-Mail
 * (/reset-password?token=...) und /login von der Werbeseite. Werbeseite,
 * Datenschutz, Impressum und Handbuch bleiben im Browser.
 */
export const APP_LINK_PFADE: readonly string[] = ['/login', '/register', '/reset-password'];

/**
 * In-App-Ziel fuer eine von Android oder iOS gelieferte Adresse. Leerer String =
 * nichts tun (fremder Host, kein https, Pfad ohne Seite in der App, Unsinn).
 *
 * Abfrage und Anker bleiben erhalten: Der Einladungscode steckt in ?code=,
 * der Reset-Token in ?token= -- die Seiten lesen beides aus location.search.
 */
export const deepLinkZiel = (url: string): string => {
  let adresse: URL;
  try {
    adresse = new URL(url);
  } catch {
    return '';
  }
  if (adresse.protocol !== 'https:') return '';
  if (!APP_LINK_HOSTS.includes(adresse.hostname.toLowerCase())) return '';

  // Wie Androids pathPrefix und die *-Muster der AASA: reiner Anfangsvergleich.
  const pfad = adresse.pathname;
  if (!APP_LINK_PFADE.some((prefix) => pfad.startsWith(prefix))) return '';

  return `${pfad}${adresse.search}${adresse.hash}`;
};

/**
 * Lauscher fuer geoeffnete Links anschliessen. Liefert die Funktion zum
 * Abbauen. Ein Link, der zu keinem Ziel fuehrt, wird still verworfen.
 */
export const deepLinksAnschliessen = async (): Promise<() => void> => {
  const lauscher = await App.addListener('appUrlOpen', (ereignis: URLOpenListenerEvent) => {
    pushZielMelden(deepLinkZiel(ereignis.url));
  });
  return () => {
    void lauscher.remove();
  };
};
