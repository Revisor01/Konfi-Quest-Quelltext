// Stilles Scheitern verhindern: 30+ Aktionen
// prüften `if (!isOnline) return;` — der Tipp auf "Löschen", "Absagen" usw.
// verpuffte offline ohne jede Rückmeldung. Diese Aktionen bleiben bewusst
// online-pflichtig statt queue-fähig: Sie sind destruktiv (Löschen von
// Konfis, Chats, Events) oder brauchen eine sofortige Server-Antwort
// (Einladungscode, Passwort, Chat anlegen) — ein Nachversand Stunden später
// wäre riskant bis irreführend. Statt stillem Nichtstun gibt es eine Meldung.
// Der Test keinStillesOfflineScheitern.test.ts wacht darüber, dass das alte
// Muster nicht zurückkehrt.

export const OFFLINE_AKTION_MELDUNG =
  'Das geht nur mit Internetverbindung. Bitte versuche es später noch einmal.';

/**
 * Ersatz für das stumme `if (!isOnline) return;`:
 * offline -> Meldung zeigen und true (Aufrufer bricht ab),
 * online -> false (Aktion läuft normal weiter).
 */
export function offlineBlockiert(
  isOnline: boolean,
  setError: (msg: string) => void
): boolean {
  if (isOnline) return false;
  setError(OFFLINE_AKTION_MELDUNG);
  return true;
}
