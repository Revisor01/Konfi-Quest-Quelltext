// Deshalb steht vor jeder schreibenden Route hier requireAdmin (org_admin,
// admin) statt des frueheren requireTeamer (das zusaetzlich 'teamer' zuliess).
// GESPERRT WIRD IN BEIDEN EBENEN: Die Oberflaeche zeigt den Teamer:innen
// diese Aktionen nicht mehr, und das Backend lehnt sie mit 403 ab — eine
// Sperre nur in der Oberflaeche ist keine.
//
// Am selben Tag war die Teamer-Absage kurzzeitig gebaut worden (Oberflaeche
// und Tests); das ist keine Fehlkorrektur, sondern eine geaenderte
// Anforderung.
//
// WAS DEM TEAM BLEIBT: die eigene Zu- und Absage der Teilnahme
// (POST /teamer/events/:id/zusage), der QR-Code zum Einchecken
// (events/checkin.js) und der Termin-Chat. Alles Lesende ohnehin.
const express = require('express');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../../middleware/validation');
const PushService = require('../../services/pushService');
const liveUpdate = require('../../utils/liveUpdate');
const { isRegistrationOpenForKonfis, zaehleBuchungen, rueckeNach, freiePlaetze, meldeAlleAbBeiAbsage, hebeAbsageAbmeldungenAuf, ABSAGE_OHNE_GRUND } = require('../../utils/bookingUtils');
const { allIdsBelongToOrg } = require('../../utils/orgOwnership');
const { syncEventChat } = require('../../utils/eventChat');
const { nachAntwort } = require('../../utils/nachAntwort');
const { validateTeamerQuota, pruefeAnmeldeschluss } = require('./validierung');
const { formatDatum } = require('../../utils/zeitformat');
const { darfTermin, darfJahrgang } = require('../../utils/jahrgangsZugriff');

module.exports = (db, rbacVerifier, { requireAdmin }) => {
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
  router.post('/', rbacVerifier, requireAdmin, validateCreateEvent, async (req, res) => {
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

    // Anmeldeschluss darf an einem noch kommenden Termin nicht schon
    // abgelaufen sein (Begruendung bei pruefeAnmeldeschluss in validierung.js).
    const schlussFehler = pruefeAnmeldeschluss(registration_closes_at, event_date);
    if (schlussFehler) {
      return res.status(400).json({ error: schlussFehler });
    }

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

      // Jahrgangs-Bindung: Ein Termin darf nur in eigenen
      // Jahrgaengen entstehen — sonst waere er unmittelbar nach dem Anlegen
      // fuer die Erstellerin selbst unsichtbar (die Liste filtert) und die
      // Schreibrouten wiesen sie ab. Dieselbe Doppelpruefung wie beim
      // Verschieben einer Konfi (konfi-management.js, PUT /:id).
      if (Array.isArray(jahrgang_ids) && jahrgang_ids.length > 0) {
        const alleErlaubt = jahrgang_ids.every(jid => darfJahrgang(req, jid, { edit: true }));
        if (!alleErlaubt) {
          return res.status(403).json({ error: 'Kein Zugriff auf diesen Jahrgang' });
        }
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
  router.put('/:id', rbacVerifier, requireAdmin, validateUpdateEvent, async (req, res) => {
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

    // Wie beim Anlegen: an einem noch kommenden Termin darf der
    // Anmeldeschluss nicht in die Vergangenheit gesetzt werden. Bei einem
    // vergangenen Termin bleibt die nachtraegliche Pflege moeglich.
    const schlussFehlerUpdate = pruefeAnmeldeschluss(registration_closes_at, event_date);
    if (schlussFehlerUpdate) {
      return res.status(400).json({ error: schlussFehlerUpdate });
    }

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
    // Vor dem try: die Nacharbeit hinter dem finally braucht diese Werte.
    let oldEvent = null;
    let fruehAntwort = null;
    const promotedUsers = [];
    const promotedTeamers = [];
    try {
      await client.query('BEGIN');

      // Alte Werte lesen: mandatory/registration_open_notified für Auto-Enrollment-Logik,
      // name/event_date/event_end_time/location/cancelled für den Aenderungs-Push-Vergleich unten,
      // teamer_max_participants für das Teamer-Nachruecken bei Kapazitaetserhoehung
      const { rows: [alterStand] } = await client.query(
        'SELECT mandatory, registration_open_notified, name, event_date, event_end_time, location, cancelled, teamer_max_participants FROM events WHERE id = $1',
        [id]
      );
      oldEvent = alterStand;

      const zugriff = await darfTermin(client, req, id);
      // Und der ZIEL-Jahrgang muss ebenfalls ein eigener sein — dieselbe
      // Doppelpruefung wie beim Verschieben einer Konfi
      // (konfi-management.js, PUT /:id).
      const zielJahrgangErlaubt = !(Array.isArray(jahrgang_ids) && jahrgang_ids.length > 0)
        || jahrgang_ids.every(jid => darfJahrgang(req, jid, { edit: true }));

      if (!zugriff.erlaubt) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 403, body: { error: 'Kein Zugriff auf diesen Termin' } };
      } else if (!zielJahrgangErlaubt) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 403, body: { error: 'Kein Zugriff auf diesen Jahrgang' } };
      } else {

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
        fruehAntwort = { status: 404, body: { error: 'Event nicht gefunden oder keine Berechtigung' } };
      } else {

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
      if (has_timeslots && timeslots && Array.isArray(timeslots) && timeslots.length > 0) {
        // Bei Timeslot-Events: Für jeden Timeslot separat prüfen
        for (const slot of timeslots) {
          if (!slot.id) continue; // Nur bestehende Timeslots prüfen
          const frei = await freiePlaetze(client, { eventId: id, timeslotId: slot.id, seite: 'konfi' }, slot.max_participants);
          const { waitlist: wartendeSlot } = await zaehleBuchungen(client, { timeslotId: slot.id }, 'konfi');
          const obergrenzeSlot = frei === null ? wartendeSlot : Math.min(frei, wartendeSlot);
          if (obergrenzeSlot > 0) {
            const nachgerueckt = await rueckeNach(client, {
              eventId: id, timeslotId: slot.id, seite: 'konfi', anzahl: obergrenzeSlot
            });
            promotedUsers.push(...nachgerueckt);
          }
        }
      } else if (max_participants > 0) {
        // Bei normalen Events: Gesamtkapazität prüfen (Teamer zählen nicht mit)
        const frei = await freiePlaetze(client, { eventId: id, seite: 'konfi' }, max_participants);
        if (frei > 0) {
          const nachgerueckt = await rueckeNach(client, { eventId: id, seite: 'konfi', anzahl: frei });
          promotedUsers.push(...nachgerueckt);
        }
      }

      // Teamer-Nachruecken bei Erhöhung von teamer_max_participants.
      // Bestandsschutz bei Reduktion: bereits bestaetigte Teamer werden NIE
      // zurueckgestuft (identisch zum Konfi-Verhalten). 0 = unbegrenzt -> alle
      // Wartenden ruecken nach.
      const newTeamerMax = effectiveTeamerMax !== null ? effectiveTeamerMax : (oldEvent?.teamer_max_participants ?? 0);
      const oldTeamerMax = oldEvent?.teamer_max_participants ?? 0;
      if (newTeamerMax === 0 || newTeamerMax > oldTeamerMax) {
        // 0 = unbegrenzt -> keine Obergrenze fuer die Anzahl der Nachruecker.
        // Die Wartenden sind die natuerliche Obergrenze: rueckeNach hoert auf,
        // sobald die Warteliste leer ist.
        const frei = await freiePlaetze(client, { eventId: id, seite: 'team' }, newTeamerMax);
        const { waitlist: wartende } = await zaehleBuchungen(client, { eventId: id }, 'team');
        const obergrenze = frei === null ? wartende : Math.min(frei, wartende);
        if (obergrenze > 0) {
          const nachgerueckt = await rueckeNach(client, { eventId: id, seite: 'team', anzahl: obergrenze });
          promotedTeamers.push(...nachgerueckt);
        }
      }

      await client.query('COMMIT');
      }
      }
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database error in PUT /events/:id:', id, txErr);
      return res.status(500).json({ error: 'Datenbankfehler' });
    } finally {
      // KEIN client.release() im try — nur hier. Die Nacharbeit (Pushes,
      // Live-Updates, Antwort) steht bewusst dahinter.
      client.release();
    }

    if (fruehAntwort) {
      return res.status(fruehAntwort.status).json(fruehAntwort.body);
    }

    try {
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
    } catch (nachErr) {
      // Die Aenderung ist festgeschrieben — ein Fehler beim Benachrichtigen
      // darf die Antwort nicht mehr in einen 500 kippen.
      console.error('Post-commit error in PUT /events/:id:', id, nachErr);
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
            // Die Auswahl bleibt, wie sie ist -- und faengt seit Migration
            // 153 einen Fall mit, der vorher durchrutschte: Eine
            // abgemeldete Person steht nicht mehr auf 'confirmed' und bekommt
            // damit kein "Der Termin wurde verlegt" mehr fuer einen Termin,
            // an dem sie nicht teilnimmt. Kein Eingriff noetig; die Regel
            // "wer gebucht ist, wird benachrichtigt" stimmt jetzt einfach.
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
  });

  // Delete event
  router.delete('/:id', rbacVerifier, requireAdmin, validateEventId, async (req, res) => {
    const { id } = req.params;
    
    const client = await db.getClient();
    // Vor dem try: die Nacharbeit hinter dem finally braucht diese Werte.
    let event = null;
    let fruehAntwort = null;
    let bookedKonfiUserIds = [];
    let awardedPoints = [];
    try {
      await client.query('BEGIN');

      // First, verify the event belongs to the organization
      const { rows: [gefunden] } = await client.query("SELECT id, name, event_date, cancelled, cancelled_reason FROM events WHERE id = $1 AND organization_id = $2", [id, req.user.organization_id]);
      event = gefunden;

      const zugriff = event ? await darfTermin(client, req, id) : null;

      if (!event) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 404, body: { error: 'Event nicht gefunden' } };
      } else if (!zugriff.erlaubt) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 403, body: { error: 'Kein Zugriff auf diesen Termin' } };
      } else {

      const forceDelete = req.query.force === 'true';
      if (!forceDelete) {
        const { rows: [usage] } = await client.query(`
          SELECT
            (SELECT COUNT(*)::int FROM event_bookings WHERE event_id = $1 AND status IN ('confirmed', 'waitlist', 'excused')) AS booking_count,
            (SELECT COUNT(*)::int FROM chat_messages cm JOIN chat_rooms cr ON cm.room_id = cr.id WHERE cr.event_id = $1) AS message_count,
            (SELECT COUNT(*)::int FROM event_points WHERE event_id = $1) AS points_count,
            (SELECT COALESCE(SUM(points), 0)::int FROM event_points WHERE event_id = $1) AS points_total
        `, [id]);

        const bookingsBlockieren = !event.cancelled && usage.booking_count > 0;
        if (bookingsBlockieren || usage.message_count > 0 || usage.points_count > 0) {
          await client.query('ROLLBACK');
          const verluste = [];
          if (usage.booking_count > 0) verluste.push(`${usage.booking_count} Anmeldung(en)`);
          if (usage.message_count > 0) verluste.push(`${usage.message_count} Chat-Nachricht(en)`);
          if (usage.points_count > 0) verluste.push(`${usage.points_total} bereits vergebene Punkte`);
          fruehAntwort = { status: 409, body: {
            error: `Beim Löschen dieses Events geht verloren: ${verluste.join(', ')}.`,
            error_code: 'event_delete_confirm',
            booking_count: usage.booking_count,
            message_count: usage.message_count,
            points_count: usage.points_count,
            points_total: usage.points_total
          } };
        }
      }

      if (!fruehAntwort) {

      // Push an angemeldete Konfis wenn abgesagtes Event gelöscht wird
      // IMMER einsammeln (nicht nur bei abgesagten Events): wer angemeldet war,
      // muss erfahren, dass der Termin weg ist — egal ob vorher abgesagt oder
      // direkt gelöscht.
      const { rows: bookedKonfis } = await client.query(
        `SELECT eb.user_id FROM event_bookings eb
         JOIN users u ON eb.user_id = u.id
         JOIN roles r ON u.role_id = r.id
         WHERE eb.event_id = $1 AND r.name = 'konfi' AND eb.status IN ('confirmed', 'waitlist', 'excused') AND u.deleted_at IS NULL`,
        [id]
      );
      bookedKonfiUserIds = bookedKonfis.map(b => b.user_id);

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

      const { rows: vergebenePunkte } = await client.query(
        "SELECT konfi_id, points, point_type FROM event_points WHERE event_id = $1",
        [id]
      );
      awardedPoints = vergebenePunkte;
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
        fruehAntwort = { status: 404, body: { error: 'Event nicht gefunden' } };
      } else {
        await client.query('COMMIT');
      }
      }
      }
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database error in DELETE /events/:id:', id, txErr);
      return res.status(500).json({ error: 'Datenbankfehler' });
    } finally {
      // KEIN client.release() im try — nur hier.
      client.release();
    }

    if (fruehAntwort) {
      return res.status(fruehAntwort.status).json(fruehAntwort.body);
    }

    res.json({ message: 'Event erfolgreich gelöscht' });

    nachAntwort(req, async () => {
      // Bis hierher ging bei JEDEM Loeschen eine Absage-Meldung raus. Wer
      // einen Termin erst absagt und ihn spaeter aufraeumt — der uebliche Weg,
      // das Handbuch empfiehlt genau ihn —, schickte denselben zwanzig Konfis
      // zweimal "Leider abgesagt: 'Konfifreizeit' am Sa., 20.09.". Beim
      // zweiten Mal war der Termin in der App schon durchgestrichen; die
      // Meldung erzaehlte nichts Neues und sah aus wie ein Fehler.
      //
      // GELOESCHT WIRD DIE MELDUNG NICHT, NUR DIE DOPPLUNG: Wird ein NICHT
      // abgesagter Termin mit Anmeldungen geloescht, geht sie wie bisher raus
      // — dort ist sie die einzige Nachricht, die diese Leute je bekommen.
      // Der Vertrag zur ausgelieferten App aendert sich dabei nicht: Der Push
      // ist ein Ereignis, kein Antwortfeld; eine App, die eine Meldung
      // weniger bekommt, bricht nicht.
      //
      // OHNE KENNUNG (letzter Parameter bleibt weg): Der Termin ist in
      // derselben Transaktion geloescht worden. Ein Sprung dorthin fuehrte
      // ins Leere — die Meldung bleibt auf der Terminliste.
      if (bookedKonfiUserIds.length > 0 && !event.cancelled) {
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
  });

  router.post('/:id/chat', rbacVerifier, requireAdmin, async (req, res) => {
    const eventId = req.params.id;
    
    const client = await db.getClient();
    // Vor dem try: die Antwort steht hinter dem finally.
    let fruehAntwort = null;
    let chatRoomId = null;
    let hinzugefuegt = 0;
    try {
      await client.query('BEGIN');

      const { rows: [event] } = await client.query("SELECT name FROM events WHERE id = $1 AND organization_id = $2", [eventId, req.user.organization_id]);

      // Jahrgangs-Bindung: Der Event-Chat nimmt alle Angemeldeten
      // auf — wer den Termin nicht sehen darf, legt auch keinen Raum dazu an.
      const zugriff = event ? await darfTermin(client, req, eventId) : null;
      const { rows: [existingChat] } = event ? await client.query("SELECT id FROM chat_rooms WHERE event_id = $1", [eventId]) : { rows: [] };

      if (!event) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 404, body: { error: 'Event nicht gefunden' } };
      } else if (!zugriff.erlaubt) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 403, body: { error: 'Kein Zugriff auf diesen Termin' } };
      } else if (existingChat) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 409, body: { error: 'Chat existiert bereits für dieses Event' } };
      } else {

      const chatName = `${event.name} - Chat`;
      const { rows: [newChat] } = await client.query("INSERT INTO chat_rooms (name, type, event_id, created_by, organization_id) VALUES ($1, 'group', $2, $3, $4) RETURNING id", [chatName, eventId, req.user.id, req.user.organization_id]);
      chatRoomId = newChat.id;

      await client.query("INSERT INTO chat_participants (room_id, user_id, user_type) VALUES ($1, $2, $3)", [chatRoomId, req.user.id, req.user.type]);

      hinzugefuegt = await syncEventChat(client, eventId, req.user.organization_id);

      await client.query('COMMIT');
      }
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database error in POST /events/:eventId/chat:', eventId, txErr);
      return res.status(500).json({ error: 'Datenbankfehler' });
    } finally {
      // KEIN client.release() im try — nur hier.
      client.release();
    }

    if (fruehAntwort) {
      return res.status(fruehAntwort.status).json(fruehAntwort.body);
    }

    res.status(201).json({
      chat_room_id: chatRoomId,
      message: 'Chat erstellt und Teilnehmer erfolgreich hinzugefügt',
      participants_added: hinzugefuegt
    });
  });

  // Cancel event (Admin only)
  router.put('/:id/cancel', rbacVerifier, requireAdmin, async (req, res) => {
    const eventId = req.params.id;
    // notification_message BLEIBT (Alt-App-Vertrag): Ausgelieferte
    // App-Fassungen schicken das Feld mit und lesen es aus der Antwort zurueck.
    // Gespeichert oder verschickt wurde es nie — es ist ein Echo, kein Grund
    // (siehe Migration 150). Es anzufassen, um daraus den Absagegrund zu
    // machen, haette genau die Bedeutungsverschiebung erzeugt, vor der der
    // Vertrag schuetzt: Alte Apps schicken hier einen festen Satz ("Das Event
    // wurde leider abgesagt."), der dann als Begruendung an allen Konfis
    // gestanden haette.
    const { notification_message = 'Das Event wurde abgesagt.', cancelled_reason } = req.body;

    // Freitext begrenzen und leere Eingabe auf NULL normalisieren — genauso
    // wie bei excuse_reason und attendance_note (events/anwesenheit.js), damit
    // "kein Grund" und "Grund aus Leerzeichen" nicht zweierlei sind.
    const grund = (() => {
      if (typeof cancelled_reason !== 'string') return null;
      const getrimmt = cancelled_reason.trim();
      return getrimmt === '' ? null : getrimmt.slice(0, 500);
    })();

    const client = await db.getClient();
    // Vor dem try: Push, Antwort und Live-Update stehen hinter dem finally.
    let event = null;
    let fruehAntwort = null;
    let participants = [];
    try {
      await client.query('BEGIN');

      // Get event details
      const { rows: [gefunden] } = await client.query(
        "SELECT name, event_date, cancelled FROM events WHERE id = $1 AND organization_id = $2",
        [eventId, req.user.organization_id]
      );
      event = gefunden;

      const zugriff = (event && !event.cancelled) ? await darfTermin(client, req, eventId) : null;

      if (!event) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 404, body: { error: 'Event nicht gefunden' } };
      } else if (event.cancelled) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 400, body: { error: 'Event ist bereits abgesagt' } };
      } else if (!zugriff.erlaubt) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 403, body: { error: 'Kein Zugriff auf diesen Termin' } };
      } else {

      // Mark event as cancelled
      //
      // Grund und Urheber kommen additiv dazu (Migration 150). Ohne Grund
      // bleibt cancelled_reason NULL — und damit alles so, wie es war.
      // cancelled_by wird IMMER gesetzt, auch ohne Grund: Wer abgesagt hat,
      // ist unabhaengig davon interessant, ob eine Begruendung dabeistand.
      await client.query(
        `UPDATE events
            SET cancelled = TRUE,
                cancelled_at = NOW(),
                cancelled_reason = $2,
                cancelled_by = $3,
                cancelled_reason_set_by = $3,
                cancelled_reason_set_at = NOW()
          WHERE id = $1`,
        [eventId, grund, req.user.id]
      );

      // Get all participants to notify
      const { rows: teilnehmende } = await client.query(`
        SELECT DISTINCT eb.user_id, u.display_name, u.username
        FROM event_bookings eb
        JOIN users u ON eb.user_id = u.id
        WHERE eb.event_id = $1 AND eb.status IN ('confirmed', 'waitlist', 'excused') AND u.deleted_at IS NULL
      `, [eventId]);
      participants = teilnehmende;

      // IN DERSELBEN TRANSAKTION wie die Absage. Schlaegt das Abmelden fehl,
      // faellt auch das cancelled = TRUE zurueck -- ein halb abgesagter
      // Termin waere schlimmer als ein nicht abgesagter, weil ihn niemand
      // mehr als offen erkennt.
      //
      // Der Push bleibt, wie er ist: die Absage-Meldung. Eine zusaetzliche
      // Abmelde-Benachrichtigung waere dieselbe Nachricht ein zweites Mal.
      await meldeAlleAbBeiAbsage(client, eventId, grund);

      await client.query('COMMIT');
      }
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database error in PUT /events/:eventId/cancel:', eventId, txErr);
      return res.status(500).json({ error: 'Datenbankfehler beim Absagen des Events' });
    } finally {
      // KEIN client.release() im try — nur hier.
      client.release();
    }

    if (fruehAntwort) {
      return res.status(fruehAntwort.status).json(fruehAntwort.body);
    }

    // Push und LiveUpdate NACH COMMIT und client.release()
    const userIds = participants.map(p => p.user_id);
    const eventDateFormatted = formatDatum(event.event_date);
    if (userIds.length > 0) {
      try { await PushService.sendEventCancellationToKonfis(db, userIds, event.name, eventDateFormatted, req.user.organization_id, grund, eventId); } catch (e) { console.error('Push notification failed:', e); }
    }

    res.json({
      message: `Event "${event.name}" wurde abgesagt`,
      participants_notified: participants.length,
      notification_message,
      // Additiv: Alte Apps ignorieren das Feld, neue zeigen den Grund direkt
      // an, ohne den Termin nochmal zu laden.
      cancelled_reason: grund
    });

    try {
      liveUpdate.sendToOrg(req.user.organization_id, 'events', 'update', { eventId, action: 'cancelled' });
    } catch (liveErr) {
      console.error('Live-Update nach PUT /events/:eventId/cancel fehlgeschlagen:', liveErr);
    }
  });

  // WARUM EINE EIGENE ROUTE UND NICHT DIE CANCEL-ROUTE ERWEITERT:
  // Die 400 ist Vertrag. Ausgelieferte App-Fassungen rufen /cancel auf und
  // verlassen sich darauf, dass ein zweiter Aufruf abprallt -- etwa beim
  // Doppeltippen auf einem wackeligen Netz. Naehme /cancel den Fall mit,
  // wuerde aus einem folgenlosen Fehlschlag stillschweigend ein zweiter
  // Schreibvorgang, und der Absagegrund kaeme aus einem Feld, das alte Apps
  // gar nicht schicken -- ein vorhandener Grund waere nach jedem Doppeltipp
  // weg. Eine neue Route aendert am Verhalten der alten nichts.
  //
  // UND WARUM NICHT PUT /events/:id (Bearbeiten): Das Bearbeiten-Formular
  // schickt den ganzen Termin. Ein abgesagter Termin ist aber gerade nicht
  // mehr zu bearbeiten -- und ein Feld, das nur bei abgesagten Terminen
  // ueberhaupt eine Bedeutung hat, gehoert nicht in eine Route, die
  // hauptsaechlich fuer die anderen da ist.
  router.put('/:id/absagegrund', rbacVerifier, requireAdmin, async (req, res) => {
    const eventId = req.params.id;
    const { cancelled_reason } = req.body;

    // Exakt dieselbe Normalisierung wie in /cancel (und wie bei excuse_reason
    // und attendance_note in events/anwesenheit.js): getrimmt, auf 500 Zeichen
    // begrenzt, leer wird NULL. Sonst hiesse derselbe Text hier und dort
    // zweierlei, je nachdem, ueber welchen Weg er hereinkam.
    const grund = (() => {
      if (typeof cancelled_reason !== 'string') return null;
      const getrimmt = cancelled_reason.trim();
      return getrimmt === '' ? null : getrimmt.slice(0, 500);
    })();

    const client = await db.getClient();
    let fruehAntwort = null;
    let event = null;
    try {
      await client.query('BEGIN');

      const { rows: [gefunden] } = await client.query(
        "SELECT name, cancelled FROM events WHERE id = $1 AND organization_id = $2",
        [eventId, req.user.organization_id]
      );
      event = gefunden;

      const zugriff = (event && event.cancelled) ? await darfTermin(client, req, eventId) : null;

      if (!event) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 404, body: { error: 'Event nicht gefunden' } };
      } else if (!event.cancelled) {
        // Spiegelbild zur 400 in /cancel: Dort ist "schon abgesagt" der
        // Fehlerfall, hier "noch gar nicht abgesagt". Einen Absagegrund an
        // einem laufenden Termin gaebe es keinen Ort, an dem er angezeigt
        // wuerde -- die Anzeige haengt ueberall an cancelled.
        await client.query('ROLLBACK');
        fruehAntwort = { status: 400, body: { error: 'Event ist nicht abgesagt' } };
      } else if (!zugriff.erlaubt) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 403, body: { error: 'Kein Zugriff auf diesen Termin' } };
      } else {
        // cancelled, cancelled_at, cancelled_by BLEIBEN UNANGETASTET
        // (Migration 152): Wer den Termin abgesagt hat, hat ihn abgesagt --
        // daran aendert eine spaetere Korrektur am Begleittext nichts.
        // Festgehalten wird stattdessen, wer den GRUND zuletzt gesetzt hat.
        await client.query(
          `UPDATE events
              SET cancelled_reason = $2,
                  cancelled_reason_set_by = $3,
                  cancelled_reason_set_at = NOW()
            WHERE id = $1`,
          [eventId, grund, req.user.id]
        );

        // DER KORRIGIERTE GRUND WANDERT ZU DEN ABGEMELDETEN MIT
        // 
        //
        // DER FEHLER, DEN DAS BEHEBT: Die Absage meldet alle Angemeldeten ab
        // und traegt den Absagegrund als excuse_reason ein
        // (bookingUtils.meldeAlleAbBeiAbsage). Aenderte danach jemand den
        // Grund, schrieb diese Route nur an events.cancelled_reason. Am
        // Termin stand danach "Heizung defekt", in der Teilnehmerliste bei
        // jeder einzelnen Person weiter "Heizng defket" — derselbe Sachverhalt
        // an zwei Stellen mit zwei Texten. Wer den Tippfehler korrigiert,
        // korrigiert ihn erwartbar ueberall.
        //
        // NUR WER DURCH DIE ABSAGE ABGEMELDET WURDE (Migration 153,
        // abgemeldet_durch_absage): Das Handbuch nennt den Gegenfall
        // ausdruecklich — "Genauso laesst sich der Grund bei einzelnen
        // Personen durch einen eigenen ersetzen, etwa 'krank, Mutter hat
        // angerufen'". Dieser Satz waere sonst nach der naechsten
        // Grund-Korrektur nicht mehr wahr: Ein von Hand eingetragener Grund
        // gehoert der Person, nicht dem Termin, und wird hier nicht
        // ueberschrieben.
        //
        // WARUM NICHT AM TEXT ERKENNEN ("steht der alte Absagegrund drin?"):
        // Dieselbe Begruendung wie in Migration 153 — eine Leitung, die von
        // Hand denselben Wortlaut eintippt, waere nicht zu unterscheiden, und
        // nach der ersten Korrektur waere der Vergleichstext weg. Herkunft ist
        // eine eigene Angabe, kein Rueckschluss aus einem Freitext.
        //
        // OHNE GRUND DERSELBE FESTE TEXT WIE BEIM ABSAGEN: Wird der Grund
        // geleert, steht bei den Abgemeldeten wieder 'Termin abgesagt'
        // (ABSAGE_OHNE_GRUND) und nicht NULL. Die Zeile in der
        // Teilnehmerliste laese sich sonst als "abgemeldet, Grund unbekannt"
        // — der Grund ist aber bekannt, der Termin faellt aus. Genau so legt
        // es meldeAlleAbBeiAbsage beim Absagen an; beide Wege muessen
        // denselben Stand herstellen.
        //
        // IN DERSELBEN TRANSAKTION: Termin und Buchungen duerfen nicht
        // auseinanderlaufen — das ist der ganze Punkt dieser Aenderung.
        await client.query(
          `UPDATE event_bookings
              SET excuse_reason = $2
            WHERE event_id = $1
              AND abgemeldet_durch_absage = TRUE`,
          [eventId, grund || ABSAGE_OHNE_GRUND]
        );

        await client.query('COMMIT');
      }
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database error in PUT /events/:eventId/absagegrund:', eventId, txErr);
      return res.status(500).json({ error: 'Datenbankfehler beim Ändern des Absagegrunds' });
    } finally {
      // KEIN client.release() im try — nur hier.
      client.release();
    }

    if (fruehAntwort) {
      return res.status(fruehAntwort.status).json(fruehAntwort.body);
    }

    res.json({
      message: `Absagegrund für "${event.name}" wurde ${grund ? 'gespeichert' : 'entfernt'}`,
      cancelled_reason: grund
    });

    try {
      liveUpdate.sendToOrg(req.user.organization_id, 'events', 'update', { eventId, action: 'cancelled' });
    } catch (liveErr) {
      console.error('Live-Update nach PUT /events/:eventId/absagegrund fehlgeschlagen:', liveErr);
    }
  });

  // EINE ABSAGE ZURUECKNEHMEN -- der Termin findet doch statt.
  //
  // Bis hierher war eine Absage endgueltig. Die Heizung ist doch rechtzeitig
  // repariert, der Sturm zieht vorbei -- und der einzige Weg zurueck war, den
  // Termin neu anzulegen: ohne die Angemeldeten, ohne den Chat, ohne die
  // Warteliste, mit neuer Kennung. Alle mussten sich neu anmelden.
  //
  // WAS ZURUECKKOMMT UND WAS NICHT:
  //
  //   ZURUECK: die Abmeldungen AUS DIESER ABSAGE -- und jede auf ihren
  //   eigenen alten Status (status_vor_absage, Migration 155). Wer einen
  //   festen Platz hatte, hat ihn wieder; wer gewartet hat, wartet weiter.
  //
  //   NICHT ZURUECK: der Absagegrund. Er beschreibt eine Absage, die es nicht
  //   mehr gibt. Stehen bliebe er sonst an einem stattfindenden Termin und
  //   erschiene in jeder Ansicht, die ihn anzeigt (AbsageBlock haengt an
  //   cancelled -- der Block verschwaende zwar, aber der Text bliebe in der
  //   Datenbank und kaeme bei der naechsten Absage als Vorbelegung des
  //   Formulars zurueck: "Heizung defekt" an einer Absage wegen Sturm).
  //   Dasselbe gilt fuer cancelled_at/_by und cancelled_reason_set_by/_at:
  //   Alle sechs Felder beschreiben EINEN Vorgang, und der ist aufgehoben.
  //   Sie einzeln stehen zu lassen hiesse, eine halbe Absage aufzubewahren.
  //   Wer die Historie braucht, hat den Termin-Chat und die Push-Meldungen;
  //   eine Absage-Historie waere eine eigene Tabelle und ein eigener Auftrag.
  //
  // WARUM EINE EIGENE ROUTE UND NICHT PUT /events/:id (Bearbeiten): Dieselbe
  // Begruendung wie bei /absagegrund. Das Bearbeiten-Formular schickt den
  // ganzen Termin; hier geht es um genau einen Vorgang mit genau einer
  // Wirkung -- Buchungen wiederherstellen und allen einen Push schicken. Das
  // gehoert nicht in eine Route, die hauptsaechlich fuer anderes da ist, und
  // schon gar nicht in ein Feld, das eine alte App-Fassung versehentlich
  // mitschicken koennte.
  router.put('/:id/reaktivieren', rbacVerifier, requireAdmin, async (req, res) => {
    const eventId = req.params.id;

    const client = await db.getClient();
    // Vor dem try: Push, Antwort und Live-Update stehen hinter dem finally.
    let event = null;
    let fruehAntwort = null;
    let wiederAngemeldet = [];
    try {
      await client.query('BEGIN');

      const { rows: [gefunden] } = await client.query(
        "SELECT name, event_date, cancelled FROM events WHERE id = $1 AND organization_id = $2",
        [eventId, req.user.organization_id]
      );
      event = gefunden;

      // Jahrgangs-Bindung wie beim Absagen: Die Zuruecknahme
      // schickt allen einen Push und stellt ihre Buchungen wieder her -- das
      // darf nur, wer den Termin auch sehen darf.
      const zugriff = (event && event.cancelled) ? await darfTermin(client, req, eventId) : null;

      if (!event) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 404, body: { error: 'Event nicht gefunden' } };
      } else if (!event.cancelled) {
        // Spiegelbild zur 400 in /cancel ("bereits abgesagt"), genau wie bei
        // /absagegrund. Einen nicht abgesagten Termin zurueckzunehmen hat
        // keine Bedeutung -- und wuerde ohne diesen Riegel stillschweigend
        // Abmeldungen aufheben, die mit einer Absage nichts zu tun haben.
        await client.query('ROLLBACK');
        fruehAntwort = { status: 400, body: { error: 'Event ist nicht abgesagt' } };
      } else if (!zugriff.erlaubt) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 403, body: { error: 'Kein Zugriff auf diesen Termin' } };
      } else {
        // Alle sechs Absage-Felder zurueck auf den Stand davor. Begruendung
        // ausfuehrlich im Kopf dieser Route.
        await client.query(
          `UPDATE events
              SET cancelled = FALSE,
                  cancelled_at = NULL,
                  cancelled_by = NULL,
                  cancelled_reason = NULL,
                  cancelled_reason_set_by = NULL,
                  cancelled_reason_set_at = NULL
            WHERE id = $1`,
          [eventId]
        );

        // IN DERSELBEN TRANSAKTION: Ein Termin, der wieder stattfindet, aber
        // dessen Angemeldete noch abgemeldet sind, waere schlimmer als ein
        // abgesagter -- er stuende offen in der Liste, und niemand waere
        // gebucht.
        //
        // Die Rueckgabe ist zugleich die Empfaengerliste des Pushes: genau
        // die, die jetzt wieder angemeldet sind. Wer abgemeldet bleibt,
        // steht nicht drin und bekommt keine Nachricht (siehe unten).
        wiederAngemeldet = await hebeAbsageAbmeldungenAuf(client, eventId);

        await client.query('COMMIT');
      }
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database error in PUT /events/:eventId/reaktivieren:', eventId, txErr);
      return res.status(500).json({ error: 'Datenbankfehler beim Zurücknehmen der Absage' });
    } finally {
      // KEIN client.release() im try — nur hier.
      client.release();
    }

    if (fruehAntwort) {
      return res.status(fruehAntwort.status).json(fruehAntwort.body);
    }

    // Push und LiveUpdate NACH COMMIT und client.release()
    const userIds = wiederAngemeldet.map(b => b.user_id);
    if (userIds.length > 0) {
      const eventDateFormatted = formatDatum(event.event_date);
      try {
        await PushService.sendEventReactivationToKonfis(db, userIds, event.name, eventDateFormatted, req.user.organization_id, eventId);
      } catch (e) {
        console.error('Push notification failed:', e);
      }
    }

    res.json({
      message: `Die Absage für "${event.name}" wurde zurückgenommen`,
      // Wie viele wieder angemeldet sind -- dieselbe Zahl, die die
      // Rueckfrage vor dem Ausfuehren angekuendigt hat.
      reaktiviert: wiederAngemeldet.length,
      participants_notified: userIds.length
    });

    try {
      liveUpdate.sendToOrg(req.user.organization_id, 'events', 'update', { eventId, action: 'reactivated' });
    } catch (liveErr) {
      console.error('Live-Update nach PUT /events/:eventId/reaktivieren fehlgeschlagen:', liveErr);
    }
  });

  return router;
};
