import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

/**
 * Haptisches Feedback ist Beiwerk und darf NIE einen Ablauf abbrechen.
 *
 * Bei `openLink` war es noch stiller: Der Aufruf stand dort ausserhalb jedes
 * try — der Link ging gar nicht auf, ohne jede Meldung.
 *
 * Deshalb: Ein Geraet ohne Vibration ist der NORMALFALL, kein Fehler. Auf
 * Nicht-Native-Plattformen wird das Plugin erst gar nicht gerufen, damit auf
 * dem Rechner kein Fehler in der Konsole landet — sonst verrauscht er die
 * Fehlererfassung und echte Fehler gehen darin unter.
 *
 * Regel: `Haptics` wird NIRGENDS sonst importiert. Alle Aufrufstellen gehen
 * ueber `haptik()` (oder `triggerPullHaptic`).
 */
export const haptik = async (style: ImpactStyle = ImpactStyle.Light): Promise<void> => {
  // Web/Desktop: gar nicht erst versuchen. Der Aufruf wuerde nur werfen.
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Haptics.impact({ style });
  } catch {
    // Auch nativ kann die Vibration fehlen (Geraet ohne Motor, abgeschaltet).
  }
};

/** Haptisches Feedback beim Pull-to-Refresh. */
export const triggerPullHaptic = async (): Promise<void> => {
  await haptik(ImpactStyle.Light);
};

export { ImpactStyle };
