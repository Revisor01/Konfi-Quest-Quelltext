import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { getDeviceId, setDeviceId } from './tokenStore';

/**
 * Die App schickt sie bei Anmeldung, Registrierung, Biometrie-Anmeldung und
 * jedem Refresh als `device_id` mit. Ein gebundenes Token gilt nur mit
 * DERSELBEN Kennung -- eine andere oder fehlende heisst 401 und Widerruf.
 * Deshalb muss die Kennung stabil sein, und deshalb gilt:
 *
 * - Auf dem Geraet zaehlt, was das Betriebssystem liefert (`Device.getId()`:
 *   iOS identifierForVendor, Android ANDROID_ID) -- nicht die gespeicherte
 *   Kopie. Wer die Preferences samt Refresh-Token aus einer Sicherung auf ein
 *   anderes Geraet holt, hat dort eine andere Kennung, und das Token gilt
 *   nicht. Die gespeicherte Kopie wird nachgezogen (dieselbe Regel wie die
 *   Push-Registrierung in AppContext, die sie ebenfalls ueberschreibt).
 * - Liefert das Betriebssystem keine (iOS nach dem Neustart vor dem ersten
 *   Entsperren), gilt die gespeicherte Kopie; gibt es keine, wird einmal eine
 *   erzeugt und gespeichert -- wie in AppContext.
 * - Im Browser gibt es nur die gespeicherte, einmal erzeugte Kennung.
 * - Nie werfen: Ohne Kennung (null) laeuft die Anfrage ohne `device_id`. Eine
 *   Kennung, die sich nicht speichern liess, wird NICHT verwendet -- sonst
 *   hinge das Token an einem Wert, den die App beim naechsten Mal nicht mehr
 *   kennt.
 */
export async function geraeteKennung(): Promise<string | null> {
  try {
    if (Capacitor.isNativePlatform()) {
      try {
        const { identifier } = await Device.getId();
        if (identifier) {
          // Die Kennung des Betriebssystems ist auch ohne gespeicherte Kopie
          // beim naechsten Mal dieselbe -- ein Speicherfehler schadet hier nicht.
          if (getDeviceId() !== identifier) {
            try {
              await setDeviceId(identifier);
            } catch {
              // siehe oben
            }
          }
          return identifier;
        }
      } catch {
        // Kennung des Betriebssystems gerade nicht lesbar -- gespeicherte nehmen.
      }
    }
    const gespeichert = getDeviceId();
    if (gespeichert) return gespeichert;
    const neu = `${Capacitor.getPlatform()}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    await setDeviceId(neu);
    return neu;
  } catch {
    return null;
  }
}
