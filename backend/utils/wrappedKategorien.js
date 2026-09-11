// wrappedKategorien.js -- welche Kategorie-Seite ein Termin ausloest.
//
// Und sein Nachtrag, der der bessere Weg ist:
//   "Gottesdienst im Dezember ist ja immer auch Advent/Weihnachten.
//    Und Neujahr koennen wir auch uebers Datum machen."
//
// VORRANG: Trifft beides zu (Kategorie UND Datum), gewinnt das Datum -- es
// ist das konkretere Ereignis. Eine Person bekommt nie zwei Seiten ueber
// denselben Termin.

// ---------------------------------------------------------------------------
// Bewegliche Feiertage -- berechnet, NICHT hartkodiert
// ---------------------------------------------------------------------------

/**
 * Ostersonntag nach der Gaussschen Osterformel (gregorianisch).
 *
 * Bewusst gerechnet statt als Jahrestabelle gepflegt: Eine Tabelle laeuft
 * irgendwann ab, und der Rueckblick soll auch 2031 noch stimmen, ohne dass
 * jemand daran denkt.
 *
 * @param {number} jahr
 * @returns {Date} Ostersonntag, lokale Mitternacht
 */
function ostersonntag(jahr) {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31); // 3 = Maerz, 4 = April
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(jahr, monat - 1, tag);
}

/**
 * Der 1. Advent: der vierte Sonntag vor dem 25.12.
 *
 * Gerechnet statt geraten -- er wandert zwischen dem 27.11. und dem 3.12.
 */
function ersterAdvent(jahr) {
  const weihnachten = new Date(jahr, 11, 25);
  // Zum 4. Advent (letzter Sonntag vor/am 24.12.) zurueck, dann 3 Wochen.
  const tagVorWeihnachten = weihnachten.getDay(); // 0 = Sonntag
  const vierterAdvent = new Date(jahr, 11, 25 - (tagVorWeihnachten === 0 ? 7 : tagVorWeihnachten));
  return new Date(vierterAdvent.getFullYear(), vierterAdvent.getMonth(), vierterAdvent.getDate() - 21);
}

/** Aschermittwoch: 46 Tage vor Ostern. */
function aschermittwoch(jahr) {
  const o = ostersonntag(jahr);
  return new Date(o.getFullYear(), o.getMonth(), o.getDate() - 46);
}

/** Erster Sonntag im Oktober (Erntedank). */
function erntedank(jahr) {
  const d = new Date(jahr, 9, 1);
  const versatz = (7 - d.getDay()) % 7;
  return new Date(jahr, 9, 1 + versatz);
}

/** Datum ohne Uhrzeit vergleichen -- sonst kippt ein Termin um 20 Uhr raus. */
function nurTag(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

/**
 * Welches Zeitfenster trifft dieses Datum?
 *
 * Reihenfolge ist Absicht: Weihnachten vor Advent, sonst schluckte das
 * Advent-Fenster den 24.12.
 *
 * @param {Date|string} datum
 * @returns {string|null} Schluessel der Datums-Seite oder null
 */
function datumsFenster(datum) {
  if (!datum) return null;
  const d = nurTag(datum);
  if (isNaN(d.getTime())) return null;
  const jahr = d.getFullYear();

  const weihnachtenVon = new Date(jahr, 11, 24);
  const weihnachtenBis = new Date(jahr, 11, 26);
  if (d >= weihnachtenVon && d <= weihnachtenBis) return 'weihnachten';

  const adventVon = ersterAdvent(jahr);
  const adventBis = new Date(jahr, 11, 23);
  if (d >= adventVon && d <= adventBis) return 'advent';

  // Jahreswechsel laeuft ueber den Jahresbruch: 27.12. bis 6.1.
  if ((d.getMonth() === 11 && d.getDate() >= 27) ||
      (d.getMonth() === 0 && d.getDate() <= 6)) return 'jahreswechsel';

  const ostern = ostersonntag(jahr);
  const passionVon = aschermittwoch(jahr);
  const osterMontag = new Date(ostern.getFullYear(), ostern.getMonth(), ostern.getDate() + 1);
  if (d >= passionVon && d <= osterMontag) return 'ostern';

  const ed = erntedank(jahr);
  if (d.getTime() === ed.getTime()) return 'erntedank';

  if (d.getMonth() === 6 || d.getMonth() === 7) return 'sommer';

  return null;
}

// ---------------------------------------------------------------------------
// Kategorie-Erkennung ueber den Namen
// ---------------------------------------------------------------------------

/**
 * UNSER VOKABULAR -- die acht Standardkategorien der App.
 *
 * WARUM DAS DER RICHTIGE WEG IST: Der erste Versuch sammelte die frei
 * getippten Namen aus allen fuenf Organisationen ein und riet, auf welche
 * Seite sie gehoeren ("Sonntag" -> Gottesdienst, "Gruppen/ Treffen" ->
 * Jugend). Das ist Woerterbuchpflege ohne Ende: Jede neue Gemeinde erfindet
 * neue Namen, und wir haengen hinterher. Schlimmer noch -- wir haetten fuer
 * das Vokabular fremder Gemeinden Seiten gebaut, die wir selbst nie so
 * genannt haetten.
 *
 * Stattdessen haengen die Seiten an den Standardkategorien, die die App bei
 * jeder neuen Gemeinde selbst anlegt (routes/organizations.js,
 * defaultCategories). Wer sie behaelt, bekommt die Seiten. Wer eigene Namen
 * vergibt, faellt auf die allgemeine Schwerpunkt-Seite ("Deine haeufigste
 * Kategorie: Kreativ") -- niemand geht leer aus, aber wir erfinden auch
 * keine Seite fuer fremdes Vokabular.
 *
 * DIESE LISTE MUSS ZU defaultCategories IN routes/organizations.js PASSEN.
 * Ein Test haelt beide zusammen (wrappedKategorien.test.js).
 *
 * Toleriert wird nur Normalisierung derselben Begriffe: Gross-/Klein-
 * schreibung, Bindestrich, Randleerzeichen. Das ist keine Fremdwort-
 * Erkennung.
 */
const STANDARD_SEITEN = {
  fest: 'Fest',
  senioren: 'Senior:innen',
  jugend: 'Jugend',
  oeffentlichkeit: '\u00d6ffentlichkeitsarbeit',
  freizeit: 'Freizeit',
  weihnachten: 'Weihnachten',
  konzert: 'Konzert',
  kinder: 'Kinder',
  kreativ: 'Kreativ',
  seelsorge: 'Seelsorge',
  kasualien: 'Kasualien',
  gottesdienst: 'Gottesdienst',
  // Gemeinde ebenfalls. Damit tragen alle
  // Standardkategorien eine eigene Seite -- die Unterscheidung
  // "Kategorie, aber keine Seite" gibt es nicht mehr.
  gemeinde: 'Gemeinde',
  // Teamer-Seite: erscheint nur im Teamer-Rueckblick.
  teamtreff: 'Teamtreff'
};


const NUR_TEAMER = new Set(['teamtreff']);

/**
 * =====================================================================
 * DIE SONDERSEITE ZUR SOMMERFREIZEIT -- HIER STEHT ALLES DARUEBER
 * =====================================================================
 *
 * DREI BEDINGUNGEN MUESSEN ALLE ZUTREFFEN, damit jemand die Seite sieht:
 *   1. Die Person gehoert zu einer der Organisationen in SOMMERFREIZEIT.orgs.
 *   2. Sie hat eine Aktivitaet oder einen Termin der Kategorie
 *      "Sommerfreizeit" (SOMMERFREIZEIT.kategorie).
 *   3. Dieser liegt im Fenster von / bis -- sonst loeste die Fahrt des
 *      naechsten Jahres dieselbe Seite noch einmal aus.
 *
 * SO WIRD DARAUS NAECHSTES JAHR ITALIEN -- alles an dieser einen Stelle:
 *   - `orgs`      welche Gemeinden fahren mit
 *   - `kategorie` wie die Kategorie in der App heisst
 *   - `von`/`bis` das Zeitfenster der Fahrt
 *   - `seite`     der Schluessel der Seite (steht in beiden Dramaturgien
 *                 in wrappedKacheln.js und im Frontend als Renderer)
 * Titel, Text und Bild der Seite selbst liegen im Frontend
 * (components/wrapped/slides/...) -- der Schluessel `seite` verbindet beides.
 *
 * DAS FENSTER ist bewusst grosszuegig um die eigentlichen 14 Tage gelegt:
 * Vor- und Nachtreffen gehoeren zur Fahrt, und wann genau jemand die
 * Aktivitaet eingetragen bekommt, haengt daran, wann die Leitung dazu kommt.
 */
const SOMMERFREIZEIT = {
  /**
   * Alle anderen Gemeinden bleiben org-uebergreifend generisch: Sie
   * bekommen die allgemeinen Seiten, nie diese.
   */
  orgs: [1, 2],
  /** Der Kategoriename, unter dem die Fahrt eingetragen ist. */
  kategorie: 'sommerfreizeit',
  /** Das Fenster der Fahrt. */
  von: '2026-06-01',
  bis: '2026-09-30',
  /** Der Schluessel der Seite in Dramaturgie und Frontend. */
  seite: 'stavanger-2026'
};

/**
 * Darf diese Organisation die Sommerfreizeit-Seite ueberhaupt sehen?
 *
 * @param {number} orgId
 * @returns {boolean}
 */
function orgHatSommerfreizeit(orgId) {
  return SOMMERFREIZEIT.orgs.includes(Number(orgId));
}

/**
 * Traegt dieser Kategoriename die Sommerfreizeit?
 *
 * NICHT in STANDARD_SEITEN aufgenommen: Diese Liste muss zu
 * defaultCategories in routes/organizations.js passen (ein Test haelt beide
 * zusammen), und "Sommerfreizeit" soll NICHT bei jeder neuen Gemeinde
 * angelegt werden. Es ist eine Sonderseite fuer eine einzelne Fahrt, kein
 * Standardvokabular.
 */
function istSommerfreizeit(name) {
  if (!name || typeof name !== 'string') return false;
  return normalisiere(name) === SOMMERFREIZEIT.kategorie;
}

// ALT-NAMEN, damit bestehender Code und Tests weiterlaufen. Die Werte
// stehen jetzt in SOMMERFREIZEIT (siehe oben) -- hier nur noch die Ausgabe.
const STAVANGER_VON = SOMMERFREIZEIT.von;
const STAVANGER_BIS = SOMMERFREIZEIT.bis;


/** Vergleichsform: klein, Bindestrich wie Leerzeichen, ohne Raender. */
function normalisiere(s) {
  return String(s).trim().toLowerCase().replace(/[-\s]+/g, ' ');
}

/**
 * Ordnet einen Kategorienamen einer festen Seite zu -- NUR wenn er einer
 * unserer acht Standardkategorien entspricht.
 *
 * Alles andere gibt null. Das ist Absicht und kein Loch: Der Aufrufer
 * sammelt diese Faelle in der allgemeinen Seite "Deine haeufigste
 * Kategorie: ...".
 *
 * @param {string} name
 * @returns {string|null} Seiten-Schluessel oder null
 */
function seiteFuerKategorie(name) {
  if (!name || typeof name !== 'string') return null;
  const n = normalisiere(name);
  if (!n) return null;
  for (const [schluessel, anzeige] of Object.entries(STANDARD_SEITEN)) {
    if (n === normalisiere(anzeige) || n === normalisiere(schluessel)) return schluessel;
  }
  return null;
}

module.exports = {
  ostersonntag,
  ersterAdvent,
  aschermittwoch,
  erntedank,
  datumsFenster,
  seiteFuerKategorie,
  istSommerfreizeit,
  orgHatSommerfreizeit,
  SOMMERFREIZEIT,
  STAVANGER_VON,
  STAVANGER_BIS,
  STANDARD_SEITEN,
  NUR_TEAMER
};
