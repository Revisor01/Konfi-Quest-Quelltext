import type { KeyboardEvent } from 'react';

/**
 * Enter im Feld löst die übergebene Aktion aus — die implizite Absendung,
 * die native <input>-Felder in einem <form> von sich aus haben.
 *
 * Ionic-Eingabefelder bekommen sie nicht: Das native <input> steckt im
 * Shadow-DOM von ion-input und gehört damit zu keinem <form> des Dokuments;
 * ion-input selbst behandelt Enter nicht (Ionic 9.0.3, ion-input.js: onKeydown
 * ruft nur checkClearOnEdit). Auf den Anmeldeseiten hieß das: Nach dem
 * Passwort zur Maus greifen.
 *
 * Während einer IME-Komposition (z. B. japanische Tastatur) bestätigt Enter
 * nur die Zeichenwahl — dann wird nichts abgeschickt.
 */
export const beiEnter = (aktion: () => void) => (ereignis: KeyboardEvent<HTMLElement>): void => {
  if (ereignis.key !== 'Enter' || ereignis.nativeEvent.isComposing) return;
  ereignis.preventDefault();
  aktion();
};

/**
 * Enter ODER Leertaste lösen die Aktion aus — das Tastaturverhalten eines
 * Knopfs, für Elemente mit role="button", die kein <button> sind (klickbare
 * Listenzeilen, Kacheln, Chips). Die Leertaste würde sonst die Seite
 * scrollen, deshalb preventDefault.
 *
 * Nur, wenn die Taste auf dem Element SELBST gedrückt wurde: Ein Knopf im
 * Inneren (etwa das Info-Symbol rechts in einer Zeile) behandelt seine
 * Tasten selbst; sein Enter darf nicht zusätzlich die Zeile auslösen.
 */
export const beiEnterOderLeertaste = (aktion: (ereignis: KeyboardEvent<HTMLElement>) => void) =>
  (ereignis: KeyboardEvent<HTMLElement>): void => {
    if (ereignis.target !== ereignis.currentTarget) return;
    if (ereignis.key !== 'Enter' && ereignis.key !== ' ') return;
    ereignis.preventDefault();
    aktion(ereignis);
  };

/**
 * Enter oder Leertaste klicken das Element — derselbe Weg wie Finger und
 * Maus, also derselbe onClick mit einem echten Klick-Ereignis (Popover
 * finden ihr Ziel über event.target). Ein onKeyDown für jedes
 * <div role="button" tabIndex={0} onClick=…>.
 */
export const tastaturKlick = beiEnterOderLeertaste((ereignis) => ereignis.currentTarget.click());
