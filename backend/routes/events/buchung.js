const express = require('express');
const PushService = require('../../services/pushService');
const liveUpdate = require('../../utils/liveUpdate');
const { checkExistingBooking, validateRegistrationWindow, determineBookingStatus, promoteFromWaitlist } = require('../../utils/bookingUtils');
const { removeFromEventChat, addToEventChat } = require('../../utils/eventChat');
const { nachAntwort } = require('../../utils/nachAntwort');

module.exports = (db, rbacVerifier) => {
  const router = express.Router();

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

  return router;
};
