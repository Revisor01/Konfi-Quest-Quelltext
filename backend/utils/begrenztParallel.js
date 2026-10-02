// backend/utils/begrenztParallel.js
//
// Promise.allSettled mit Obergrenze fuer gleichzeitig laufende Aufgaben.
//
// ANLASS: Die Konfi-Rueckblick-Erzeugung
// startete fuer JEDEN Konfi eines Jahrgangs gleichzeitig eine Kette mit
// eigenem Pool-Client. Bei 58 Konfis und einem Pool von 20 war der Pool die
// ganze Zeit voll (gesamt 20, frei 0, wartend 20); ein gleichzeitiger
// Dashboard-Aufruf brauchte 754 ms statt 17 ms, und auf der Produktions-
// Datenbank liefen die wartenden Ketten UND alle API-Anfragen dieser Replica
// in den 5-s-Verbindungs-Timeout.
//
// Diese Funktion arbeitet die Liste mit hoechstens `grenze` Arbeitern ab.
// Ergebnisform wie Promise.allSettled ({status, value} bzw. {status, reason}),
// in der Reihenfolge der Eingabe -- ein Aufrufer, der bisher allSettled
// nutzte, tauscht nur den Aufruf.
//
// Kein zusaetzliches Paket (p-limit o. Ae.): 25 Zeilen, keine Abhaengigkeit,
// die der Proxy verweigern koennte.

/**
 * @template T, R
 * @param {T[]} elemente
 * @param {number} grenze  hoechstens so viele Aufgaben gleichzeitig (>= 1)
 * @param {(element: T, index: number) => Promise<R>} aufgabe
 * @returns {Promise<Array<{status: 'fulfilled', value: R} | {status: 'rejected', reason: any}>>}
 */
async function begrenztParallel(elemente, grenze, aufgabe) {
  const anzahl = elemente.length;
  const ergebnisse = new Array(anzahl);
  let naechster = 0;

  const arbeiter = async () => {
    for (;;) {
      const i = naechster++;
      if (i >= anzahl) return;
      try {
        ergebnisse[i] = { status: 'fulfilled', value: await aufgabe(elemente[i], i) };
      } catch (reason) {
        ergebnisse[i] = { status: 'rejected', reason };
      }
    }
  };

  const arbeiterZahl = Math.max(1, Math.min(Math.floor(grenze) || 1, anzahl));
  await Promise.all(Array.from({ length: arbeiterZahl }, arbeiter));
  return ergebnisse;
}

module.exports = { begrenztParallel };
