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
    // Im try steht NUR die Transaktion. Frueher Ausstieg und Nacharbeit
    // (Badges, Push, Live-Update, Antwort) laufen hinter dem finally — sonst
    // rollt ein Fehler aus der Nacharbeit eine Verbindung zurueck, die
    // inzwischen ein anderer Request aus dem Pool hat.
    let fruehAntwort = null;
    let event = null;
    let pointsAwarded = false;
    try {
      await client.query('BEGIN');

      // Event laden und qr_token abgleichen
      const { rows: [gefunden] } = await client.query(
        `SELECT id, name, event_date, checkin_window, mandatory, points, point_type, qr_token, organization_id
         FROM events WHERE id = $1 AND qr_token = $2`,
        [eventId, token]
      );
      event = gefunden;

      if (!event) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 400, body: { error: 'Ungültiger QR-Code', error_type: 'invalid_token' } };
      } else if (event.organization_id !== req.user.organization_id) {
        // Organization-Check
        await client.query('ROLLBACK');
        fruehAntwort = { status: 403, body: { error: 'Kein Zugriff auf dieses Event', error_type: 'wrong_organization' } };
      } else {

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
        fruehAntwort = { status: 400, body: {
          error: 'Check-in ist noch nicht möglich',
          error_type: 'too_early',
          event_date: event.event_date,
          checkin_window: event.checkin_window
        } };
      } else if (timeCheck.too_late) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 400, body: {
          error: 'Der Check-in-Zeitraum ist abgelaufen',
          error_type: 'too_late'
        } };
      } else {

      // Booking prüfen
      const { rows: [booking] } = await client.query(
        `SELECT id, status, attendance_status FROM event_bookings WHERE event_id = $1 AND user_id = $2`,
        [eventId, userId]
      );

      if (!booking) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 400, body: { error: 'Du bist nicht für dieses Event angemeldet', error_type: 'not_registered' } };
      } else if (booking.status === 'opted_out') {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 400, body: { error: 'Du hast dich von diesem Event abgemeldet', error_type: 'opted_out' } };
      } else if (booking.status === 'excused') {
        // DARF EINE ABGEMELDETE PERSON EINCHECKEN? NEIN -- und zwar aus
        // demselben Grund, aus dem eine Selbstabmeldung es nicht darf: Der
        // Check-in ist kein Anmeldeweg, sondern die Bestaetigung einer
        // bestehenden Anmeldung. Es gibt hier keine mehr. Waere es erlaubt,
        // koennte eine krank gemeldete Konfi sich per QR-Code selbst wieder
        // eintragen und sich Punkte gutschreiben -- die Abmeldung der
        // Leitung liesse sich also von der abgemeldeten Person aufheben.
        //
        // Der Rueckweg bleibt offen, nur nicht hier: Die Leitung setzt die
        // Person ueber die Teilnehmerliste auf 'present' (anwesenheit.js),
        // und das holt den Buchungsstatus auf 'confirmed' zurueck. Wer
        // abgemeldet ist und doch kommt, meldet sich also bei der Leitung --
        // was in dem Moment ohnehin passiert.
        //
        // EIGENER ZWEIG STATT DES not_confirmed-SAMMELFALLS darunter: Dessen
        // Text ("Deine Anmeldung ist nicht bestaetigt") beschreibt die
        // Warteliste und waere hier schlicht falsch. Ein eigener error_type
        // laesst die App ausserdem das Richtige sagen. ADDITIV: Ein neuer
        // error_type ist ein neuer WERT, kein neues Feld -- ausgelieferte
        // Fassungen zeigen den error-Text, den sie mitbekommen.
        await client.query('ROLLBACK');
        fruehAntwort = { status: 400, body: {
          error: 'Du wurdest von diesem Termin abgemeldet. Melde dich bei der Leitung, wenn du doch da bist.',
          error_type: 'excused'
        } };
      } else if (booking.status !== 'confirmed') {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 400, body: { error: 'Deine Anmeldung ist nicht bestätigt', error_type: 'not_confirmed' } };
      } else if (booking.attendance_status === 'present') {
        // Duplikat-Check
        await client.query('ROLLBACK');
        fruehAntwort = { status: 200, body: {
          message: 'Du bist bereits eingecheckt',
          already_checked_in: true,
          event_name: event.name,
          event_id: event.id
        } };
      } else {

      // Attendance setzen
      //
      // DIE QUELLE WIRD SEIT MIGRATION 151 GETRENNT FESTGEHALTEN
      // checkin_quelle = 'qr' und checked_in_at sagen, WOHER
      // die Anwesenheit kam, ohne eine Person zu benennen. Vorher stand der
      // Selbst-Check-in im selben NULL wie der Altbestand von vor Migration
      // 148 -- beides "unbekannt", obwohl hier sehr wohl etwas bekannt ist.
      // Die Anzeige macht daraus "Checkin via QR-Code am 15.09." statt gar
      // keiner Zeile. attendance_set_by/_at bleiben davon unberuehrt.
      await client.query(
        "UPDATE event_bookings SET attendance_status = 'present', checkin_quelle = 'qr', checked_in_at = NOW() WHERE id = $1",
        [booking.id]
      );

      // Punkte-Vergabe (nur für Konfis, Teamer erhalten keine Punkte)
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
      } // Duplikat-Check
      } // Zeitfenster
      } // Event gefunden + richtige Organisation
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database error in POST /events/qr-checkin:', txErr);
      return res.status(500).json({ error: 'Datenbankfehler' });
    } finally {
      // KEIN client.release() im try — nur hier.
      client.release();
    }

    if (fruehAntwort) {
      return res.status(fruehAntwort.status).json(fruehAntwort.body);
    }

    try {
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

    } catch (nachErr) {
      // Der Check-in ist festgeschrieben — ein Fehler in der Nacharbeit darf
      // die Antwort nicht mehr kippen.
      console.error('Post-commit error in POST /events/qr-checkin:', nachErr);
    }

    res.json({
      message: 'Erfolgreich eingecheckt',
      event_name: event.name,
      event_id: event.id,
      points_awarded: pointsAwarded
    });
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
      // "X von Y eingecheckt" waehrend des Check-ins. `total` sind die
      // ERWARTETEN -- deshalb weiterhin nur status = 'confirmed'.
      //
      // Seit Migration 153 faellt eine von der Leitung
      // abgemeldete Person hier automatisch heraus, weil sie auf
      // status = 'excused' steht. Das ist richtig und der Grund, warum diese
      // Abfrage NICHT angefasst wird: Wer abgemeldet ist, wird nicht erwartet
      // und darf die Zahl nicht kuenstlich erhoehen -- sonst stuende am Ende
      // eines vollstaendig verlaufenen Termins "18 von 20", obwohl alle da
      // waren, die kommen sollten.
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
