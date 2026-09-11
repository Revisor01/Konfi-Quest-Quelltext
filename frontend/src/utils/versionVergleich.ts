// versionVergleich.ts — semantischer Vergleich zweier Versionsstrings fuer
// den Store-Update-Hinweis (services/updateCheck.ts).
//
// Warum eine eigene Funktion statt String-Vergleich: "2.10.0" > "2.9.0" ist
// als String FALSCH ("1" < "9"), semantisch aber richtig. Genau dieser Fall
// wuerde den Update-Hinweis ab Version 2.10 dauerhaft stummschalten.
// Bewusst KEINE Bibliothek (semver waere 30 kB fuer drei Zahlen) und kein
// Support fuer Prerelease-Suffixe ("2.1.0-beta") — die Stores nehmen ohnehin
// nur x.y(.z) an (siehe scripts/apply-version.sh).

/**
 * Vergleicht zwei Versionsstrings der Form x.y(.z...) segmentweise.
 * Fehlende Segmente zaehlen als 0 ("2.1" === "2.1.0").
 *
 * @returns -1 wenn a < b, 0 wenn gleich, 1 wenn a > b
 */
export function vergleicheVersionen(a: string, b: string): number {
  const teileA = a.trim().split('.');
  const teileB = b.trim().split('.');
  const laenge = Math.max(teileA.length, teileB.length);
  for (let i = 0; i < laenge; i++) {
    // Fehlendes Segment = 0; kaputtes Segment ebenfalls 0, damit die
    // Funktion nie NaN-Vergleiche macht (NaN > x ist immer false und
    // wuerde still falsche Ergebnisse liefern).
    const zahlA = parseInt(teileA[i] ?? '0', 10) || 0;
    const zahlB = parseInt(teileB[i] ?? '0', 10) || 0;
    if (zahlA > zahlB) return 1;
    if (zahlA < zahlB) return -1;
  }
  return 0;
}

// Nur Strings dieser Form werden ueberhaupt verglichen. Alles andere
// (leer, null vom Server, unerwartete Strings) fuehrt zu "kein Hinweis" —
// ein Update-Hinweis auf Basis von Datenmuell waere schlimmer als keiner.
const VERSIONS_FORM = /^[0-9]+(\.[0-9]+)*$/;

/**
 * true, wenn die Store-Version echt neuer ist als die installierte.
 * Defensive Eingabe: unplausible oder fehlende Werte ergeben false.
 */
export function istNeuereVersion(
  storeVersion: string | null | undefined,
  installierteVersion: string | null | undefined
): boolean {
  if (!storeVersion || !installierteVersion) return false;
  if (!VERSIONS_FORM.test(storeVersion.trim()) || !VERSIONS_FORM.test(installierteVersion.trim())) {
    return false;
  }
  return vergleicheVersionen(storeVersion, installierteVersion) > 0;
}
