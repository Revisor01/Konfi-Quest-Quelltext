const express = require('express');
const PushService = require('../../services/pushService');
const liveUpdate = require('../../utils/liveUpdate');
const { checkPointTypeEnabled } = require('../../utils/pointTypeGuard');
const { nachAntwort } = require('../../utils/nachAntwort');

module.exports = (db, rbacVerifier, { requireTeamer }, checkAndAwardBadges) => {
  const router = express.Router();

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

  return router;
};
