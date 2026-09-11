const express = require('express');
const liveUpdate = require('../../utils/liveUpdate');
const { formatDatum } = require('../../utils/zeitformat');
const { allIdsBelongToOrg } = require('../../utils/orgOwnership');
const { validateTeamerQuota } = require('./validierung');

module.exports = (db, rbacVerifier, { requireTeamer }) => {
  const router = express.Router();

  // Create series events
  router.post('/series', rbacVerifier, requireTeamer, async (req, res) => {
    // WICHTIG: Diese Liste muss mit POST / (Einzel-Event, verwaltung.js) synchron bleiben.
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
        error: `Eine Serie darf höchstens ${SERIES_MAX_SPAN_MONTHS} Monate umfassen (letzter Termin wäre ${formatDatum(lastDate)})`
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

        // Anmeldefenster: derselbe zeitliche Abstand wie beim ersten Termin
        // 
        //
        // Vorher wurde die Verschiebung ueber `getDate()` gerechnet — das
        // liefert nur den TAG IM MONAT, nicht die verstrichene Zeit. Ueber
        // eine Monatsgrenze hinweg ergab das Unsinn: Termin am 1.9.,
        // Anmeldung ab 25.8. wurde zu "1 minus 25 = -24 Tage" statt der
        // echten 7. Gemessen verschob sich das Fenster dadurch um 31 Tage,
        // und zwar bei JEDEM Termin der Serie — die Anmeldung oeffnete
        // durchgehend NACH dem Termin und war damit unbrauchbar.
        //
        // Der Abstand in Millisekunden ist die einzige Groesse, die ueber
        // Monatsgrenzen traegt. Denselben Ansatz nutzt die Datei bereits an
        // anderer Stelle (`d.getTime()`).
        const regOpens = registration_opens_at
          ? new Date(date.getTime() - (new Date(event_date) - new Date(registration_opens_at)))
          : null;

        const regCloses = registration_closes_at
          ? new Date(date.getTime() - (new Date(event_date) - new Date(registration_closes_at)))
          : null;

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

  return router;
};
