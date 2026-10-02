const express = require('express');
const { formatUhrzeit } = require('../../utils/zeitformat');
const PushService = require('../../services/pushService');
const liveUpdate = require('../../utils/liveUpdate');
const { rueckeNach, takeBackEventPoints, freiePlaetze, zaehleBestaetigte } = require('../../utils/bookingUtils');
const { meldeNachrueckern } = require('../../utils/nachrueckMeldung');
const { removeFromEventChat, addToEventChat } = require('../../utils/eventChat');
const { nachAntwort } = require('../../utils/nachAntwort');
const { darfTermin, gehoertZumTermin } = require('../../utils/jahrgangsZugriff');

// Deshalb requireAdmin (org_admin, admin) statt des frueheren requireTeamer.
// Gesperrt wird in BEIDEN Ebenen: Oberflaeche und Backend.
// Die Werte, die POST /:id/participants fuer `status` annimmt.
const STATUS_VON_HAND = ['auto', 'confirmed', 'waitlist'];

module.exports = (db, rbacVerifier, { requireAdmin }) => {
  const router = express.Router();

  // Add participant to event (Admin only) - mit Transaktion gegen Race Conditions
  router.post('/:id/participants', rbacVerifier, requireAdmin, async (req, res) => {
    const eventId = req.params.id;
    const { user_id, timeslot_id = null } = req.body;
    // Fehlt status (oder ist null), gilt 'auto' -- wie bisher beim Fehlen.
    const status = req.body.status === undefined || req.body.status === null ? 'auto' : req.body.status;

    // STATUS PRUEFEN, BEVOR ETWAS GESCHRIEBEN WIRD.
    // Der Wert ging bis dahin ungeprueft ins INSERT:
    // 'foo' scheiterte erst am CHECK der Datenbank und endete als 500
    // "Datenbankfehler"; 'cancelled' oder 'opted_out' stehen in diesem CHECK
    // und legten eine Buchung an, die es so nie geben soll. Erlaubt sind die
    // drei Werte, die dieser Weg kennt: 'auto' (Kapazitaet und Warteliste
    // wie bei der Selbstanmeldung), 'confirmed' und 'waitlist'. Die App
    // schickt 'confirmed' (Stand 2.2.0 bis heute).
    if (!STATUS_VON_HAND.includes(status)) {
      return res.status(400).json({
        error: 'Ungültiger Status. Erlaubt sind auto, confirmed und waitlist',
        error_code: 'status_ungueltig'
      });
    }

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

      // Wer wieder Leute eintragen will, nimmt zuerst die Absage zurueck
      // (PUT /:id/reaktivieren) — dort kommen die vorher Abgemeldeten
      // ohnehin von selbst zurueck.
      if (event.cancelled) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ error: 'Dieses Event ist abgesagt' });
      }

      const zugriff = await darfTermin(client, req, eventId);
      if (!zugriff.erlaubt) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(403).json({ error: 'Kein Zugriff auf dieses Event' });
      }

      const { rows: [user] } = await client.query(
        `SELECT u.id, u.display_name,
                COALESCE(
                  (SELECT r.name FROM roles r WHERE r.id = u.role_id AND u.organization_id = $2),
                  (SELECT r.name FROM user_organizations uo JOIN roles r ON r.id = uo.role_id
                    WHERE uo.user_id = u.id AND uo.organization_id = $2 LIMIT 1)
                ) AS role_name
           FROM users u
          WHERE u.id = $1
            AND (u.organization_id = $2
                 OR EXISTS (SELECT 1 FROM user_organizations uo
                             WHERE uo.user_id = u.id AND uo.organization_id = $2))`,
        [user_id, req.user.organization_id]
      );
      if (!user) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }

      //     darfTermin oben prueft den handelnden Admin. Die Person, die er
      //     eintraegt, wurde bis hierher nur ueber organization_id geholt —
      //     ein Konfi aus Jahrgang B liess sich in einen Termin von Jahrgang A
      //     eintragen, eine Teamer:in ohne Zuweisung ebenso. Die Selbst-
      //     anmeldung (bucheTermin) prueft das laengst; nur dieser Weg nicht.
      //
      //     Eigene Meldung mit Namen: Die handelnde Person IST berechtigt,
      //     die Ablehnung betrifft jemand anderen — "dem du nicht zugewiesen
      //     bist" (JAHRGANG_FREMD) waere hier schlicht falsch.
      //     Konfi und Team laufen durch dieselbe Pruefung; Termine ohne
      //     Jahrgang, 'Nur Team' und die Gemeindeleitung sind ausgenommen.
      if (!(await gehoertZumTermin(client, user_id, eventId))) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(403).json({
          error: `${user.display_name} gehört zu keinem Jahrgang dieses Events`,
          error_code: 'person_jahrgang_fremd'
        });
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

      const addedIsKonfi = user.role_name === 'konfi';
      const addedIsTeamer = !addedIsKonfi;

      if (status === 'confirmed' && req.body.ueberbuchen === false) {
        const seite = addedIsKonfi ? 'konfi' : 'team';
        const zeitfenster = addedIsKonfi && timeslot ? timeslot.id : null;
        const maxKapazitaet = addedIsKonfi
          ? (zeitfenster ? (timeslot.max_participants || 0) : (event.max_participants || 0))
          : (event.teamer_max_participants || 0);
        const frei = await freiePlaetze(client, { eventId, timeslotId: zeitfenster, seite }, maxKapazitaet);
        if (frei !== null && frei <= 0) {
          const belegt = await zaehleBestaetigte(
            client, zeitfenster ? { timeslotId: zeitfenster } : { eventId }, seite
          );
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({
            error: 'Das Event ist voll. Erhöhe die Teilnehmerzahl, um weitere Plätze zu vergeben.',
            error_code: 'event_voll',
            max: maxKapazitaet,
            belegt,
            seite
          });
        }
      }

      if (status === 'auto') {
        // Rolle des hinzugefuegten Users bestimmt, GEGEN WELCHES Kontingent
        // gezählt wird. Ohne diese Weiche landete ein per Admin hinzugefuegter
        // Teamer im Konfi-Kontingent — und stand er auf der Warteliste, fand
        // ihn promoteFromWaitlist(...,'not_teamer') nie: eine tote Buchung.
        //
        // addedIsKonfi/addedIsTeamer stehen oben, vor dieser Weiche — sie
        // werden auch beim Push gebraucht.
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

      // Seiteneffekte NACH der Antwort (siehe utils/nachAntwort.js): Die
      // Leitung soll nicht warten, bis der Push draussen ist, und ein
      // Push-Fehler darf die laengst committete Buchung nicht kippen.
      nachAntwort(req, async () => {
        // Vorher gab es hier nur Live-Updates: Die erreichen eine offene
        // Sitzung, aber kein Handy. Es ist derselbe Wortlaut wie bei der
        // Selbstanmeldung (routes/events/buchung.js) — die Meldung ist
        // dieselbe, egal ob man sich selbst anmeldet oder angemeldet wird.
        //
        // AUCH BEI DER WARTELISTE (bewusst so entschieden): Wer direkt auf
        // die Warteliste gesetzt wird, bekommt die passende Meldung "Du
        // stehst auf der Warteliste" — sendEventRegisteredToKonfi
        // unterscheidet den Wortlaut ueber den status. Schweigen waere hier
        // falsch: Die Person weiss sonst nicht einmal, dass die Leitung sie
        // ueberhaupt vorgemerkt hat, und hielte sich den Termin nicht frei.
        if (Number(user_id) !== Number(req.user.id)) {
          try {
            if (addedIsTeamer) {
              await PushService.sendEventRegisteredToTeamer(
                db, user_id, event.name, event.event_date, finalStatus, eventId, req.user.organization_id
              );
            } else {
              await PushService.sendEventRegisteredToKonfi(
                db, user_id, event.name, event.event_date, finalStatus, eventId, timeslot, req.user.organization_id
              );
            }
          } catch (pushErr) {
            console.error('Push notification failed for admin booking:', pushErr);
          }
        }

        // Live Update: Notify the booked person and admins about the admin-booking.
        // sendToUserByRole statt hart 'konfi': die Leitung kann hier auch
        // Teamer:innen eintragen (siehe addedIsTeamer oben) — die sitzen im Raum
        // user_teamer_<id> und bekamen ihr eigenes Ereignis sonst nie.
        liveUpdate.sendToUserByRole(user_id, 'events', 'update', { eventId, status: finalStatus });
        liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'admin_booking' });
      }, 'POST /events/:id/participants');

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
  router.delete('/:id/bookings/:bookingId', rbacVerifier, requireAdmin, async (req, res) => {
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
                 e.name AS event_name, e.event_date AS event_date,
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

        const zugriff = await darfTermin(client, req, eventId);
        if (!zugriff.erlaubt) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Kein Zugriff auf dieses Event' });
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

      // Ein frei gewordener Platz wird nachbesetzt. Konfi- und Team-Kontingent
      // sind strikt getrennt: ein frei gewordener Konfi-Platz wird nur aus der
      // Konfi-Warteliste nachbesetzt und umgekehrt.
        if (booking.status === 'confirmed') {
          const removedIsTeamer = booking.is_teamer_booking === true;
          // Kein eigener try/catch um diesen Block: Ein geschluckter Fehler
          // wuerde in ein COMMIT laufen und einen halben Zustand festschreiben.
          // Scheitert das Nachruecken, rollt das Entfernen zurueck.
          const [nachgerueckt] = await rueckeNach(client, {
            eventId,
            timeslotId: removedIsTeamer ? null : booking.timeslot_id,
            seite: removedIsTeamer ? 'team' : 'konfi'
          });
          if (nachgerueckt) {
            promotedUserId = nachgerueckt;
            const { rows: [eventInfo] } = await client.query(
              "SELECT name FROM events WHERE id = $1", [eventId]
            );
            promotedEventName = eventInfo?.name || null;
            promotedType = removedIsTeamer ? 'teamer' : 'konfi';
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

      // WER AUSGETRAGEN WIRD, ERFAEHRT ES:
      // "Ja, mit Postfach-Eintrag, wie beim Eintragen." Derselbe Rahmen wie
      // beim Eintragen oben: nach der Antwort, nicht an die ausloesende
      // Person selbst (wer sich selbst austraegt, weiss es), Fehler kippen
      // nichts. Nur wer angemeldet war oder wartete -- eine Zeile, die schon
      // "abgemeldet" hiess, verschwindet ohne neue Nachricht: Die Person hat
      // sich ja bereits abgemeldet oder wurde abgemeldet.
      if (['confirmed', 'waitlist'].includes(booking.status)
          && Number(booking.user_id) !== Number(req.user.id)) {
        nachAntwort(req, async () => {
          await PushService.sendEventRemovedByLeitung(
            db, booking.user_id, booking.event_name, booking.event_date, 'removed', eventId, req.user.organization_id
          );
        }, 'DELETE /events/:id/bookings/:bookingId (Mitteilung)');
      }

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
  router.put('/:id/participants/:participantId/status', rbacVerifier, requireAdmin, async (req, res) => {
    const { id: eventId, participantId } = req.params;
    const { status } = req.body;
    const ueberbuchen = req.body?.ueberbuchen === true;
    
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
      let herabstufungNachrueckerIn = null;
      let herabstufungSeite = 'konfi';
      try {
        await client.query('BEGIN');

        const { rows: [booking] } = await client.query(
          `SELECT eb.status, eb.attendance_status, eb.user_id, eb.timeslot_id,
                  e.organization_id, e.name AS event_name, e.event_date, e.cancelled,
                  e.max_participants, e.teamer_max_participants,
                  ts.max_participants AS timeslot_max,
                  COALESCE(r.name, '') <> 'konfi' AS ist_team
             FROM event_bookings eb
             JOIN events e ON eb.event_id = e.id
             JOIN users u ON eb.user_id = u.id
             LEFT JOIN roles r ON u.role_id = r.id
             LEFT JOIN event_timeslots ts ON eb.timeslot_id = ts.id
            WHERE eb.id = $1 AND eb.event_id = $2 FOR UPDATE OF eb`,
          [participantId, eventId]
        );
        if (!booking) {
          await client.query('ROLLBACK');
          // KEIN client.release() hier — das finally unten released.
          return res.status(404).json({ error: 'Buchung nicht gefunden' });
        }
        if (booking.organization_id !== req.user.organization_id) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Zugriff verweigert' });
        }

        const zugriff = await darfTermin(client, req, eventId);
        if (!zugriff.erlaubt) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Kein Zugriff auf dieses Event' });
        }

        if (booking.status === status) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Teilnehmer:in ist bereits ${status === 'confirmed' ? 'bestätigt' : 'auf der Warteliste'}` });
        }

        if (booking.cancelled && status === 'confirmed') {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Dieses Event ist abgesagt' });
        }

        // Vorheriger Status: bei Wechsel von 'waitlist' -> 'confirmed' ist es eine
        // Wartelisten-Befoerderung (Push an die betroffene Person). Bei 'confirmed'
        // -> 'waitlist' werden ggf. Punkte entzogen (Dashboard-Refresh nötig).
        wasWaitlist = booking.status === 'waitlist';
        betroffenerUser = booking.user_id;
        eventName = booking.event_name;
        eventDatum = booking.event_date;

        if (status === 'waitlist') {
          // Auf Warteliste: attendance_status löschen und Event-Punkte zurücknehmen.
          //
          // booking_date auf jetzt: Wer auf die
          // Warteliste zurueckgesetzt wird, stellt sich HINTEN an -- dieselbe
          // Regel wie bei der Wiederanmeldung (bookingUtils.js,
          // wartelistenRangSql). Bis dahin behielt die Herabgestufte ihren
          // alten Rang. Hatte sie vor den Wartenden gebucht (der Normalfall:
          // wer bestaetigt ist, war meist zuerst da), rueckte sie unten selbst
          // wieder nach, die Route nahm das zurueck -- und der geraeumte Platz
          // blieb leer, waehrend andere warteten.
          await client.query("UPDATE event_bookings SET status = 'waitlist', attendance_status = NULL, booking_date = NOW() WHERE id = $1", [participantId]);

          // Punkte-Ruecknahme ueber den gemeinsamen Helfer: Derselbe Block lag
          // vorher viermal im Code, zweimal transaktional und zweimal nicht.
          punkteZurueck = await takeBackEventPoints(client, booking.user_id, eventId);

          const [nachgerueckt] = await rueckeNach(client, {
            eventId,
            timeslotId: booking.ist_team ? null : booking.timeslot_id,
            seite: booking.ist_team ? 'team' : 'konfi'
          });
          if (nachgerueckt && nachgerueckt !== booking.user_id) {
            herabstufungNachrueckerIn = nachgerueckt;
            herabstufungSeite = booking.ist_team ? 'team' : 'konfi';
          } else if (nachgerueckt === booking.user_id) {
            // Sie hat sich selbst zurueckgeholt -- das macht die Herabstufung
            // zunichte. Rueckgaengig: zurueck auf die Warteliste.
            await client.query("UPDATE event_bookings SET status = 'waitlist', war_auf_warteliste = false WHERE id = $1", [participantId]);
          }
        } else {
          // KAPAZITAET PRUEFEN -- bis hierher gab es hier KEINE.
          //
          // Das fiel erst auf, seit das Nachruecken vollstaendig ist: Jede
          // Abmeldung und jede Herabstufung befoerdert seit dem 15.09.
          // automatisch die naechste wartende Person. Wer eine Abmeldung ueber
          // den Umweg "zurueck auf die Warteliste, dann bestaetigen" rueckgaengig
          // machen wollte -- der einzige Weg, den es bis heute gab --, buchte
          // den Termin damit still ueber: Beim Herabstufen rueckt Y nach, beim
          // Bestaetigen kommt X ungeprueft dazu. Zwei Personen auf einem Platz,
          // und nirgends eine Zahl, die rot wird.
          //
          // ABGELEHNT STATT STILL UEBERBUCHT (Entscheidung): Die Leitung soll
          // handlungsfaehig bleiben, aber nicht versehentlich ueber die eigene
          // Obergrenze gehen. Wer bewusst mehr Leute mitnehmen will, hat dafuer
          // den richtigen Weg -- die Kapazitaet des Termins erhoehen. Dann
          // stimmt die Zahl hinterher auch, und die Wartenden ruecken von
          // selbst korrekt nach. Eine stille Ueberbuchung dagegen ist kein
          // Alltagsweg, sondern ein Unfall: Sie faellt erst am Termin auf, wenn
          // die Stuehle nicht reichen.
          //
          // Ohne Obergrenze (0 oder NULL) aendert sich nichts -- dort gibt es
          // nichts zu ueberschreiten. Die Zaehlung laeuft ueber dieselbe Regel
          // wie das Nachruecken (zaehleBestaetigte ueber freiePlaetze), damit
          // beide nicht auseinanderlaufen koennen.
          const maxKapazitaet = booking.ist_team
            ? (booking.teamer_max_participants || 0)
            : (booking.timeslot_id ? (booking.timeslot_max || 0) : (booking.max_participants || 0));
          const frei = await freiePlaetze(
            client,
            {
              eventId,
              timeslotId: booking.ist_team ? null : booking.timeslot_id,
              seite: booking.ist_team ? 'team' : 'konfi'
            },
            maxKapazitaet
          );
          if (frei !== null && frei <= 0 && !ueberbuchen) {
            // belegt wird gezaehlt, nicht aus `frei` errechnet: freiePlaetze
            // endet bei 0, ein schon ueberbuchtes Event haette sonst belegt =
            // max gemeldet.
            const belegt = await zaehleBestaetigte(
              client,
              !booking.ist_team && booking.timeslot_id ? { timeslotId: booking.timeslot_id } : { eventId },
              booking.ist_team ? 'team' : 'konfi'
            );
            await client.query('ROLLBACK');
            return res.status(400).json({
              error: 'Das Event ist voll. Erhöhe die Teilnehmerzahl, um weitere Plätze zu vergeben.',
              error_code: 'event_voll',
              max: maxKapazitaet,
              belegt,
              seite: booking.ist_team ? 'team' : 'konfi'
            });
          }

          // BEFOERDERUNG VON HAND: Die Leitung waehlt eine bestimmte Person aus
          // -- FIFO gilt hier bewusst nicht, also kann promoteFromWaitlist das
          // nicht uebernehmen. Was es aber tut und hier fehlte:
          // war_auf_warteliste setzen (Migration 145). Ohne die Spalte verliert
          // der Jahresrueckblick im Moment der Befoerderung die Information,
          // dass diese Person gewartet hat.
          await client.query(
            `UPDATE event_bookings
                SET status = $1,
                    war_auf_warteliste = CASE WHEN $3::boolean THEN true ELSE war_auf_warteliste END
              WHERE id = $2`,
            [status, participantId, wasWaitlist]
          );
        }

        // Chat zum Termin, falls es einen gibt: Wer bestaetigt wird, kommt
        // hinein; wer auf die Warteliste zurueckgesetzt wird, geht hinaus.
        if (status === 'waitlist') {
          await removeFromEventChat(client, eventId, booking.user_id, req.user.organization_id);
        } else {
          await addToEventChat(client, eventId, booking.user_id, req.user.organization_id);
        }

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }

      const action = status === 'confirmed' ? 'Teilnehmer:in von Warteliste bestätigt' : 'Teilnehmer:in auf Warteliste gesetzt';
      res.json({ message: action, status });

      // Push bei Befoerderung von der Warteliste (Muster wie die uebrigen Nachrueck-Stellen, gemeinsamer Nachlauf in utils/nachrueckMeldung.js).
      // Seiteneffekt NACH res — Push-Fehler darf nichts kippen.
      nachAntwort(req, async () => {
        if (status === 'confirmed' && wasWaitlist) {
          try {
            await PushService.sendWaitlistPromotionToKonfi(db, betroffenerUser, eventName, eventDatum, eventId, req.user.organization_id);
          } catch (pushErr) {
            console.error('Error sending waitlist promotion push:', pushErr);
          }
        }

        // Wer auf die Warteliste zurueckgesetzt wird, erfaehrt es
        // -- wie beim Austragen nicht, wer sich
        // selbst herabstuft. wasWaitlist ist hier false: 'waitlist' ->
        // 'waitlist' lehnt die Route oben mit 400 ab.
        if (status === 'waitlist' && !wasWaitlist && Number(betroffenerUser) !== Number(req.user.id)) {
          await PushService.sendEventRemovedByLeitung(
            db, betroffenerUser, eventName, eventDatum, 'waitlist', eventId, req.user.organization_id
          );
        }

        // Wer durch die Herabstufung nachgerueckt ist, erfaehrt es — ueber
        // denselben Weg wie an allen anderen Nachrueck-Stellen.
        if (herabstufungNachrueckerIn) {
          await meldeNachrueckern(db, req.user.organization_id, [{
            eventId,
            userId: herabstufungNachrueckerIn,
            seite: herabstufungSeite
          }]);
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
