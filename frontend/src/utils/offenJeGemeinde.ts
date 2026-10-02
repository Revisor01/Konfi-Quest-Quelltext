/**
 * Was je Gemeinde offen ist -- die Antwort von
 * GET /notifications/badge-counts/je-organisation gelesen.
 *
 * Zwei Leser: der Gemeinde-Umschalter (rote Zahl je Eintrag) und das
 * App-Symbol bei mehreren Gemeinden (BadgeContext). Beide lesen hier, damit
 * Zahl am Eintrag und Zahl am Symbol nach derselben Regel entstehen.
 */

/**
 * Nur Gemeinden mit einer Zahl groesser 0 bleiben stehen -- "nichts offen"
 * heisst: kein Eintrag, keine Zahl. Aeltere Server ohne die Route oder ohne
 * das Feld ergeben ein leeres Objekt, kein Fehler.
 */
export const offenJeOrgAusAntwort = (data: unknown): Record<number, number> => {
  const ergebnis: Record<number, number> = {};
  const roh = (data as { jeOrganisation?: unknown } | null | undefined)?.jeOrganisation;
  if (!roh || typeof roh !== 'object') return ergebnis;
  Object.entries(roh as Record<string, unknown>).forEach(([orgId, eintrag]) => {
    const offen = Number((eintrag as { offen?: unknown } | null | undefined)?.offen) || 0;
    const id = Number(orgId);
    if (offen > 0 && Number.isFinite(id)) ergebnis[id] = offen;
  });
  return ergebnis;
};

/**
 * null, wenn die Antwort das Feld nicht traegt (aelterer Server): Dann bleibt
 * das Symbol bei der Summe der aktiven Gemeinde, wie bisher -- lieber die
 * alte Zahl als eine 0, die "nichts offen" behauptet.
 */
export const summeAllerGemeindenAusAntwort = (data: unknown): number | null => {
  const roh = (data as { jeOrganisation?: unknown } | null | undefined)?.jeOrganisation;
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return null;
  return Object.values(offenJeOrgAusAntwort(data)).reduce((summe, n) => summe + n, 0);
};
