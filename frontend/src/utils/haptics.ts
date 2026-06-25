import { Haptics, ImpactStyle } from '@capacitor/haptics';

/**
 * Haptisches Feedback beim Pull-to-Refresh auslösen.
 * Schlägt auf Web/Desktop still fehl.
 */
export const triggerPullHaptic = async (): Promise<void> => {
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Haptik nicht verfügbar (z.B. Web-Browser)
  }
};
