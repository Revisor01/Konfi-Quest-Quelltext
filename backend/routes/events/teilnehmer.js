const express = require('express');
const { formatUhrzeit } = require('../../utils/zeitformat');
const PushService = require('../../services/pushService');
const liveUpdate = require('../../utils/liveUpdate');
const { promoteFromWaitlist, takeBackEventPoints } = require('../../utils/bookingUtils');
const { removeFromEventChat, addToEventChat } = require('../../utils/eventChat');
const { nachAntwort } = require('../../utils/nachAntwort');

module.exports = (db, rbacVerifier, { requireTeamer }) => {
  const router = express.Router();

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
        const addedIsKonfi = addedUser?.role_name === 'konfi';
        const addedIsTeamer = !addedIsKonfi;

        if (addedIsTeamer && !event.teamer_needed && !event.teamer_only) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({ error: 'Dieses Event ist nicht für das Team vorgesehen' });
        }
        if (!addedIsTeamer && event.teamer_only) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({ error: 'Dieses Event ist nur für das Team' });
        }

        // Teamer buchen nie in Timeslots (wie im Selbst-Buchungs-Pfad).
        const isTimeslotBooking = !!timeslot && !addedIsTeamer;
        // Das Team-Kontingent zaehlt alle Nicht-Konfis (Teamer:innen wie
        // zugeordnete Admins), das Konfi-Kontingent nur Konfis.
        const roleFilterSql = addedIsTeamer
          ? "AND r.name <> 'konfi'"
          : "AND r.name = 'konfi'";
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
      ? `Teilnehmer:in zum Zeitslot ${formatUhrzeit(timeslot.start_time)} - ${formatUhrzeit(timeslot.end_time)} ${finalStatus === 'waitlist' ? 'auf Warteliste gesetzt' : 'hinzugefügt'}`
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
      // Transaktional ab hier.
      //
      // Sechs Schreibzugriffe ueber vier Tabellen liefen vorher einzeln ueber
      // den Pool: Punkte-Zeile loeschen, Saldo verringern, Buchung loeschen,
      // Chat-Austritt, Nachruecken, Chat-Eintritt des Nachrueckers. Riss
      // zwischen den ersten beiden hiess: Der Konfi behaelt Punkte ohne Beleg,
      // nicht mehr rekonstruierbar. Riss vor dem Nachruecken hiess: ein Platz
      // bleibt dauerhaft leer, obwohl Leute warten.
      //
      // FOR UPDATE OF eb dazu: Zwei Leitungen, die gleichzeitig denselben
      // Teilnehmer entfernen, zogen die Punkte sonst zweimal ab. Das zweite
      // DELETE war idempotent, der zweite Punktabzug nicht.
      const client = await db.getClient();
      let booking = null;
      let punkteZurueck = null;
      let promotedUserId = null;
      let promotedType = null;
      let promotedEventName = null;
      try {
        await client.query('BEGIN');

        // Get booking details to verify ownership and status (Event-Org wird mitgeprueft).
        // Die Rolle des ENTFERNTEN Users wird mitgelesen: sie entscheidet, aus welcher
        // Warteliste nachgerueckt wird (Konfi- und Teamer-Kontingent sind getrennt).
        const { rows: [gefunden] } = await client.query(`
          SELECT eb.*, u.organization_id, e.organization_id as event_org_id,
                 (r.name <> 'konfi') as is_teamer_booking
          FROM event_bookings eb
          JOIN users u ON eb.user_id = u.id
          JOIN roles r ON u.role_id = r.id
          JOIN events e ON eb.event_id = e.id
          WHERE eb.id = $1 AND eb.event_id = $2
          FOR UPDATE OF eb`, [bookingId, eventId]);
        booking = gefunden;

        if (!booking) {
          await client.query('ROLLBACK');
          // KEIN client.release() hier — das finally unten released.
          return res.status(404).json({ error: 'Buchung nicht gefunden' });
        }
        if (booking.organization_id !== req.user.organization_id || booking.event_org_id !== req.user.organization_id) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Zugriff verweigert' });
        }

        // Falls der Konfi als ANWESEND verbucht war, beim Löschen die vergebenen
        // Event-Punkte zuruecknehmen (sonst behält er Punkte für ein Event, an dem
        // er nicht mehr als Teilnehmer geführt wird). Nur für Konfis relevant.
        if (booking.attendance_status === 'present') {
          punkteZurueck = await takeBackEventPoints(client, booking.user_id, eventId);
        }

        // Delete the booking
        await client.query("DELETE FROM event_bookings WHERE id = $1", [bookingId]);

        // Wer von der Leitung ausgetragen wird, gehört auch nicht mehr in den
        // Event-Chat. Bisher tat das nur die Selbstabmeldung der Teamer
        // 
        await removeFromEventChat(client, eventId, booking.user_id, req.user.organization_id);

      // Auto-promote from waitlist if the deleted booking was confirmed.
      // Konfi- und Teamer-Kontingent sind strikt getrennt: ein frei gewordener
      // Konfi-Platz wird nur aus der Konfi-Warteliste nachbesetzt und umgekehrt.
      // promoteFromWaitlist filtert die Rolle und schließt geloeschte User aus.
        if (booking.status === 'confirmed') {
          const removedIsTeamer = booking.is_teamer_booking === true;
          // Kein eigener try/catch mehr um diesen Block: Ein geschluckter
          // Fehler wuerde jetzt in ein COMMIT laufen und einen halben Zustand
          // festschreiben. Scheitert das Nachruecken, rollt das Entfernen
          // zurueck und laesst sich wiederholen.
          let maxCapacity = 0;
          let confirmedCount = 0;

          if (removedIsTeamer) {
            // Teamer-Buchungen haben nie einen Timeslot -> event-weite Zählung.
            const { rows: [teamerCapInfo] } = await client.query(
              "SELECT teamer_max_participants FROM events WHERE id = $1 AND organization_id = $2",
              [eventId, req.user.organization_id]
            );
            const { rows: [teamerCountRes] } = await client.query(
              `SELECT COUNT(*) as confirmed_count
               FROM event_bookings eb
               JOIN users u ON eb.user_id = u.id
               JOIN roles r ON u.role_id = r.id
               WHERE eb.event_id = $1 AND eb.status = 'confirmed'
                 AND r.name <> 'konfi' AND u.deleted_at IS NULL`,
              [eventId]
            );
            maxCapacity = teamerCapInfo?.teamer_max_participants || 0;
            confirmedCount = parseInt(teamerCountRes?.confirmed_count || '0', 10);
          } else if (booking.timeslot_id) {
            const { rows: [slotInfo] } = await client.query(
              "SELECT max_participants FROM event_timeslots WHERE id = $1 AND organization_id = $2",
              [booking.timeslot_id, req.user.organization_id]
            );
            // Teamer:innen zählen NICHT gegen das Konfi-Kontingent (sie haben
            // ihr eigenes) — sonst blockiert eine bestaetigte Teamer-Buchung
            // den Nachrueckplatz eines Konfis.
            const { rows: [slotCountRes] } = await client.query(
              `SELECT COUNT(*) as confirmed_count
               FROM event_bookings eb
               LEFT JOIN users u ON eb.user_id = u.id
               LEFT JOIN roles r ON u.role_id = r.id AND r.name <> 'konfi'
               WHERE eb.timeslot_id = $1 AND eb.status = 'confirmed' AND r.id IS NULL`,
              [booking.timeslot_id]
            );
            maxCapacity = slotInfo?.max_participants || 0;
            confirmedCount = parseInt(slotCountRes?.confirmed_count || '0', 10);
          } else {
            const { rows: [eventCapInfo] } = await client.query(
              "SELECT max_participants FROM events WHERE id = $1 AND organization_id = $2",
              [eventId, req.user.organization_id]
            );
            const { rows: [countResult] } = await client.query(
              `SELECT COUNT(*) as confirmed_count
               FROM event_bookings eb
               LEFT JOIN users u ON eb.user_id = u.id
               LEFT JOIN roles r ON u.role_id = r.id AND r.name <> 'konfi'
               WHERE eb.event_id = $1 AND eb.status = 'confirmed' AND r.id IS NULL`,
              [eventId]
            );
            maxCapacity = eventCapInfo?.max_participants || 0;
            confirmedCount = parseInt(countResult?.confirmed_count || '0', 10);
          }

          // Nur nachruecken wenn unter Kapazität (0 = unbegrenzt, immer nachruecken).
          if (maxCapacity === 0 || confirmedCount < maxCapacity) {
            promotedUserId = await promoteFromWaitlist(
              client,
              eventId,
              removedIsTeamer ? null : booking.timeslot_id,
              removedIsTeamer ? 'teamer' : 'not_teamer'
            );

            if (promotedUserId) {
              const { rows: [eventInfo] } = await client.query(
                "SELECT name FROM events WHERE id = $1", [eventId]
              );
              promotedEventName = eventInfo?.name || null;
              promotedType = removedIsTeamer ? 'teamer' : 'konfi';
            }
          }
        }

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }

      res.json({ message: 'Teilnehmer erfolgreich entfernt' });

      // Ab hier ist alles festgeschrieben — Benachrichtigungen erst jetzt.
      if (punkteZurueck) {
        liveUpdate.sendToUser('konfi', booking.user_id, 'dashboard', 'update', { points: -punkteZurueck.points });
      }

      if (promotedUserId && promotedEventName) {
        try {
          if (promotedType === 'teamer') {
            await PushService.sendWaitlistPromotionToTeamer(db, promotedUserId, promotedEventName, null, eventId, req.user.organization_id);
          } else {
            await PushService.sendWaitlistPromotionToKonfi(db, promotedUserId, promotedEventName, null, eventId, req.user.organization_id);
          }
        } catch (pushErr) {
          console.error('Error sending waitlist promotion push:', pushErr);
        }
      }
      if (promotedUserId) {
        // Live Update: Notify promoted user about their status change
        liveUpdate.sendToUser(promotedType, promotedUserId, 'events', 'update', { eventId, action: 'promoted' });
      }

      // Live Update: Notify the removed user (rollenrichtiger Kanal) and admins
      liveUpdate.sendToUser(booking.is_teamer_booking ? 'teamer' : 'konfi', booking.user_id, 'events', 'update', { eventId, action: 'removed' });
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'booking_removed' });

    } catch (err) {
 console.error('Database error in DELETE /events/:eventId/bookings/:bookingId:', eventId, bookingId, err);
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
      
      
      // Transaktional ab hier.
      //
      // Der Weg auf die Warteliste nimmt die Event-Punkte zurueck: erst die
      // event_points-Zeile loeschen, dann den Saldo verringern. Riss dazwischen
      // hiess: Der Konfi behaelt Punkte, fuer die es keinen Beleg mehr gibt.
      //
      // Und anders als anderswo war dieser Zustand NICHT reparierbar. Der
      // Guard unten ("ist bereits auf der Warteliste") laesst einen zweiten
      // Versuch gar nicht erst zu — der Saldo blieb dauerhaft falsch und war
      // nur per Hand in der Datenbank zu korrigieren.
      //
      // FOR UPDATE OF eb dazu: Zwei Leitungen, die gleichzeitig denselben
      // Teilnehmer herabstufen, zogen die Punkte sonst zweimal ab.
      const client = await db.getClient();
      let punkteZurueck = null;
      let wasWaitlist = false;
      let betroffenerUser = null;
      let eventName = null;
      let eventDatum = null;
      try {
        await client.query('BEGIN');

        const { rows: [booking] } = await client.query("SELECT eb.status, eb.attendance_status, eb.user_id, e.organization_id, e.name AS event_name, e.event_date FROM event_bookings eb JOIN events e ON eb.event_id = e.id WHERE eb.id = $1 AND eb.event_id = $2 FOR UPDATE OF eb", [participantId, eventId]);
        if (!booking) {
          await client.query('ROLLBACK');
          // KEIN client.release() hier — das finally unten released.
          return res.status(404).json({ error: 'Buchung nicht gefunden' });
        }
        if (booking.organization_id !== req.user.organization_id) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Zugriff verweigert' });
        }
        if (booking.status === status) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Teilnehmer:in ist bereits ${status === 'confirmed' ? 'bestätigt' : 'auf der Warteliste'}` });
        }

        // Vorheriger Status: bei Wechsel von 'waitlist' -> 'confirmed' ist es eine
        // Wartelisten-Befoerderung (Push an die betroffene Person). Bei 'confirmed'
        // -> 'waitlist' werden ggf. Punkte entzogen (Dashboard-Refresh nötig).
        wasWaitlist = booking.status === 'waitlist';
        betroffenerUser = booking.user_id;
        eventName = booking.event_name;
        eventDatum = booking.event_date;

        if (status === 'waitlist') {
          // Auf Warteliste: attendance_status löschen und Event-Punkte zurücknehmen
          await client.query("UPDATE event_bookings SET status = 'waitlist', attendance_status = NULL WHERE id = $1", [participantId]);

          // Punkte-Ruecknahme ueber den gemeinsamen Helfer: Derselbe Block lag
          // vorher viermal im Code, zweimal transaktional und zweimal nicht.
          punkteZurueck = await takeBackEventPoints(client, booking.user_id, eventId);
        } else {
          await client.query("UPDATE event_bookings SET status = $1 WHERE id = $2", [status, participantId]);
        }

        // In den Chat zum Termin, falls es einen gibt. Auch bei der Rueckstufung
        // auf die Warteliste: angemeldet ist angemeldet, entfernt wird erst beim
        // Austragen (idempotent, meist schon drin).
        await addToEventChat(client, eventId, booking.user_id, req.user.organization_id);

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }

      const action = status === 'confirmed' ? 'Teilnehmer:in von Warteliste bestätigt' : 'Teilnehmer:in auf Warteliste gesetzt';
      res.json({ message: action, status });

      // Push bei Befoerderung von der Warteliste (analog events.js:1010/1513/1731).
      // Seiteneffekt NACH res — Push-Fehler darf nichts kippen.
      nachAntwort(req, async () => {
        if (status === 'confirmed' && wasWaitlist) {
          try {
            await PushService.sendWaitlistPromotionToKonfi(db, betroffenerUser, eventName, eventDatum, eventId, req.user.organization_id);
          } catch (pushErr) {
            console.error('Error sending waitlist promotion push:', pushErr);
          }
        }

        // Live-Update an die betroffene Person (korrekter Socket-Raum per Rolle).
        liveUpdate.sendToUserByRole(betroffenerUser, 'events', 'update', { eventId });
        // Bei Punktentzug (Degradierung) zusaetzlich das Dashboard aktualisieren.
        if (punkteZurueck) {
          liveUpdate.sendToUserByRole(betroffenerUser, 'dashboard', 'update');
        }
        // Live-Update an Admins/Org-Admins/Teamer:innen der Org.
        liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId });
      }, 'PUT /events/:eventId/participants/:participantId/status');

    } catch (err) {
 console.error('Database error in PUT /events/:eventId/participants/:participantId/status:', eventId, participantId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  return router;
};
