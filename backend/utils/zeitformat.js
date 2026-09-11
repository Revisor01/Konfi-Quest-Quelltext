/**
 * Datums- und Uhrzeitformatierung in Berliner Zeit.
 *
 * Die Container-Zeitzone ist inzwischen gesetzt -- aber sie ist die falsche
 * Stelle, sich darauf zu verlassen. Sie ging beim letzten Umzug schon einmal
 * verloren, und beim naechsten geht sie wieder verloren. Deshalb tragen die
 * Formatierer ihre Zone hier selbst, und die Variable im Stack ist nur noch
 * der Guertel zum Hosentraeger.
 *
 * Wer eine Uhrzeit oder ein Datum fuer MENSCHEN formatiert, nimmt eine
 * Funktion aus dieser Datei -- kein blankes toLocale* mehr.
 */

const ZONE = 'Europe/Berlin';

/** Zeitzone, in der die App fuer Nutzer:innen rechnet und anzeigt. */
const BERLIN = ZONE;

/**
 * Uhrzeit als "14:05".
 * @param {Date|string|number} wert
 * @param {object} [optionen] zusaetzliche Intl-Optionen
 */
function formatUhrzeit(wert, optionen = {}) {
  return new Date(wert).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ZONE,
    ...optionen
  });
}

function formatDatum(wert, optionen = {}) {
  return new Date(wert).toLocaleDateString('de-DE', {
    timeZone: ZONE,
    ...optionen
  });
}

/**
 * ERSATZ FUER `new Date().toISOString().split('T')[0]`. Das lieferte IMMER den
 * UTC-Tag -- zwischen 00:00 und 02:00 Berliner Zeit also den Vortag. Punkte,
 * die eine Leitung um 00:30 verbucht hat, trugen dadurch das Datum von
 * gestern, und die Tageslosung wechselte erst um 02:00 statt um Mitternacht.
 *
 * `sv-SE` ist hier kein Zufall und keine Spielerei: Das schwedische
 * Gebietsschema formatiert Daten von Haus aus als ISO (JJJJ-MM-TT), womit sich
 * der Tag samt Zeitzonenumrechnung in einem Schritt ergibt.
 *
 * @param {Date|string|number} [wert] Zeitpunkt; ohne Angabe: jetzt
 * @returns {string} Datum im Format JJJJ-MM-TT
 */
function heuteBerlin(wert = new Date()) {
  return new Date(wert).toLocaleDateString('sv-SE', { timeZone: ZONE });
}

module.exports = { BERLIN, formatUhrzeit, formatDatum, heuteBerlin };
