const express = require('express');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { sendFirebasePushNotification } = require('../push/firebase');

module.exports = (db, verifyTokenRBAC) => {
  const router = express.Router();

  // Validierungsregeln
  const validateDeviceToken = [
    body('token').notEmpty().withMessage('Push-Token ist erforderlich'),
    body('platform').isIn(['ios', 'android', 'web']).withMessage('Ungültige Plattform'),
    handleValidationErrors
  ];

  const validateDeleteToken = [
    body('device_id').notEmpty().withMessage('Geräte-ID ist erforderlich'),
    body('platform').notEmpty().withMessage('Plattform ist erforderlich'),
    handleValidationErrors
  ];

  // Leichtgewichtige Badge-Zaehler fuer die Tab-Leiste.
  // Ersetzt im BadgeContext die frueheren Voll-Fetches von /chat/rooms +
  // /admin/activities/requests + /events, die nur fuer Zaehler geladen wurden.
  // WICHTIG fuer Konsistenz mit den Listen-Ansichten:
  // - chat.byRoom repliziert EXAKT die unread_count-Semantik der
  //   GET /chat/rooms-Query (inkl. Mitzaehlen eigener Nachrichten) — die Werte
  //   speisen chatUnreadByRoom, das ChatRoom/ChatOverview konsumieren.
  //   BEWUSST OHNE Mitgliedschafts-Sync (der laeuft TTL-gesteuert in /rooms).
  // - pendingRequests entspricht dem pending-Filter der Admin-Antragsliste
  //   (GET /admin/activities/requests ist org-weit ueber activities.organization_id).
  // - pendingEvents entspricht der Frontend-Logik "unprocessed_count > 0 UND
  //   event_date < jetzt" (unprocessed = bestaetigte Buchung ohne attendance_status).
  router.get('/badge-counts', verifyTokenRBAC, async (req, res) => {
    try {
      const userId = req.user.id;
      const userType = req.user.type;
      const organizationId = req.user.organization_id;

      const chatQuery = `
        SELECT r.id AS room_id,
               (
                 SELECT COUNT(*)
                 FROM chat_messages m
                 WHERE m.room_id = r.id
                 AND m.deleted_at IS NULL
                 AND m.created_at > COALESCE(crs.last_read_at, '1970-01-01')
               ) AS unread_count
        FROM chat_rooms r
        INNER JOIN chat_participants p ON r.id = p.room_id AND p.user_id = $1 AND p.user_type = $2
        LEFT JOIN chat_read_status crs ON r.id = crs.room_id AND crs.user_id = $1 AND crs.user_type = $2
        WHERE r.organization_id = $3
      `;

      // Pending-Zaehler nur fuer Admin-Typen (Konfis/Teamer nutzen sie im
      // Frontend nicht — BadgeContext zeigt sie nur fuer isAdmin).
      const isAdminType = userType === 'admin';
      const zero = Promise.resolve({ rows: [{ c: 0 }] });

      const [chatRes, requestsRes, eventsRes] = await Promise.all([
        db.query(chatQuery, [userId, userType, organizationId]),
        isAdminType
          ? db.query(
              `SELECT COUNT(*)::int AS c
               FROM activity_requests ar
               JOIN activities a ON ar.activity_id = a.id
               WHERE a.organization_id = $1 AND ar.status = 'pending'`,
              [organizationId]
            )
          : zero,
        isAdminType
          ? db.query(
              `SELECT COUNT(*)::int AS c
               FROM events e
               WHERE e.organization_id = $1
               AND e.event_date < NOW()
               AND EXISTS (
                 SELECT 1 FROM event_bookings eb
                 WHERE eb.event_id = e.id
                 AND eb.status = 'confirmed'
                 AND eb.attendance_status IS NULL
               )`,
              [organizationId]
            )
          : zero
      ]);

      const byRoom = {};
      let total = 0;
      chatRes.rows.forEach((r) => {
        const unread = parseInt(r.unread_count, 10) || 0;
        byRoom[r.room_id] = unread;
        total += unread;
      });

      res.json({
        chat: { total, byRoom },
        pendingRequests: requestsRes.rows[0]?.c || 0,
        pendingEvents: eventsRes.rows[0]?.c || 0
      });
    } catch (err) {
      console.error('Database error in GET /notifications/badge-counts:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Liefert den globalen Push-Master-Schalter des eingeloggten Users
  router.get('/preferences', verifyTokenRBAC, async (req, res) => {
    try {
      const { rows: [row] } = await db.query(
        'SELECT push_enabled FROM users WHERE id = $1',
        [req.user.id]
      );
      res.json({ push_enabled: row ? row.push_enabled : true });
    } catch (err) {
      console.error('Database error in GET /preferences:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Setzt den globalen Push-Master-Schalter des eingeloggten Users
  router.put('/preferences', verifyTokenRBAC, [
    body('push_enabled').isBoolean().withMessage('push_enabled muss true oder false sein'),
    handleValidationErrors
  ], async (req, res) => {
    const { push_enabled } = req.body;
    try {
      await db.query(
        'UPDATE users SET push_enabled = $1 WHERE id = $2',
        [push_enabled, req.user.id]
      );
      res.json({ success: true, push_enabled });
    } catch (err) {
      console.error('Database error in PUT /preferences:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Speichert oder aktualisiert einen Geräte-Token für Push-Benachrichtigungen
  router.post('/device-token', verifyTokenRBAC, validateDeviceToken, async (req, res) => {
    const { token, platform, device_id } = req.body;
    const userId = req.user.id;
    const userType = req.user.type;

    if (!token || !platform) {
      return res.status(400).json({ error: 'Token und Plattform erforderlich' });
    }

    try {
      // Device ID generieren falls nicht vorhanden
      const finalDeviceId = device_id || `${platform}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Ein FCM-Token darf nur GENAU EINMAL existieren: weder bei einem anderen
      // User (Account-Wechsel) noch beim selben User unter anderer device_id
      // (z.B. neue identifierForVendor nach App-Neuinstallation) — sonst wird
      // derselbe Push mehrfach an dasselbe Geraet gesendet.
      await db.query(
        `DELETE FROM push_tokens
         WHERE token = $1
           AND NOT (user_id = $2 AND platform = $3 AND device_id = $4)`,
        [token, userId, platform, finalDeviceId]
      );

      // Upsert: Token speichern oder aktualisieren
      await db.query(`
        INSERT INTO push_tokens (user_id, user_type, token, platform, device_id, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (user_id, platform, device_id)
        DO UPDATE SET
          token = EXCLUDED.token,
          user_type = EXCLUDED.user_type,
          updated_at = NOW()`,
        [userId, userType, token, platform, finalDeviceId]
      );


      res.json({ success: true, message: 'Token erfolgreich gespeichert' });

    } catch (err) {
      console.error('Database error in POST /device-token:', err);
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Token für diesen Benutzer und dieses Gerät existiert bereits.' });
      }
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Sendet eine Test-Push-Benachrichtigung an alle Geräte eines Benutzers
  router.post('/test-push', verifyTokenRBAC, async (req, res) => {
    const userId = req.user.id;
    const { message = 'Test Push Notification' } = req.body;

    try {
      // Org-gefiltert: Nur Tokens des eigenen Users innerhalb der eigenen Organisation
      const { rows: tokens } = await db.query(
        `SELECT pt.* FROM push_tokens pt
         JOIN users u ON pt.user_id = u.id
         WHERE pt.user_id = $1 AND u.organization_id = $2`,
        [userId, req.user.organization_id]
      );

      if (!tokens || tokens.length === 0) {
        return res.json({ success: false, message: 'Keine Push-Tokens gefunden' });
      }

      let sentCount = 0;
      let errorCount = 0;

      for (const tokenRow of tokens) {
        try {
          await sendFirebasePushNotification(tokenRow.token, {
            title: 'Test Push',
            body: message,
            badge: 1,
            sound: 'default'
          });
          sentCount++;
        } catch (error) {
          console.error('Error sending to token:', error.message);
          errorCount++;
        }
      }

      res.json({
        success: true,
        sent: sentCount,
        errors: errorCount,
        total: tokens.length,
        message: `Test-Push an ${sentCount} Gerät(e) gesendet`
      });

    } catch (err) {
      console.error('Database error in POST /test-push:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Entfernt einen Geräte-Token beim Logout
  router.delete('/device-token', verifyTokenRBAC, validateDeleteToken, async (req, res) => {
    const { device_id, platform } = req.body;
    const userId = req.user.id;

    if (!device_id || !platform) {
      return res.status(400).json({ error: 'Geräte-ID und Plattform erforderlich' });
    }

    try {
      // Org-gefiltert: Nur eigene Tokens innerhalb der eigenen Organisation löschen
      const { rowCount } = await db.query(
        `DELETE FROM push_tokens pt
         USING users u
         WHERE pt.user_id = u.id
           AND pt.user_id = $1
           AND pt.platform = $2
           AND pt.device_id = $3
           AND u.organization_id = $4`,
        [userId, platform, device_id, req.user.organization_id]
      );

      res.json({
        success: true,
        message: 'Push-Token für dieses Gerät entfernt',
        changes: rowCount
      });

    } catch (err) {
      console.error('Database error in DELETE /device-token:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  return router;
};
