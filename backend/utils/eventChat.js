// eventChat.js — Mitgliedschaft im Event-Chat, gekoppelt an die Event-Teilnahme.
//
// Regel: Wer am Termin teilnimmt, ist im Chat dazu. Wer sich abmeldet, fliegt
// raus. Das Anlegen des Chats bleibt eine bewusste Handlung der Leitung
// (POST /events/:id/chat) — hier geht es nur um die Mitgliedschaft in einem
// bereits bestehenden Chat.
//
// Die Regel steht deshalb an EINER Stelle, in den beiden Eintrittswegen
// unten: addToEventChat und syncEventChat nehmen nur auf, wer eine
// BESTAETIGTE Buchung hat. Die Aufrufer (Anmelden, Eintragen durch die
// Leitung, Nachruecken, Zusage des Teams, Pflicht-Automatik, Wieder-
// anmelden) muessen dafuer nichts wissen: Sie rufen wie bisher nach dem
// Schreiben der Buchung, und wer auf der Warteliste landet, bleibt draussen,
// bis promoteFromWaitlist ihn bestaetigt und hier erneut ruft.
//
// user_type muss dem Wert entsprechen, mit dem später gelesen wird:
// konfi -> 'konfi', teamer -> 'teamer', org_admin/admin -> 'admin'
// (dieselbe Abbildung wie in jahrgangChat.js).

/**
 * Entfernt eine Person aus allen Chat-Räumen eines Termins.
 * Idempotent: Ist sie nicht drin, passiert nichts.
 *
 * @param {object} db   Pool ODER Client (muss .query haben). Innerhalb einer
 *                      Transaktion den Client uebergeben.
 * @param {number} eventId
 * @param {number} userId
 * @param {number} organizationId
 * @returns {Promise<number>} Anzahl entfernter Mitgliedschaften.
 */
async function removeFromEventChat(db, eventId, userId, organizationId) {
  const { rowCount } = await db.query(
    `DELETE FROM chat_participants
     WHERE user_id = $1
       AND room_id IN (
         SELECT id FROM chat_rooms WHERE event_id = $2 AND organization_id = $3
       )`,
    [userId, eventId, organizationId]
  );
  return rowCount;
}

/**
 * Die Rolle wird selbst nachgesehen, damit der user_type stimmt: Ein Teamer,
 * der als 'admin' eingetragen wird, findet seinen eigenen Raum nicht.
 *
 * @param {object} db   Pool ODER Client (muss .query haben).
 * @param {number} eventId
 * @param {number} userId
 * @param {number} organizationId
 * @returns {Promise<number>} Anzahl angelegter Mitgliedschaften.
 */
async function addToEventChat(db, eventId, userId, organizationId) {
  const { rowCount } = await db.query(
    `INSERT INTO chat_participants (room_id, user_id, user_type)
     SELECT cr.id, u.id,
            CASE WHEN r.name = 'konfi' THEN 'konfi'
                 WHEN r.name = 'teamer' THEN 'teamer'
                 ELSE 'admin' END
     FROM chat_rooms cr
     JOIN users u ON u.id = $2
     JOIN roles r ON r.id = u.role_id
     WHERE cr.event_id = $1
       AND cr.organization_id = $3
       AND u.deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM event_bookings eb
          WHERE eb.event_id = cr.event_id
            AND eb.user_id = u.id
            AND eb.status = 'confirmed'
       )
     ON CONFLICT DO NOTHING`,
    [eventId, userId, organizationId]
  );
  return rowCount;
}

/**
 * Für Mengen gedacht (Pflicht-Event-Automatik), wo einzelne Aufrufe je Person
 * unnötig viele Abfragen wären. Idempotent.
 *
 * @param {object} db   Pool ODER Client (muss .query haben).
 * @param {number} eventId
 * @param {number} organizationId
 * @returns {Promise<number>} Anzahl neu angelegter Mitgliedschaften.
 */
async function syncEventChat(db, eventId, organizationId) {
  const { rowCount } = await db.query(
    `INSERT INTO chat_participants (room_id, user_id, user_type)
     SELECT cr.id, u.id,
            CASE WHEN r.name = 'konfi' THEN 'konfi'
                 WHEN r.name = 'teamer' THEN 'teamer'
                 ELSE 'admin' END
     FROM chat_rooms cr
     JOIN event_bookings eb ON eb.event_id = cr.event_id
     JOIN users u ON u.id = eb.user_id
     JOIN roles r ON r.id = u.role_id
     WHERE cr.event_id = $1
       AND cr.organization_id = $2
       AND eb.status = 'confirmed'
       AND u.deleted_at IS NULL
     ON CONFLICT DO NOTHING`,
    [eventId, organizationId]
  );
  return rowCount;
}

module.exports = { removeFromEventChat, addToEventChat, syncEventChat };
