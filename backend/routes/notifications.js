const express = require('express');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');

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

  // Leichtgewichtige Badge-Zähler für die Tab-Leiste.
  // Ersetzt im BadgeContext die frueheren Voll-Fetches von /chat/rooms +
  // /admin/activities/requests + /events, die nur für Zähler geladen wurden.
  // WICHTIG für Konsistenz mit den Listen-Ansichten:
  // - chat.byRoom repliziert EXAKT die unread_count-Semantik der
  //   GET /chat/rooms-Query (inkl. Mitzaehlen eigener Nachrichten) — die Werte
  //   speisen chatUnreadByRoom, das ChatRoom/ChatOverview konsumieren.
  //   BEWUSST OHNE Mitgliedschafts-Sync (der läuft TTL-gesteuert in /rooms).
  // - pendingRequests entspricht dem pending-Filter der Admin-Antragsliste
  //   (GET /admin/activities/requests ist org-weit über activities.organization_id).
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
                 -- Eigene Nachrichten zählen nicht als ungelesen. Ohne diese
                 -- Zeile stand nach der eigenen letzten Nachricht eine Eins am
                 -- Reiter, die erst beim Oeffnen des Raums verschwand — und wer
                 -- ihn nicht mehr oeffnete, sah sie dauerhaft. Die Zählung im
                 -- Hintergrunddienst schließt sie seit jeher aus
                 -- (backgroundService.js), diese hier nicht.
                 AND NOT (m.user_id = $1 AND m.user_type = $2)
               ) AS unread_count
        FROM chat_rooms r
        INNER JOIN chat_participants p ON r.id = p.room_id AND p.user_id = $1 AND p.user_type = $2
        LEFT JOIN chat_read_status crs ON r.id = crs.room_id AND crs.user_id = $1 AND crs.user_type = $2
        WHERE r.organization_id = $3
      `;

      // Pending-Zähler nur für Admin-Typen (Konfis/Teamer nutzen sie im
      // Frontend nicht — BadgeContext zeigt sie nur für isAdmin).
      const isAdminType = userType === 'admin';
      const zero = Promise.resolve({ rows: [{ c: 0 }] });

      // Offene Challenge-Freigaben: Admin org-weit; Teamer nur für Challenges
      // ihrer zugewiesenen Jahrgänge (gleiche Grenze wie viewableJahrgangIds
      // in routes/challenges.js — der Teamer soll nicht auf Freigaben gestupst
      // werden, deren Challenge er gar nicht oeffnen darf).
      const teamerJahrgangIds = userType === 'teamer'
        ? (req.user.assigned_jahrgaenge || []).filter(j => j.can_view).map(j => j.id)
        : [];
      let challengesPromise = zero;
      if (isAdminType) {
        challengesPromise = db.query(
          `SELECT COUNT(*)::int AS c
           FROM challenge_submissions cs
           JOIN challenges c ON cs.challenge_id = c.id
           WHERE c.organization_id = $1 AND cs.moderation_status = 'pending'`,
          [organizationId]
        );
      } else if (userType === 'teamer') {
        // 'nur_team'-Challenges laufen org-weit ueber die Rolle (Migration 121):
        // Jede:r Teamer:in der Organisation darf sie sehen und moderieren, auch
        // ohne Jahrgangs-Zuordnung -- die es dort per Definition nicht gibt.
        // Dieselbe Ausnahme steht in challenges.js (leadershipMayAccess und die
        // Listen-Abfrage).
        challengesPromise = db.query(
          `SELECT COUNT(*)::int AS c
           FROM challenge_submissions cs
           JOIN challenges c ON cs.challenge_id = c.id
           WHERE c.organization_id = $1
             AND cs.moderation_status = 'pending'
             AND (
               c.audience = 'nur_team'
               OR EXISTS (
                 SELECT 1 FROM challenge_jahrgang_assignments cja
                 WHERE cja.challenge_id = c.id AND cja.jahrgang_id = ANY($2::int[])
               )
             )`,
          [organizationId, teamerJahrgangIds]
        );
      }

      // Die Fortschrittsberechnung braucht es dafuer NICHT: user_badges.seen
      // gilt fuer beide Rollen, custom_badges.target_role trennt sie. Eine
      // COUNT-Abfrage genuegt.
      // Die Leitung kann keine Abzeichen verdienen -> immer 0.
      const badgesPromise = (userType === 'konfi' || userType === 'teamer')
        ? db.query(
            `SELECT COUNT(*)::int AS c
             FROM user_badges ub
             JOIN custom_badges cb ON ub.badge_id = cb.id
             WHERE ub.user_id = $1
               AND ub.organization_id = $2
               AND ub.seen = false
               AND COALESCE(cb.target_role, 'konfi') = $3`,
            [userId, organizationId, userType]
          )
        : zero;

      const [chatRes, requestsRes, eventsRes, challengesRes, badgesRes] = await Promise.all([
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
          : zero,
        challengesPromise,
        badgesPromise
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
        pendingEvents: eventsRes.rows[0]?.c || 0,
        pendingChallenges: challengesRes.rows[0]?.c || 0,
        newBadges: badgesRes.rows[0]?.c || 0
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
