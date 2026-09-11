const express = require('express');
const PushService = require('../../services/pushService');
const liveUpdate = require('../../utils/liveUpdate');
const { bucheTermin, zaehleBestaetigte, promoteFromWaitlist } = require('../../utils/bookingUtils');
const { removeFromEventChat, addToEventChat } = require('../../utils/eventChat');
const { nachAntwort } = require('../../utils/nachAntwort');

module.exports = (db, rbacVerifier) => {
  const router = express.Router();

  // Selbst-Anmeldung zu einem Termin.
  //
  // Was hier bleibt, ist die HUELLE dieser Route und nur sie: Statuscode 201,
  // die Felder {id, message, status}, die Live-Updates und die beiden Pushes
  // an die Leitung bzw. an die Teamer:in selbst. Daran darf sich nichts
  // aendern — ausgelieferte Apps lesen genau diese Form.
  router.post('/:id/book', rbacVerifier, async (req, res) => {
    const eventId = req.params.id;
    const userId = req.user.id;
    const { timeslot_id } = req.body;

    const isKonfi = req.user.type === 'konfi';
    const isTeamer = req.user.type === 'teamer';
    if (!isKonfi && !isTeamer) {
      return res.status(403).json({ error: 'Nur Konfis und das Team können Events buchen' });
    }

    const client = await db.getClient();
    let ergebnis;
    try {
      await client.query('BEGIN');
      ergebnis = await bucheTermin(client, {
        eventId,
        userId,
        orgId: req.user.organization_id,
        rolle: isTeamer ? 'teamer' : 'konfi',
        timeslotId: timeslot_id
      });

      if (!ergebnis.ok) {
        await client.query('ROLLBACK');
        client.release();
        const antwort = { error: ergebnis.error };
        if (ergebnis.error_code) antwort.error_code = ergebnis.error_code;
        return res.status(ergebnis.status).json(antwort);
      }

      await client.query('COMMIT');
      client.release();
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
      console.error('Database error in POST /events/:eventId/book:', eventId, err);
      return res.status(500).json({ error: 'Datenbankfehler bei der Anmeldung' });
    }

    const { bookingId, status, event } = ergebnis;
    const message = status === 'confirmed' ? 'Erfolgreich angemeldet' : 'Auf die Warteliste gesetzt';
    res.status(201).json({ id: bookingId, message, status });

    if (isTeamer) {
      liveUpdate.sendToUser('teamer', userId, 'events', 'update', { eventId, status });
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'teamer_booking' });

      try {
        await PushService.sendTeamerEventBookingToAdmins(
          db, req.user.organization_id, req.user.display_name, event.name, status, eventId
        );
      } catch (pushErr) {
        console.error('Push notification failed for teamer booking:', pushErr);
      }

      // Bestaetigung an die Teamer:in selbst (analog Konfi-Anmeldung)
      try {
        await PushService.sendEventRegisteredToTeamer(db, userId, event.name, event.event_date, status, eventId, req.user.organization_id);
      } catch (pushErr) {
        console.error('Push notification failed for teamer booking confirmation:', pushErr);
      }
      return;
    }

    // Live Update: Notify the konfi and admins about the booking
    liveUpdate.sendToUser('konfi', userId, 'events', 'update', { eventId, status });
    liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'booking' });
  });
  
  // Cancel booking
  router.delete('/:id/book', rbacVerifier, async (req, res) => {
    const eventId = req.params.id;
    const userId = req.user.id;

    const isKonfi = req.user.type === 'konfi';
    const isTeamer = req.user.type === 'teamer';
    if (!isKonfi && !isTeamer) {
      return res.status(403).json({ error: 'Nur Konfis und das Team können Buchungen stornieren' });
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
          // Keine Buchung (mehr) — zwei sehr verschiedene Faelle:
          //
          // a) Der Termin gehoert gar nicht zu dieser Gemeinde oder existiert
          //    nicht. Das bleibt ein 404.
          //
          // b) Der Termin existiert, die Buchung ist bereits weg. Dann ist das
          //    Ziel erreicht. Genau so kommt eine offline abgegebene Abmeldung
          //    zurueck, wenn die Anfrage ankam, aber die Antwort auf dem
          //    Rueckweg verloren ging und die Warteschlange sie erneut vorlegt.
          //    Vorher meldete dieser Fall 404 — ein erfolgreicher Vorgang
          //    wurde als Fehler angezeigt und im Fehl-Merker abgelegt.
          const { rows: [terminDa] } = await client.query(
            'SELECT 1 FROM events WHERE id = $1 AND organization_id = $2',
            [eventId, req.user.organization_id]
          );
          await client.query('ROLLBACK');
          // KEIN client.release() hier — das finally unten released (sonst Doppel-Release)
          if (terminDa) {
            return res.json({ message: 'Buchung storniert', bereits_storniert: true });
          }
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

          // Zaehlung ueber zaehleBestaetigte: Konfi-Seite heisst ausschliesslich
          // Konfis, geloeschte Konten zaehlen nie mit (Migration 136). Vorher
          // stand hier ein eigenes LEFT-JOIN-Konstrukt ohne deleted_at-Filter —
          // ein geloeschtes Konto blockierte damit den Nachrueckplatz.
          let maxCapacity, confirmedCount;
          if (booking.timeslot_id) {
            const { rows: [slotInfo] } = await client.query(
              "SELECT max_participants FROM event_timeslots WHERE id = $1 AND organization_id = $2",
              [booking.timeslot_id, req.user.organization_id]
            );
            maxCapacity = slotInfo?.max_participants || 0;
            confirmedCount = await zaehleBestaetigte(client, { timeslotId: booking.timeslot_id }, 'konfi');
          } else {
            maxCapacity = eventCapInfo?.max_participants || 0;
            confirmedCount = await zaehleBestaetigte(client, { eventId }, 'konfi');
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
          const teamerMaxCapacity = teamerCapInfo?.teamer_max_participants || 0;
          const teamerConfirmedCount = await zaehleBestaetigte(client, { eventId }, 'team');

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

  // Get user's bookings
  router.get('/user/bookings', rbacVerifier, async (req, res) => {
    try {
      if (req.user.type !== 'konfi' && req.user.type !== 'teamer') {
        return res.status(403).json({ error: 'Nur Konfis und das Team können ihre Buchungen einsehen' });
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

  return router;
};
