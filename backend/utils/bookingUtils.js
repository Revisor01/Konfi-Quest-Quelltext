const { addToEventChat } = require('./eventChat');

// Shared Booking-Logik für Event-Buchungen
// Wird von konfi.js und events.js genutzt
// Keine Push-Notifications oder liveUpdate-Aufrufe — nur Datenbank-Logik

/**
 * Prueft ob ein User bereits für ein Event gebucht ist
 * @param {object} client - DB-Client (innerhalb Transaktion)
 * @param {number} userId - User ID
 * @param {number} eventId - Event ID
 * @returns {object|null} Booking-Objekt oder null
 */
async function checkExistingBooking(client, userId, eventId) {
  const { rows: [existing] } = await client.query(
    'SELECT id FROM event_bookings WHERE user_id = $1 AND event_id = $2',
    [userId, eventId]
  );
  return existing || null;
}

/**
 * Laedt Event mit confirmed_count und waitlist_count (FOR UPDATE)
 * @param {object} client - DB-Client (innerhalb Transaktion)
 * @param {number} eventId - Event ID
 * @param {number} orgId - Organisation ID
 * @param {object} options - { excludeTeamers: boolean }
 * @returns {object|null} Event mit confirmed_count und waitlist_count oder null
 */
async function getEventWithCounts(client, eventId, orgId, options = {}) {
  const { excludeTeamers = false } = options;

  // Postgres erlaubt FOR UPDATE nicht mit GROUP BY.
  // Lösung: Event zuerst mit FOR UPDATE sperren, Counts als Subqueries.
  const confirmedCountSql = excludeTeamers
    ? `(SELECT COUNT(*) FROM event_bookings eb
         LEFT JOIN users u ON eb.user_id = u.id
         LEFT JOIN roles r ON u.role_id = r.id AND r.name = 'teamer'
         WHERE eb.event_id = e.id AND eb.status = 'confirmed' AND r.id IS NULL)`
    : `(SELECT COUNT(*) FROM event_bookings eb
         WHERE eb.event_id = e.id AND eb.status = 'confirmed')`;

  const waitlistCountSql = excludeTeamers
    ? `(SELECT COUNT(*) FROM event_bookings eb
         LEFT JOIN users u ON eb.user_id = u.id
         LEFT JOIN roles r ON u.role_id = r.id AND r.name = 'teamer'
         WHERE eb.event_id = e.id AND eb.status = 'waitlist' AND r.id IS NULL)`
    : `(SELECT COUNT(*) FROM event_bookings eb
         WHERE eb.event_id = e.id AND eb.status = 'waitlist')`;

  const query = `
    SELECT e.*,
           ${confirmedCountSql} AS confirmed_count,
           ${waitlistCountSql} AS waitlist_count
    FROM events e
    WHERE e.id = $1 AND e.organization_id = $2
    FOR UPDATE OF e
  `;

  const { rows: [event] } = await client.query(query, [eventId, orgId]);
  return event || null;
}

/**
 * Bestimmt den Buchungsstatus basierend auf Kapazität und Warteliste
 *
 * Rollenagnostisch: über `options` laesst sich waehlen, welche Wartelisten-
 * Felder des Events gelten. Für das Teamer-Kontingent sind das
 * teamer_waitlist_enabled / teamer_max_waitlist_size, für Konfis die
 * unpraefixierten Felder.
 *
 * @param {object} event - Event-Objekt
 * @param {number} confirmedCount - Anzahl bestaetigter Buchungen
 * @param {number} waitlistCount - Anzahl Wartelisten-Eintraege
 * @param {number} maxCapacity - Maximale Kapazität (0 = unbegrenzt)
 * @param {object} options - { waitlistEnabledField, maxWaitlistSizeField }
 * @returns {string|object} 'confirmed', 'waitlist', oder { error: string, status: number }
 */
function determineBookingStatus(event, confirmedCount, waitlistCount, maxCapacity, options = {}) {
  const {
    waitlistEnabledField = 'waitlist_enabled',
    maxWaitlistSizeField = 'max_waitlist_size'
  } = options;

  const waitlistEnabled = event[waitlistEnabledField];
  const maxWaitlistSize = event[maxWaitlistSizeField] || 10;

  // 0 = unbegrenzt
  if (maxCapacity > 0 && confirmedCount >= maxCapacity) {
    if (waitlistEnabled && waitlistCount < maxWaitlistSize) {
      return 'waitlist';
    }
    // Kein Platz und keine Warteliste oder Warteliste voll
    if (!waitlistEnabled) {
      return { error: 'Das Event ist leider bereits ausgebucht', status: 400 };
    }
    return { error: 'Event ist voll und Warteliste ist auch voll', status: 400 };
  }
  return 'confirmed';
}

/**
 * Rueckt den ersten Wartelisten-Eintrag nach (timeslot-aware, rollen-gefiltert)
 *
 * WICHTIG: roleFilter ist PFLICHT-relevant, seit Events ein eigenes
 * Teamer-Kontingent haben. Konfi- und Teamer-Warteliste sind strikt getrennt:
 * ein frei gewordener Konfi-Platz darf NIEMALS von einem Teamer belegt werden
 * und umgekehrt. Ohne Filter wuerde die FIFO-Reihenfolge beide Wartelisten
 * vermischen.
 *
 * @param {object} db - DB-Pool oder Client (innerhalb Transaktion)
 * @param {number} eventId - Event ID
 * @param {number|null} timeslotId - Timeslot ID (null für Events ohne Timeslots)
 * @param {'teamer'|'not_teamer'} roleFilter - Welche Warteliste nachruecken soll
 * @returns {number|null} User-ID des nachgerueckten Users oder null
 */
async function promoteFromWaitlist(db, eventId, timeslotId, roleFilter) {
  if (roleFilter !== 'teamer' && roleFilter !== 'not_teamer') {
    throw new Error(`promoteFromWaitlist: roleFilter muss 'teamer' oder 'not_teamer' sein (war: ${roleFilter})`);
  }
  // Rollen-Bedingung: Teamer-Warteliste vs. alles-was-kein-Teamer-ist (Konfis).
  // Geloeschte User (deleted_at) ruecken nie nach.
  const roleCondition = roleFilter === 'teamer'
    ? `EXISTS (SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id
                WHERE u.id = eb.user_id AND r.name = 'teamer' AND u.deleted_at IS NULL)`
    : `EXISTS (SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id
                WHERE u.id = eb.user_id AND r.name != 'teamer' AND u.deleted_at IS NULL)`;

  // Atomar: SELECT des nächsten Wartelisten-Eintrags und UPDATE in EINEM Statement.
  // FOR UPDATE SKIP LOCKED verhindert, dass zwei gleichzeitige Stornierungen
  // denselben Wartelistenplatz nachruecken (Race -> Doppel-Promotion über Kapazität).
  const subSelect = timeslotId
    ? `SELECT eb.id FROM event_bookings eb
        WHERE eb.event_id = $1 AND eb.timeslot_id = $2 AND eb.status = 'waitlist'
          AND ${roleCondition}
        ORDER BY eb.created_at ASC LIMIT 1 FOR UPDATE OF eb SKIP LOCKED`
    : `SELECT eb.id FROM event_bookings eb
        WHERE eb.event_id = $1 AND eb.status = 'waitlist'
          AND ${roleCondition}
        ORDER BY eb.created_at ASC LIMIT 1 FOR UPDATE OF eb SKIP LOCKED`;
  const params = timeslotId ? [eventId, timeslotId] : [eventId];

  const { rows: [promoted] } = await db.query(
    `UPDATE event_bookings SET status = 'confirmed'
     WHERE id = (${subSelect})
     RETURNING user_id, organization_id`,
    params
  );

  if (!promoted) return null;

  // Wer nachrueckt, gehört auch in den Chat zum Termin. Bewusst hier und nicht
  // an den vier Aufrufstellen: Als kopierter Block war genau diese Regel schon
  // einmal auseinandergelaufen.
  await addToEventChat(db, eventId, promoted.user_id, promoted.organization_id);

  return promoted.user_id;
}

/**
 * Prueft ob das Anmeldezeitraum für ein Event offen ist
 * @param {object} event - Event-Objekt mit registration_opens_at und registration_closes_at
 * @returns {object} { valid: boolean, error?: string }
 */
function validateRegistrationWindow(event) {
  const now = new Date();
  if (event.registration_opens_at && now < new Date(event.registration_opens_at)) {
    return { valid: false, error: 'Anmeldung noch nicht geöffnet' };
  }
  if (event.registration_closes_at && now > new Date(event.registration_closes_at)) {
    return { valid: false, error: 'Anmeldung bereits geschlossen' };
  }
  return { valid: true };
}

/**
 * Ist das Event JETZT für Konfis anmeldbar? Grundlage für den
 * "Anmeldung möglich"-Push. Anmeldbar = Anmeldefenster offen UND nicht abgesagt
 * UND nicht reines Teamer-Event (Konfis können sich da nicht anmelden).
 * @param {object} event - Event mit registration_opens_at/closes_at, cancelled, teamer_only
 * @returns {boolean}
 */
function isRegistrationOpenForKonfis(event) {
  if (event.cancelled) return false;
  if (event.teamer_only) return false;
  return validateRegistrationWindow(event).valid;
}

module.exports = {
  checkExistingBooking,
  getEventWithCounts,
  determineBookingStatus,
  promoteFromWaitlist,
  validateRegistrationWindow,
  isRegistrationOpenForKonfis
};
