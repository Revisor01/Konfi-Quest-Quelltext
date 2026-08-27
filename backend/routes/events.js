const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { checkPointTypeEnabled } = require('../utils/pointTypeGuard');
const jwt = require('jsonwebtoken');
const PushService = require('../services/pushService');
const liveUpdate = require('../utils/liveUpdate');
const { checkExistingBooking, validateRegistrationWindow, determineBookingStatus, promoteFromWaitlist, isRegistrationOpenForKonfis } = require('../utils/bookingUtils');
const { allIdsBelongToOrg } = require('../utils/orgOwnership');
const { removeFromEventChat, addToEventChat, syncEventChat } = require('../utils/eventChat');
const { nachAntwort } = require('../utils/nachAntwort');

const QR_SECRET = process.env.QR_SECRET;
if (!QR_SECRET) {
  console.error('FATAL: QR_SECRET Umgebungsvariable fehlt!');
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
}

/**
 * Validiert die Felder des Teamer-Kontingents.
 * 0 = unbegrenzt (Konvention wie max_participants), negativ ist ungueltig.
 * @returns {string|null} Fehlermeldung oder null wenn alles in Ordnung ist
 */
function validateTeamerQuota(teamerMaxParticipants, teamerMaxWaitlistSize) {
  if (teamerMaxParticipants !== undefined && teamerMaxParticipants !== null) {
    const value = parseInt(teamerMaxParticipants, 10);
    if (Number.isNaN(value) || value < 0) {
      return 'teamer_max_participants muss eine Zahl >= 0 sein (0 = unbegrenzt)';
    }
  }
  if (teamerMaxWaitlistSize !== undefined && teamerMaxWaitlistSize !== null) {
    const value = parseInt(teamerMaxWaitlistSize, 10);
    if (Number.isNaN(value) || value < 0) {
      return 'teamer_max_waitlist_size muss eine Zahl >= 0 sein';
    }
  }
  return null;
}

// Events routes
// Events: Teamer darf alles (view, create, edit, delete, manage_bookings)
module.exports = (db, rbacVerifier, { requireTeamer }, checkAndAwardBadges) => {

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

  // Get all events (read-only, accessible to all authenticated users)
  router.get('/', rbacVerifier, async (req, res) => {
    try {
      // Datumsfenster: standardmaessig nur Events des letzten Jahres (plus alle
      // zukuenftigen). Mit ?all=true wird die gesamte Historie geliefert.
      const includeAll = req.query.all === 'true';
      const dateWindowClause = includeAll
        ? ''
        : "AND e.event_date >= NOW() - INTERVAL '1 year'";

      // Restrukturierte Query:
      // Keine Join-Explosion mehr über bookings/users/roles/categories/jahrgaenge.
      // Stattdessen pro Anliegen ein LATERAL-Aggregat bzw. Sub-Select — kein
      // GROUP BY über die ganze Breite nötig.
      const query = `
        SELECT e.*,
                bstats.registered_count,
                bstats.waitlist_count,
                bstats.unprocessed_count,
                bstats.teamer_unprocessed_count,
                bstats.total_participants,
                bstats.teamer_count,
                bstats.teamer_waitlist_count,
                CASE
                  WHEN e.has_timeslots THEN COALESCE(timeslot_capacity.total_capacity, e.max_participants)
                  ELSE e.max_participants
                END as max_participants,
                e.registration_opens_at,
                e.registration_closes_at,
                e.point_type,
                cats.category_ids,
                cats.category_names,
                jgs.jahrgang_ids,
                jgs.jahrgang_names,
                event_chat.id as chat_room_id,
                CASE
                  WHEN e.cancelled THEN 'cancelled'
                  WHEN e.mandatory THEN 'mandatory'
                  WHEN NOW() < e.registration_opens_at THEN 'upcoming'
                  WHEN NOW() > e.registration_closes_at THEN 'closed'
                  WHEN (
                    CASE WHEN e.has_timeslots THEN COALESCE(timeslot_capacity.total_capacity, e.max_participants) ELSE e.max_participants END
                  ) > 0 AND bstats.registered_count >= (
                    CASE WHEN e.has_timeslots THEN COALESCE(timeslot_capacity.total_capacity, e.max_participants) ELSE e.max_participants END
                  ) AND (NOT e.waitlist_enabled OR bstats.waitlist_count >= COALESCE(e.max_waitlist_size, 0)) THEN 'closed'
                  ELSE 'open'
                END as registration_status,
                -- Bewusst ein ZWEITER Wert statt einer Aenderung am ersten: Die
                -- beiden Kontingente sind unabhaengig (zehn Konfi-Plaetze und
                -- drei Teamer-Plaetze sind zehn und drei, nicht dreizehn). Ein
                -- gemeinsamer Status koennte nur einen von beiden abbilden.
                CASE
                  WHEN e.cancelled THEN 'cancelled'
                  WHEN NOT (e.teamer_needed OR e.teamer_only) THEN 'none'
                  WHEN NOW() < e.registration_opens_at THEN 'upcoming'
                  WHEN NOW() > e.registration_closes_at THEN 'closed'
                  -- 0 heisst unbegrenzt, wie beim Konfi-Kontingent auch.
                  WHEN COALESCE(e.teamer_max_participants, 0) > 0
                       AND bstats.teamer_count >= e.teamer_max_participants
                       AND (NOT e.teamer_waitlist_enabled
                            OR bstats.teamer_waitlist_count >= COALESCE(e.teamer_max_waitlist_size, 0))
                    THEN 'closed'
                  WHEN COALESCE(e.teamer_max_participants, 0) > 0
                       AND bstats.teamer_count >= e.teamer_max_participants
                    THEN 'waitlist'
                  ELSE 'open'
                END as teamer_registration_status,
                CASE WHEN eb_user.status = 'confirmed' THEN true ELSE false END as is_registered,
                eb_user.status as booking_status,
                eb_user.attendance_status,
                mat.material_count
        FROM events e
        LEFT JOIN LATERAL (
          SELECT
            -- registered_count/waitlist_count sind KONFI-Zahlen (Migration 120:
            -- Teamer haben ein eigenes Kontingent). Ohne den Rollenfilter
            -- zählten angemeldete Teamer gegen die Konfi-Plaetze, und
            -- registration_status meldete "ausgebucht", obwohl für Konfis noch
            -- Plaetze frei waren.
            COUNT(*) FILTER (WHERE eb.status = 'confirmed' AND COALESCE(r_book.name, '') <> 'teamer') as registered_count,
            COUNT(*) FILTER (WHERE eb.status = 'waitlist' AND COALESCE(r_book.name, '') <> 'teamer') as waitlist_count,
            COUNT(*) FILTER (WHERE eb.status = 'confirmed' AND eb.attendance_status IS NULL AND COALESCE(r_book.name, '') <> 'teamer') as unprocessed_count,
            COUNT(*) FILTER (WHERE eb.status = 'confirmed' AND eb.attendance_status IS NULL AND r_book.name = 'teamer') as teamer_unprocessed_count,
            COUNT(*) as total_participants,
            COUNT(*) FILTER (WHERE eb.status = 'confirmed' AND r_book.name = 'teamer') as teamer_count,
            COUNT(*) FILTER (WHERE eb.status = 'waitlist' AND r_book.name = 'teamer') as teamer_waitlist_count
          FROM event_bookings eb
          LEFT JOIN users u_book ON eb.user_id = u_book.id
          LEFT JOIN roles r_book ON u_book.role_id = r_book.id
          WHERE eb.event_id = e.id
        ) bstats ON true
        LEFT JOIN LATERAL (
          SELECT STRING_AGG(DISTINCT c.id::text, ',') as category_ids,
                 STRING_AGG(DISTINCT c.name, ', ') as category_names
          FROM event_categories ec
          JOIN categories c ON ec.category_id = c.id
          WHERE ec.event_id = e.id
        ) cats ON true
        LEFT JOIN LATERAL (
          SELECT STRING_AGG(DISTINCT j.id::text, ',') as jahrgang_ids,
                 STRING_AGG(DISTINCT j.name, ', ') as jahrgang_names
          FROM event_jahrgang_assignments eja
          JOIN jahrgaenge j ON eja.jahrgang_id = j.id
          WHERE eja.event_id = e.id
        ) jgs ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) as material_count
          FROM material_events me
          WHERE me.event_id = e.id
        ) mat ON true
        LEFT JOIN LATERAL (
          SELECT eb2.status, eb2.attendance_status
          FROM event_bookings eb2
          WHERE eb2.event_id = e.id AND eb2.user_id = $2
          LIMIT 1
        ) eb_user ON true
        LEFT JOIN LATERAL (
          SELECT SUM(max_participants) as total_capacity
          FROM event_timeslots
          WHERE event_id = e.id
        ) timeslot_capacity ON true
        -- Event-Chat: nur, wenn die abrufende Person auch Mitglied des Raums
        -- ist. Damit bildet der Einstieg in der Detailansicht genau die
        -- Berechtigung ab, die darfRaumOeffnen (chat.js:273) durchsetzt —
        -- ein Knopf, der ins 403 fuehrt, entsteht so gar nicht erst.
        -- Teamer:innen und Konfis werden beim Buchen Mitglied (addToEventChat).
        LEFT JOIN LATERAL (
          SELECT cr.id
          FROM chat_rooms cr
          JOIN chat_participants cp
            ON cp.room_id = cr.id AND cp.user_id = $2 AND cp.user_type = $3
          WHERE cr.event_id = e.id AND cr.organization_id = $1
          LIMIT 1
        ) event_chat ON true
        WHERE e.organization_id = $1
          ${dateWindowClause}
        ORDER BY e.event_date ASC
      `;

      const { rows } = await db.query(query, [req.user.organization_id, req.user.id, req.user.type]);

      // Für Teamer: nur Events anzeigen die mindestens einem zugewiesenen Jahrgang zugeordnet sind
      // ODER die keinem Jahrgang zugeordnet sind (allgemeine Events)
      // ODER die teamer_only/teamer_needed sind (immer sichtbar für Teamer)
      let filteredRows = rows;
      if (req.user.role_name === 'teamer') {
        // Ohne jede Zuweisung griff der Filter früher gar nicht (die Bedingung
        // verlangte length > 0) — eine Teamer:in ohne Jahrgang sah damit ALLE
        // Events der Organisation statt keiner jahrgangsgebundenen.
        // Jetzt greift der Filter immer; ohne Zuweisung bleibt die
        // Liste der sichtbaren Jahrgänge schlicht leer.
        const viewableJahrgaenge = (req.user.assigned_jahrgaenge || [])
          .filter(j => j.can_view)
          .map(j => j.id);
        filteredRows = rows.filter(row => {
          // Reine Teamer-Events und Teamer-benötigte Events sind immer sichtbar
          if (row.teamer_only || row.teamer_needed) return true;
          // Allgemeine Events (keine Jahrgang-Zuweisung) sind für alle sichtbar
          if (!row.jahrgang_ids) return true;
          // Prüfen ob mindestens ein zugewiesener Jahrgang dabei ist
          const eventJahrgangIds = row.jahrgang_ids.split(',').map(id => parseInt(id, 10));
          return eventJahrgangIds.some(id => viewableJahrgaenge.includes(id));
        });
      }

      // Für Konfis: teamer_only Events ausschließen
      if (req.user.type === 'konfi') {
        filteredRows = filteredRows.filter(row => !row.teamer_only);
      }
      
      // Transform the data to include categories and jahrgaenge arrays
      const eventsWithRelations = filteredRows.map(row => {
        const categories = [];
        if (row.category_ids) {
          const ids = row.category_ids.split(',');
          const names = row.category_names.split(',');
          for (let i = 0; i < ids.length; i++) {
            categories.push({
              id: parseInt(ids[i], 10),
              name: names[i]
            });
          }
        }
        
        const jahrgaenge = [];
        if (row.jahrgang_ids) {
          const ids = row.jahrgang_ids.split(',');
          const names = row.jahrgang_names.split(',');
          for (let i = 0; i < ids.length; i++) {
            jahrgaenge.push({
              id: parseInt(ids[i], 10),
              name: names[i]
            });
          }
        }
        
        const unprocessedCount =
          (parseInt(row.unprocessed_count, 10) || 0)
          + (parseInt(row.teamer_unprocessed_count, 10) || 0);

        // qr_token gehört NICHT in die Liste: Die Query
        // holt e.*, damit lag der Check-in-Token jedes Events in der Antwort —
        // für ALLE Rollen, auch Konfis. Ein Konfi konnte sich damit per
        // POST /events/qr-checkin von zu Hause als anwesend eintragen und
        // Punkte gutschreiben. GET /events/:id filterte den Token bereits,
        // über die Liste war dieser Schutz umgehbar.
        // Teamer und Leitung brauchen den Token nur zum Anzeigen des QR-Codes
        // und holen ihn dort über die Detail- bzw. generate-Route.
        const { qr_token: _qrToken, ...rowOhneToken } = row;

        return {
          ...rowOhneToken,
          categories: categories,
          jahrgaenge: jahrgaenge,
          waitlist_count: parseInt(row.waitlist_count, 10) || 0,
          teamer_count: parseInt(row.teamer_count, 10) || 0,
          teamer_waitlist_count: parseInt(row.teamer_waitlist_count, 10) || 0,
          material_count: parseInt(row.material_count, 10) || 0,
          pending_bookings_count: unprocessedCount > 0 ? unprocessedCount : undefined
        };
      });

      res.json(eventsWithRelations);

    } catch (err) {
 console.error('Database error in GET /events:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get cancelled events (Admin only)
  router.get('/cancelled', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const query = `
        SELECT e.*, 
                COUNT(DISTINCT CASE WHEN eb.status = 'confirmed' THEN eb.id END) as registered_count,
                COUNT(DISTINCT CASE WHEN eb.status = 'waitlist' THEN eb.id END) as waitlist_count,
                COUNT(DISTINCT CASE WHEN eb.status = 'confirmed' AND eb.attendance_status IS NULL THEN eb.id END) as unprocessed_count,
                STRING_AGG(DISTINCT c.id::text, ',') as category_ids,
                STRING_AGG(DISTINCT c.name, ', ') as category_names,
                STRING_AGG(DISTINCT j.id::text, ',') as jahrgang_ids,
                STRING_AGG(DISTINCT j.name, ', ') as jahrgang_names
        FROM events e
        LEFT JOIN event_bookings eb ON e.id = eb.event_id
        LEFT JOIN event_categories ec ON e.id = ec.event_id
        LEFT JOIN categories c ON ec.category_id = c.id
        LEFT JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
        LEFT JOIN jahrgaenge j ON eja.jahrgang_id = j.id
        WHERE e.organization_id = $1 AND e.cancelled = TRUE
        GROUP BY e.id
        ORDER BY e.cancelled_at DESC
      `;
      
      const { rows } = await db.query(query, [req.user.organization_id]);
      
      // Transform the data to include categories and jahrgaenge arrays
      const eventsWithRelations = rows.map(row => {
        const categories = [];
        if (row.category_ids) {
          const ids = row.category_ids.split(',');
          const names = row.category_names.split(',');
          for (let i = 0; i < ids.length; i++) {
            categories.push({
              id: parseInt(ids[i], 10),
              name: names[i]
            });
          }
        }
        
        const jahrgaenge = [];
        if (row.jahrgang_ids) {
          const ids = row.jahrgang_ids.split(',');
          const names = row.jahrgang_names.split(',');
          for (let i = 0; i < ids.length; i++) {
            jahrgaenge.push({
              id: parseInt(ids[i], 10),
              name: names[i]
            });
          }
        }
        
        // Abgesagte Termine: unprocessed_count zaehlt hier bereits ueber ALLE
        // Rollen (events.js:305, keine Rollen-Trennung) — nicht addieren,
        // das wuerde Teamer doppelt zaehlen.
        const unprocessedCount = parseInt(row.unprocessed_count, 10) || 0;
        return {
          ...row,
          categories: categories,
          jahrgaenge: jahrgaenge,
          registration_status: 'cancelled',
          waitlist_count: parseInt(row.waitlist_count, 10) || 0,
          pending_bookings_count: unprocessedCount > 0 ? unprocessedCount : undefined
        };
      });
      
      res.json(eventsWithRelations);
      
    } catch (err) {
 console.error('Database error in GET /events/cancelled:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // ====================================================================
  // QR-CODE CHECK-IN ENDPOINTS
  // WICHTIG: Diese müssen VOR den parametrisierten /:id Routes stehen,
  // damit Express "qr-checkin" nicht als :id Parameter interpretiert.
  // ====================================================================

  // QR-Check-in: Konfi checkt sich selbst ein via QR-Token
  router.post('/qr-checkin', rbacVerifier, async (req, res) => {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Token fehlt', error_type: 'missing_token' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, QR_SECRET);
    } catch (err) {
      return res.status(400).json({ error: 'Ungültiger QR-Code', error_type: 'invalid_token' });
    }

    const eventId = decoded.eid;
    const userId = req.user.id;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Event laden und qr_token abgleichen
      const { rows: [event] } = await client.query(
        `SELECT id, name, event_date, checkin_window, mandatory, points, point_type, qr_token, organization_id
         FROM events WHERE id = $1 AND qr_token = $2`,
        [eventId, token]
      );

      if (!event) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ error: 'Ungültiger QR-Code', error_type: 'invalid_token' });
      }

      // Organization-Check
      if (event.organization_id !== req.user.organization_id) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(403).json({ error: 'Kein Zugriff auf dieses Event', error_type: 'wrong_organization' });
      }

      // Zeitfenster-Prüfung (komplett in PostgreSQL für korrekte Zeitzonen)
      const { rows: [timeCheck] } = await client.query(
        `SELECT NOW() BETWEEN (event_date - ($1 || ' minutes')::interval) AND (event_date + ($1 || ' minutes')::interval) AS in_window,
                NOW() < (event_date - ($1 || ' minutes')::interval) AS too_early,
                NOW() > (event_date + ($1 || ' minutes')::interval) AS too_late
         FROM events WHERE id = $2`,
        [event.checkin_window, eventId]
      );

      if (timeCheck.too_early) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({
          error: 'Check-in ist noch nicht möglich',
          error_type: 'too_early',
          event_date: event.event_date,
          checkin_window: event.checkin_window
        });
      }
      if (timeCheck.too_late) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({
          error: 'Der Check-in-Zeitraum ist abgelaufen',
          error_type: 'too_late'
        });
      }

      // Booking prüfen
      const { rows: [booking] } = await client.query(
        `SELECT id, status, attendance_status FROM event_bookings WHERE event_id = $1 AND user_id = $2`,
        [eventId, userId]
      );

      if (!booking) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ error: 'Du bist nicht für dieses Event angemeldet', error_type: 'not_registered' });
      }
      if (booking.status === 'opted_out') {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ error: 'Du hast dich von diesem Event abgemeldet', error_type: 'opted_out' });
      }
      if (booking.status !== 'confirmed') {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ error: 'Deine Anmeldung ist nicht bestätigt', error_type: 'not_confirmed' });
      }

      // Duplikat-Check
      if (booking.attendance_status === 'present') {
        await client.query('ROLLBACK');
        client.release();
        return res.json({
          message: 'Du bist bereits eingecheckt',
          already_checked_in: true,
          event_name: event.name,
          event_id: event.id
        });
      }

      // Attendance setzen
      await client.query("UPDATE event_bookings SET attendance_status = 'present' WHERE id = $1", [booking.id]);

      // Punkte-Vergabe (nur für Konfis, Teamer erhalten keine Punkte)
      let pointsAwarded = false;
      if (event.points > 0 && !event.mandatory && req.user.type === 'konfi') {
        const pointType = event.point_type || 'gemeinde';
        const { enabled: ptEnabled } = await checkPointTypeEnabled(client, userId, pointType);

        if (ptEnabled) {
          const description = `Event-Teilnahme: ${event.name}`;
          const { rowCount } = await client.query(
            `INSERT INTO event_points (konfi_id, event_id, points, point_type, description, awarded_date, admin_id, organization_id)
             VALUES ($1, $2, $3, $4, $5, NOW(), NULL, $6)
             ON CONFLICT (konfi_id, event_id) DO NOTHING`,
            [userId, eventId, event.points, pointType, description, req.user.organization_id]
          );

          if (rowCount > 0) {
            const updateProfileQuery = pointType === 'gottesdienst'
              ? "UPDATE konfi_profiles SET gottesdienst_points = gottesdienst_points + $1 WHERE user_id = $2"
              : "UPDATE konfi_profiles SET gemeinde_points = gemeinde_points + $1 WHERE user_id = $2";
            await client.query(updateProfileQuery, [event.points, userId]);

            try {
              await checkAndAwardBadges(client, userId);
            } catch (badgeErr) {
              console.error('Error checking badges after QR check-in:', badgeErr);
            }

            pointsAwarded = true;
          }
        }
      }

      await client.query('COMMIT');
      client.release();

      // Badge-Check für Teamer NACH COMMIT (Konfis bekommen Badge-Check schon oben)
      if (req.user.type === 'teamer') {
        try {
          await checkAndAwardBadges(db, userId);
        } catch (badgeErr) {
          console.error('Error checking teamer badges after QR check-in:', badgeErr);
        }
      }

      // Push und LiveUpdate NACH COMMIT
      try {
        const userType = req.user.type === 'teamer' ? 'teamer' : 'konfi';
        if (pointsAwarded) {
          try { await PushService.checkAndSendLevelUp(db, userId, req.user.organization_id); } catch (e) { console.error('Level-up check failed:', e); }
          try { await PushService.sendEventAttendanceToKonfi(db, userId, event.name, 'present', event.points, null, req.user.organization_id); } catch (e) { console.error('Push notification failed:', e); }
          // userType statt hart 'konfi': beim QR-Check-in koennen sich auch
          // Teamer:innen einchecken. Zwei Zeilen weiter wurde userType
          // bereits richtig verwendet, hier nicht.
          liveUpdate.sendToUser(userType, userId, 'dashboard', 'update', { points: event.points });
        } else {
          try { await PushService.sendEventAttendanceToKonfi(db, userId, event.name, 'present', 0, null, req.user.organization_id); } catch (e) { console.error('Push notification failed:', e); }
        }
        liveUpdate.sendToUser(userType, userId, 'events', 'update', { eventId, action: 'checkin' });
        liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'attendance' });
      } catch (notifyErr) {
        console.error('Post-commit notification error:', notifyErr);
      }

      res.json({
        message: 'Erfolgreich eingecheckt',
        event_name: event.name,
        event_id: event.id,
        points_awarded: pointsAwarded
      });

    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
      console.error('Database error in POST /events/qr-checkin:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Generate QR token for event (Admin/Teamer)
  router.post('/:id/generate-qr', rbacVerifier, requireTeamer, async (req, res) => {
    const { id } = req.params;
    try {
      const { rows: [event] } = await db.query(
        "SELECT id, qr_token FROM events WHERE id = $1 AND organization_id = $2",
        [id, req.user.organization_id]
      );

      if (!event) {
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      // Wenn Token bereits existiert: direkt zurückgeben
      if (event.qr_token) {
        return res.json({ qr_token: event.qr_token });
      }

      // Neuen Token generieren (kein expiresIn - Zeitfenster läuft über event_date)
      const token = jwt.sign(
        { eid: parseInt(id), oid: req.user.organization_id },
        QR_SECRET,
        { algorithm: 'HS256' }
      );

      await db.query("UPDATE events SET qr_token = $1 WHERE id = $2", [token, id]);

      res.json({ qr_token: token });
    } catch (err) {
      console.error('Database error in POST /events/:id/generate-qr:', id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get attendance count for live polling (Admin/Teamer)
  router.get('/:id/attendance-count', rbacVerifier, requireTeamer, async (req, res) => {
    const { id } = req.params;
    try {
      const { rows: [counts] } = await db.query(
        `SELECT
           COUNT(*) FILTER (WHERE eb.attendance_status = 'present') AS checked_in,
           COUNT(*) AS total
         FROM event_bookings eb
         JOIN events e ON eb.event_id = e.id
         WHERE eb.event_id = $1 AND eb.status = 'confirmed' AND e.organization_id = $2`,
        [id, req.user.organization_id]
      );

      res.json({
        checked_in: parseInt(counts.checked_in) || 0,
        total: parseInt(counts.total) || 0
      });
    } catch (err) {
      console.error('Database error in GET /events/:id/attendance-count:', id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get timeslots for an event
  router.get('/:id/timeslots', rbacVerifier, async (req, res) => {
    const eventId = req.params.id;
    try {

      // Verify event exists and belongs to organization
      const { rows: [event] } = await db.query("SELECT id, has_timeslots FROM events WHERE id = $1 AND organization_id = $2", [eventId, req.user.organization_id]);

      if (!event) {
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      if (!event.has_timeslots) {
        return res.json([]); // Return empty array if event doesn't use timeslots
      }

      const timeslotsQuery = `
        SELECT et.*,
               COUNT(eb.id) FILTER (WHERE eb.status = 'confirmed') as registered_count,
               COUNT(eb.id) FILTER (WHERE eb.status = 'waitlist') as waitlist_count
        FROM event_timeslots et
        LEFT JOIN event_bookings eb ON et.id = eb.timeslot_id
        WHERE et.event_id = $1 AND et.organization_id = $2
        GROUP BY et.id
        ORDER BY et.start_time ASC
      `;
      const { rows: timeslots } = await db.query(timeslotsQuery, [eventId, req.user.organization_id]);

      res.json(timeslots);

    } catch (err) {
 console.error('Database error in GET /events/:id/timeslots:', req.params.id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get event details with participants
  router.get('/:id', rbacVerifier, async (req, res) => {
    const eventId = req.params.id;
    try {
      // Get event details
      const { rows: [event] } = await db.query("SELECT id, name, description, event_date, event_end_time, location, location_maps_url, points, point_type, type, max_participants, registration_opens_at, registration_closes_at, has_timeslots, waitlist_enabled, max_waitlist_size, teamer_max_participants, teamer_waitlist_enabled, teamer_max_waitlist_size, is_series, series_id, mandatory, is_konfirmation, bring_items, checkin_window, teamer_needed, teamer_only, cancelled, cancelled_at, qr_token, created_by, organization_id, created_at FROM events WHERE id = $1 AND organization_id = $2", [eventId, req.user.organization_id]);

      if (!event) {
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      // Get participants
      const participantsQuery = `
        SELECT eb.*, eb.opt_out_reason, eb.opt_out_date,
                u.display_name as participant_name,
                CASE
                  WHEN r.name = 'teamer' THEN (SELECT STRING_AGG(DISTINCT j2.name, ', ' ORDER BY j2.name) FROM user_jahrgang_assignments uja2 JOIN jahrgaenge j2 ON uja2.jahrgang_id = j2.id WHERE uja2.user_id = u.id)
                  ELSE j.name
                END as jahrgang_name,
                kp.jahrgang_id,
                et.start_time as timeslot_start_time,
                et.end_time as timeslot_end_time,
                r.name as role_name
        FROM event_bookings eb
        JOIN users u ON eb.user_id = u.id
        LEFT JOIN roles r ON u.role_id = r.id
        LEFT JOIN konfi_profiles kp ON u.id = kp.user_id
        LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
        LEFT JOIN event_timeslots et ON eb.timeslot_id = et.id
        WHERE eb.event_id = $1 AND u.organization_id = $2 AND u.deleted_at IS NULL
        ORDER BY
          CASE eb.status
            WHEN 'confirmed' THEN 1
            WHEN 'waitlist' THEN 2
            ELSE 3
          END,
          eb.created_at ASC
      `;
      const { rows: participants } = await db.query(participantsQuery, [eventId, req.user.organization_id]);
      
      // Get series events if this is part of a series
      let seriesEvents = [];
      if (event.is_series && event.series_id) {
        const seriesQuery = `
          SELECT e.*, COUNT(eb.id) as registered_count
          FROM events e
          LEFT JOIN event_bookings eb ON e.id = eb.event_id AND eb.status = 'confirmed'
          WHERE e.series_id = $1 AND e.organization_id = $2 AND e.id != $3
          GROUP BY e.id
          ORDER BY e.event_date ASC
        `;
        const { rows } = await db.query(seriesQuery, [event.series_id, req.user.organization_id, eventId]);
        seriesEvents = rows;
      }
      
      // Get timeslots if event has them
      let timeslots = [];
      if (event.has_timeslots) {
        const timeslotsQuery = `
          SELECT et.*,
                 COUNT(eb.id) FILTER (WHERE eb.status = 'confirmed') as registered_count,
                 COUNT(eb.id) FILTER (WHERE eb.status = 'waitlist') as waitlist_count
          FROM event_timeslots et
          LEFT JOIN event_bookings eb ON et.id = eb.timeslot_id
          WHERE et.event_id = $1 AND et.organization_id = $2
          GROUP BY et.id
          ORDER BY et.start_time ASC
        `;
        const { rows } = await db.query(timeslotsQuery, [eventId, req.user.organization_id]);
        timeslots = rows;
      }
      
      // Get jahrgaenge for this event
      const jahrgaengeQuery = `
        SELECT j.id, j.name
        FROM jahrgaenge j
        JOIN event_jahrgang_assignments eja ON j.id = eja.jahrgang_id
        WHERE eja.event_id = $1
      `;
      const { rows: jahrgaenge } = await db.query(jahrgaengeQuery, [eventId]);
      
      // Get categories for this event
      const categoriesQuery = `
        SELECT c.id, c.name
        FROM categories c
        JOIN event_categories ec ON c.id = ec.category_id
        WHERE ec.event_id = $1
      `;
      const { rows: categories } = await db.query(categoriesQuery, [eventId]);

      // Get unregistrations (Abmeldungen) for this event
      const unregistrationsQuery = `
        SELECT eu.*, u.display_name as konfi_name
        FROM event_unregistrations eu
        JOIN users u ON eu.user_id = u.id
        WHERE eu.event_id = $1 AND eu.organization_id = $2 AND u.deleted_at IS NULL
        ORDER BY eu.unregistered_at DESC
      `;
      const { rows: unregistrations } = await db.query(unregistrationsQuery, [eventId, req.user.organization_id]);

      // Check if event has an associated chat room
      const { rows: [eventChat] } = await db.query(
        "SELECT id FROM chat_rooms WHERE event_id = $1",
        [eventId]
      );

      // registered_count/pending_count sind KONFI-Zahlen — dieselbe Semantik
      // wie die Liste (events.js, bstats-LATERAL). Ohne den Rollenfilter
      // zählte das Detail Teamer mit: bei einem
      // teamer_needed-Event mit Kapazität meldete das Detail "Ausgebucht",
      // während die Liste "Offen" zeigte. Teamer stehen getrennt in
      // teamer_count/teamer_waitlist_count (eigenes Kontingent, Migration 120).
      const registeredCount = participants.filter(p => p.status === 'confirmed' && p.role_name !== 'teamer').length;
      const pendingCount = participants.filter(p => p.status === 'waitlist' && p.role_name !== 'teamer').length;

      // Teamer-Kontingent: eigene Zähler, getrennt vom Konfi-Kontingent
      const teamerCount = participants.filter(p => p.status === 'confirmed' && p.role_name === 'teamer').length;
      const teamerWaitlistCount = participants.filter(p => p.status === 'waitlist' && p.role_name === 'teamer').length;

      // Buchungsstatus des eingeloggten Users (für Konfis UND Teamer:innen —
      // Teamer können seit dem Teamer-Kontingent ebenfalls 'waitlist' haben)
      const ownBooking = participants.find(p => p.user_id === req.user.id);

      // For timeslot events, calculate total capacity and availability
      let totalCapacity = event.max_participants;
      if (event.has_timeslots && timeslots && timeslots.length > 0) {
        totalCapacity = timeslots.reduce((sum, slot) => sum + slot.max_participants, 0);
      }
      
      // Konfis bekommen diese Route zwar (sie ist nur mit rbacVerifier
      // geschuetzt), duerfen aber NICHT alles sehen:
      //  - qr_token: damit könnte sich ein Konfi per POST /qr-checkin von zu
      //    Hause selbst als anwesend eintragen und Punkte gutschreiben.
      //  - participants/unregistrations: enthalten Klarnamen, Jahrgang,
      //    Anwesenheitsstatus und opt_out_reason (Entschuldigungsgruende
      //    Minderjaehriger). Die Konfi-Route /api/konfi/events/:id/participants
      //    anonymisiert dieselben Daten bewusst zu "Vorname N.".
      const istKonfi = req.user.type === 'konfi';
      const { qr_token, ...eventOhneToken } = event;

      res.json({
        ...(istKonfi ? eventOhneToken : event),
        participants: istKonfi ? [] : participants,
        timeslots,
        series_events: seriesEvents,
        jahrgaenge,
        categories,
        unregistrations: istKonfi ? [] : unregistrations,
        registered_count: registeredCount,
        pending_count: pendingCount,
        teamer_count: teamerCount,
        teamer_waitlist_count: teamerWaitlistCount,
        max_participants: totalCapacity,
        available_spots: totalCapacity - registeredCount,
        booking_status: ownBooking ? ownBooking.status : null,
        is_registered: ownBooking ? ownBooking.status === 'confirmed' : false,
        chat_room_id: eventChat?.id || null
      });
      
    } catch (err) {
 console.error('Database error in GET /events/:id:', req.params.id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
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

    // NOTE: For transactions with pg-pool, a client must be checked out.
    // As per the instructions, we use db.query for everything. This is safe
    // as long as the logic is encapsulated inside a single route handler.
    try {

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
      const { rows: [newEvent] } = await db.query(insertEventQuery, [
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
      const promises = [];
      
      // Add categories
      if (category_ids && Array.isArray(category_ids) && category_ids.length > 0) {
        const categoryQuery = "INSERT INTO event_categories (event_id, category_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING";
        promises.push(db.query(categoryQuery, [eventId, category_ids]));
      }
      
      // Add jahrgaenge
      if (jahrgang_ids && Array.isArray(jahrgang_ids) && jahrgang_ids.length > 0) {
        const jahrgangQuery = "INSERT INTO event_jahrgang_assignments (event_id, jahrgang_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING";
        promises.push(db.query(jahrgangQuery, [eventId, jahrgang_ids]));
      }
      
      // If has timeslots, create them (effectiveHasTimeslots ist bei mandatory/
      // is_konfirmation bereits false -> dann werden keine Timeslots angelegt)
      if (effectiveHasTimeslots && timeslots && timeslots.length > 0) {
        const timeslotQuery = "INSERT INTO event_timeslots (event_id, start_time, end_time, max_participants, organization_id) VALUES ($1, $2, $3, $4, $5)";
        timeslots.forEach(slot => {
          promises.push(db.query(timeslotQuery, [eventId, slot.start_time, slot.end_time, slot.max_participants, req.user.organization_id]));
        });
      }
      
      await Promise.all(promises);

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
        await db.query(enrollQuery, [eventId, jahrgang_ids, req.user.organization_id]);
      }

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
 console.error('Database error in POST /events:', err);
      // '23505' is the PostgreSQL code for unique_violation
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Ein ähnliches Event existiert möglicherweise bereits.' });
      }
      res.status(500).json({ error: 'Datenbankfehler' });
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
      // Konfi- und Teamer-Kontingent sind strikt getrennt — die Konfi-Bloecke hier
      // duerfen NIE einen Teamer nachruecken lassen (r.name != 'teamer').
      const promotedUsers = [];
      const promotedTeamers = [];
      if (has_timeslots && timeslots && Array.isArray(timeslots) && timeslots.length > 0) {
        // Bei Timeslot-Events: Für jeden Timeslot separat prüfen
        for (const slot of timeslots) {
          if (!slot.id) continue; // Nur bestehende Timeslots prüfen
          const { rows: [tsCapacity] } = await client.query(
            `SELECT COUNT(*)::int as confirmed_count FROM event_bookings eb
             JOIN users u ON eb.user_id = u.id
             JOIN roles r ON u.role_id = r.id
             WHERE eb.timeslot_id = $1 AND eb.status = 'confirmed' AND eb.organization_id = $2
               AND r.name != 'teamer' AND u.deleted_at IS NULL`,
            [slot.id, req.user.organization_id]
          );
          const freeSlots = slot.max_participants - tsCapacity.confirmed_count;
          if (freeSlots > 0) {
            const { rows: waitlistEntries } = await client.query(
              `SELECT eb.id, eb.user_id FROM event_bookings eb
               JOIN users u ON eb.user_id = u.id
               JOIN roles r ON u.role_id = r.id
               WHERE eb.event_id = $1 AND eb.timeslot_id = $2 AND eb.status = 'waitlist' AND eb.organization_id = $4
                 AND r.name != 'teamer' AND u.deleted_at IS NULL
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
        const { rows: [currentCounts] } = await client.query(
          `SELECT COUNT(*)::int as confirmed_count FROM event_bookings eb
           JOIN users u ON eb.user_id = u.id
           JOIN roles r ON u.role_id = r.id
           WHERE eb.event_id = $1 AND eb.status = 'confirmed'
             AND r.name != 'teamer' AND u.deleted_at IS NULL`,
          [id]
        );
        const freeSlots = max_participants - currentCounts.confirmed_count;
        if (freeSlots > 0) {
          const { rows: waitlistEntries } = await client.query(
            `SELECT eb.id, eb.user_id FROM event_bookings eb
             JOIN users u ON eb.user_id = u.id
             JOIN roles r ON u.role_id = r.id
             WHERE eb.event_id = $1 AND eb.status = 'waitlist'
               AND r.name != 'teamer' AND u.deleted_at IS NULL
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
        const { rows: [teamerCounts] } = await client.query(
          `SELECT COUNT(*)::int as confirmed_count FROM event_bookings eb
           JOIN users u ON eb.user_id = u.id
           JOIN roles r ON u.role_id = r.id
           WHERE eb.event_id = $1 AND eb.status = 'confirmed'
             AND r.name = 'teamer' AND u.deleted_at IS NULL`,
          [id]
        );
        // 0 = unbegrenzt -> keine Obergrenze für die Anzahl der Nachruecker
        const freeTeamerSlots = newTeamerMax === 0
          ? null
          : newTeamerMax - teamerCounts.confirmed_count;
        if (freeTeamerSlots === null || freeTeamerSlots > 0) {
          const limitClause = freeTeamerSlots === null ? '' : 'LIMIT $2';
          const limitParams = freeTeamerSlots === null ? [id] : [id, freeTeamerSlots];
          const { rows: teamerWaitlistEntries } = await client.query(
            `SELECT eb.id, eb.user_id FROM event_bookings eb
             JOIN users u ON eb.user_id = u.id
             JOIN roles r ON u.role_id = r.id
             WHERE eb.event_id = $1 AND eb.status = 'waitlist'
               AND r.name = 'teamer' AND u.deleted_at IS NULL
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
          const fullPath = path.join(__dirname, '..', 'uploads', 'chat', fileRecord.file_path);
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
          const eventDateFormatted = new Date(event.event_date).toLocaleDateString('de-DE');
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
  
  // Book event (mit Transaktion gegen Race Conditions)
  router.post('/:id/book', rbacVerifier, async (req, res) => {
    const eventId = req.params.id;
    const userId = req.user.id;
    const { timeslot_id } = req.body;

    const isKonfi = req.user.type === 'konfi';
    const isTeamer = req.user.type === 'teamer';
    if (!isKonfi && !isTeamer) {
      return res.status(403).json({ error: 'Nur Konfis und Teamer:innen können Events buchen' });
    }

    const client = await db.getClient();
    try {

      // Transaktion starten für Race-Condition-Schutz
      await client.query('BEGIN');

      // 1. Check if event exists (FOR UPDATE sperrt die Zeile)
      const { rows: [event] } = await client.query(
        "SELECT id, name, description, event_date, event_end_time, location, points, point_type, type, max_participants, registration_opens_at, registration_closes_at, has_timeslots, waitlist_enabled, max_waitlist_size, teamer_max_participants, teamer_waitlist_enabled, teamer_max_waitlist_size, is_series, series_id, mandatory, is_konfirmation, bring_items, checkin_window, teamer_needed, teamer_only, cancelled, qr_token, created_by, organization_id FROM events WHERE id = $1 AND organization_id = $2 FOR UPDATE",
        [eventId, req.user.organization_id]
      );
      if (!event) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      // TEAMER-PFAD: eigenes Kontingent mit eigener Warteliste.
      // Bewusst weiterhin OHNE Timeslot und OHNE Anmeldefenster-Check —
      // Teamer:innen duerfen sich jederzeit anmelden, das Kontingent begrenzt
      // nur die Anzahl. Konfi- und Teamer-Plaetze sind strikt getrennt.
      if (isTeamer) {
        if (!event.teamer_needed && !event.teamer_only) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(403).json({ error: 'Dieses Event ist nicht für Teamer:innen buchbar' });
        }

        // Duplikat-Check
        const { rows: [existingBooking] } = await client.query(
          "SELECT id FROM event_bookings WHERE event_id = $1 AND user_id = $2",
          [eventId, userId]
        );
        if (existingBooking) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(409).json({ error: 'Du bist bereits für dieses Event angemeldet' });
        }

        // Teamer-Kontingent zählen: NUR Buchungen von Teamer:innen (Konfis
        // zählen hier nicht, sie haben ihr eigenes Kontingent).
        const { rows: [teamerCounts] } = await client.query(
          `SELECT COUNT(*) FILTER (WHERE eb.status = 'confirmed') as confirmed_count,
                  COUNT(*) FILTER (WHERE eb.status = 'waitlist') as waitlist_count
           FROM event_bookings eb
           JOIN users u ON eb.user_id = u.id
           JOIN roles r ON u.role_id = r.id
           WHERE eb.event_id = $1 AND r.name = 'teamer' AND u.deleted_at IS NULL`,
          [eventId]
        );
        const teamerConfirmed = parseInt(teamerCounts.confirmed_count, 10);
        const teamerWaitlist = parseInt(teamerCounts.waitlist_count, 10);

        // teamer_max_participants = 0 -> unbegrenzt (Verhalten der Bestands-Events)
        const teamerStatusResult = determineBookingStatus(
          event, teamerConfirmed, teamerWaitlist, event.teamer_max_participants || 0,
          { waitlistEnabledField: 'teamer_waitlist_enabled', maxWaitlistSizeField: 'teamer_max_waitlist_size' }
        );
        if (typeof teamerStatusResult === 'object') {
          await client.query('ROLLBACK');
          client.release();
          return res.status(teamerStatusResult.status).json({ error: teamerStatusResult.error });
        }
        const teamerBookingStatus = teamerStatusResult;
        const teamerMessage = teamerBookingStatus === 'confirmed' ? 'Erfolgreich angemeldet' : 'Auf die Warteliste gesetzt';

        // KEIN Timeslot für Teamer-Buchungen
        const insertQuery = "INSERT INTO event_bookings (event_id, user_id, status, booking_date, organization_id) VALUES ($1, $2, $3, NOW(), $4) RETURNING id";
        const { rows: [newBooking] } = await client.query(insertQuery, [eventId, userId, teamerBookingStatus, req.user.organization_id]);

        // In den Chat zum Termin, falls es einen gibt (idempotent).
        await addToEventChat(client, eventId, userId, req.user.organization_id);

        await client.query('COMMIT');
        client.release();

        res.status(201).json({ id: newBooking.id, message: teamerMessage, status: teamerBookingStatus });

        // Live Update und Push
        liveUpdate.sendToUser('teamer', userId, 'events', 'update', { eventId, status: teamerBookingStatus });
        liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'teamer_booking' });

        try {
          await PushService.sendTeamerEventBookingToAdmins(
            db, req.user.organization_id, req.user.display_name, event.name, teamerBookingStatus, eventId
          );
        } catch (pushErr) {
          console.error('Push notification failed for teamer booking:', pushErr);
        }

        // Bestaetigung an die Teamer:in selbst (analog Konfi-Anmeldung)
        try {
          await PushService.sendEventRegisteredToTeamer(db, userId, event.name, event.event_date, teamerBookingStatus, eventId, req.user.organization_id);
        } catch (pushErr) {
          console.error('Push notification failed for teamer booking confirmation:', pushErr);
        }

        return;
      }

      // KONFI-PFAD: Bestehende Logik
      // Konfis dürfen keine teamer_only Events buchen
      if (isKonfi && event.teamer_only) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(403).json({ error: 'Dieses Event ist nur für Teamer:innen' });
      }

      // Registration-Zeitfenster-Check (nur für Konfis)
      const regCheck = validateRegistrationWindow(event);
      if (!regCheck.valid) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ error: regCheck.error });
      }

      // 2. Check if already booked
      const existingBooking = await checkExistingBooking(client, userId, eventId);
      if (existingBooking) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({ error: 'Du bist bereits für dieses Event angemeldet' });
      }

      // 2b. Konfirmations-Sperre: ein Konfi darf nur EINEN Konfirmations-Termin buchen.
      // Bucht er ein is_konfirmation-Event, obwohl er bereits an einer anderen (nicht
      // abgesagten) Konfirmation angemeldet ist -> 409. Er muss die bestehende erst
      // verlassen. Die anderen Termine werden im Frontend ausgegraut.
      if (event.is_konfirmation) {
        const { rows: [otherKonfirmation] } = await client.query(
          `SELECT e.id, e.name, e.event_date
             FROM event_bookings eb
             JOIN events e ON e.id = eb.event_id
            WHERE eb.user_id = $1
              AND eb.event_id <> $2
              AND eb.status = 'confirmed'
              AND e.is_konfirmation = true
              AND e.organization_id = $3
              AND (e.cancelled IS NULL OR e.cancelled = false)
            LIMIT 1`,
          [userId, eventId, req.user.organization_id]
        );
        if (otherKonfirmation) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(409).json({
            error: `Du bist bereits zu einem Konfirmationstermin angemeldet ("${otherKonfirmation.name}"). Melde dich dort zuerst ab, um einen anderen Termin zu wählen.`,
            error_code: 'konfirmation_already_booked'
          });
        }
      }

      // 3. Kapazität + Warteliste bestimmen (gilt nur für Konfis).
      // WICHTIG: Bei Timeslot-Events zählt die Kapazität PRO SLOT, nicht event-weit.
      // Frueher entschied die Summe aller Slots über confirmed/waitlist — dadurch
      // wurde ein voller Slot als "noch Platz" gewertet (Gesamt hatte ja Luft) und
      // die Warteliste griff nie; die nachgelagerte Slot-Prüfung warf dann nur ein
      // hartes "ausgebucht" ohne Wartelisten-Option. Jetzt entscheidet der Slot.
      let bookingStatus;
      if (event.has_timeslots) {
        if (!timeslot_id) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({ error: 'Bitte einen Zeitslot auswählen' });
        }
        // Slot sperren (FOR UPDATE) — verhindert, dass zwei gleichzeitige Buchungen
        // denselben letzten Platz bekommen.
        const { rows: [slot] } = await client.query(
          `SELECT id, max_participants FROM event_timeslots
           WHERE id = $1 AND event_id = $2 AND organization_id = $3 FOR UPDATE`,
          [timeslot_id, eventId, req.user.organization_id]
        );
        if (!slot) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({ error: 'Ungültiger Zeitslot' });
        }
        // confirmed/waitlist NUR für diesen Slot zählen (Teamer zählen nicht)
        const { rows: [slotCounts] } = await client.query(
          `SELECT COUNT(*) FILTER (WHERE eb.status = 'confirmed') as confirmed_count,
                  COUNT(*) FILTER (WHERE eb.status = 'waitlist') as waitlist_count
           FROM event_bookings eb
           JOIN users u ON eb.user_id = u.id
           JOIN roles r ON u.role_id = r.id
           WHERE eb.timeslot_id = $1 AND r.name != 'teamer' AND u.deleted_at IS NULL`,
          [timeslot_id]
        );
        const slotConfirmed = parseInt(slotCounts.confirmed_count, 10);
        const slotWaitlist = parseInt(slotCounts.waitlist_count, 10);

        // determineBookingStatus mit der SLOT-Kapazität: voller Slot + Warteliste
        // aktiv -> 'waitlist'; voller Slot ohne/volle Warteliste -> 400.
        const statusResult = determineBookingStatus(event, slotConfirmed, slotWaitlist, slot.max_participants);
        if (typeof statusResult === 'object') {
          await client.query('ROLLBACK');
          client.release();
          return res.status(statusResult.status).json({ error: statusResult.error });
        }
        bookingStatus = statusResult;
      } else {
        if (timeslot_id) {
          // Event ohne Timeslots: kein timeslot_id zulassen
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({ error: 'Dieses Event hat keine Zeitslots' });
        }
        // Event-weite Kapazität (Teamer zählen nicht)
        const { rows: [counts] } = await client.query(
          `SELECT COUNT(*) FILTER (WHERE eb.status = 'confirmed') as confirmed_count,
                  COUNT(*) FILTER (WHERE eb.status = 'waitlist') as waitlist_count
           FROM event_bookings eb
           JOIN users u ON eb.user_id = u.id
           JOIN roles r ON u.role_id = r.id
           WHERE eb.event_id = $1 AND r.name != 'teamer' AND u.deleted_at IS NULL`,
          [eventId]
        );
        const confirmedCount = parseInt(counts.confirmed_count, 10);
        const waitlistCount = parseInt(counts.waitlist_count, 10);

        const statusResult = determineBookingStatus(event, confirmedCount, waitlistCount, event.max_participants);
        if (typeof statusResult === 'object') {
          await client.query('ROLLBACK');
          client.release();
          return res.status(statusResult.status).json({ error: statusResult.error });
        }
        bookingStatus = statusResult;
      }
      const message = bookingStatus === 'confirmed' ? 'Erfolgreich angemeldet' : 'Auf die Warteliste gesetzt';

      // 4. Create booking
      const insertBookingQuery = "INSERT INTO event_bookings (event_id, user_id, timeslot_id, status, booking_date, organization_id) VALUES ($1, $2, $3, $4, NOW(), $5) RETURNING id";
      const { rows: [newBooking] } = await client.query(insertBookingQuery, [eventId, userId, timeslot_id, bookingStatus, req.user.organization_id]);

      // In den Chat zum Termin, falls es einen gibt (idempotent).
      await addToEventChat(client, eventId, userId, req.user.organization_id);

      // Transaktion abschließen
      await client.query('COMMIT');
      client.release();

      res.status(201).json({ id: newBooking.id, message, status: bookingStatus });

      // Live Update: Notify the konfi and admins about the booking
      liveUpdate.sendToUser('konfi', userId, 'events', 'update', { eventId, status: bookingStatus });
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'booking' });

    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
      console.error('Database error in POST /events/:eventId/book:', eventId, err);
      res.status(500).json({ error: 'Datenbankfehler bei der Anmeldung' });
    }
  });
  
  // Cancel booking
  router.delete('/:id/book', rbacVerifier, async (req, res) => {
    const eventId = req.params.id;
    const userId = req.user.id;

    const isKonfi = req.user.type === 'konfi';
    const isTeamer = req.user.type === 'teamer';
    if (!isKonfi && !isTeamer) {
      return res.status(403).json({ error: 'Nur Konfis und Teamer:innen können Buchungen stornieren' });
    }

    let promotedUserId = null;
    let promotedEventName = null;
    try {
      // Stornierung + Nachruecken atomar in EINER Transaktion (verhindert stale Kapazität
      // bei gleichzeitiger Buchung/Stornierung).
      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        // Get booking details before deleting (need timeslot_id and status for waitlist promotion)
        const { rows: [booking] } = await client.query(
          "SELECT status, timeslot_id, attendance_status FROM event_bookings WHERE event_id = $1 AND user_id = $2 AND organization_id = $3 FOR UPDATE",
          [eventId, userId, req.user.organization_id]
        );

        if (!booking) {
          await client.query('ROLLBACK');
          // KEIN client.release() hier — das finally unten released (sonst Doppel-Release)
          return res.status(404).json({ error: 'Buchung nicht gefunden' });
        }

        // War der Konfi als anwesend verbucht: Event-Punkte zuruecknehmen.
        if (booking.attendance_status === 'present') {
          const { rows: [pts] } = await client.query(
            "SELECT id, points, point_type FROM event_points WHERE konfi_id = $1 AND event_id = $2",
            [userId, eventId]
          );
          if (pts) {
            await client.query("DELETE FROM event_points WHERE id = $1", [pts.id]);
            const profileUpd = pts.point_type === 'gottesdienst'
              ? "UPDATE konfi_profiles SET gottesdienst_points = GREATEST(0, gottesdienst_points - $1) WHERE user_id = $2"
              : "UPDATE konfi_profiles SET gemeinde_points = GREATEST(0, gemeinde_points - $1) WHERE user_id = $2";
            await client.query(profileUpd, [pts.points, userId]);
          }
        }

        // Delete the booking
        await client.query("DELETE FROM event_bookings WHERE event_id = $1 AND user_id = $2 AND organization_id = $3", [eventId, userId, req.user.organization_id]);

        // Wer sich vom Event abmeldet, fliegt auch aus dem zugehörigen Event-Chat.
        // Sonst bleibt man im Chat, obwohl man nicht mehr teilnimmt.
        await removeFromEventChat(client, eventId, userId, req.user.organization_id);

        // If a confirmed Konfi-spot was opened, auto-promote from waitlist (nur für Konfis relevant).
        // Kapazität wird SLOT-bezogen geprüft, wenn die Buchung an einem Timeslot hing —
        // sonst (event-weite Zählung) wäre bei mehreren Slots die falsche Grenze massgeblich
        // und es rueckte niemand oder der Falsche nach.
        if (booking.status === 'confirmed' && isKonfi) {
          const { rows: [eventCapInfo] } = await client.query(
            "SELECT max_participants, name FROM events WHERE id = $1 AND organization_id = $2",
            [eventId, req.user.organization_id]
          );

          let maxCapacity, confirmedCount;
          if (booking.timeslot_id) {
            const { rows: [slotInfo] } = await client.query(
              "SELECT max_participants FROM event_timeslots WHERE id = $1 AND organization_id = $2",
              [booking.timeslot_id, req.user.organization_id]
            );
            // Teamer:innen zählen NICHT gegen das Konfi-Kontingent (eigenes
            // Kontingent seit Migration 120) — sonst blockiert eine bestaetigte
            // Teamer-Buchung den Nachrueckplatz eines Konfis.
            const { rows: [slotCountRes] } = await client.query(
              `SELECT COUNT(*) as confirmed_count
               FROM event_bookings eb
               LEFT JOIN users u ON eb.user_id = u.id
               LEFT JOIN roles r ON u.role_id = r.id AND r.name = 'teamer'
               WHERE eb.timeslot_id = $1 AND eb.status = 'confirmed' AND r.id IS NULL`,
              [booking.timeslot_id]
            );
            maxCapacity = slotInfo?.max_participants || 0;
            confirmedCount = parseInt(slotCountRes?.confirmed_count || '0', 10);
          } else {
            const { rows: [countResult] } = await client.query(
              `SELECT COUNT(*) as confirmed_count
               FROM event_bookings eb
               LEFT JOIN users u ON eb.user_id = u.id
               LEFT JOIN roles r ON u.role_id = r.id AND r.name = 'teamer'
               WHERE eb.event_id = $1 AND eb.status = 'confirmed' AND r.id IS NULL`,
              [eventId]
            );
            maxCapacity = eventCapInfo?.max_participants || 0;
            confirmedCount = parseInt(countResult?.confirmed_count || '0', 10);
          }

          // Nur nachruecken wenn unter Kapazität (0 = unbegrenzt, immer nachruecken).
          // promoteFromWaitlist ist timeslot-aware und nimmt den nächsten des Slots.
          // roleFilter 'not_teamer': ein frei gewordener Konfi-Platz darf NIEMALS
          // von einem Teamer der Teamer-Warteliste belegt werden.
          if (maxCapacity === 0 || confirmedCount < maxCapacity) {
            promotedUserId = await promoteFromWaitlist(client, eventId, booking.timeslot_id, 'not_teamer');
            if (promotedUserId) promotedEventName = eventCapInfo?.name || null;
          }
        }

        // TEAMER-STORNO: eigenes Kontingent, eigene Warteliste. Ein frei
        // gewordener Teamer-Platz wird ausschliesslich aus der Teamer-Warteliste
        // nachbesetzt (roleFilter 'teamer'). Teamer-Buchungen haben nie einen
        // Timeslot -> event-weite Zählung.
        if (booking.status === 'confirmed' && isTeamer) {
          const { rows: [teamerCapInfo] } = await client.query(
            "SELECT teamer_max_participants, name FROM events WHERE id = $1 AND organization_id = $2",
            [eventId, req.user.organization_id]
          );
          const { rows: [teamerCountRes] } = await client.query(
            `SELECT COUNT(*) as confirmed_count
             FROM event_bookings eb
             JOIN users u ON eb.user_id = u.id
             JOIN roles r ON u.role_id = r.id
             WHERE eb.event_id = $1 AND eb.status = 'confirmed'
               AND r.name = 'teamer' AND u.deleted_at IS NULL`,
            [eventId]
          );
          const teamerMaxCapacity = teamerCapInfo?.teamer_max_participants || 0;
          const teamerConfirmedCount = parseInt(teamerCountRes?.confirmed_count || '0', 10);

          if (teamerMaxCapacity === 0 || teamerConfirmedCount < teamerMaxCapacity) {
            promotedUserId = await promoteFromWaitlist(client, eventId, null, 'teamer');
            if (promotedUserId) promotedEventName = teamerCapInfo?.name || null;
          }
        }

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      // Push-Notification an nachgerückten User NACH COMMIT (Seiteneffekt, darf Storno nicht failen).
      // Bei Teamer-Storno rueckt ein Teamer nach, bei Konfi-Storno ein Konfi.
      if (promotedUserId && promotedEventName) {
        try {
          if (isTeamer) {
            await PushService.sendWaitlistPromotionToTeamer(db, promotedUserId, promotedEventName, null, eventId, req.user.organization_id);
          } else {
            await PushService.sendWaitlistPromotionToKonfi(db, promotedUserId, promotedEventName, null, eventId, req.user.organization_id);
          }
        } catch (pushErr) {
          console.error('Error sending waitlist promotion push:', pushErr);
        }
      }

      res.json({ message: 'Buchung erfolgreich storniert' });

      nachAntwort(req, async () => {
        // Live Update
        const userType = isTeamer ? 'teamer' : 'konfi';
        liveUpdate.sendToUser(userType, userId, 'events', 'update', { eventId, action: 'canceled' });
        liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'cancellation' });

        // Push an Admins bei Teamer-Storno
        if (isTeamer) {
          try {
            const { rows: [eventInfo] } = await db.query("SELECT name FROM events WHERE id = $1", [eventId]);
            await PushService.sendTeamerEventCancellationToAdmins(
              db, req.user.organization_id, req.user.display_name,
              eventInfo ? eventInfo.name : 'Event', eventId
            );
          } catch (pushErr) {
            console.error('Push notification failed for teamer cancellation:', pushErr);
          }
        }
      }, 'DELETE /events/:eventId/book');

    } catch (err) {
      console.error('Database error in DELETE /events/:eventId/book:', eventId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Add participant to event (Admin only) - mit Transaktion gegen Race Conditions
  router.post('/:id/participants', rbacVerifier, requireTeamer, async (req, res) => {
    const eventId = req.params.id;
    const { user_id, status = 'auto', timeslot_id = null } = req.body;

    const client = await db.getClient();
    try {
      // Transaktion starten für Race-Condition-Schutz
      await client.query('BEGIN');

      // 1. Get event details (FOR UPDATE sperrt die Zeile)
      const { rows: [event] } = await client.query("SELECT id, name, description, event_date, event_end_time, location, points, point_type, type, max_participants, registration_opens_at, registration_closes_at, has_timeslots, waitlist_enabled, max_waitlist_size, teamer_max_participants, teamer_waitlist_enabled, teamer_max_waitlist_size, is_series, series_id, mandatory, is_konfirmation, bring_items, checkin_window, teamer_needed, teamer_only, cancelled, qr_token, created_by, organization_id FROM events WHERE id = $1 AND organization_id = $2 FOR UPDATE", [eventId, req.user.organization_id]);
      if (!event) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      // 2. Validate user
      const { rows: [user] } = await client.query("SELECT id FROM users WHERE id = $1 AND organization_id = $2", [user_id, req.user.organization_id]);
      if (!user) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }

      // 3. Validate timeslot if provided
      let timeslot = null;
      if (event.has_timeslots) {
        if (!timeslot_id) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({ error: 'Zeitslot-Auswahl für dieses Event erforderlich' });
        }
        const { rows: [ts] } = await client.query("SELECT id, event_id, start_time, end_time, max_participants, organization_id FROM event_timeslots WHERE id = $1 AND event_id = $2 AND organization_id = $3", [timeslot_id, eventId, req.user.organization_id]);
        if (!ts) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(404).json({ error: 'Zeitslot nicht gefunden' });
        }
        timeslot = ts;
      }

      // 4. Check if already booked
      const { rows: [existing] } = await client.query("SELECT id FROM event_bookings WHERE event_id = $1 AND user_id = $2", [eventId, user_id]);
      if (existing) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({ error: 'Benutzer ist bereits für dieses Event angemeldet' });
      }

      // 5. Determine final status
      let finalStatus = status;
      if (status === 'auto') {
        // Rolle des hinzugefuegten Users bestimmt, GEGEN WELCHES Kontingent
        // gezählt wird. Ohne diese Weiche landete ein per Admin hinzugefuegter
        // Teamer im Konfi-Kontingent — und stand er auf der Warteliste, fand
        // ihn promoteFromWaitlist(...,'not_teamer') nie: eine tote Buchung.
        const { rows: [addedUser] } = await client.query(
          `SELECT r.name AS role_name FROM users u
           JOIN roles r ON u.role_id = r.id
           WHERE u.id = $1 AND u.organization_id = $2`,
          [user_id, req.user.organization_id]
        );
        const addedIsTeamer = addedUser?.role_name === 'teamer';

        if (addedIsTeamer && !event.teamer_needed && !event.teamer_only) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({ error: 'Dieses Event ist nicht für Teamer:innen vorgesehen' });
        }
        if (!addedIsTeamer && event.teamer_only) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({ error: 'Dieses Event ist nur für Teamer:innen' });
        }

        // Teamer buchen nie in Timeslots (wie im Selbst-Buchungs-Pfad).
        const isTimeslotBooking = !!timeslot && !addedIsTeamer;
        const roleFilterSql = addedIsTeamer
          ? "AND r.name = 'teamer'"
          : "AND r.name <> 'teamer'";
        const capacityQuery = isTimeslotBooking
        ? `SELECT COUNT(*) as confirmed_count FROM event_bookings eb
             JOIN users u ON eb.user_id = u.id JOIN roles r ON u.role_id = r.id
             WHERE eb.timeslot_id = $1 AND eb.status = 'confirmed' ${roleFilterSql} AND u.deleted_at IS NULL`
        : `SELECT COUNT(*) as confirmed_count FROM event_bookings eb
             JOIN users u ON eb.user_id = u.id JOIN roles r ON u.role_id = r.id
             WHERE eb.event_id = $1 AND eb.status = 'confirmed' ${roleFilterSql} AND u.deleted_at IS NULL`;
        const capacityParam = isTimeslotBooking ? timeslot.id : eventId;
        const maxCapacity = isTimeslotBooking
          ? timeslot.max_participants
          : (addedIsTeamer ? (event.teamer_max_participants || 0) : event.max_participants);

        const { rows: [capacityResult] } = await client.query(capacityQuery, [capacityParam]);
        const confirmedCount = parseInt(capacityResult.confirmed_count, 10);

        // Only check capacity if maxCapacity > 0 (0 means unlimited)
        if (maxCapacity > 0 && confirmedCount >= maxCapacity) {
          // Auch die Warteliste rollenrichtig: Teamer haben eigene Felder.
          const waitlistEnabled = addedIsTeamer ? event.teamer_waitlist_enabled : event.waitlist_enabled;
          const maxWaitlistSize = addedIsTeamer
            ? (event.teamer_max_waitlist_size || 10)
            : event.max_waitlist_size;
          if (waitlistEnabled) {
            const waitlistQuery = isTimeslotBooking
            ? `SELECT COUNT(*) as waitlist_count FROM event_bookings eb
                 JOIN users u ON eb.user_id = u.id JOIN roles r ON u.role_id = r.id
                 WHERE eb.timeslot_id = $1 AND eb.status = 'waitlist' ${roleFilterSql} AND u.deleted_at IS NULL`
            : `SELECT COUNT(*) as waitlist_count FROM event_bookings eb
                 JOIN users u ON eb.user_id = u.id JOIN roles r ON u.role_id = r.id
                 WHERE eb.event_id = $1 AND eb.status = 'waitlist' ${roleFilterSql} AND u.deleted_at IS NULL`;
            const { rows: [waitlistResult] } = await client.query(waitlistQuery, [capacityParam]);
            const waitlistCount = parseInt(waitlistResult.waitlist_count, 10);

            if (waitlistCount >= maxWaitlistSize) {
              await client.query('ROLLBACK');
              client.release();
              return res.status(409).json({ error: 'Event und Warteliste sind voll' });
            }
            finalStatus = 'waitlist';
          } else {
            await client.query('ROLLBACK');
            client.release();
            return res.status(409).json({ error: 'Event ist voll und Warteliste ist deaktiviert' });
          }
        } else {
          finalStatus = 'confirmed';
        }
      }

      // 6. Create booking
      const insertQuery = "INSERT INTO event_bookings (event_id, user_id, timeslot_id, status, booking_date, organization_id) VALUES ($1, $2, $3, $4, NOW(), $5) RETURNING id";
      const { rows: [newBooking] } = await client.query(insertQuery, [eventId, user_id, timeslot_id, finalStatus, req.user.organization_id]);

      // In den Chat zum Termin, falls es einen gibt (idempotent).
      await addToEventChat(client, eventId, user_id, req.user.organization_id);

      // Transaktion abschliessen
      await client.query('COMMIT');
      client.release();

      const responseMessage = timeslot
      ? `Teilnehmer:in zum Zeitslot ${new Date(timeslot.start_time).toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})} - ${new Date(timeslot.end_time).toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})} ${finalStatus === 'waitlist' ? 'auf Warteliste gesetzt' : 'hinzugefügt'}`
      : `Teilnehmer:in ${finalStatus === 'waitlist' ? 'auf Warteliste gesetzt' : 'hinzugefügt'}`;

      res.status(201).json({
        id: newBooking.id,
        status: finalStatus,
        timeslot_id: timeslot_id,
        message: responseMessage
      });

      // Live Update: Notify the booked person and admins about the admin-booking.
      // sendToUserByRole statt hart 'konfi': die Leitung kann hier auch
      // Teamer:innen eintragen (siehe addedIsTeamer oben) — die sitzen im Raum
      // user_teamer_<id> und bekamen ihr eigenes Ereignis sonst nie.
      liveUpdate.sendToUserByRole(user_id, 'events', 'update', { eventId, status: finalStatus });
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'admin_booking' });

    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
      console.error('Database error in POST /events/:id/participants:', req.params.id, err);
      if (err.code === '23505') { // unique_violation
        return res.status(409).json({ error: 'Dieser Benutzer ist bereits für dieses Event angemeldet.' });
      }
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Delete event booking (Admin only)
  router.delete('/:id/bookings/:bookingId', rbacVerifier, requireTeamer, async (req, res) => {
    const { id: eventId, bookingId } = req.params;
    
    try {
      
      // Get booking details to verify ownership and status (Event-Org wird mitgeprueft).
      // Die Rolle des ENTFERNTEN Users wird mitgelesen: sie entscheidet, aus welcher
      // Warteliste nachgerueckt wird (Konfi- und Teamer-Kontingent sind getrennt).
      const { rows: [booking] } = await db.query(`
        SELECT eb.*, u.organization_id, e.organization_id as event_org_id,
               (r.name = 'teamer') as is_teamer_booking
        FROM event_bookings eb
        JOIN users u ON eb.user_id = u.id
        JOIN roles r ON u.role_id = r.id
        JOIN events e ON eb.event_id = e.id
        WHERE eb.id = $1 AND eb.event_id = $2`, [bookingId, eventId]);

      if (!booking) return res.status(404).json({ error: 'Buchung nicht gefunden' });
      if (booking.organization_id !== req.user.organization_id || booking.event_org_id !== req.user.organization_id) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }
      
      // Falls der Konfi als ANWESEND verbucht war, beim Löschen die vergebenen
      // Event-Punkte zuruecknehmen (sonst behält er Punkte für ein Event, an dem
      // er nicht mehr als Teilnehmer geführt wird). Nur für Konfis relevant.
      if (booking.attendance_status === 'present') {
        const { rows: [pts] } = await db.query(
          "SELECT id, points, point_type FROM event_points WHERE konfi_id = $1 AND event_id = $2",
          [booking.user_id, eventId]
        );
        if (pts) {
          await db.query("DELETE FROM event_points WHERE id = $1", [pts.id]);
          const profileUpd = pts.point_type === 'gottesdienst'
            ? "UPDATE konfi_profiles SET gottesdienst_points = GREATEST(0, gottesdienst_points - $1) WHERE user_id = $2"
            : "UPDATE konfi_profiles SET gemeinde_points = GREATEST(0, gemeinde_points - $1) WHERE user_id = $2";
          await db.query(profileUpd, [pts.points, booking.user_id]);
          // Dashboard/Punkte live aktualisieren.
          liveUpdate.sendToUser('konfi', booking.user_id, 'dashboard', 'update', { points: -pts.points });
        }
      }

      // Delete the booking
      await db.query("DELETE FROM event_bookings WHERE id = $1", [bookingId]);

      // Wer von der Leitung ausgetragen wird, gehört auch nicht mehr in den
      // Event-Chat. Bisher tat das nur die Selbstabmeldung der Teamer
      // 
      await removeFromEventChat(db, eventId, booking.user_id, req.user.organization_id);

      // Auto-promote from waitlist if the deleted booking was confirmed.
      // Konfi- und Teamer-Kontingent sind strikt getrennt: ein frei gewordener
      // Konfi-Platz wird nur aus der Konfi-Warteliste nachbesetzt und umgekehrt.
      // promoteFromWaitlist filtert die Rolle und schließt geloeschte User aus.
      if (booking.status === 'confirmed') {
        const removedIsTeamer = booking.is_teamer_booking === true;
        try {
          let maxCapacity = 0;
          let confirmedCount = 0;

          if (removedIsTeamer) {
            // Teamer-Buchungen haben nie einen Timeslot -> event-weite Zählung.
            const { rows: [teamerCapInfo] } = await db.query(
              "SELECT teamer_max_participants FROM events WHERE id = $1 AND organization_id = $2",
              [eventId, req.user.organization_id]
            );
            const { rows: [teamerCountRes] } = await db.query(
              `SELECT COUNT(*) as confirmed_count
               FROM event_bookings eb
               JOIN users u ON eb.user_id = u.id
               JOIN roles r ON u.role_id = r.id
               WHERE eb.event_id = $1 AND eb.status = 'confirmed'
                 AND r.name = 'teamer' AND u.deleted_at IS NULL`,
              [eventId]
            );
            maxCapacity = teamerCapInfo?.teamer_max_participants || 0;
            confirmedCount = parseInt(teamerCountRes?.confirmed_count || '0', 10);
          } else if (booking.timeslot_id) {
            const { rows: [slotInfo] } = await db.query(
              "SELECT max_participants FROM event_timeslots WHERE id = $1 AND organization_id = $2",
              [booking.timeslot_id, req.user.organization_id]
            );
            // Teamer:innen zählen NICHT gegen das Konfi-Kontingent (sie haben
            // ihr eigenes) — sonst blockiert eine bestaetigte Teamer-Buchung
            // den Nachrueckplatz eines Konfis.
            const { rows: [slotCountRes] } = await db.query(
              `SELECT COUNT(*) as confirmed_count
               FROM event_bookings eb
               LEFT JOIN users u ON eb.user_id = u.id
               LEFT JOIN roles r ON u.role_id = r.id AND r.name = 'teamer'
               WHERE eb.timeslot_id = $1 AND eb.status = 'confirmed' AND r.id IS NULL`,
              [booking.timeslot_id]
            );
            maxCapacity = slotInfo?.max_participants || 0;
            confirmedCount = parseInt(slotCountRes?.confirmed_count || '0', 10);
          } else {
            const { rows: [eventCapInfo] } = await db.query(
              "SELECT max_participants FROM events WHERE id = $1 AND organization_id = $2",
              [eventId, req.user.organization_id]
            );
            const { rows: [countResult] } = await db.query(
              `SELECT COUNT(*) as confirmed_count
               FROM event_bookings eb
               LEFT JOIN users u ON eb.user_id = u.id
               LEFT JOIN roles r ON u.role_id = r.id AND r.name = 'teamer'
               WHERE eb.event_id = $1 AND eb.status = 'confirmed' AND r.id IS NULL`,
              [eventId]
            );
            maxCapacity = eventCapInfo?.max_participants || 0;
            confirmedCount = parseInt(countResult?.confirmed_count || '0', 10);
          }

          // Nur nachruecken wenn unter Kapazität (0 = unbegrenzt, immer nachruecken).
          if (maxCapacity === 0 || confirmedCount < maxCapacity) {
            const promotedUserId = await promoteFromWaitlist(
              db,
              eventId,
              removedIsTeamer ? null : booking.timeslot_id,
              removedIsTeamer ? 'teamer' : 'not_teamer'
            );

            if (promotedUserId) {
              const { rows: [eventInfo] } = await db.query(
                "SELECT name FROM events WHERE id = $1", [eventId]
              );
              const eventName = eventInfo?.name || null;
              const promotedType = removedIsTeamer ? 'teamer' : 'konfi';

              if (eventName) {
                if (removedIsTeamer) {
                  await PushService.sendWaitlistPromotionToTeamer(db, promotedUserId, eventName, null, eventId, req.user.organization_id);
                } else {
                  await PushService.sendWaitlistPromotionToKonfi(db, promotedUserId, eventName, null, eventId, req.user.organization_id);
                }
              }
              // Live Update: Notify promoted user about their status change
              liveUpdate.sendToUser(promotedType, promotedUserId, 'events', 'update', { eventId, action: 'promoted' });
            }
          }
        } catch (promotionError) {
          console.error('Error promoting from waitlist:', promotionError);
        }
      }

      res.json({ message: 'Teilnehmer erfolgreich entfernt' });

      // Live Update: Notify the removed user (rollenrichtiger Kanal) and admins
      liveUpdate.sendToUser(booking.is_teamer_booking ? 'teamer' : 'konfi', booking.user_id, 'events', 'update', { eventId, action: 'removed' });
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'booking_removed' });

    } catch (err) {
 console.error('Database error in DELETE /events/:eventId/bookings/:bookingId:', eventId, bookingId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Get user's bookings
  router.get('/user/bookings', rbacVerifier, async (req, res) => {
    try {
      if (req.user.type !== 'konfi' && req.user.type !== 'teamer') {
        return res.status(403).json({ error: 'Nur Konfis und Teamer:innen können ihre Buchungen einsehen' });
      }
      
      const query = `
        SELECT eb.*, eb.status, e.name as event_name, e.event_date, e.location, e.mandatory, e.bring_items
        FROM event_bookings eb
        JOIN events e ON eb.event_id = e.id
        WHERE eb.user_id = $1 AND eb.status IN ('confirmed', 'waitlist') AND e.organization_id = $2
        ORDER BY e.event_date ASC
      `;
      const { rows: bookings } = await db.query(query, [req.user.id, req.user.organization_id]);
      res.json(bookings);
      
    } catch (err) {
 console.error('Database error in GET /events/user/bookings:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Create series events
  router.post('/series', rbacVerifier, requireTeamer, async (req, res) => {
    // WICHTIG: Diese Liste muss mit POST / (Einzel-Event) synchron bleiben.
    // Fehlende Felder wurden hier früher stillschweigend auf den Spalten-
    // Default gesetzt — eine Serie kam damit ohne Teamer-Kontingent, ohne
    // Pflicht-/Konfirmations-Flag, ohne Mitbringen und ohne Check-in-Fenster
    // heraus, obwohl das Formular sie mitgeschickt hat (Bugreport 09.08.).
    const {
      name, description, event_date, event_end_time, location, location_maps_url, points, point_type,
      category_ids, jahrgang_ids, type, max_participants, registration_opens_at,
      registration_closes_at, has_timeslots, waitlist_enabled, max_waitlist_size,
      timeslots, series_count, series_interval, teamer_needed, teamer_only,
      teamer_max_participants, teamer_waitlist_enabled, teamer_max_waitlist_size,
      mandatory, is_konfirmation, bring_items, checkin_window
    } = req.body;

    // Gleiche Kontingent-Prüfung wie beim Einzel-Event.
    const seriesTeamerQuotaCheck = validateTeamerQuota(teamer_max_participants, teamer_max_waitlist_size);
    if (seriesTeamerQuotaCheck) {
      return res.status(400).json({ error: seriesTeamerQuotaCheck });
    }

    // Gegenseitiger Ausschluss wie in POST / und PUT /:id
    if (teamer_needed && teamer_only) {
      return res.status(400).json({ error: 'teamer_needed und teamer_only schließen sich gegenseitig aus' });
    }

    // Pflicht-Events benoetigen mindestens einen Jahrgang (wie POST /)
    if (mandatory && (!jahrgang_ids || jahrgang_ids.length === 0)) {
      return res.status(400).json({ error: 'Pflicht-Events benötigen mindestens einen Jahrgang' });
    }

    // DIESELBEN Zwangsregeln wie POST / — vorher wendete die Serien-Route
    // KEINE davon an: eine Serie mit mandatory bekam Punkte, Teilnehmerzahl,
    // Warteliste und Timeslots wie gesendet, eine Konfirmations-Serie ebenso.
    const seriesPoints = (mandatory || is_konfirmation || teamer_only) ? 0 : (points || 0);
    const seriesMaxParticipants = mandatory ? 0 : max_participants;
    const seriesWaitlist = mandatory ? false : (waitlist_enabled !== undefined ? waitlist_enabled : true);
    const seriesHasTimeslots = (mandatory || is_konfirmation) ? false : (has_timeslots || false);
    // checkin_window auf 5-120 begrenzen (wie POST /): ein negativer Wert
    // wuerde das QR-Zeitfenster umdrehen.
    const seriesCheckinWindow = Math.max(5, Math.min(120, parseInt(checkin_window) || 30));
    
    if (!name || !event_date || !series_count || series_count < 2) {
      return res.status(400).json({ error: 'Name, Datum und Serienanzahl (min. 2) sind erforderlich' });
    }

    // Serien-Limits: max. 26 Termine, gültiges Intervall, max. 12 Monate Spannweite.
    // Verhindert versehentliche oder missbräuchliche Riesen-Serien (Aufräumen wäre teuer).
    const SERIES_MAX_COUNT = 26;
    const SERIES_MAX_SPAN_MONTHS = 12;
    const SERIES_INTERVALS = ['day', 'week', '2weeks', 'month'];

    if (!Number.isInteger(series_count) || series_count > SERIES_MAX_COUNT) {
      return res.status(400).json({ error: `Eine Serie darf höchstens ${SERIES_MAX_COUNT} Termine haben` });
    }
    if (series_interval !== undefined && !SERIES_INTERVALS.includes(series_interval)) {
      return res.status(400).json({ error: 'Ungültiges Serien-Intervall. Erlaubt: day, week, 2weeks, month' });
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

    const generateSeriesDates = (startDate, count, interval) => {
      const dates = [];
      let currentDate = new Date(startDate);
      for (let i = 0; i < count; i++) {
        dates.push(new Date(currentDate));
        if (interval === 'day') currentDate.setDate(currentDate.getDate() + 1);
        else if (interval === '2weeks') currentDate.setDate(currentDate.getDate() + 14);
        else if (interval === 'month') currentDate.setMonth(currentDate.getMonth() + 1);
        else currentDate.setDate(currentDate.getDate() + 7); // 'week' und default: wöchentlich
      }
      return dates;
    };

    const seriesDates = generateSeriesDates(event_date, series_count, series_interval);

    // Spannweite prüfen: letzter Termin muss VOR first + 12 Monate liegen.
    // (>= statt >: monatlich x 13 endet exakt +12 Monate und soll abgelehnt
    // werden — das Frontend erlaubt bei monatlich max. 12 Termine.)
    const spanLimit = new Date(seriesDates[0]);
    spanLimit.setMonth(spanLimit.getMonth() + SERIES_MAX_SPAN_MONTHS);
    const lastDate = seriesDates[seriesDates.length - 1];
    if (lastDate >= spanLimit) {
      return res.status(400).json({
        error: `Eine Serie darf höchstens ${SERIES_MAX_SPAN_MONTHS} Monate umfassen (letzter Termin wäre ${lastDate.toLocaleDateString('de-DE')})`
      });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      let seriesId = null; // Will be set to the first event's ID


      for (let i = 0; i < seriesDates.length; i++) {
        const date = seriesDates[i];
        const eventName = `${name} #${i + 1}`;

        // Calculate dates for this specific event in series
        const eventStartDate = new Date(date);
        const eventEndDate = event_end_time ? new Date(date) : null;
        if (eventEndDate && event_end_time) {
          const endTime = new Date(event_end_time);
          eventEndDate.setHours(endTime.getHours(), endTime.getMinutes(), 0, 0);
        }

        // Calculate registration dates for this event
        const regOpens = registration_opens_at ? new Date(date) : null;
        if (regOpens && registration_opens_at) {
          const openTime = new Date(registration_opens_at);
          regOpens.setHours(openTime.getHours(), openTime.getMinutes(), 0, 0);
          regOpens.setDate(regOpens.getDate() - (new Date(event_date).getDate() - new Date(registration_opens_at).getDate()));
        }

        const regCloses = registration_closes_at ? new Date(date) : null;
        if (regCloses && registration_closes_at) {
          const closeTime = new Date(registration_closes_at);
          regCloses.setHours(closeTime.getHours(), closeTime.getMinutes(), 0, 0);
          regCloses.setDate(regCloses.getDate() - (new Date(event_date).getDate() - new Date(registration_closes_at).getDate()));
        }

        let eventId;

        // First event: create without series_id, then use its ID as series_id
        if (i === 0) {
          const eventQuery = `
            INSERT INTO events (
              name, description, event_date, event_end_time, location, location_maps_url, points, point_type,
              type, max_participants, registration_opens_at, registration_closes_at,
              has_timeslots, waitlist_enabled, max_waitlist_size, is_series,
              teamer_needed, teamer_only,
              teamer_max_participants, teamer_waitlist_enabled, teamer_max_waitlist_size,
              mandatory, is_konfirmation, bring_items, checkin_window,
              created_by, organization_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true, $16, $17,
                      $18, $19, $20, $21, $22, $23, $24, $25, $26)
            RETURNING id
          `;
          const { rows: [newEvent] } = await client.query(eventQuery, [
            eventName, description, eventStartDate.toISOString(),
            eventEndDate ? eventEndDate.toISOString() : null,
            location, location_maps_url,
            seriesPoints, point_type || 'gemeinde', type || 'event', seriesMaxParticipants,
            regOpens ? regOpens.toISOString() : null,
            regCloses ? regCloses.toISOString() : null,
            seriesHasTimeslots,
            seriesWaitlist,
            max_waitlist_size || 10,
            teamer_needed || false, teamer_only || false,
            teamer_max_participants !== undefined && teamer_max_participants !== null ? parseInt(teamer_max_participants, 10) : 0,
            teamer_waitlist_enabled !== undefined && teamer_waitlist_enabled !== null ? !!teamer_waitlist_enabled : true,
            teamer_max_waitlist_size !== undefined && teamer_max_waitlist_size !== null ? parseInt(teamer_max_waitlist_size, 10) : 10,
            mandatory || false, is_konfirmation || false,
            bring_items || null,
            seriesCheckinWindow,
            req.user.id, req.user.organization_id
          ]);
          eventId = newEvent.id;
          seriesId = eventId; // Use first event's ID as series_id

          // Update first event to set its own series_id
          await client.query("UPDATE events SET series_id = $1 WHERE id = $2", [seriesId, eventId]);
        } else {
          // Subsequent events: create with series_id
          const eventQuery = `
            INSERT INTO events (
              name, description, event_date, event_end_time, location, location_maps_url, points, point_type,
              type, max_participants, registration_opens_at, registration_closes_at,
              has_timeslots, waitlist_enabled, max_waitlist_size, is_series, series_id,
              teamer_needed, teamer_only,
              teamer_max_participants, teamer_waitlist_enabled, teamer_max_waitlist_size,
              mandatory, is_konfirmation, bring_items, checkin_window,
              created_by, organization_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true, $16, $17, $18,
                      $19, $20, $21, $22, $23, $24, $25, $26, $27)
            RETURNING id
          `;
          const { rows: [newEvent] } = await client.query(eventQuery, [
            eventName, description, eventStartDate.toISOString(),
            eventEndDate ? eventEndDate.toISOString() : null,
            location, location_maps_url,
            seriesPoints, point_type || 'gemeinde', type || 'event', seriesMaxParticipants,
            regOpens ? regOpens.toISOString() : null,
            regCloses ? regCloses.toISOString() : null,
            seriesHasTimeslots,
            seriesWaitlist,
            max_waitlist_size || 10,
            seriesId,
            teamer_needed || false, teamer_only || false,
            teamer_max_participants !== undefined && teamer_max_participants !== null ? parseInt(teamer_max_participants, 10) : 0,
            teamer_waitlist_enabled !== undefined && teamer_waitlist_enabled !== null ? !!teamer_waitlist_enabled : true,
            teamer_max_waitlist_size !== undefined && teamer_max_waitlist_size !== null ? parseInt(teamer_max_waitlist_size, 10) : 10,
            mandatory || false, is_konfirmation || false,
            bring_items || null,
            seriesCheckinWindow,
            req.user.id, req.user.organization_id
          ]);
          eventId = newEvent.id;
        }

        // IMPORTANT: Create relationPromises array INSIDE the loop for each event
        // This prevents promises from previous events being executed again
        const relationPromises = [];
        if (category_ids && category_ids.length) {
          const catQuery = "INSERT INTO event_categories (event_id, category_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING";
          relationPromises.push(client.query(catQuery, [eventId, category_ids]));
        }
        if (jahrgang_ids && jahrgang_ids.length) {
          const jahrQuery = "INSERT INTO event_jahrgang_assignments (event_id, jahrgang_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING";
          relationPromises.push(client.query(jahrQuery, [eventId, jahrgang_ids]));
        }
        if (has_timeslots && timeslots && timeslots.length) {
          const tsQuery = "INSERT INTO event_timeslots (event_id, start_time, end_time, max_participants, organization_id) VALUES ($1, $2, $3, $4, $5)";
          timeslots.forEach(slot => {
            // Adjust timeslot dates to match the event date
            const slotStart = new Date(slot.start_time);
            const slotEnd = new Date(slot.end_time);
            const adjustedStart = new Date(date);
            const adjustedEnd = new Date(date);

            adjustedStart.setHours(slotStart.getHours(), slotStart.getMinutes(), 0, 0);
            adjustedEnd.setHours(slotEnd.getHours(), slotEnd.getMinutes(), 0, 0);

            relationPromises.push(client.query(tsQuery, [
              eventId,
              adjustedStart.toISOString(),
              adjustedEnd.toISOString(),
              slot.max_participants,
              req.user.organization_id
            ]));
          });
        }
        // Wait for all relations of THIS event to be created before moving to next event
        await Promise.all(relationPromises);

        // Auto-Enrollment für Pflicht-Events — wie in POST / (dort Z. 858ff).
        // Fehlte hier komplett: eine Pflicht-SERIE hatte in keinem Termin
        // Teilnehmer, obwohl Pflicht bedeutet "der ganze Jahrgang ist dabei".
        if (mandatory && jahrgang_ids && jahrgang_ids.length > 0) {
          await client.query(
            `INSERT INTO event_bookings (event_id, user_id, status, booking_date, organization_id)
             SELECT $1, u.id, 'confirmed', NOW(), $3
             FROM users u
             JOIN konfi_profiles kp ON u.id = kp.user_id
             JOIN roles r ON u.role_id = r.id
             WHERE kp.jahrgang_id = ANY($2::int[])
               AND u.organization_id = $3
               AND r.name = 'konfi'
               AND u.deleted_at IS NULL
             ON CONFLICT (user_id, event_id) DO NOTHING`,
            [eventId, jahrgang_ids, req.user.organization_id]
          );
        }
      }

      await client.query('COMMIT');
      client.release();

      res.status(201).json({
        message: 'Serien-Events erfolgreich erstellt',
        series_id: seriesId,
        events_created: seriesDates.length
      });

      // Live-Update an die ganze Org (analog Einzel-Create events.js:766): neue
      // Serien-Events erschienen -> Konfis + Admins/Teamer:innen aktualisieren.
      liveUpdate.sendToOrg(req.user.organization_id, 'events', 'create', { seriesId, count: seriesDates.length });

    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
      console.error('Database error in POST /events/series:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Promote/Demote participant between confirmed and waitlist
  router.put('/:id/participants/:participantId/status', rbacVerifier, requireTeamer, async (req, res) => {
    const { id: eventId, participantId } = req.params;
    const { status } = req.body;
    
    try {
      if (!['confirmed', 'waitlist'].includes(status)) {
        return res.status(400).json({ error: 'Ungültiger Status. Muss bestätigt oder Warteliste sein' });
      }
      
      
      const { rows: [booking] } = await db.query("SELECT eb.status, eb.attendance_status, eb.user_id, e.organization_id, e.name AS event_name, e.event_date FROM event_bookings eb JOIN events e ON eb.event_id = e.id WHERE eb.id = $1 AND eb.event_id = $2", [participantId, eventId]);
      if (!booking) return res.status(404).json({ error: 'Buchung nicht gefunden' });
      if (booking.organization_id !== req.user.organization_id) return res.status(403).json({ error: 'Zugriff verweigert' });
      if (booking.status === status) return res.status(400).json({ error: `Teilnehmer:in ist bereits ${status === 'confirmed' ? 'bestätigt' : 'auf der Warteliste'}` });

      // Vorheriger Status: bei Wechsel von 'waitlist' -> 'confirmed' ist es eine
      // Wartelisten-Befoerderung (Push an die betroffene Person). Bei 'confirmed'
      // -> 'waitlist' werden ggf. Punkte entzogen (Dashboard-Refresh nötig).
      const wasWaitlist = booking.status === 'waitlist';
      let pointsRemoved = false;

      if (status === 'waitlist') {
        // Auf Warteliste: attendance_status löschen und Event-Punkte zurücknehmen
        await db.query("UPDATE event_bookings SET status = 'waitlist', attendance_status = NULL WHERE id = $1", [participantId]);

        // Event-Punkte zurücknehmen falls vorhanden
        const { rows: [existingPoints] } = await db.query("SELECT id, points, point_type FROM event_points WHERE konfi_id = $1 AND event_id = $2", [booking.user_id, eventId]);
        if (existingPoints) {
          await db.query("DELETE FROM event_points WHERE id = $1", [existingPoints.id]);
          const updateProfileQuery = existingPoints.point_type === 'gottesdienst'
            ? "UPDATE konfi_profiles SET gottesdienst_points = GREATEST(0, gottesdienst_points - $1) WHERE user_id = $2"
            : "UPDATE konfi_profiles SET gemeinde_points = GREATEST(0, gemeinde_points - $1) WHERE user_id = $2";
          await db.query(updateProfileQuery, [existingPoints.points, booking.user_id]);
          pointsRemoved = true;
        }
      } else {
        await db.query("UPDATE event_bookings SET status = $1 WHERE id = $2", [status, participantId]);
      }

      // In den Chat zum Termin, falls es einen gibt. Auch bei der Rueckstufung
      // auf die Warteliste: angemeldet ist angemeldet, entfernt wird erst beim
      // Austragen (idempotent, meist schon drin).
      await addToEventChat(db, eventId, booking.user_id, req.user.organization_id);

      const action = status === 'confirmed' ? 'Teilnehmer:in von Warteliste bestätigt' : 'Teilnehmer:in auf Warteliste gesetzt';
      res.json({ message: action, status });

      // Push bei Befoerderung von der Warteliste (analog events.js:1010/1513/1731).
      // Seiteneffekt NACH res — Push-Fehler darf nichts kippen.
      nachAntwort(req, async () => {
        if (status === 'confirmed' && wasWaitlist) {
          try {
            await PushService.sendWaitlistPromotionToKonfi(db, booking.user_id, booking.event_name, booking.event_date, eventId, req.user.organization_id);
          } catch (pushErr) {
            console.error('Error sending waitlist promotion push:', pushErr);
          }
        }

        // Live-Update an die betroffene Person (korrekter Socket-Raum per Rolle).
        liveUpdate.sendToUserByRole(booking.user_id, 'events', 'update', { eventId });
        // Bei Punktentzug (Degradierung) zusaetzlich das Dashboard aktualisieren.
        if (pointsRemoved) {
          liveUpdate.sendToUserByRole(booking.user_id, 'dashboard', 'update');
        }
        // Live-Update an Admins/Org-Admins/Teamer:innen der Org.
        liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId });
      }, 'PUT /events/:eventId/participants/:participantId/status');

    } catch (err) {
 console.error('Database error in PUT /events/:eventId/participants/:participantId/status:', eventId, participantId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Abgemeldete (status <> 'confirmed') und bereits Verbuchte
  // (attendance_status IS NOT NULL) bleiben in BEIDEN Faellen unangetastet:
  // "Alle verbuchen" darf keine getroffene Entscheidung ueberschreiben.
  router.put('/:id/participants/attendance-all', rbacVerifier, requireTeamer, async (req, res) => {
    const { id: eventId } = req.params;
    const rolle = req.body?.rolle === 'teamer' ? 'teamer' : 'konfi';
    const client = await db.getClient();
    try {
      const { rows: [event] } = await client.query(
        "SELECT organization_id, name, points, point_type, mandatory FROM events WHERE id = $1",
        [eventId]
      );
      if (!event) { return res.status(404).json({ error: 'Event nicht gefunden' }); }
      if (event.organization_id !== req.user.organization_id) { return res.status(403).json({ error: 'Zugriff verweigert' }); }

      await client.query('BEGIN');

      // Nur ANGEMELDETE Konfis ohne Anwesenheits-Status. Teamer:innen werden
      // weiterhin einzeln verbucht (eigene Liste, keine Punkte).
      const { rows: unprocessed } = await client.query(
        `SELECT eb.id AS booking_id, eb.user_id
         FROM event_bookings eb
         JOIN users u ON eb.user_id = u.id
         JOIN roles r ON u.role_id = r.id
         WHERE eb.event_id = $1 AND eb.status = 'confirmed'
           AND eb.attendance_status IS NULL
           AND (CASE WHEN $2 = 'teamer' THEN r.name = 'teamer' ELSE COALESCE(r.name, '') <> 'teamer' END)
         ORDER BY eb.created_at ASC`,
        [eventId, rolle]
      );

      const awarded = []; // Konfis, die Punkte bekommen haben
      const marked = [];  // alle als anwesend verbuchten Konfis
      const pointType = event.point_type || 'gemeinde';

      for (const b of unprocessed) {
        await client.query("UPDATE event_bookings SET attendance_status = 'present' WHERE id = $1", [b.booking_id]);
        marked.push(b.user_id);

        // Punkte-Logik identisch zum Einzel-Handler: nur nicht-Pflicht-Events
        // mit Punkten. Deaktivierter Punkt-Typ bricht den Bulk NICHT ab —
        // die Person wird verbucht, nur ohne Punkte (anders als der 400 des
        // Einzel-Handlers, der bei einem Bulk alle uebrigen blockieren wuerde).
        // Punkte nur fuer Konfis. Teamer werden verbucht (fuer Abzeichen und
        // Anwesenheit), bekommen aber keine Konfi-Punkte.
        if (rolle === 'konfi' && event.points > 0 && !event.mandatory) {
          const { enabled: ptEnabled } = await checkPointTypeEnabled(client, b.user_id, pointType);
          if (!ptEnabled) continue;

          const { rowCount } = await client.query(
            `INSERT INTO event_points (konfi_id, event_id, points, point_type, description, awarded_date, admin_id, organization_id)
             VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
             ON CONFLICT (konfi_id, event_id) DO NOTHING`,
            [b.user_id, eventId, event.points, pointType, `Event-Teilnahme: ${event.name}`, req.user.id, req.user.organization_id]
          );
          if (rowCount > 0) {
            const updateProfileQuery = pointType === 'gottesdienst'
              ? "UPDATE konfi_profiles SET gottesdienst_points = gottesdienst_points + $1 WHERE user_id = $2"
              : "UPDATE konfi_profiles SET gemeinde_points = gemeinde_points + $1 WHERE user_id = $2";
            await client.query(updateProfileQuery, [event.points, b.user_id]);
            awarded.push(b.user_id);
          }
        }
      }

      await client.query('COMMIT');
      res.json({
        message: marked.length > 0
          ? `${marked.length} Teilnehmer:in(nen) als anwesend verbucht${awarded.length > 0 ? `, ${event.points} Punkte je ${awarded.length}x vergeben` : ''}`
          : 'Keine unverbuchten Angemeldeten vorhanden',
        confirmed: marked.length,
        points_awarded: awarded.length
      });

      // Seiteneffekte NACH COMMIT (Muster Einzel-Handler): Badges, Level-Up,
      // Push und LiveUpdates pro Person fehlertolerant.
      nachAntwort(req, async () => {
        for (const userId of marked) {
          try {
            await checkAndAwardBadges(db, userId);
          } catch (badgeErr) {
            console.error('Error checking badges after bulk attendance:', badgeErr);
          }
        }
        for (const userId of marked) {
          const gotPoints = awarded.includes(userId);
          try {
            if (gotPoints) {
              await PushService.checkAndSendLevelUp(db, userId, req.user.organization_id);
            }
            await PushService.sendEventAttendanceToKonfi(db, userId, event.name, 'present', gotPoints ? event.points : 0, null, req.user.organization_id);
          } catch (pushErr) {
            console.error('Push notification failed (bulk attendance):', pushErr);
          }
          if (gotPoints) {
            // sendToUserByRole: die Sammel-Anwesenheit laeuft ueber ALLE
            // Teilnehmenden eines Termins — darunter Teamer:innen, die in
            // user_teamer_<id> sitzen und hart adressiert nichts mitbekamen.
            liveUpdate.sendToUserByRole(userId, 'dashboard', 'update', { points: event.points });
          }
          liveUpdate.sendToUserByRole(userId, 'events', 'update', { eventId });
        }
        if (marked.length > 0) {
          liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'attendance' });
        }
      }, 'PUT /events/:eventId/participants/attendance-all');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database error in PUT /events/:eventId/participants/attendance-all:', eventId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    } finally {
      client.release();
    }
  });


  // Update participant attendance and award event points
  router.put('/:id/participants/:participantId/attendance', rbacVerifier, requireTeamer, async (req, res) => {
    const { id: eventId, participantId } = req.params;
    const { attendance_status } = req.body;

    if (!['present', 'absent'].includes(attendance_status)) {
      return res.status(400).json({ error: 'Ungültiger Anwesenheitsstatus' });
    }

    // Dedizierter Client für Transaction - pool.query() kann verschiedene
    // Connections nutzen, was BEGIN/COMMIT auf unterschiedliche Connections verteilt!
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Teilnehmer-Typ über roles.name (event_bookings.user_type wird beim Insert
      // NICHT gesetzt und ist unzuverlaessig).
      const eventDataQuery = `
        SELECT e.name, e.points, e.point_type, e.mandatory, eb.user_id, r.name AS participant_role
        FROM events e
        JOIN event_bookings eb ON e.id = eb.event_id
        JOIN users u ON eb.user_id = u.id
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE e.id = $1 AND eb.id = $2 AND e.organization_id = $3
      `;
      const { rows: [eventData] } = await client.query(eventDataQuery, [eventId, participantId, req.user.organization_id]);
      if (!eventData) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Event oder Teilnehmer nicht gefunden, oder Zugriff verweigert' });
      }

      // Punkte gibt es NUR für Konfis. Teamer:innen nehmen zwar teil (Anwesenheit
      // wird gesetzt), bekommen aber keine Punkte -> Punkte-Logik (inkl.
      // checkPointTypeEnabled, das ein konfi_profile voraussetzt) ueberspringen.
      const isKonfiParticipant = eventData.participant_role === 'konfi';

      await client.query("UPDATE event_bookings SET attendance_status = $1 WHERE id = $2", [attendance_status, participantId]);

      let responseData = { message: 'Anwesenheit aktualisiert', points_awarded: false, points_removed: false };
      let pointsAwarded = false;
      let pointsRemoved = false;
      let removedPointsAmount = 0;

      if (isKonfiParticipant && attendance_status === 'present' && eventData.points > 0 && !eventData.mandatory) {
        const pointType = eventData.point_type || 'gemeinde';
        const { enabled: ptEnabled, error: ptError } = await checkPointTypeEnabled(client, eventData.user_id, pointType);
        if (!ptEnabled) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({ error: ptError });
        }

        const description = `Event-Teilnahme: ${eventData.name}`;
        const awardPointsQuery = `
          INSERT INTO event_points (konfi_id, event_id, points, point_type, description, awarded_date, admin_id, organization_id)
          VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
          ON CONFLICT (konfi_id, event_id) DO NOTHING
        `;
        const { rowCount } = await client.query(awardPointsQuery, [
          eventData.user_id, eventId, eventData.points, pointType, description,
          req.user.id, req.user.organization_id
        ]);

        if (rowCount > 0) {
          const updateProfileQuery = pointType === 'gottesdienst'
          ? "UPDATE konfi_profiles SET gottesdienst_points = gottesdienst_points + $1 WHERE user_id = $2"
          : "UPDATE konfi_profiles SET gemeinde_points = gemeinde_points + $1 WHERE user_id = $2";
          await client.query(updateProfileQuery, [eventData.points, eventData.user_id]);

          try {
            await checkAndAwardBadges(client, eventData.user_id);
          } catch (badgeErr) {
            console.error('Error checking badges after event attendance:', badgeErr);
          }

          pointsAwarded = true;
          responseData = { message: `Anwesenheit aktualisiert und ${eventData.points} ${pointType}-Punkte vergeben`, points_awarded: true };
        } else {
          responseData = { message: 'Anwesenheit aktualisiert (Punkte bereits vergeben)', points_awarded: false };
        }

      } else if (isKonfiParticipant && attendance_status === 'absent') {
        const { rows: [existingPoints] } = await client.query("SELECT id, points, point_type FROM event_points WHERE konfi_id = $1 AND event_id = $2", [eventData.user_id, eventId]);

        if (existingPoints) {
          await client.query("DELETE FROM event_points WHERE id = $1", [existingPoints.id]);
          const updateProfileQuery = existingPoints.point_type === 'gottesdienst'
          ? "UPDATE konfi_profiles SET gottesdienst_points = GREATEST(0, gottesdienst_points - $1) WHERE user_id = $2"
          : "UPDATE konfi_profiles SET gemeinde_points = GREATEST(0, gemeinde_points - $1) WHERE user_id = $2";
          await client.query(updateProfileQuery, [existingPoints.points, eventData.user_id]);
          pointsRemoved = true;
          removedPointsAmount = existingPoints.points;
          responseData = { message: `Anwesenheit aktualisiert und ${existingPoints.points} Punkte entfernt`, points_removed: true };
        }
      }

      await client.query('COMMIT');
      client.release();

      // Badge-Check NACH COMMIT für alle User (Teamer + Konfis)
      if (attendance_status === 'present') {
        try {
          await checkAndAwardBadges(db, eventData.user_id);
        } catch (badgeErr) {
          console.error('Error checking badges after attendance update:', badgeErr);
        }
      }

      // Push und LiveUpdate NACH COMMIT und client.release() - nutzt pool (db) statt client.
      // Konfi-spezifische Pushes/Dashboard-Updates nur für Konfis; das Admin-
      // LiveUpdate (Liste/Badge) feuert immer.
      try {
        if (attendance_status === 'present') {
          if (isKonfiParticipant && pointsAwarded) {
            try { await PushService.checkAndSendLevelUp(db, eventData.user_id, req.user.organization_id); } catch (e) { console.error('Level-up check failed:', e); }
            try { await PushService.sendEventAttendanceToKonfi(db, eventData.user_id, eventData.name, 'present', eventData.points, null, req.user.organization_id); } catch (e) { console.error('Push notification failed:', e); }
            liveUpdate.sendToUser('konfi', eventData.user_id, 'dashboard', 'update', { points: eventData.points });
          } else if (isKonfiParticipant) {
            try { await PushService.sendEventAttendanceToKonfi(db, eventData.user_id, eventData.name, 'present', 0, null, req.user.organization_id); } catch (e) { console.error('Push notification failed:', e); }
          }
          liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'attendance' });
        } else if (attendance_status === 'absent') {
          if (isKonfiParticipant) {
            try { await PushService.sendEventAttendanceToKonfi(db, eventData.user_id, eventData.name, 'absent', 0, null, req.user.organization_id); } catch (e) { console.error('Push notification failed:', e); }
            if (pointsRemoved) {
              liveUpdate.sendToUser('konfi', eventData.user_id, 'dashboard', 'update', { points: -removedPointsAmount });
            }
          }
          liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'attendance' });
        }
      } catch (notifyErr) {
        console.error('Post-commit notification error:', notifyErr);
      }

      res.json(responseData);

    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
      console.error('Database error in PUT /events/:eventId/participants/:participantId/attendance:', eventId, participantId, err);
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
      const eventDateFormatted = new Date(event.event_date).toLocaleDateString('de-DE');
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