// Die Texte der Fortschrittsanzeige beim Laden und Senden von Dateien —
// EINMAL, für Chat und Challenges. Der Balken dazu ist
// components/shared/FortschrittsBalken.tsx.

/**
 * "Wird geladen… 40 %" — oder ohne Zahl, solange der Server keine Größe
 * meldet. Dann läuft die Anzeige unbestimmt statt auf einer geratenen Zahl.
 */
export const ladeText = (prozent: number | null | undefined): string =>
  prozent != null ? `Wird geladen… ${prozent} %` : 'Wird geladen…';

/**
 * "Wird gesendet… 40 %". Bei 100 % rechnet der Server noch (Bild umrechnen,
 * verschlüsseln) — ein Balken, der bei 100 stehenbleibt, sähe sonst aus wie
 * ein Hänger.
 */
export const sendeText = (prozent: number): string =>
  prozent >= 100 ? 'Wird verarbeitet…' : `Wird gesendet… ${prozent} %`;
