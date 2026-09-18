import { Share } from '@capacitor/share';
import type { ShareOptions } from '@capacitor/share';
import { ohneSperre } from './appSperre';

// ---------------------------------------------------------------------------
// Systemdialoge, die die App in den Hintergrund schicken.
//
// WARUM ES DIESE DATEI GIBT:
// Ein Teilen-Blatt, eine Dateiauswahl oder ein geoeffneter Link legen die App
// in den Hintergrund, ohne dass die Person sie verlaesst. Fuer die App-Sperre
// (services/appSperre.ts) sieht das zunaechst aus wie "App verlassen" — und bei
// der Einstellung "sofort" saesse man nach dem Teilen vor einem Sperrbildschirm.
//
// Statt an acht Aufrufstellen einen Merker zu setzen (und beim neunten daran zu
// denken), laufen die Dialoge hier durch EINE Huelle, die den Ausflug an- und
// abmeldet. Wer kuenftig teilt, importiert von hier und bekommt das Verhalten
// geschenkt.
//
// Die Karenzzeit in appSperre.ts bleibt trotzdem noetig: sie faengt die
// Dialoge ab, die nie durch diese Datei laufen (Fotoauswahl ueber ein
// verstecktes <input type="file">, window.open auf Karten und Weblinks).
// ---------------------------------------------------------------------------

/**
 * `Share.share` mit abgemeldeter App-Sperre.
 * Verhaelt sich sonst in jeder Hinsicht wie das Original — auch im Fehlerfall:
 * ein Abbruch wirft weiterhin, die Aufrufstellen behandeln ihn wie bisher.
 */
export const teilen = (optionen: ShareOptions) =>
  ohneSperre(() => Share.share(optionen));

/** `navigator.share` mit abgemeldeter App-Sperre (Browser-Weg). */
export const teilenImBrowser = (daten: ShareData) =>
  ohneSperre(() => navigator.share(daten));

/**
 * Oeffnet einen Link ausserhalb der App (Karten, Store, Weblinks).
 * Gibt es nur, damit auch diese Abgaenge die Sperre nicht ausloesen.
 */
export const linkOeffnen = (url: string): void => {
  ohneSperre(async () => {
    window.open(url, '_blank');
    // Kurz offen halten: window.open kehrt sofort zurueck, der Wechsel in den
    // Hintergrund passiert erst danach. Ohne diese Spanne waere der Merker
    // wieder weg, bevor er gebraucht wird.
    await new Promise((fertig) => setTimeout(fertig, 1500));
  });
};
