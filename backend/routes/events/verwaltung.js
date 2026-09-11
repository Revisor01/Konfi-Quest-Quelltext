const express = require('express');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../../middleware/validation');
const PushService = require('../../services/pushService');
const liveUpdate = require('../../utils/liveUpdate');
const { isRegistrationOpenForKonfis, zaehleBestaetigte } = require('../../utils/bookingUtils');
const { allIdsBelongToOrg } = require('../../utils/orgOwnership');
const { syncEventChat } = require('../../utils/eventChat');
const { nachAntwort } = require('../../utils/nachAntwort');
const { validateTeamerQuota } = require('./validierung');
const { formatDatum } = require('../../utils/zeitformat');

module.exports = (db, rbacVerifier, { requireTeamer }) => {
  const router = express.Router();

  // Validierungsregeln
  const validateCreateEvent = [
    body('name').trim().notEmpty().withMessage('Name ist erforderlich')
      .isLength({ max: 200 }).withMessage('Name darf maximal 200 Zeichen lang sein'),
    body('event_date').notEmpty().isISO8601().withMessage('Gültiges Datum erforderlich'),
    body('mandatory').optional().isBoolean().withMessage('mandatory muss ein Boolean sein'),
    body('is_konfirmation').optional().isBoolean().withMessage('is_konfirmation muss ein Boolean sein'),
    body('bring_items').optional({ nullable: true }).isString().withMessage('bring_items muss ein String sein'),
    // 0 = unbegrenzt, darum min: 0 und NICHT notEmpty (das wuerde die 0 verwerfen).
    body('max_participants').optional({ nullable: true }).isInt({ min: 0 })
      .withMessage('Maximale Teilnehmerzahl muss 0 (unbegrenzt) oder groesser sein'),
    handleValidationErrors
  ];

  const validateUpdateEvent = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('name').trim().notEmpty().withMessage('Name ist erforderlich'),
    body('mandatory').optional().isBoolean().withMessage('mandatory muss ein Boolean sein'),
    body('is_konfirmation').optional().isBoolean().withMessage('is_konfirmation muss ein Boolean sein'),
    body('bring_items').optional({ nullable: true }).isString().withMessage('bring_items muss ein String sein'),
    body('max_participants').optional({ nullable: true }).isInt({ min: 0 })
      .withMessage('Maximale Teilnehmerzahl muss 0 (unbegrenzt) oder groesser sein'),
    handleValidationErrors
  ];

  const validateEventId = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors
  ];

  // Create new event
  router.post('/', rbacVerifier, requireTeamer, validateCreateEvent, async (req, res) => {
    const {
      name, description, event_date, event_end_time, location, location_maps_url,
      points, point_type, category_ids, jahrgang_ids, type, max_participants,
      registration_opens_at, registration_closes_at, has_timeslots,
      waitlist_enabled, max_waitlist_size, timeslots, is_series, series_id,
      mandatory, is_konfirmation, bring_items, checkin_window, teamer_needed, teamer_only,
      teamer_max_participants, teamer_waitlist_enabled, teamer_max_waitlist_size
    } = req.body;

    // Teamer-Felder validieren: gegenseitiger Ausschluss
    if (teamer_needed && teamer_only) {
      return res.status(400).json({ error: 'teamer_needed und teamer_only schließen sich gegenseitig aus' });
    }

    // Teamer-Kontingent validieren (0 = unbegrenzt, negativ ist ungueltig)
    const teamerQuotaCheck = validateTeamerQuota(teamer_max_participants, teamer_max_waitlist_size);
    if (teamerQuotaCheck) {
      return res.status(400).json({ error: teamerQuotaCheck });
    }

    // checkin_window validieren (5-120, Default 30)
    const effectiveCheckinWindow = Math.max(5, Math.min(120, parseInt(checkin_window) || 30));

    // max_participants ist die KONFI-Teilnehmerzahl. Bei Pflicht-Events (ganzer
    // Jahrgang) und bei reinen Teamer-Events (keine Konfi-Teilnahme) gibt es
    // sie nicht — dort darf sie nicht eingefordert werden. Ohne diese Ausnahme
    // liess sich ein reines Teamer-Event gar nicht anlegen.
    //
    // 0 bedeutet UNBEGRENZT (Konvention im ganzen System, siehe Spalten-Default
    // und den Schalter "Unbegrenzte Teilnehmer:innen" im Formular). Ein
    // truthy-Check wie !max_participants verwirft die 0 zusammen mit
    // undefined/null und lehnte damit genau den Fall ab, den die Oberflaeche
    // anbietet: unbegrenzte Events liessen sich nicht anlegen (22.08.).
    // Deshalb explizit auf "nicht angegeben" prüfen statt auf falsy.
    const maxParticipantsFehlt = max_participants === undefined
      || max_participants === null
      || max_participants === '';

    if (!name || !event_date || (!mandatory && !teamer_only && maxParticipantsFehlt)) {
      return res.status(400).json({ error: 'Name, Datum und maximale Teilnehmerzahl sind erforderlich' });
    }


    // Pflicht-Events benoetigen mindestens einen Jahrgang
    if (mandatory && (!jahrgang_ids || jahrgang_ids.length === 0)) {
      return res.status(400).json({ error: 'Pflicht-Events benötigen mindestens einen Jahrgang' });
    }

    // Org-Isolation: fremde jahrgang_ids/category_ids abweisen (Cross-Org-Referenzen)
    try {
      if (!(await allIdsBelongToOrg(db, 'jahrgaenge', jahrgang_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens ein Jahrgang gehört nicht zu deiner Organisation' });
      }
      if (!(await allIdsBelongToOrg(db, 'categories', category_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens eine Kategorie gehört nicht zu deiner Organisation' });
      }
    } catch (err) {
      console.error('Org-Ownership-Check fehlgeschlagen:', err);
      return res.status(500).json({ error: 'Datenbankfehler' });
    }

    // Guards für Pflicht-Events
    // Pflicht- UND Konfirmations-Events geben keine Punkte (serverseitig erzwungen).
    const effectivePoints = (mandatory || is_konfirmation) ? 0 : (points || 0);
    // Reine Teamer-Events haben keine Konfi-Plaetze -> 0 (= unbegrenzt/irrelevant)
    const effectiveMaxParticipants = (mandatory || teamer_only) ? 0 : max_participants;
    const effectiveWaitlist = mandatory ? false : (waitlist_enabled !== undefined ? waitlist_enabled : true);
    // Timeslots sind bei Pflicht-Events UND Konfirmationen NICHT erlaubt (fachliche
    // Regel): Pflicht betrifft den ganzen Jahrgang, Konfirmation hat feste Termine.
    // Serverseitig erzwungen, damit es nicht per direktem API-Call/Offline-Queue
    // umgangen werden kann (Frontend disabled das Toggle zusaetzlich).
    const effectiveHasTimeslots = (mandatory || is_konfirmation) ? false : (has_timeslots || false);

    // Transaktional.
    //
    // Hier stand bis dahin: "As per the instructions, we use db.query for
    // everything. This is safe as long as the logic is encapsulated inside a
    // single route handler." Beides war falsch. Es gibt keine solchen
    // "instructions" — der einzige Treffer im ganzen Backend war dieser Satz
    // selbst; er stammt aus der SQLite-Umstellung im Juli 2025. Und ein
    // Route-Handler ist keine Transaktionsgrenze: Express weiss nichts von
    // Postgres, jedes db.query() ist eine eigene Auto-Commit-Transaktion auf
    // einer beliebigen Verbindung. database.js sagt direkt ueber getClient()
    // das Gegenteil, und POST /series legt DIESELBEN Datensaetze seit jeher
    // transaktional an.
    //
    // Praktische Folge des alten Zustands: Riss zwischen Kategorien und
    // Jahrgaengen hiess ein Termin ohne Jahrgangs-Zuordnung — fuer niemanden
    // sichtbar, ohne Teilnehmer, und der Client legte ihn nach dem 500er
    // vermutlich noch einmal an.
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const insertEventQuery = `
        INSERT INTO events (
          name, description, event_date, event_end_time, location, location_maps_url,
          points, point_type, type, max_participants, registration_opens_at,
          registration_closes_at, has_timeslots, waitlist_enabled, max_waitlist_size,
          is_series, series_id, mandatory, is_konfirmation, bring_items, checkin_window,
          teamer_needed, teamer_only,
          teamer_max_participants, teamer_waitlist_enabled, teamer_max_waitlist_size,
          created_by, organization_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
        RETURNING id
      `;
      const { rows: [newEvent] } = await client.query(insertEventQuery, [
        name, description, event_date, event_end_time, location, location_maps_url,
        effectivePoints, point_type || 'gemeinde', type || 'event', effectiveMaxParticipants,
        registration_opens_at, registration_closes_at, effectiveHasTimeslots,
        effectiveWaitlist, max_waitlist_size || 10,
        is_series || false, series_id, mandatory || false, is_konfirmation || false, bring_items || null,
        effectiveCheckinWindow, teamer_needed || false, teamer_only || false,
        // 0 = unbegrenzt, Default wie in der Migration
        teamer_max_participants !== undefined && teamer_max_participants !== null ? parseInt(teamer_max_participants, 10) : 0,
        teamer_waitlist_enabled !== undefined && teamer_waitlist_enabled !== null ? !!teamer_waitlist_enabled : true,
        teamer_max_waitlist_size !== undefined && teamer_max_waitlist_size !== null ? parseInt(teamer_max_waitlist_size, 10) : 10,
        req.user.id, req.user.organization_id
      ]);
      
      const eventId = newEvent.id;

      // Sequentiell statt Promise.all: Auf einem einzelnen Client gibt es
      // keine echte Parallelitaet, und das alte Promise.all checkte pro
      // Timeslot eine eigene Pool-Verbindung aus (bei acht Slots die Haelfte
      // des Pools auf einen Schlag). Es brach ausserdem beim ersten Fehler ab,
      // waehrend die uebrigen weiterliefen und committeten — der Fehlerzustand
      // war damit nicht einmal vorhersagbar.

      // Add categories
      if (category_ids && Array.isArray(category_ids) && category_ids.length > 0) {
        const categoryQuery = "INSERT INTO event_categories (event_id, category_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING";
        await client.query(categoryQuery, [eventId, category_ids]);
      }

      // Add jahrgaenge
      if (jahrgang_ids && Array.isArray(jahrgang_ids) && jahrgang_ids.length > 0) {
        const jahrgangQuery = "INSERT INTO event_jahrgang_assignments (event_id, jahrgang_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING";
        await client.query(jahrgangQuery, [eventId, jahrgang_ids]);
      }

      // If has timeslots, create them (effectiveHasTimeslots ist bei mandatory/
      // is_konfirmation bereits false -> dann werden keine Timeslots angelegt)
      // Ein Multi-Row-INSERT statt N Einzelabfragen — dasselbe unnest-Muster
      // wie bei den Kategorien oben.
      if (effectiveHasTimeslots && timeslots && timeslots.length > 0) {
        await client.query(
          `INSERT INTO event_timeslots (event_id, start_time, end_time, max_participants, organization_id)
           SELECT $1, s.start_time, s.end_time, s.max_participants, $3
             FROM UNNEST($2::jsonb[]) AS t(slot),
                  LATERAL (SELECT (slot->>'start_time')::timestamptz AS start_time,
                                  (slot->>'end_time')::timestamptz   AS end_time,
                                  (slot->>'max_participants')::int   AS max_participants) s`,
          [eventId, timeslots.map(slot => JSON.stringify(slot)), req.user.organization_id]
        );
      }

      // Auto-Enrollment für Pflicht-Events
      if (mandatory && jahrgang_ids && jahrgang_ids.length > 0) {
        const enrollQuery = `
          INSERT INTO event_bookings (event_id, user_id, status, booking_date, organization_id)
          SELECT $1, u.id, 'confirmed', NOW(), $3
          FROM users u
          JOIN konfi_profiles kp ON u.id = kp.user_id
          JOIN roles r ON u.role_id = r.id
          WHERE kp.jahrgang_id = ANY($2::int[])
            AND u.organization_id = $3
            AND r.name = 'konfi'
            AND u.deleted_at IS NULL
          ON CONFLICT (user_id, event_id) DO NOTHING
        `;
        await client.query(enrollQuery, [eventId, jahrgang_ids, req.user.organization_id]);
      }

      await client.query('COMMIT');

      res.status(201).json({ id: eventId, message: 'Event erfolgreich erstellt' });

      // Live Update: Notify all konfis and admins about the new event
      liveUpdate.sendToOrg(req.user.organization_id, 'events', 'create', { eventId });

      // Push Notification
      try {
        if (mandatory && jahrgang_ids && jahrgang_ids.length > 0) {
          // Push nur an tatsaechlich enrollte Konfis (jahrgangs-spezifisch)
          const { rows: enrolledUsers } = await db.query(`
            SELECT u.id FROM users u
            JOIN konfi_profiles kp ON u.id = kp.user_id
            JOIN roles r ON u.role_id = r.id
            WHERE kp.jahrgang_id = ANY($1::int[])
              AND u.organization_id = $2
              AND r.name = 'konfi'
              AND u.deleted_at IS NULL
          `, [jahrgang_ids, req.user.organization_id]);

          if (enrolledUsers.length > 0) {
            const userIds = enrolledUsers.map(u => u.id);
            await PushService.sendMandatoryEventCreated(db, userIds, name, event_date, eventId, req.user.organization_id);
          }
        }
        // Freiwillige Events: KEIN direkter "Anmeldung möglich"-Push hier.
        // Das Flag registration_open_notified bleibt false (Default) -> der Cron
        // (backgroundService, atomar, alle 1 Min) sendet GENAU EINEN Push, sobald
        // das Event anmeldbar ist. Verhindert Doppel-Pushes (POST + Cron).
      } catch (pushErr) {
        console.error('Push notification failed for new event:', pushErr);
      }

    } catch (err) {
      // Rollback ist ein No-op, wenn der Fehler NACH dem COMMIT auftrat
      // (Push, LiveUpdate) — dann ist die Transaktion bereits abgeschlossen.
      await client.query('ROLLBACK').catch(() => {});
 console.error('Database error in POST /events:', err);
      // '23505' is the PostgreSQL code for unique_violation
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Ein ähnliches Event existiert möglicherweise bereits.' });
      }
      res.status(500).json({ error: 'Datenbankfehler' });
    } finally {
      client.release();
    }
  });
  
  // Update event
  router.put('/:id', rbacVerifier, requireTeamer, validateUpdateEvent, async (req, res) => {
    const { id } = req.params;
    const {
      name, description, event_date, event_end_time, location, location_maps_url,
      points, point_type, category_ids, jahrgang_ids, type, max_participants,
      registration_opens_at, registration_closes_at, has_timeslots,
      waitlist_enabled, max_waitlist_size, timeslots,
      mandatory, is_konfirmation, bring_items, checkin_window, teamer_needed, teamer_only,
      teamer_max_participants, teamer_waitlist_enabled, teamer_max_waitlist_size
    } = req.body;

    // Teamer-Felder validieren: gegenseitiger Ausschluss
    if (teamer_needed && teamer_only) {
      return res.status(400).json({ error: 'teamer_needed und teamer_only schließen sich gegenseitig aus' });
    }

    // Teamer-Kontingent validieren (0 = unbegrenzt, negativ ist ungueltig)
    const teamerQuotaCheck = validateTeamerQuota(teamer_max_participants, teamer_max_waitlist_size);
    if (teamerQuotaCheck) {
      return res.status(400).json({ error: teamerQuotaCheck });
    }

    // checkin_window validieren (5-120, Default 30)
    const effectiveCheckinWindow = Math.max(5, Math.min(120, parseInt(checkin_window) || 30));

    // Guards für Pflicht-Events
    // Pflicht- UND Konfirmations-Events geben keine Punkte (serverseitig erzwungen).
    const effectivePoints = (mandatory || is_konfirmation) ? 0 : points;

    // Org-Isolation: fremde jahrgang_ids/category_ids abweisen (Cross-Org-Referenzen)
    try {
      if (!(await allIdsBelongToOrg(db, 'jahrgaenge', jahrgang_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens ein Jahrgang gehört nicht zu deiner Organisation' });
      }
      if (!(await allIdsBelongToOrg(db, 'categories', category_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens eine Kategorie gehört nicht zu deiner Organisation' });
      }
    } catch (err) {
      console.error('Org-Ownership-Check fehlgeschlagen:', err);
      return res.status(500).json({ error: 'Datenbankfehler' });
    }
    // Reine Teamer-Events haben keine Konfi-Plaetze -> 0 (= unbegrenzt/irrelevant)
    const effectiveMaxParticipants = (mandatory || teamer_only) ? 0 : max_participants;
    const effectiveWaitlist = mandatory ? false : (waitlist_enabled !== undefined ? waitlist_enabled : true);
    // Timeslots bei Pflicht-Events UND Konfirmationen nicht erlaubt (siehe POST).
    // Wird ein Event nachträglich zu mandatory/is_konfirmation, fällt es unten in
    // den !effectiveHasTimeslots-Zweig und vorhandene Timeslots ohne Buchungen
    // werden entfernt.
    const effectiveHasTimeslots = (mandatory || is_konfirmation) ? false : (has_timeslots || false);

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Alte Werte lesen: mandatory/registration_open_notified für Auto-Enrollment-Logik,
      // name/event_date/event_end_time/location/cancelled für den Aenderungs-Push-Vergleich unten,
      // teamer_max_participants für das Teamer-Nachruecken bei Kapazitaetserhoehung
      const { rows: [oldEvent] } = await client.query(
        'SELECT mandatory, registration_open_notified, name, event_date, event_end_time, location, cancelled, teamer_max_participants FROM events WHERE id = $1',
        [id]
      );

      // Teamer-Kontingent: nachträglich editierbar. Wird ein Feld nicht mitgeschickt,
      // bleibt der bisherige Wert erhalten (COALESCE über den Parameter).
      const effectiveTeamerMax = (teamer_max_participants === undefined || teamer_max_participants === null)
        ? null
        : parseInt(teamer_max_participants, 10);
      const effectiveTeamerWaitlist = (teamer_waitlist_enabled === undefined || teamer_waitlist_enabled === null)
        ? null
        : !!teamer_waitlist_enabled;
      const effectiveTeamerMaxWaitlist = (teamer_max_waitlist_size === undefined || teamer_max_waitlist_size === null)
        ? null
        : parseInt(teamer_max_waitlist_size, 10);

      const updateQuery = `
        UPDATE events SET
          name = $1, description = $2, event_date = $3, event_end_time = $4, location = $5,
          location_maps_url = $6, points = $7, point_type = $8, type = $9,
          max_participants = $10, registration_opens_at = $11, registration_closes_at = $12,
          has_timeslots = $13, waitlist_enabled = $14, max_waitlist_size = $15,
          mandatory = $16, is_konfirmation = $17, bring_items = $18, checkin_window = $19,
          teamer_needed = $20, teamer_only = $21,
          teamer_max_participants = COALESCE($22, teamer_max_participants),
          teamer_waitlist_enabled = COALESCE($23, teamer_waitlist_enabled),
          teamer_max_waitlist_size = COALESCE($24, teamer_max_waitlist_size)
        WHERE id = $25 AND organization_id = $26
      `;
      const { rowCount } = await client.query(updateQuery, [
        name, description, event_date, event_end_time, location, location_maps_url,
        effectivePoints, point_type, type, effectiveMaxParticipants, registration_opens_at,
        registration_closes_at, effectiveHasTimeslots,
        effectiveWaitlist, max_waitlist_size || 10,
        mandatory || false, is_konfirmation || false, bring_items || null,
        effectiveCheckinWindow, teamer_needed || false, teamer_only || false,
        effectiveTeamerMax, effectiveTeamerWaitlist, effectiveTeamerMaxWaitlist,
        id, req.user.organization_id
      ]);

      if (rowCount === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Event nicht gefunden oder keine Berechtigung' });
      }

      // Clear and re-add categories and jahrgaenge
      await client.query("DELETE FROM event_categories WHERE event_id = $1", [id]);
      await client.query("DELETE FROM event_jahrgang_assignments WHERE event_id = $1", [id]);

      // Add categories and jahrgaenge back sequentially
      if (category_ids && Array.isArray(category_ids) && category_ids.length > 0) {
        const categoryQuery = "INSERT INTO event_categories (event_id, category_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING";
        await client.query(categoryQuery, [id, category_ids]);
      }
      if (jahrgang_ids && Array.isArray(jahrgang_ids) && jahrgang_ids.length > 0) {
        const jahrgangQuery = "INSERT INTO event_jahrgang_assignments (event_id, jahrgang_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING";
        await client.query(jahrgangQuery, [id, jahrgang_ids]);
      }

      // Auto-Enrollment für Pflicht-Events. Frueher haing das an
      // `!oldEvent.mandatory` und griff damit nur bei der Umwandlung
      // freiwillig -> Pflicht. Kam zu einem Termin, der schon Pflicht war, ein
      // weiterer Jahrgang dazu, blieben dessen Konfis still ungebucht
      // ON CONFLICT DO NOTHING macht den Lauf idempotent,
      // bestehende Buchungen bleiben also unangetastet.
      if (mandatory && jahrgang_ids && jahrgang_ids.length > 0) {
        const enrollQuery = `
          INSERT INTO event_bookings (event_id, user_id, status, booking_date, organization_id)
          SELECT $1, u.id, 'confirmed', NOW(), $3
          FROM users u
          JOIN konfi_profiles kp ON u.id = kp.user_id
          JOIN roles r ON u.role_id = r.id
          WHERE kp.jahrgang_id = ANY($2::int[])
            AND u.organization_id = $3
            AND r.name = 'konfi'
            AND u.deleted_at IS NULL
          ON CONFLICT (user_id, event_id) DO NOTHING
        `;
        await client.query(enrollQuery, [id, jahrgang_ids, req.user.organization_id]);
        // Die frisch Eingebuchten gehören auch in den Chat, falls es einen gibt.
        await syncEventChat(client, id, req.user.organization_id);
      }

      // Handle timeslots - intelligent update to preserve booking references.
      // effectiveHasTimeslots ist bei mandatory/is_konfirmation false -> dann greift
      // unten der else-Zweig und entfernt vorhandene Timeslots (sofern unbenutzt).
      if (effectiveHasTimeslots && timeslots && Array.isArray(timeslots) && timeslots.length > 0) {
        // Get existing timeslot IDs
        const { rows: existingSlots } = await client.query(
          "SELECT id FROM event_timeslots WHERE event_id = $1", [id]
        );
        const existingIds = new Set(existingSlots.map(s => s.id));

        // Track which IDs are in the new timeslots
        const newIds = new Set(timeslots.filter(ts => ts.id).map(ts => ts.id));

        // Delete timeslots that are no longer in the list (and have no bookings)
        for (const existingId of existingIds) {
          if (!newIds.has(existingId)) {
            // Check if this timeslot has bookings
            const { rows: [bookingCheck] } = await client.query(
              `SELECT COUNT(*)::int as count FROM event_bookings eb
               JOIN event_timeslots et ON eb.timeslot_id = et.id
               WHERE et.id = $1 AND et.organization_id = $2`, [existingId, req.user.organization_id]
            );
            if (bookingCheck.count === 0) {
              await client.query("DELETE FROM event_timeslots WHERE id = $1", [existingId]);
            }
            // If has bookings, keep the timeslot but it won't show in the UI
          }
        }

        // Update existing or insert new timeslots
        for (const slot of timeslots) {
          if (slot.id && existingIds.has(slot.id)) {
            // Update existing timeslot
            await client.query(
              "UPDATE event_timeslots SET start_time = $1, end_time = $2, max_participants = $3 WHERE id = $4",
              [slot.start_time, slot.end_time, slot.max_participants, slot.id]
            );
          } else {
            // Insert new timeslot
            await client.query(
              "INSERT INTO event_timeslots (event_id, start_time, end_time, max_participants, organization_id) VALUES ($1, $2, $3, $4, $5)",
              [id, slot.start_time, slot.end_time, slot.max_participants, req.user.organization_id]
            );
          }
        }
      } else if (!effectiveHasTimeslots) {
        // Only delete timeslots if event no longer has timeslots AND no bookings reference them
        const { rows: [bookingCheck] } = await client.query(
          "SELECT COUNT(*)::int as count FROM event_bookings eb JOIN event_timeslots et ON eb.timeslot_id = et.id WHERE et.event_id = $1", [id]
        );
        if (bookingCheck.count === 0) {
          await client.query("DELETE FROM event_timeslots WHERE event_id = $1", [id]);
        }
      }

      // Nachrück-Logik: Wenn Kapazität erhöht wurde, Wartelisten-Einträge nachrücken lassen.
      // Konfi- und Team-Kontingent sind strikt getrennt. Die Zaehlung folgt der
      // Sicht aus Migration 136 (zaehleBestaetigte): Konfi-Seite = ausschliesslich
      // Konfis, Team-Seite = Teamer:innen UND zugeordnete Leitung, geloeschte
      // Konten nie. Vorher stand hier `r.name != 'teamer'` — eine zugeordnete
      // Leitung belegte damit einen Konfi-Platz und blockierte das Nachruecken.
      const promotedUsers = [];
      const promotedTeamers = [];
      if (has_timeslots && timeslots && Array.isArray(timeslots) && timeslots.length > 0) {
        // Bei Timeslot-Events: Für jeden Timeslot separat prüfen
        for (const slot of timeslots) {
          if (!slot.id) continue; // Nur bestehende Timeslots prüfen
          const bestaetigt = await zaehleBestaetigte(client, { timeslotId: slot.id }, 'konfi');
          const freeSlots = slot.max_participants - bestaetigt;
          if (freeSlots > 0) {
            const { rows: waitlistEntries } = await client.query(
              `SELECT eb.id, eb.user_id FROM event_bookings eb
               JOIN users u ON eb.user_id = u.id
               JOIN roles r ON u.role_id = r.id
               WHERE eb.event_id = $1 AND eb.timeslot_id = $2 AND eb.status = 'waitlist' AND eb.organization_id = $4
                 AND r.name = 'konfi' AND u.deleted_at IS NULL
               ORDER BY eb.created_at ASC LIMIT $3`,
              [id, slot.id, freeSlots, req.user.organization_id]
            );
            for (const entry of waitlistEntries) {
              await client.query("UPDATE event_bookings SET status = 'confirmed' WHERE id = $1", [entry.id]);
              promotedUsers.push(entry.user_id);
            }
          }
        }
      } else if (max_participants > 0) {
        // Bei normalen Events: Gesamtkapazität prüfen (Teamer zählen nicht mit)
        const bestaetigt = await zaehleBestaetigte(client, { eventId: id }, 'konfi');
        const freeSlots = max_participants - bestaetigt;
        if (freeSlots > 0) {
          const { rows: waitlistEntries } = await client.query(
            `SELECT eb.id, eb.user_id FROM event_bookings eb
             JOIN users u ON eb.user_id = u.id
             JOIN roles r ON u.role_id = r.id
             WHERE eb.event_id = $1 AND eb.status = 'waitlist'
               AND r.name = 'konfi' AND u.deleted_at IS NULL
             ORDER BY eb.created_at ASC LIMIT $2`,
            [id, freeSlots]
          );
          for (const entry of waitlistEntries) {
            await client.query("UPDATE event_bookings SET status = 'confirmed' WHERE id = $1", [entry.id]);
            promotedUsers.push(entry.user_id);
          }
        }
      }

      // Teamer-Nachruecken bei Erhöhung von teamer_max_participants.
      // Bestandsschutz bei Reduktion: bereits bestaetigte Teamer werden NIE
      // zurueckgestuft (identisch zum Konfi-Verhalten). 0 = unbegrenzt -> alle
      // Wartenden ruecken nach.
      const newTeamerMax = effectiveTeamerMax !== null ? effectiveTeamerMax : (oldEvent?.teamer_max_participants ?? 0);
      const oldTeamerMax = oldEvent?.teamer_max_participants ?? 0;
      if (newTeamerMax === 0 || newTeamerMax > oldTeamerMax) {
        const teamBestaetigt = await zaehleBestaetigte(client, { eventId: id }, 'team');
        // 0 = unbegrenzt -> keine Obergrenze für die Anzahl der Nachruecker
        const freeTeamerSlots = newTeamerMax === 0
          ? null
          : newTeamerMax - teamBestaetigt;
        if (freeTeamerSlots === null || freeTeamerSlots > 0) {
          const limitClause = freeTeamerSlots === null ? '' : 'LIMIT $2';
          const limitParams = freeTeamerSlots === null ? [id] : [id, freeTeamerSlots];
          const { rows: teamerWaitlistEntries } = await client.query(
            `SELECT eb.id, eb.user_id FROM event_bookings eb
             JOIN users u ON eb.user_id = u.id
             JOIN roles r ON u.role_id = r.id
             WHERE eb.event_id = $1 AND eb.status = 'waitlist'
               AND r.name <> 'konfi' AND u.deleted_at IS NULL
             ORDER BY eb.created_at ASC ${limitClause}`,
            limitParams
          );
          for (const entry of teamerWaitlistEntries) {
            await client.query("UPDATE event_bookings SET status = 'confirmed' WHERE id = $1", [entry.id]);
            promotedTeamers.push(entry.user_id);
          }
        }
      }

      await client.query('COMMIT');
      client.release();

      // Push-Notifications und Live-Updates für nachgerückte Konfis (nach COMMIT)
      if (promotedUsers.length > 0) {
        const { rows: [eventInfo] } = await db.query("SELECT name FROM events WHERE id = $1", [id]);
        for (const userId of promotedUsers) {
          try {
            await PushService.sendWaitlistPromotionToKonfi(db, userId, eventInfo ? eventInfo.name : name, null, id, req.user.organization_id);
          } catch (pushErr) {
 console.error('Push notification failed for waitlist promotion:', pushErr);
          }
          // sendToUserByRole: von der Warteliste ruecken auch Teamer:innen nach
          // (eigene Teamer-Warteliste, teamer_waitlist_enabled).
          liveUpdate.sendToUserByRole(userId, 'events', 'update', { eventId: id, action: 'promoted' });
        }
      }

      // Push-Notifications und Live-Updates für nachgerückte Teamer:innen (nach COMMIT)
      if (promotedTeamers.length > 0) {
        const { rows: [eventInfo] } = await db.query("SELECT name FROM events WHERE id = $1", [id]);
        for (const userId of promotedTeamers) {
          try {
            await PushService.sendWaitlistPromotionToTeamer(db, userId, eventInfo ? eventInfo.name : name, null, id, req.user.organization_id);
          } catch (pushErr) {
            console.error('Push notification failed for teamer waitlist promotion:', pushErr);
          }
          liveUpdate.sendToUser('teamer', userId, 'events', 'update', { eventId: id, action: 'promoted' });
        }
      }

      res.json({
        message: 'Event erfolgreich aktualisiert',
        promoted_count: promotedUsers.length,
        promoted_teamer_count: promotedTeamers.length
      });

      nachAntwort(req, async () => {
        // Live Update: Notify all konfis and admins about the event update
        liveUpdate.sendToOrg(req.user.organization_id, 'events', 'update', { eventId: id });

        // "Anmeldung möglich"-Push beim AENDERN — KEIN direkter Push hier, nur Flag
        // pflegen (Flankenerkennung). Den Push sendet allein der Cron (atomar) ->
        // keine Doppel-Pushes.
        // - Wird das Event NICHT-anmeldbar (Anmeldung in Zukunft/zu/abgesagt) ->
        //   Flag auf false zuruecksetzen, damit beim nächsten Oeffnen erneut
        //   gepusht wird.
        // - Wird es anmeldbar, ist das Flag aber noch false (z.B. neu geoeffnet),
        //   greift der Cron automatisch.
        // Pflicht-Events haben einen eigenen Erstellungs-Push -> hier ausgenommen.
        if (!mandatory) {
          try {
            const openNow = isRegistrationOpenForKonfis({
              registration_opens_at, registration_closes_at,
              cancelled: false, teamer_only
            });
            if (!openNow && oldEvent?.registration_open_notified) {
              await db.query('UPDATE events SET registration_open_notified = false WHERE id = $1', [id]);
            }
          } catch (pushErr) {
            console.error('Flag-Reset for event update (registration open) failed:', pushErr);
          }
        }

        // Push an gebuchte Teilnehmer bei relevanter Änderung (Termin/Uhrzeit/Ort).
        // Normalisierung nötig: DB liefert Date-Objekte (event_date/event_end_time),
        // der Request liefert Strings -> ohne Normalisierung wuerde der Vergleich bei
        // JEDEM Speichern (auch ohne inhaltliche Änderung) als "geändert" durchgehen.
        try {
          const normalizeDate = (value) => {
            if (!value) return null;
            const d = new Date(value);
            return Number.isNaN(d.getTime()) ? null : d.getTime();
          };
          const normalizeLocation = (value) => (value === undefined || value === null || value === '') ? null : String(value);

          const dateChanged = normalizeDate(oldEvent?.event_date) !== normalizeDate(event_date);
          const endTimeChanged = normalizeDate(oldEvent?.event_end_time) !== normalizeDate(event_end_time);
          const locationChanged = normalizeLocation(oldEvent?.location) !== normalizeLocation(location);

          const isFuture = normalizeDate(event_date) !== null && normalizeDate(event_date) > Date.now();

          if (oldEvent && !oldEvent.cancelled && isFuture && (dateChanged || endTimeChanged || locationChanged)) {
            const { rows: bookedParticipants } = await db.query(
              `SELECT eb.user_id FROM event_bookings eb
               JOIN users u ON eb.user_id = u.id
               WHERE eb.event_id = $1 AND eb.status IN ('confirmed', 'waitlist') AND u.deleted_at IS NULL`,
              [id]
            );
            const bookedUserIds = bookedParticipants.map(p => p.user_id);

            if (bookedUserIds.length > 0) {
              const changes = {};
              if (dateChanged || endTimeChanged) {
                changes.newDate = event_date;
                changes.newEndTime = event_end_time;
              }
              if (locationChanged) {
                changes.newLocation = location;
              }
              await PushService.sendEventChangedToKonfis(db, bookedUserIds, name, changes, id, req.user.organization_id);
            }
          }
        } catch (pushErr) {
          console.error('Push notification failed for event change:', pushErr);
        }
      }, 'PUT /events/:id');

    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
      console.error('Database error in PUT /events/:id:', id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Delete event
  router.delete('/:id', rbacVerifier, requireTeamer, validateEventId, async (req, res) => {
    const { id } = req.params;
    
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // First, verify the event belongs to the organization
      const { rows: [event] } = await client.query("SELECT id, name, event_date, cancelled FROM events WHERE id = $1 AND organization_id = $2", [id, req.user.organization_id]);
      if (!event) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      const forceDelete = req.query.force === 'true';
      if (!forceDelete) {
        const { rows: [usage] } = await client.query(`
          SELECT
            (SELECT COUNT(*)::int FROM event_bookings WHERE event_id = $1 AND status IN ('confirmed', 'waitlist')) AS booking_count,
            (SELECT COUNT(*)::int FROM chat_messages cm JOIN chat_rooms cr ON cm.room_id = cr.id WHERE cr.event_id = $1) AS message_count,
            (SELECT COUNT(*)::int FROM event_points WHERE event_id = $1) AS points_count,
            (SELECT COALESCE(SUM(points), 0)::int FROM event_points WHERE event_id = $1) AS points_total
        `, [id]);

        const bookingsBlockieren = !event.cancelled && usage.booking_count > 0;
        if (bookingsBlockieren || usage.message_count > 0 || usage.points_count > 0) {
          await client.query('ROLLBACK');
          client.release();
          const verluste = [];
          if (usage.booking_count > 0) verluste.push(`${usage.booking_count} Anmeldung(en)`);
          if (usage.message_count > 0) verluste.push(`${usage.message_count} Chat-Nachricht(en)`);
          if (usage.points_count > 0) verluste.push(`${usage.points_total} bereits vergebene Punkte`);
          return res.status(409).json({
            error: `Beim Löschen dieses Events geht verloren: ${verluste.join(', ')}.`,
            error_code: 'event_delete_confirm',
            booking_count: usage.booking_count,
            message_count: usage.message_count,
            points_count: usage.points_count,
            points_total: usage.points_total
          });
        }
      }

      // Push an angemeldete Konfis wenn abgesagtes Event gelöscht wird
      // IMMER einsammeln (nicht nur bei abgesagten Events): wer angemeldet war,
      // muss erfahren, dass der Termin weg ist — egal ob vorher abgesagt oder
      // direkt gelöscht.
      const { rows: bookedKonfis } = await client.query(
        `SELECT eb.user_id FROM event_bookings eb
         JOIN users u ON eb.user_id = u.id
         JOIN roles r ON u.role_id = r.id
         WHERE eb.event_id = $1 AND r.name = 'konfi' AND eb.status IN ('confirmed', 'waitlist') AND u.deleted_at IS NULL`,
        [id]
      );
      const bookedKonfiUserIds = bookedKonfis.map(b => b.user_id);

      // Get event chat rooms and their files before deletion
      const { rows: eventChatRooms } = await client.query("SELECT id FROM chat_rooms WHERE event_id = $1", [id]);
      const allFiles = [];

      for (const room of eventChatRooms) {
        const { rows: roomFiles } = await client.query("SELECT file_path FROM chat_messages WHERE room_id = $1 AND file_path IS NOT NULL", [room.id]);
        allFiles.push(...roomFiles);
      }

      // Proceed with deletions. Order matters due to foreign keys.
      // 1. Delete chat data first
      for (const room of eventChatRooms) {
        // Delete poll votes first (polls are linked via message_id, not room_id)
        await client.query(`
          DELETE FROM chat_poll_votes WHERE poll_id IN (
            SELECT cp.id FROM chat_polls cp
            JOIN chat_messages cm ON cp.message_id = cm.id
            WHERE cm.room_id = $1
          )
        `, [room.id]);

        // Delete polls (via message_id)
        await client.query(`
          DELETE FROM chat_polls WHERE message_id IN (
            SELECT id FROM chat_messages WHERE room_id = $1
          )
        `, [room.id]);
        await client.query("DELETE FROM chat_read_status WHERE room_id = $1", [room.id]);
        await client.query("DELETE FROM chat_messages WHERE room_id = $1", [room.id]);
        await client.query("DELETE FROM chat_participants WHERE room_id = $1", [room.id]);
      }
      await client.query("DELETE FROM chat_rooms WHERE event_id = $1", [id]);

      const { rows: awardedPoints } = await client.query(
        "SELECT konfi_id, points, point_type FROM event_points WHERE event_id = $1",
        [id]
      );
      for (const pts of awardedPoints) {
        const updateProfileQuery = pts.point_type === 'gottesdienst'
          ? "UPDATE konfi_profiles SET gottesdienst_points = GREATEST(0, gottesdienst_points - $1) WHERE user_id = $2"
          : "UPDATE konfi_profiles SET gemeinde_points = GREATEST(0, gemeinde_points - $1) WHERE user_id = $2";
        await client.query(updateProfileQuery, [pts.points, pts.konfi_id]);
      }
      await client.query("DELETE FROM event_points WHERE event_id = $1", [id]);

      // 3. Delete event-specific data
      await client.query("DELETE FROM event_bookings WHERE event_id = $1", [id]);
      await client.query("DELETE FROM event_timeslots WHERE event_id = $1", [id]);
      await client.query("DELETE FROM event_categories WHERE event_id = $1", [id]);
      await client.query("DELETE FROM event_jahrgang_assignments WHERE event_id = $1", [id]);

      // 4. Clean up files from filesystem (best effort)
      const fs = require('fs').promises;
      const path = require('path');

      for (const fileRecord of allFiles) {
        try {
          // Seit der Aufteilung liegt diese Datei eine Ebene tiefer
          // (routes/events/ statt routes/), daher ZWEI '..' bis backend/.
          const fullPath = path.join(__dirname, '..', '..', 'uploads', 'chat', fileRecord.file_path);
          await fs.unlink(fullPath);
        } catch (fileErr) {
 console.warn(`Could not delete file ${fileRecord.file_path}:`, fileErr.message);
        }
      }

      // Finally, delete the event itself
      const { rowCount } = await client.query("DELETE FROM events WHERE id = $1", [id]);

      if (rowCount === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      await client.query('COMMIT');
      client.release();

      res.json({ message: 'Event erfolgreich gelöscht' });

      nachAntwort(req, async () => {
        // Push an Konfis wenn abgesagtes Event mit Buchungen gelöscht wurde
        if (bookedKonfiUserIds.length > 0) {
          const eventDateFormatted = formatDatum(event.event_date);
          try { await PushService.sendEventCancellationToKonfis(db, bookedKonfiUserIds, event.name, eventDateFormatted, req.user.organization_id); } catch (e) { console.error('Push notification failed:', e); }
        }

        // Live Update: Notify all konfis and admins about the event deletion
        liveUpdate.sendToOrg(req.user.organization_id, 'events', 'delete', { eventId: id });

        // Konfis, deren Punkte zurueckgenommen wurden: Dashboard aktualisieren
        // (analog Einzel-Storno in PUT /:id/participants/:participantId/status).
        for (const konfiId of new Set(awardedPoints.map(p => p.konfi_id))) {
          liveUpdate.sendToUserByRole(konfiId, 'dashboard', 'update');
        }
      }, 'DELETE /events/:id');

    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
      console.error('Database error in DELETE /events/:id:', id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Create group chat for event
  router.post('/:id/chat', rbacVerifier, requireTeamer, async (req, res) => {
    const eventId = req.params.id;
    
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const { rows: [event] } = await client.query("SELECT name FROM events WHERE id = $1 AND organization_id = $2", [eventId, req.user.organization_id]);
      if (!event) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      const { rows: [existingChat] } = await client.query("SELECT id FROM chat_rooms WHERE event_id = $1", [eventId]);
      if (existingChat) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({ error: 'Chat existiert bereits für dieses Event' });
      }

      const chatName = `${event.name} - Chat`;
      const { rows: [newChat] } = await client.query("INSERT INTO chat_rooms (name, type, event_id, created_by, organization_id) VALUES ($1, 'group', $2, $3, $4) RETURNING id", [chatName, eventId, req.user.id, req.user.organization_id]);
      const chatRoomId = newChat.id;

      // user_type des Erstellers aus dem Token — hartes 'admin' machte den Raum
      // für Teamer:innen (duerfen Event-Chats erstellen) unsichtbar.
      await client.query("INSERT INTO chat_participants (room_id, user_id, user_type) VALUES ($1, $2, $3)", [chatRoomId, req.user.id, req.user.type]);

      const hinzugefuegt = await syncEventChat(client, eventId, req.user.organization_id);

      await client.query('COMMIT');
      client.release();

      res.status(201).json({
        chat_room_id: chatRoomId,
        message: 'Chat erstellt und Teilnehmer erfolgreich hinzugefügt',
        participants_added: hinzugefuegt
      });

    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
      console.error('Database error in POST /events/:eventId/chat:', eventId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Cancel event (Admin only)
  router.put('/:id/cancel', rbacVerifier, requireTeamer, async (req, res) => {
    const eventId = req.params.id;
    const { notification_message = 'Das Event wurde abgesagt.' } = req.body;
    
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Get event details
      const { rows: [event] } = await client.query(
        "SELECT name, event_date, cancelled FROM events WHERE id = $1 AND organization_id = $2",
        [eventId, req.user.organization_id]
      );

      if (!event) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      if (event.cancelled) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ error: 'Event ist bereits abgesagt' });
      }

      // Mark event as cancelled
      await client.query(
        "UPDATE events SET cancelled = TRUE, cancelled_at = NOW() WHERE id = $1",
        [eventId]
      );

      // Get all participants to notify
      const { rows: participants } = await client.query(`
        SELECT DISTINCT eb.user_id, u.display_name, u.username
        FROM event_bookings eb
        JOIN users u ON eb.user_id = u.id
        WHERE eb.event_id = $1 AND eb.status IN ('confirmed', 'waitlist') AND u.deleted_at IS NULL
      `, [eventId]);

      await client.query('COMMIT');
      client.release();

      // Push und LiveUpdate NACH COMMIT und client.release()
      const userIds = participants.map(p => p.user_id);
      const eventDateFormatted = formatDatum(event.event_date);
      if (userIds.length > 0) {
        try { await PushService.sendEventCancellationToKonfis(db, userIds, event.name, eventDateFormatted, req.user.organization_id); } catch (e) { console.error('Push notification failed:', e); }
      }

      res.json({
        message: `Event "${event.name}" wurde abgesagt`,
        participants_notified: participants.length,
        notification_message
      });

      liveUpdate.sendToOrg(req.user.organization_id, 'events', 'update', { eventId, action: 'cancelled' });

    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
      console.error('Database error in PUT /events/:eventId/cancel:', eventId, err);
      res.status(500).json({ error: 'Datenbankfehler beim Absagen des Events' });
    }
  });

  return router;
};
