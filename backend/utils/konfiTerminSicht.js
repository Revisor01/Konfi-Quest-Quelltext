//   Termin des eigenen Jahrgangs   sichtbar
//   Termin fremder Jahrgaenge      nicht sichtbar
//   Termin ohne jeden Jahrgang     sichtbar (ganze Gemeinde)
//   "Nur Team" (teamer_only)       nie
//   Konfi ohne Jahrgang            sieht nur die Termine ohne Jahrgang
//
// Was die Liste darueber hinaus filtert, gehoert nicht zur Sichtbarkeit des
// Termins, sondern zur Darstellung: das Datumsfenster (letzte 12 Monate) und
// abgesagte Termine nur bei eigener Buchung. Der Anmeldestart-Push meldet
// ohnehin nur kuenftige, nicht abgesagte Termine (backgroundService).

/**
 * SQL-Bedingung "eine Konfi des Jahrgangs <jahrgang> sieht Termin <e>".
 *
 * Ist <jahrgang> NULL (Konfi ohne Jahrgang), gilt sie nur fuer Termine ohne
 * Jahrgang.
 *
 * @param {object} opt
 * @param {string} opt.jahrgang  SQL-Ausdruck fuer den Jahrgang der Konfi
 *                               (z. B. '$3' oder 'kp.jahrgang_id')
 * @param {string} [opt.e='e']   Alias der events-Tabelle
 * @returns {string}
 */
function konfiSiehtTerminSql({ jahrgang, e = 'e' }) {
  return `(
    ${e}.teamer_only IS NOT TRUE
    AND (
      NOT EXISTS (
        SELECT 1 FROM event_jahrgang_assignments eja_konfi_alle
         WHERE eja_konfi_alle.event_id = ${e}.id
      )
      OR EXISTS (
        SELECT 1 FROM event_jahrgang_assignments eja_konfi_sicht
         WHERE eja_konfi_sicht.event_id = ${e}.id
           AND eja_konfi_sicht.jahrgang_id = ${jahrgang}
      )
    )
  )`;
}

/**
 * Sieht Konfi <konfiId> Termin <eventId>? Dieselbe Bedingung wie die Liste,
 * mit dem Jahrgang aus konfi_profiles.
 *
 * auchMitBuchung: Die EIGENE Buchung bleibt lesbar, auch wenn der Termin
 * nicht (mehr) zum Jahrgang passt -- nach einem Jahrgangswechsel bleiben
 * vergangene Buchungen mit Anwesenheit stehen, und die Konfi oeffnet sie aus
 * ihrem Verlauf. Fuers Buchen gilt das nicht: Anmelden darf sich nur, wer
 * den Termin sieht.
 *
 * Ein unbekannter Termin ergibt false. Die Gemeinde prueft der Aufrufer.
 *
 * @param {object} db              Pool oder Client
 * @param {number|string} konfiId
 * @param {number|string} eventId
 * @param {object} [opt]
 * @param {boolean} [opt.auchMitBuchung=false]
 * @returns {Promise<boolean>}
 */
async function konfiSiehtTermin(db, konfiId, eventId, { auchMitBuchung = false } = {}) {
  const jahrgang = '(SELECT kp.jahrgang_id FROM konfi_profiles kp WHERE kp.user_id = $2)';
  const buchung = auchMitBuchung
    ? 'OR EXISTS (SELECT 1 FROM event_bookings eb WHERE eb.event_id = e.id AND eb.user_id = $2)'
    : '';
  const { rows: [zeile] } = await db.query(
    `SELECT (${konfiSiehtTerminSql({ jahrgang, e: 'e' })} ${buchung}) AS sieht
       FROM events e WHERE e.id = $1`,
    [eventId, konfiId]
  );
  return Boolean(zeile && zeile.sieht);
}

/**
 * Alle Konfis, die Termin <eventId> in ihrer Terminliste sehen -- die
 * Empfaenger von "Neues Event!". Aktive, nicht geloeschte Konten der Gemeinde
 * des Termins.
 *
 * @param {object} db
 * @param {number} eventId
 * @returns {Promise<Array<number>>} Nutzer-IDs ohne Doppelte
 */
async function ladeKonfisDieTerminSehen(db, eventId) {
  if (eventId === null || eventId === undefined || String(eventId) === '') return [];
  const { rows } = await db.query(
    `SELECT DISTINCT u.id
       FROM events e
       JOIN users u ON u.organization_id = e.organization_id
       JOIN roles r ON r.id = u.role_id
       JOIN konfi_profiles kp ON kp.user_id = u.id
      WHERE e.id = $1
        AND r.name = 'konfi'
        AND u.deleted_at IS NULL
        AND u.is_active = true
        AND ${konfiSiehtTerminSql({ jahrgang: 'kp.jahrgang_id', e: 'e' })}
      ORDER BY u.id`,
    [eventId]
  );
  return rows.map((r) => r.id);
}

module.exports = { konfiSiehtTerminSql, konfiSiehtTermin, ladeKonfisDieTerminSehen };
