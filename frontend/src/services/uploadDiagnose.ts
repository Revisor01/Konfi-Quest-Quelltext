/**
 * Wo ein Datei-Upload scheitert — für die anonyme Fehlermessung.
 *
 * Diese Stellen melden deshalb je einen `fehler` mit festem `ort` und der
 * groben Ursache als `art` (`netz`, `timeout`, `http-…`, `intern`). Kein
 * Dateiname, keine Größe, kein Typ — dieselben Regeln wie jede Fehlermeldung
 * Die Orte:
 *
 *   - `dateiauswahl-nicht-lesbar` / `-nicht-gefunden` / `-kein-zugriff` /
 *     `-lesefehler`: Das Dokument ließ sich direkt nach der Auswahl nicht in
 *     den Speicher lesen (services/systemDialoge.ts, imSpeicher). Der Name
 *     des Browser-Fehlers bestimmt, welcher der vier.
 *   - `chat-datei-direkt`: Der Versand einer Nachricht mit Datei scheiterte,
 *     ohne dass der Server sie abgelehnt hat (keine 4xx-Antwort).
 *   - `chat-datei-sichern`: Danach ließ sich die Datei nicht für die
 *     Warteschlange sichern — die Nachricht steht sofort mit „!“ da.
 *   - `chat-datei-warteschlange`: Die Warteschlange hat aufgegeben; sie lädt
 *     aus ihrer eigenen Kopie im Speicher hoch. Scheitert auch das, liegt es
 *     nicht an der gewählten Datei.
 *   - `material-dateien-hochladen` (über setError, MaterialFormModal).
 */
import { trackFehler, STELLE_ANDERE_MELDUNG } from './analytics';
import { fehlerArt } from '../utils/fehler';

export type UploadSchritt = 'chat-datei-direkt' | 'chat-datei-sichern';

/** Ort für ein Dokument, das sich nach der Auswahl nicht lesen ließ. */
export const leseFehlerOrt = (fehler: unknown): string => {
  const name = (fehler as { name?: unknown } | null)?.name;
  switch (name) {
    case 'NotReadableError':
      return 'dateiauswahl-nicht-lesbar';
    case 'NotFoundError':
      return 'dateiauswahl-nicht-gefunden';
    case 'SecurityError':
    case 'NotAllowedError':
      return 'dateiauswahl-kein-zugriff';
    default:
      return 'dateiauswahl-lesefehler';
  }
};

/** Das Dokument ließ sich nach der Auswahl nicht in den Speicher lesen. */
export const lesefehlerMelden = (fehler: unknown): void => {
  trackFehler(STELLE_ANDERE_MELDUNG, 'intern', leseFehlerOrt(fehler));
};

/** Ein Schritt beim Senden einer Chat-Nachricht mit Datei ist gescheitert. */
export const uploadFehlerMelden = (schritt: UploadSchritt, fehler: unknown): void => {
  trackFehler(STELLE_ANDERE_MELDUNG, fehlerArt(fehler), schritt);
};

/**
 * Die Warteschlange hat eine Chat-Nachricht mit Datei aufgegeben. Sie kennt
 * nur den Status (0 = keine Antwort).
 */
export const warteschlangenFehlerMelden = (status: number): void => {
  const art = status >= 100 && status <= 599 ? `http-${status}` : 'netz';
  trackFehler(STELLE_ANDERE_MELDUNG, art, 'chat-datei-warteschlange');
};
