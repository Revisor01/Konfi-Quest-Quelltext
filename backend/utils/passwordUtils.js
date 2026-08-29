// Utility functions for password generation
const crypto = require('crypto');
const { VERSE_PRO_KAPITEL } = require('./bibelVerszaehlung');

// Kuerzestes zulaessiges Passwort (validatePassword weiter unten).
const MIN_LAENGE = 8;

// Alle Stellen einmal flach ausgelegt, damit gleichverteilt gezogen werden
// kann.
//
// Der naheliegende Weg — erst ein Buch aus 66, dann ein Kapitel, dann ein
// Vers — waere stark schief: Obadja hat ein einziges Kapitel mit 21 Versen,
// Psalm 150 Kapitel mit zusammen 2461. Bei buchweiser Ziehung ist eine
// bestimmte Obadja-Stelle deshalb rund 500-mal wahrscheinlicher als ein
// bestimmter Psalmvers. Gemessen schrumpft die Vielfalt damit von 31168
// Stellen auf effektiv 6144 — fuer Passwoerter ein spuerbarer Unterschied.
//
// Die Liste wird einmal beim Laden aufgebaut (rund 31000 kurze Zeichenketten)
// und danach nur noch gelesen.
const ALLE_STELLEN = [];
for (const buch of Object.keys(VERSE_PRO_KAPITEL)) {
  const kapitelListe = VERSE_PRO_KAPITEL[buch];
  for (let kapitel = 1; kapitel <= kapitelListe.length; kapitel++) {
    for (let vers = 1; vers <= kapitelListe[kapitel - 1]; vers++) {
      const stelle = `${buch}${kapitel},${vers}`;
      // Zu kurze Stellen kommen gar nicht erst in den Topf: Sechs kurze
      // Buecher (Jona, Rut, Joel, Amos, Esra, Hiob) koennen Passwoerter unter
      // acht Zeichen ergeben ("Rut1,1"), die validatePassword spaeter selbst
      // ablehnen wuerde.
      if (stelle.length >= MIN_LAENGE) ALLE_STELLEN.push(stelle);
    }
  }
}

/**
 * Erzeugt ein Passwort aus einer Bibelstelle, die es wirklich gibt.
 *
 * Drei weitere Fehler der alten Liste sind damit weg:
 *   - "Johannes" stand ZWEIMAL drin (Evangelium und Brief) und hatte dadurch
 *     die doppelte Wahrscheinlichkeit.
 *   - Buecher mit Ordnungszahl fehlten oder waren verstuemmelt ("Samuel",
 *     "Koenige", "Chronik" ohne 1./2.).
 *   - Sechs kurze Buecher konnten Passwoerter unter acht Zeichen erzeugen
 *     ("Rut1,1" hat sechs) und verletzten damit die eigene Policy. Solche
 *     Stellen werden jetzt verworfen und neu gezogen.
 *
 * Die Buchnamen sind ohne Punkt und Leerzeichen ("1Korinther"), weil
 * validatePassword keine Leerzeichen zulaesst: iOS-Tastaturen fuegen beim
 * Abtippen sichtbarer Passwoerter gern welche ein und brechen den Login.
 */
const generateBiblicalPassword = () => {
  return ALLE_STELLEN[crypto.randomInt(ALLE_STELLEN.length)];
};

const validatePassword = (password) => {
  if (password.length < 8) {
    return 'Passwort muss mindestens 8 Zeichen lang sein';
  }
  // Leerzeichen (inkl. Tab/Umbruch) sind nicht erlaubt: iOS-Tastaturen fuegen
  // beim Tippen sichtbarer Passwoerter gerne Leerzeichen/Smart-Punctuation ein
  // (z.B. "Offenbarung23,8" -> "Offenbarung 23.8"), was den spaeteren Login bricht.
  if (/\s/.test(password)) {
    return 'Passwort darf keine Leerzeichen enthalten';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Passwort muss mindestens einen Großbuchstaben enthalten';
  }
  if (!/[a-z]/.test(password)) {
    return 'Passwort muss mindestens einen Kleinbuchstaben enthalten';
  }
  if (!/[0-9]/.test(password)) {
    return 'Passwort muss mindestens eine Zahl enthalten';
  }
  if (!/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/~`]/.test(password)) {
    return 'Passwort muss mindestens ein Sonderzeichen enthalten';
  }
  return null;
};

module.exports = {
  generateBiblicalPassword,
  validatePassword
};