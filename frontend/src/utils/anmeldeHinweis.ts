/**
 * Warum die App zur Anmeldeseite zurueckschickt -- der Hinweis, den die
 * Anmeldeseite beim Oeffnen zeigt.
 *
 * Der Weg: services/api.ts erkennt die Sperre (sperrMeldungAus) und gibt die
 * Meldung im Ereignis 'auth:relogin-required' mit; App.tsx legt sie mit
 * anmeldeHinweisMerken im sessionStorage ab; LoginView holt sie mit
 * anmeldeHinweisAbholen genau einmal ab.
 */

/** Wie bisher: "Sitzung abgelaufen" ist ein Merker mit dem Wert '1'. */
const SITZUNG_ABGELAUFEN = 'session_expired';
const ZUGANG_GESPERRT = 'zugang_gesperrt';

export const SITZUNG_ABGELAUFEN_TEXT = 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.';
export const ZUGANG_GESPERRT_TEXT = 'Zugang gesperrt. Bitte wende dich an deine Gemeinde.';

/** Die drei Sperr-Codes von Anmeldung und Refresh. */
export const SPERR_CODES = ['user_inactive', 'org_inactive', 'org_trial_expired'];

/**
 * Die anzuzeigende Meldung, wenn der Fehler eine Zugangs-Sperre ist (403 mit
 * einem der drei Codes) -- sonst null.
 */
export function sperrMeldungAus(err: unknown): string | null {
  const antwort = (typeof err === 'object' && err !== null
    ? (err as { response?: { status?: number; data?: { error?: unknown; error_code?: unknown } } }).response
    : undefined);
  if (antwort?.status !== 403) return null;
  const code = antwort.data?.error_code;
  if (typeof code !== 'string' || !SPERR_CODES.includes(code)) return null;
  const text = antwort.data?.error;
  return typeof text === 'string' && text.trim() ? text : ZUGANG_GESPERRT_TEXT;
}

/** Merkt den Hinweis fuer die Anmeldeseite: die Sperr-Meldung oder "Sitzung abgelaufen". */
export function anmeldeHinweisMerken(sperrMeldung: string | null | undefined): void {
  try {
    if (sperrMeldung) {
      sessionStorage.removeItem(SITZUNG_ABGELAUFEN);
      sessionStorage.setItem(ZUGANG_GESPERRT, sperrMeldung);
    } else {
      sessionStorage.setItem(SITZUNG_ABGELAUFEN, '1');
    }
  } catch {
    // sessionStorage nicht verfuegbar -> Hinweis entfaellt, Login kommt trotzdem
  }
}

/** Holt den Hinweis genau einmal ab; null, wenn keiner vorliegt. */
export function anmeldeHinweisAbholen(): string | null {
  try {
    const gesperrt = sessionStorage.getItem(ZUGANG_GESPERRT);
    const abgelaufen = sessionStorage.getItem(SITZUNG_ABGELAUFEN);
    sessionStorage.removeItem(ZUGANG_GESPERRT);
    sessionStorage.removeItem(SITZUNG_ABGELAUFEN);
    if (gesperrt) return gesperrt;
    if (abgelaufen === '1') return SITZUNG_ABGELAUFEN_TEXT;
    return null;
  } catch {
    return null;
  }
}
