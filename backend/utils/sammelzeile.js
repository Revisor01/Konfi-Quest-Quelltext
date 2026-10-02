// Eine Sammelzeile schreibt hoechstens EINE Zeile je Fenster (15 Minuten),
// mit der Anzahl je Grund, der haeufigste zuerst:
//
//   Socket.io Engine connection_error (15 Min): 3 Bad request ×37, 1 Session ID unknown ×2
//
// Nichts geht verloren: jeder Fall wird gezaehlt, ein ruhiges Fenster
// schreibt nichts, und der Shutdown schreibt den angefangenen Stand aus
// (sammelzeilenAusgeben in server.js). Fuer Fehler, die einzeln gebraucht
// werden, ist das nichts -- die bleiben Einzelzeilen.

const FENSTER_MS = 15 * 60 * 1000;

const alle = new Set();

class Sammelzeile {
  /**
   * @param {string} bezeichnung  Anfang der Zeile, wie bisher die Einzelzeile
   * @param {object} [optionen]
   * @param {number} [optionen.fensterMs]
   * @param {(zeile: string) => void} [optionen.ausgabe]  Standard: console.warn
   */
  constructor(bezeichnung, { fensterMs = FENSTER_MS, ausgabe = (zeile) => console.warn(zeile) } = {}) {
    this.bezeichnung = bezeichnung;
    this.fensterMs = fensterMs;
    this.ausgabe = ausgabe;
    this.zaehler = new Map();
    this.takt = null;
    alle.add(this);
  }

  zaehle(grund) {
    const schluessel = String(grund);
    this.zaehler.set(schluessel, (this.zaehler.get(schluessel) || 0) + 1);
    // Der Takt beginnt mit dem ersten Fall -- ohne Fall haelt nichts den
    // Prozess (und keinen Test) offen. unref: er haelt ihn auch sonst nicht.
    if (!this.takt) {
      this.takt = setInterval(() => this.ausgeben(), this.fensterMs);
      if (typeof this.takt.unref === 'function') this.takt.unref();
    }
  }

  /** Schreibt den Stand des Fensters (falls es einen gibt) und beginnt neu. */
  ausgeben() {
    if (this.zaehler.size === 0) return null;
    const teile = [...this.zaehler.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([grund, n]) => `${grund} ×${n}`);
    this.zaehler.clear();
    const minuten = Math.round(this.fensterMs / 60000);
    const zeile = `${this.bezeichnung} (${minuten} Min): ${teile.join(', ')}`;
    this.ausgabe(zeile);
    return zeile;
  }

  /** Takt anhalten und den angefangenen Stand ausschreiben. */
  stopp() {
    if (this.takt) {
      clearInterval(this.takt);
      this.takt = null;
    }
    this.ausgeben();
  }
}

/** Beim Herunterfahren: alle angefangenen Sammelzeilen ausschreiben. */
function sammelzeilenAusgeben() {
  for (const s of alle) s.stopp();
}

module.exports = { Sammelzeile, FENSTER_MS, sammelzeilenAusgeben };
