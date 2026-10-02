import { endgueltigAbgelehnt } from '../../utils/fehler';

/*
 * FESTE TEXTE je Status, nie der Text des Servers: Sie gehen auch an setError
 * und damit in die Fehlermessung, und die traegt nur Texte aus der
 * Positivliste hinaus (utils/bekannteFehlertexte.ts). Ein 413 kann ausserdem
 * vom Proxy vor dem Server kommen, dann ohne Text.
 *
 * Der Satz fuer 413 nennt bewusst keine Grenze: Der Chat nimmt 5 MB je Datei
 * an (createApp.js, chatUpload), eine Textdatei (TXT, CSV) nur 2 MB
 * (backend/utils/textDatei.js) -- beide kommen als 413. Die Grenzen stehen im
 * Handbuch ("Eine Datei mitschicken"). Der Satz fuer 415 ist derselbe wie der
 * des Servers fuer einen nicht erlaubten Typ (backend/utils/uploadTypen.js,
 * Regel "chat"); er passt auch auf die uebrigen 415 der Route (Typ nicht
 * verifizierbar, keine Textdatei, HTML oder Skript in der Textdatei).
 *
 * Ohne Abhaengigkeiten, damit die Nachrichtenblase ihn lesen kann, ohne die
 * Warteschlange mitzuladen.
 */
export const SENDEFEHLER_ZU_GROSS = 'Die Datei ist zu groß.';
export const SENDEFEHLER_DATEITYP = 'Dieser Dateityp kann nicht gesendet werden.';
export const SENDEFEHLER_ABGELEHNT = 'Die Nachricht wurde nicht angenommen.';

/**
 * Text zum Status einer endgueltigen Ablehnung -- oder null, wenn ein neuer
 * Versuch helfen kann (Netz, 408, 429, 5xx). Dann bleibt es beim bisherigen
 * "fehlgeschlagen" mit "Erneut senden".
 */
export function sendeFehlerText(status: number | undefined): string | null {
  if (!endgueltigAbgelehnt(status)) return null;
  if (status === 413) return SENDEFEHLER_ZU_GROSS;
  if (status === 415) return SENDEFEHLER_DATEITYP;
  return SENDEFEHLER_ABGELEHNT;
}
