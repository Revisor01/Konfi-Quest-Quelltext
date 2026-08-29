const express = require('express');
const jwt = require('jsonwebtoken');
const PushService = require('../../services/pushService');
const liveUpdate = require('../../utils/liveUpdate');
const { checkPointTypeEnabled } = require('../../utils/pointTypeGuard');

const QR_SECRET = process.env.QR_SECRET;
if (!QR_SECRET) {
  console.error('FATAL: QR_SECRET Umgebungsvariable fehlt!');
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
}

module.exports = (db, rbacVerifier, { requireTeamer }, checkAndAwardBadges) => {
  const router = express.Router();

  // ====================================================================
  // QR-CODE CHECK-IN ENDPOINTS
  // WICHTIG: Diese müssen VOR den parametrisierten /:id Routes stehen,
  // damit Express "qr-checkin" nicht als :id Parameter interpretiert.
  // Seit der Aufteilung sichert das index.js: checkin.js wird dort als
  // erstes Teilmodul eingehängt.
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

  return router;
};
