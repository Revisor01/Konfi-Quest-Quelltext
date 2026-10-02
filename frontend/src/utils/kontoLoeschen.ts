// Was die Rueckfragen vor dem Loeschen eines Kontos sagen.
//
// Ausfuehrlich steht es im Handbuch unter "Ein Konto löschen".

/** Was mit dem Konto verschwindet -- fuer jede Rolle dieselbe Aufzaehlung. */
export const KONTO_WEG =
  'Punkte, Badges, Stempel, Anträge samt Fotos, Event-Anmeldungen, Challenge-Beiträge, '
  + 'Chat-Nachrichten und Zweiergespräche';

/** Was bleibt, wenn eine Person aus Team oder Leitung geht. */
export const GEMEINDE_BEHAELT =
  'Was die Person für die Gemeinde angelegt hat — Events, Material, Badges, Challenges —, bleibt ohne ihren Namen.';

const NICHT_RUECKGAENGIG = 'Das lässt sich nicht rückgängig machen.';

/** Rueckfrage der Leitung vor DELETE /admin/konfis/:id. */
export function konfiLoeschHinweis(name: string): string {
  return [
    `"${name}" wird unwiderruflich gelöscht.`,
    `Mit dem Konto verschwinden ${KONTO_WEG}. Auf frei werdende Plätze bei Events rückt die Warteliste nach. ${NICHT_RUECKGAENGIG}`,
  ].join('\n\n');
}

/**
 * Rueckfrage vor DELETE /users/:id fuer eine Person aus Team oder Leitung,
 * die nur dieser Gemeinde angehoert (das Konto geht).
 */
export function teamKontoLoeschHinweis(): string {
  return `Mit dem Konto verschwindet alles, was zur Person gehört: ${KONTO_WEG}, auch aus einer früheren Konfi-Zeit. ${GEMEINDE_BEHAELT} ${NICHT_RUECKGAENGIG}`;
}

/** Warnung im Profil vor POST /auth/delete-account (jede Rolle). */
export function eigenesKontoLoeschHinweis(istKonfi: boolean): string {
  if (istKonfi) {
    return 'Dein Account wird endgültig gelöscht. Dieser Vorgang kann NICHT rückgängig gemacht werden. '
      + `Mit ihm verschwinden deine ${KONTO_WEG}.`;
  }
  return 'Dein Account wird endgültig gelöscht, in allen Gemeinden, in denen du mitarbeitest. '
    + 'Dieser Vorgang kann NICHT rückgängig gemacht werden. '
    + `Mit ihm verschwinden deine ${KONTO_WEG}. Was du für die Gemeinde angelegt hast, bleibt ohne deinen Namen.`;
}
