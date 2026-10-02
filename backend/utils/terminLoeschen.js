// Einen Termin samt allem, was an ihm haengt, loeschen -- EIN Weg fuer zwei
// Aufrufer.
//
// KEIN BEGIN/COMMIT hier: Der Aufrufer bestimmt die Transaktion. Mitteilungen
// (Push, Live-Update) verschickt ebenfalls der Aufrufer -- beim Einzel-Loeschen
// eine Absage an die Angemeldeten, beim Jahrgang-Loeschen keine.

const { loescheMitteilungenZuTermin } = require('./postfachAufraeumen');
const { deleteChatFile } = require('./photoStorage');

// Schluessel der Sperre (zweiteilig: dieser Wert + Gemeinde). Die
// einteiligen Sperren der Migrationen und des Cron-Leaders liegen in einem
// anderen Schluesselraum und kommen sich damit nicht in die Quere.
const TERMIN_LOESCHEN_SPERRE = 280926;

/**
 * Loescht Chat-Raeume samt Nachrichten, Umfragen, Lesestand und Teilnehmern.
 * Fuer Termin- und Jahrgangs-Chats derselbe Weg.
 *
 * @param {{query: Function}} client  Transaktions-Client
 * @param {Array<number|string>} raumIds
 * @returns {Promise<string[]>} Dateipfade der Anhaenge (fuer entferneChatDateien)
 */
async function loescheChatRaeume(client, raumIds) {
  const ids = (raumIds || []).map(Number).filter(Number.isFinite);
  if (ids.length === 0) return [];

  const { rows: dateien } = await client.query(
    'SELECT file_path FROM chat_messages WHERE room_id = ANY($1::bigint[]) AND file_path IS NOT NULL',
    [ids]
  );

  // Umfragen haengen an der Nachricht, nicht am Raum -- deshalb ueber sie.
  await client.query(
    `DELETE FROM chat_poll_votes WHERE poll_id IN (
       SELECT cp.id FROM chat_polls cp
       JOIN chat_messages cm ON cp.message_id = cm.id
       WHERE cm.room_id = ANY($1::bigint[])
     )`,
    [ids]
  );
  await client.query(
    'DELETE FROM chat_polls WHERE message_id IN (SELECT id FROM chat_messages WHERE room_id = ANY($1::bigint[]))',
    [ids]
  );
  await client.query('DELETE FROM chat_read_status WHERE room_id = ANY($1::bigint[])', [ids]);
  await client.query('DELETE FROM chat_messages WHERE room_id = ANY($1::bigint[])', [ids]);
  await client.query('DELETE FROM chat_participants WHERE room_id = ANY($1::bigint[])', [ids]);
  await client.query('DELETE FROM chat_rooms WHERE id = ANY($1::bigint[])', [ids]);

  return dateien.map((d) => d.file_path);
}

/**
 * Loescht einen Termin mit allem, was an ihm haengt.
 *
 * @param {{query: Function}} client  Transaktions-Client
 * @param {number|string} eventId
 * @param {object} [opt]
 * @param {boolean} [opt.punkteZuruecknehmen=true]  Vergebene Event-Punkte vom
 *   Punktestand abziehen (Einzel-Loeschen). false beim Jahrgang-Loeschen:
 *   Die Teilnahme hat stattgefunden, der Jahrgang wird nur aufgeraeumt.
 * @returns {Promise<{geloescht: boolean, dateien: string[], vergebenePunkte: Array<{konfi_id:number, points:number, point_type:string}>}>}
 */
async function loescheTermin(client, eventId, { punkteZuruecknehmen = true } = {}) {
  // 0. Loeschungen in derselben Gemeinde nacheinander. Die App loescht eine
  // ganze Serie mit parallelen Anfragen (AdminEventsPage, deleteSeriesEvents);
  // ohne diese Sperre haengt die eine Loeschung die Serien-Verweise auf einen
  // Termin um, den die andere gerade loescht -- und die scheitert am
  // Fremdschluessel. Die Sperre gilt bis COMMIT/ROLLBACK des Aufrufers.
  await client.query(
    'SELECT pg_advisory_xact_lock($1, (SELECT organization_id FROM events WHERE id = $2)::int)',
    [TERMIN_LOESCHEN_SPERRE, eventId]
  );

  // 1. Termin-Chats
  const { rows: raeume } = await client.query('SELECT id FROM chat_rooms WHERE event_id = $1', [eventId]);
  const dateien = await loescheChatRaeume(client, raeume.map((r) => r.id));

  // 2. Event-Punkte. Muster wie beim Einzel-Storno: je Punktart abziehen,
  // GREATEST(0, ...) gegen negative Salden.
  const { rows: vergebenePunkte } = await client.query(
    'SELECT konfi_id, points, point_type FROM event_points WHERE event_id = $1',
    [eventId]
  );
  if (punkteZuruecknehmen) {
    for (const pts of vergebenePunkte) {
      const updateProfileQuery = pts.point_type === 'gottesdienst'
        ? 'UPDATE konfi_profiles SET gottesdienst_points = GREATEST(0, gottesdienst_points - $1) WHERE user_id = $2'
        : 'UPDATE konfi_profiles SET gemeinde_points = GREATEST(0, gemeinde_points - $1) WHERE user_id = $2';
      await client.query(updateProfileQuery, [pts.points, pts.konfi_id]);
    }
  }
  await client.query('DELETE FROM event_points WHERE event_id = $1', [eventId]);

  // 3. Termin-Daten
  await client.query('DELETE FROM event_bookings WHERE event_id = $1', [eventId]);
  await client.query('DELETE FROM event_timeslots WHERE event_id = $1', [eventId]);
  await client.query('DELETE FROM event_categories WHERE event_id = $1', [eventId]);
  await client.query('DELETE FROM event_jahrgang_assignments WHERE event_id = $1', [eventId]);

  // 4. Postfach -- in derselben Transaktion, damit bei einem ROLLBACK auch
  // die Mitteilungen stehen bleiben.
  await loescheMitteilungenZuTermin(client, eventId);

  // 5. Serien-Verweis umhaengen: Die uebrigen Termine der Serie zeigen auf
  // den kleinsten verbliebenen, der damit selbst zum ersten wird.
  await client.query(
    `UPDATE events
        SET series_id = (SELECT MIN(id) FROM events WHERE series_id = $1 AND id <> $1)
      WHERE series_id = $1 AND id <> $1`,
    [eventId]
  );

  // 6. Der Termin
  const { rowCount } = await client.query('DELETE FROM events WHERE id = $1', [eventId]);

  return { geloescht: rowCount > 0, dateien, vergebenePunkte };
}

/**
 * Entfernt Chat-Anhaenge vom Dateisystem -- nach dem COMMIT, fehlertolerant.
 *
 * @param {string[]} dateien
 */
async function entferneChatDateien(dateien) {
  for (const datei of dateien || []) {
    try {
      await deleteChatFile(datei);
    } catch (err) {
      console.warn(`Chat-Anhang ${datei} konnte nicht geloescht werden:`, err.message);
    }
  }
}

module.exports = { loescheTermin, loescheChatRaeume, entferneChatDateien };
