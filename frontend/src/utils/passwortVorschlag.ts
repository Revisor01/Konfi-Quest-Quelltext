// Passwort-Vorschlag fuer alle Stellen, an denen jemand ein Passwort VERGIBT
// (Organisation anlegen, Passwort zuruecksetzen).
//
// Bewusst EINE Fassung statt Inline-Kopien: Das Muster ist an mehreren
// Stellen gefragt, und fuenf Kopien laufen frueher oder spaeter auseinander.
// Die erzeugten Passwoerter erfuellen garantiert die Policy, die das Backend
// erzwingt (mind. 8 Zeichen, Gross, Klein, Zahl, Sonderzeichen, keine
// Leerzeichen).

// Kryptographisch sicherer Zufallswert in [0, max) — Rejection-Sampling
// gegen Modulo-Bias (Math.random ist für Passwoerter nicht geeignet)
const randomInt = (max: number): number => {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
};

// Verwechselbare Zeichen fehlen absichtlich: I, O, l, o, 0, 1 — das Passwort
// wird oft vorgelesen oder abgeschrieben.
export const PASSWORT_GROSS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const PASSWORT_KLEIN = 'abcdefghijkmnpqrstuvwxyz';
export const PASSWORT_ZIFFERN = '23456789';
export const PASSWORT_SONDER = '!@#$%&*?-_+=';

// Starkes Passwort generieren (erfuellt garantiert alle Anforderungen)
export const generateStrongPassword = (length = 14): string => {
  const all = PASSWORT_GROSS + PASSWORT_KLEIN + PASSWORT_ZIFFERN + PASSWORT_SONDER;
  // Mindestens je ein Zeichen aus jeder Kategorie
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(PASSWORT_GROSS), pick(PASSWORT_KLEIN), pick(PASSWORT_ZIFFERN), pick(PASSWORT_SONDER)];
  for (let i = chars.length; i < length; i++) {
    chars.push(pick(all));
  }
  // Mischen (Fisher-Yates)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};
