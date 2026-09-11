// backend/utils/terminAnmeldeStatus.js
// Die EINE Rechnung fuer den Anmeldestatus eines Termins und die EINE Query
// fuer seine Zeitfenster.
//
// WARUM ES DIESE DATEI GIBT
// Beides lag mehrfach als wortgleiche SQL-Kopie im Repo:
//
//   registration_status  — dreimal: events/lesen.js (Leitungsliste),
//                          konfi.js (Konfi-Liste), konfi.js (Konfi-Detail).
//   Zeitfenster-Query    — zweimal: events/lesen.js (GET /events/:id/timeslots)
//                          und konfi.js (GET /konfi/events/:id/timeslots),
//                          Zeichen fuer Zeichen identisch.
//
// Kopiertes SQL laeuft auseinander, und beim Anmeldestatus ist genau das
// zweimal nachweislich passiert — jedes Mal sichtbar fuer Nutzer:innen:
//
// Alle drei Abweichungen sind inzwischen von Hand nachgezogen; die drei
// Fassungen rechnen heute gleich. Genau deshalb ist jetzt der Moment, sie
// zusammenzulegen: Solange das SQL dreimal dasteht, ist der naechste
// Nachzieh-Fehler nur eine Frage der Zeit.
//
// KEINE FORMAENDERUNG
// Beide Helfer liefern exakt dasselbe SQL wie die Kopien, die sie ersetzen.
// Spaltennamen, Werte und Reihenfolge der Antworten bleiben unveraendert —
// ausgelieferte Apps merken davon nichts.

/**
 * SQL-Ausdruck fuer den Anmeldestatus eines Termins.
 *
 * Das Kontingent ist bei Terminen mit Zeitfenstern die Summe der
 * Fenster-Kapazitaeten, sonst events.max_participants. `0` heisst dabei
 * UNBEGRENZT — daher der `> 0`-Guard vor dem Vergleich.
 *
 * @param {object} spalten
 * @param {string} spalten.kapazitaet - SQL fuer die wirksame Kapazitaet
 * @param {string} spalten.bestaetigt - SQL fuer die Zahl bestaetigter Konfi-Buchungen
 * @param {string} spalten.warteliste - SQL fuer die Zahl der Konfis auf der Warteliste
 * @returns {string} SQL-CASE-Ausdruck (ohne Alias)
 */
function anmeldeStatusSql({ kapazitaet, bestaetigt, warteliste }) {
  return `
                CASE
                  WHEN e.cancelled THEN 'cancelled'
                  WHEN e.mandatory THEN 'mandatory'
                  WHEN NOW() < e.registration_opens_at THEN 'upcoming'
                  WHEN NOW() > e.registration_closes_at THEN 'closed'
                  WHEN (${kapazitaet}) > 0
                       AND ${bestaetigt} >= (${kapazitaet})
                       AND (NOT e.waitlist_enabled
                            OR ${warteliste} >= COALESCE(e.max_waitlist_size, 0))
                    THEN 'closed'
                  ELSE 'open'
                END`;
}

/**
 * Die wirksame Kapazitaet eines Termins als SQL-Ausdruck.
 * Mit Zeitfenstern: Summe der Fenster-Kapazitaeten (Fallback auf
 * max_participants, wenn kein Fenster angelegt ist). Ohne: max_participants.
 *
 * @param {string} gesamtKapazitaetSql - SQL fuer die Fenster-Summe
 * @returns {string}
 */
function kapazitaetSql(gesamtKapazitaetSql) {
  return `CASE WHEN e.has_timeslots THEN COALESCE(${gesamtKapazitaetSql}, e.max_participants) ELSE e.max_participants END`;
}

// Zeitfenster eines Termins mit Belegung. `registered_count` zaehlt die
// bestaetigten Buchungen des Fensters, `waitlist_count` die wartenden.
// Bewusst ohne Rollenfilter: Zeitfenster sind eine reine Aufteilung des
// Termins, kein eigenes Kontingent — wer im Fenster steht, belegt dort einen
// Platz, unabhaengig von der Rolle.
const ZEITFENSTER_SQL = `
        SELECT et.*,
               COUNT(eb.id) FILTER (WHERE eb.status = 'confirmed') as registered_count,
               COUNT(eb.id) FILTER (WHERE eb.status = 'waitlist') as waitlist_count
        FROM event_timeslots et
        LEFT JOIN event_bookings eb ON et.id = eb.timeslot_id
        WHERE et.event_id = $1 AND et.organization_id = $2
        GROUP BY et.id
        ORDER BY et.start_time ASC
      `;

/**
 * Laedt die Zeitfenster eines Termins.
 *
 * Antwort ist in beiden Aufrufern (Leitung und Konfi) identisch:
 *   - Termin nicht gefunden / andere Organisation -> null
 *   - Termin ohne Zeitfenster                     -> [] (leeres Array)
 *   - sonst                                       -> Array der Fenster
 *
 * Das leere Array bei has_timeslots = false ist Vertrag: Die Oberflaechen
 * unterscheiden daran "keine Fenster" von "Termin weg" (404).
 *
 * @param {object} db - DB-Pool oder Client
 * @param {number|string} eventId
 * @param {number} orgId
 * @returns {Promise<Array|null>} Zeitfenster, leeres Array oder null
 */
async function ladeZeitfenster(db, eventId, orgId) {
  const { rows: [event] } = await db.query(
    'SELECT id, has_timeslots FROM events WHERE id = $1 AND organization_id = $2',
    [eventId, orgId]
  );

  if (!event) return null;
  if (!event.has_timeslots) return [];

  const { rows } = await db.query(ZEITFENSTER_SQL, [eventId, orgId]);
  return rows;
}

module.exports = {
  anmeldeStatusSql,
  kapazitaetSql,
  ZEITFENSTER_SQL,
  ladeZeitfenster
};
