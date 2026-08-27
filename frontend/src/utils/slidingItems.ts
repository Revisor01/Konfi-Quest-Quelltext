/**
 * Offene Wisch-Aktionen (IonItemSliding) schliessen.
 *
 * Problem (User-Hinweis 11.08.): Wischt man ein Listen-Element auf und tippt
 * dann eine der Aktionen an, bleibt das Element offen zurück — die Aktion
 * läuft, aber die halb weggeschobene Zeile steht weiter da. Das betraf
 * praktisch alle Listen der App; nur zwei Views hatten sich dafuer eigene
 * Refs gebaut (UsersView, OrganizationView).
 *
 * Statt in jeder Liste Refs auf jedes Element zu halten, greifen wir das
 * tatsaechlich geoeffnete Element direkt im DOM ab: Ionic hängt ihm die
 * Klasse `item-sliding-active-options-end` (bzw. `-start`) an. Dessen
 * `closeOpened()` schließt es.
 *
 * Bewusst tolerant: Gibt es nichts Offenes, passiert nichts. Fehler werden
 * verschluckt — ein nicht geschlossenes Sliding darf nie eine Aktion
 * verhindern.
 */
export async function closeOpenSlidingItems(): Promise<void> {
  try {
    const offene = document.querySelectorAll<HTMLIonItemSlidingElement>(
      'ion-item-sliding.item-sliding-active-options-end, ion-item-sliding.item-sliding-active-options-start'
    );
    await Promise.all(
      Array.from(offene).map((el) => el.closeOpened?.().catch(() => undefined))
    );
  } catch {
    /* Schliessen ist Kosmetik — nie die eigentliche Aktion blockieren. */
  }
}
