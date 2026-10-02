// Wie lange ein Einladungscode gilt.
//
// DIE REGEL:
//   - Beim Anlegen waehlt die Org-Leitung 7, 14, 30, 60 oder 90 Tage. Ohne
//     Angabe bleibt es bei 7 Tagen -- so schicken es die ausgelieferten Apps.
//   - Verlaengern geht um dieselben Stufen, ohne Angabe um 7 Tage. Das neue
//     Ablaufdatum liegt NIE mehr als 90 Tage in der Zukunft; was darueber
//     hinausginge, wird auf 90 Tage ab jetzt gekuerzt.
//   - Es gibt keinen Code ohne Ablauf (invite_codes.expires_at ist NOT NULL,
//     und keine Stufe heisst "unbegrenzt"). Ein abgelaufener Code bleibt
//     abgelaufen: Verlaengern verweigert ihn, die Registrierung auch.
//
// Ein Tag sind hier 24 Stunden -- dieselbe Rechnung wie beim Anlegen seit
// jeher. Das Verlaengern rechnete bis hierher mit Kalendertagen (setDate);
// ueber eine Zeitumstellung hinweg waren das 23 oder 25 Stunden, und die
// 90-Tage-Grenze haette sich mit der Anlage-Rechnung um eine Stunde
// gestritten.

const GUELTIGKEIT_TAGE = Object.freeze([7, 14, 30, 60, 90]);
const STANDARD_TAGE = 7;
const HOECHSTENS_TAGE = 90;
const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * Liest die gewuenschte Zahl der Tage aus der Anfrage.
 *
 * @param {unknown} wert  req.body.gueltig_tage bzw. req.body.tage
 * @returns {{ ok: true, tage: number } | { ok: false }}
 *   ohne Angabe (undefined/null) die Standardstufe von 7 Tagen
 */
function leseTage(wert) {
  if (wert === undefined || wert === null) return { ok: true, tage: STANDARD_TAGE };
  const zahl = typeof wert === 'string' && /^\d+$/.test(wert.trim()) ? Number(wert.trim()) : wert;
  if (typeof zahl === 'number' && GUELTIGKEIT_TAGE.includes(zahl)) return { ok: true, tage: zahl };
  return { ok: false };
}

/** Ablaufdatum eines neuen Codes. */
function ablaufBeimAnlegen(tage, jetzt = new Date()) {
  return new Date(jetzt.getTime() + tage * TAG_MS);
}

/**
 * Neues Ablaufdatum beim Verlaengern: bisheriges Ablaufdatum plus `tage`,
 * hoechstens 90 Tage ab jetzt.
 *
 * @param {Date} bisher
 * @param {number} tage
 * @param {Date} [jetzt]
 * @returns {{ ablauf: Date, begrenzt: boolean, verlaengert: boolean }}
 *   begrenzt: die 90-Tage-Grenze hat gekuerzt;
 *   verlaengert: false, wenn bis zur Grenze nicht einmal ein Tag mehr drin
 *   ist -- dann bleibt das bisherige Datum (verkuerzt wird nie). Ohne diese
 *   Schwelle haette ein eben mit 90 Tagen angelegter Code sich um die paar
 *   Sekunden seit dem Anlegen "verlaengern" lassen.
 */
function ablaufBeimVerlaengern(bisher, tage, jetzt = new Date()) {
  const gewuenscht = bisher.getTime() + tage * TAG_MS;
  const grenze = jetzt.getTime() + HOECHSTENS_TAGE * TAG_MS;
  if (gewuenscht <= grenze) return { ablauf: new Date(gewuenscht), begrenzt: false, verlaengert: true };
  if (grenze - bisher.getTime() < TAG_MS) return { ablauf: new Date(bisher.getTime()), begrenzt: true, verlaengert: false };
  return { ablauf: new Date(grenze), begrenzt: true, verlaengert: true };
}

module.exports = {
  GUELTIGKEIT_TAGE,
  STANDARD_TAGE,
  HOECHSTENS_TAGE,
  leseTage,
  ablaufBeimAnlegen,
  ablaufBeimVerlaengern
};
