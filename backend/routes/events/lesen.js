const express = require('express');
const { anmeldeStatusSql, kapazitaetSql, ZEITFENSTER_SQL } = require('../../utils/terminAnmeldeStatus');

module.exports = (db, rbacVerifier, { requireTeamer }) => {
  const router = express.Router();

  // Get all events (read-only, accessible to all authenticated users)
  router.get('/', rbacVerifier, async (req, res) => {
    try {
      // Datumsfenster: standardmaessig nur Events des letzten Jahres (plus alle
      // zukuenftigen). Mit ?all=true wird die gesamte Historie geliefert.
      const includeAll = req.query.all === 'true';
      const dateWindowClause = includeAll
        ? ''
        : "AND e.event_date >= NOW() - INTERVAL '1 year'";

      // Restrukturierte Query:
      // Keine Join-Explosion mehr über bookings/users/roles/categories/jahrgaenge.
      // Stattdessen pro Anliegen ein LATERAL-Aggregat bzw. Sub-Select — kein
      // GROUP BY über die ganze Breite nötig.
      const query = `
        SELECT e.*,
                bstats.registered_count,
                bstats.waitlist_count,
                bstats.unprocessed_count,
                bstats.teamer_unprocessed_count,
                bstats.total_participants,
                bstats.teamer_count,
                bstats.teamer_waitlist_count,
                CASE
                  WHEN e.has_timeslots THEN COALESCE(timeslot_capacity.total_capacity, e.max_participants)
                  ELSE e.max_participants
                END as max_participants,
                e.registration_opens_at,
                e.registration_closes_at,
                e.point_type,
                cats.category_ids,
                cats.category_names,
                jgs.jahrgang_ids,
                jgs.jahrgang_names,
                event_chat.id as chat_room_id,
                ${anmeldeStatusSql({
                  kapazitaet: kapazitaetSql('timeslot_capacity.total_capacity'),
                  bestaetigt: 'bstats.registered_count',
                  warteliste: 'bstats.waitlist_count'
                })} as registration_status,
                -- Bewusst ein ZWEITER Wert statt einer Aenderung am ersten: Die
                -- beiden Kontingente sind unabhaengig (zehn Konfi-Plaetze und
                -- drei Teamer-Plaetze sind zehn und drei, nicht dreizehn). Ein
                -- gemeinsamer Status koennte nur einen von beiden abbilden.
                CASE
                  WHEN e.cancelled THEN 'cancelled'
                  WHEN NOT (e.teamer_needed OR e.teamer_only) THEN 'none'
                  WHEN NOW() < e.registration_opens_at THEN 'upcoming'
                  WHEN NOW() > e.registration_closes_at THEN 'closed'
                  -- 0 heisst unbegrenzt, wie beim Konfi-Kontingent auch.
                  WHEN COALESCE(e.teamer_max_participants, 0) > 0
                       AND bstats.teamer_count >= e.teamer_max_participants
                       AND (NOT e.teamer_waitlist_enabled
                            OR bstats.teamer_waitlist_count >= COALESCE(e.teamer_max_waitlist_size, 0))
                    THEN 'closed'
                  WHEN COALESCE(e.teamer_max_participants, 0) > 0
                       AND bstats.teamer_count >= e.teamer_max_participants
                    THEN 'waitlist'
                  ELSE 'open'
                END as teamer_registration_status,
                CASE WHEN eb_user.status = 'confirmed' THEN true ELSE false END as is_registered,
                eb_user.status as booking_status,
                eb_user.attendance_status,
                mat.material_count
        FROM events e
        -- Zahlen aus der View statt aus einer eigenen Kopie.
        --
        -- event_booking_stats liegt seit Migration 128 bereit und wurde von
        -- keinem Endpunkt gelesen: Fuenf Stellen zaehlten dieselben Buchungen
        -- getrennt und liefen im August dreimal auseinander. Die Spalten sind
        -- deckungsgleich, nur anders benannt; die Namen nach aussen bleiben,
        -- damit kein Aufrufer bricht.
        --
        -- Eine Verhaltensaenderung ist dabei: Die alte Kopie hatte einen
        -- LEFT JOIN auf users ohne deleted_at-Filter und zaehlte Buchungen
        -- geloeschter Konten mit. Die View filtert sie heraus — das ist der
        -- Fehler, den ihr Kommentar (Migration 128) ausdruecklich meint.
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(ebs.konfi_confirmed, 0)   as registered_count,
            COALESCE(ebs.konfi_waitlist, 0)    as waitlist_count,
            COALESCE(ebs.konfi_offen, 0)       as unprocessed_count,
            COALESCE(ebs.teamer_offen, 0)      as teamer_unprocessed_count,
            COALESCE(ebs.teamer_confirmed, 0)  as teamer_count,
            COALESCE(ebs.teamer_waitlist, 0)   as teamer_waitlist_count,
            -- total_participants zaehlte alles inklusive Abgemeldeter.
            -- gebucht_gesamt laesst sie aus, deshalb hier wieder dazu, damit
            -- die Zahl nach aussen dieselbe bleibt. (Gelesen wird sie derzeit
            -- von niemandem — weder Backend noch App.)
            COALESCE(ebs.gebucht_gesamt, 0)
              + COALESCE(ebs.konfi_opted_out, 0)
              + COALESCE(ebs.teamer_opted_out, 0) as total_participants
          FROM event_booking_stats ebs
          WHERE ebs.event_id = e.id
        ) bstats ON true
        LEFT JOIN LATERAL (
          SELECT STRING_AGG(DISTINCT c.id::text, ',') as category_ids,
                 STRING_AGG(DISTINCT c.name, ', ') as category_names
          FROM event_categories ec
          JOIN categories c ON ec.category_id = c.id
          WHERE ec.event_id = e.id
        ) cats ON true
        LEFT JOIN LATERAL (
          SELECT STRING_AGG(DISTINCT j.id::text, ',') as jahrgang_ids,
                 STRING_AGG(DISTINCT j.name, ', ') as jahrgang_names
          FROM event_jahrgang_assignments eja
          JOIN jahrgaenge j ON eja.jahrgang_id = j.id
          WHERE eja.event_id = e.id
        ) jgs ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) as material_count
          FROM material_events me
          WHERE me.event_id = e.id
        ) mat ON true
        LEFT JOIN LATERAL (
          SELECT eb2.status, eb2.attendance_status
          FROM event_bookings eb2
          WHERE eb2.event_id = e.id AND eb2.user_id = $2
          LIMIT 1
        ) eb_user ON true
        LEFT JOIN LATERAL (
          SELECT SUM(max_participants) as total_capacity
          FROM event_timeslots
          WHERE event_id = e.id
        ) timeslot_capacity ON true
        -- Event-Chat: nur, wenn die abrufende Person auch Mitglied des Raums
        -- ist. Damit bildet der Einstieg in der Detailansicht genau die
        -- Berechtigung ab, die darfRaumOeffnen (chat.js:273) durchsetzt —
        -- ein Knopf, der ins 403 fuehrt, entsteht so gar nicht erst.
        -- Teamer:innen und Konfis werden beim Buchen Mitglied (addToEventChat).
        LEFT JOIN LATERAL (
          SELECT cr.id
          FROM chat_rooms cr
          JOIN chat_participants cp
            ON cp.room_id = cr.id AND cp.user_id = $2 AND cp.user_type = $3
          WHERE cr.event_id = e.id AND cr.organization_id = $1
          LIMIT 1
        ) event_chat ON true
        WHERE e.organization_id = $1
          ${dateWindowClause}
        ORDER BY e.event_date ASC
      `;

      const { rows } = await db.query(query, [req.user.organization_id, req.user.id, req.user.type]);

      // Für Teamer UND Admin: nur Events anzeigen die mindestens einem zugewiesenen Jahrgang zugeordnet sind
      // ODER die keinem Jahrgang zugeordnet sind (allgemeine Events)
      // ODER die teamer_only/teamer_needed sind (immer sichtbar für Teamer)
      let filteredRows = rows;
      if (!req.user.is_super_admin
          && ['teamer', 'admin'].includes(req.user.role_name)) {
        // Ohne jede Zuweisung griff der Filter früher gar nicht (die Bedingung
        // verlangte length > 0) — eine Teamer:in ohne Jahrgang sah damit ALLE
        // Events der Organisation statt keiner jahrgangsgebundenen.
        // Jetzt greift der Filter immer; ohne Zuweisung bleibt die
        // Liste der sichtbaren Jahrgänge schlicht leer.
        const viewableJahrgaenge = (req.user.assigned_jahrgaenge || [])
          .filter(j => j.can_view)
          .map(j => j.id);
        if (viewableJahrgaenge.length === 0) {
          // Grund der ausgeduennten Liste mitliefern (dasselbe Muster wie
          // GET /admin/konfis): keine Zuweisung — es bleiben nur allgemeine
          // und Teamer-Termine uebrig. Header statt Rumpf-Feld, damit die
          // Antwortform ein Array bleibt.
          res.set('X-Kein-Jahrgang-Zugewiesen', 'true');
        }
        filteredRows = rows.filter(row => {
          // Reine Teamer-Events sind immer sichtbar: Sie haengen an keinem
          // Jahrgang, es gibt nichts zu schuetzen.
          if (row.teamer_only) return true;
          // Allgemeine Events (keine Jahrgang-Zuweisung) sind für alle sichtbar
          if (!row.jahrgang_ids) return true;
          // Prüfen ob mindestens ein zugewiesener Jahrgang dabei ist
          const eventJahrgangIds = row.jahrgang_ids.split(',').map(id => parseInt(id, 10));
          return eventJahrgangIds.some(id => viewableJahrgaenge.includes(id));
        });
      }

      // Für Konfis: teamer_only Events ausschließen
      if (req.user.type === 'konfi') {
        filteredRows = filteredRows.filter(row => !row.teamer_only);
      }
      
      // Transform the data to include categories and jahrgaenge arrays
      const eventsWithRelations = filteredRows.map(row => {
        const categories = [];
        if (row.category_ids) {
          const ids = row.category_ids.split(',');
          const names = row.category_names.split(',');
          for (let i = 0; i < ids.length; i++) {
            categories.push({
              id: parseInt(ids[i], 10),
              name: names[i]
            });
          }
        }
        
        const jahrgaenge = [];
        if (row.jahrgang_ids) {
          const ids = row.jahrgang_ids.split(',');
          const names = row.jahrgang_names.split(',');
          for (let i = 0; i < ids.length; i++) {
            jahrgaenge.push({
              id: parseInt(ids[i], 10),
              name: names[i]
            });
          }
        }
        
        const unprocessedCount =
          (parseInt(row.unprocessed_count, 10) || 0)
          + (parseInt(row.teamer_unprocessed_count, 10) || 0);

        // qr_token gehört NICHT in die Liste: Die Query
        // holt e.*, damit lag der Check-in-Token jedes Events in der Antwort —
        // für ALLE Rollen, auch Konfis. Ein Konfi konnte sich damit per
        // POST /events/qr-checkin von zu Hause als anwesend eintragen und
        // Punkte gutschreiben. GET /events/:id filterte den Token bereits,
        // über die Liste war dieser Schutz umgehbar.
        // Teamer und Leitung brauchen den Token nur zum Anzeigen des QR-Codes
        // und holen ihn dort über die Detail- bzw. generate-Route.
        const { qr_token: _qrToken, ...rowOhneToken } = row;

        return {
          ...rowOhneToken,
          categories: categories,
          jahrgaenge: jahrgaenge,
          waitlist_count: parseInt(row.waitlist_count, 10) || 0,
          teamer_count: parseInt(row.teamer_count, 10) || 0,
          teamer_waitlist_count: parseInt(row.teamer_waitlist_count, 10) || 0,
          material_count: parseInt(row.material_count, 10) || 0,
          pending_bookings_count: unprocessedCount > 0 ? unprocessedCount : undefined
        };
      });

      res.json(eventsWithRelations);

    } catch (err) {
 console.error('Database error in GET /events:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get cancelled events (Admin only)
  router.get('/cancelled', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const query = `
        SELECT e.*, 
                -- Zahlen aus event_booking_stats.
                --
                -- BEDEUTUNGSAENDERUNG, bewusst und abgestimmt: Diese Stelle
                -- hatte als einzige KEINEN Rollenfilter. registered_count hiess
                -- hier "Konfis UND Teamer", ueberall sonst "nur Konfis" — ein
                -- abgesagter Termin mit 19 Konfis und 4 Teamer:innen meldete
                -- 23, waehrend die Liste 19 zeigte. Derselbe Feldname mit zwei
                -- Bedeutungen ist genau die Fehlerklasse, die im August dreimal
                -- zugeschlagen hat.
                --
                -- Die Teamer gehen nicht verloren, sie stehen jetzt getrennt —
                -- wie in der normalen Liste auch.
                COALESCE(ebs.konfi_confirmed, 0)  as registered_count,
                COALESCE(ebs.konfi_waitlist, 0)   as waitlist_count,
                COALESCE(ebs.konfi_offen, 0)      as unprocessed_count,
                COALESCE(ebs.teamer_confirmed, 0) as teamer_count,
                COALESCE(ebs.teamer_waitlist, 0)  as teamer_waitlist_count,
                COALESCE(ebs.teamer_offen, 0)     as teamer_unprocessed_count,
                STRING_AGG(DISTINCT c.id::text, ',') as category_ids,
                STRING_AGG(DISTINCT c.name, ', ') as category_names,
                STRING_AGG(DISTINCT j.id::text, ',') as jahrgang_ids,
                STRING_AGG(DISTINCT j.name, ', ') as jahrgang_names
        FROM events e
        LEFT JOIN event_booking_stats ebs ON ebs.event_id = e.id
        LEFT JOIN event_categories ec ON e.id = ec.event_id
        LEFT JOIN categories c ON ec.category_id = c.id
        LEFT JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
        LEFT JOIN jahrgaenge j ON eja.jahrgang_id = j.id
        WHERE e.organization_id = $1 AND e.cancelled = TRUE
        -- Die ebs-Spalten muessen ins GROUP BY: Das STRING_AGG fuer Kategorien
        -- und Jahrgaenge verlangt es, und die View liefert pro Termin genau
        -- eine Zeile, gruppiert also nichts zusammen.
        GROUP BY e.id, ebs.konfi_confirmed, ebs.konfi_waitlist, ebs.konfi_offen,
                 ebs.teamer_confirmed, ebs.teamer_waitlist, ebs.teamer_offen
        ORDER BY e.cancelled_at DESC
      `;
      
      const { rows } = await db.query(query, [req.user.organization_id]);
      
      // Transform the data to include categories and jahrgaenge arrays
      const eventsWithRelations = rows.map(row => {
        const categories = [];
        if (row.category_ids) {
          const ids = row.category_ids.split(',');
          const names = row.category_names.split(',');
          for (let i = 0; i < ids.length; i++) {
            categories.push({
              id: parseInt(ids[i], 10),
              name: names[i]
            });
          }
        }
        
        const jahrgaenge = [];
        if (row.jahrgang_ids) {
          const ids = row.jahrgang_ids.split(',');
          const names = row.jahrgang_names.split(',');
          for (let i = 0; i < ids.length; i++) {
            jahrgaenge.push({
              id: parseInt(ids[i], 10),
              name: names[i]
            });
          }
        }
        
        // Abgesagte Termine: unprocessed_count zaehlt hier bereits ueber ALLE
        // Rollen (events.js:305, keine Rollen-Trennung) — nicht addieren,
        // das wuerde Teamer doppelt zaehlen.
        const unprocessedCount = parseInt(row.unprocessed_count, 10) || 0;
        return {
          ...row,
          categories: categories,
          jahrgaenge: jahrgaenge,
          registration_status: 'cancelled',
          waitlist_count: parseInt(row.waitlist_count, 10) || 0,
          pending_bookings_count: unprocessedCount > 0 ? unprocessedCount : undefined
        };
      });
      
      res.json(eventsWithRelations);
      
    } catch (err) {
 console.error('Database error in GET /events/cancelled:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get timeslots for an event
  router.get('/:id/timeslots', rbacVerifier, async (req, res) => {
    const eventId = req.params.id;
    try {

      // Verify event exists and belongs to organization
      const { rows: [event] } = await db.query("SELECT id, has_timeslots FROM events WHERE id = $1 AND organization_id = $2", [eventId, req.user.organization_id]);

      if (!event) {
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      if (!event.has_timeslots) {
        return res.json([]); // Return empty array if event doesn't use timeslots
      }

      const { rows: timeslots } = await db.query(ZEITFENSTER_SQL, [eventId, req.user.organization_id]);

      res.json(timeslots);

    } catch (err) {
 console.error('Database error in GET /events/:id/timeslots:', req.params.id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get event details with participants
  router.get('/:id', rbacVerifier, async (req, res) => {
    const eventId = req.params.id;
    try {
      // Bisher lieferte nur die Liste (GET /events) die beiden Werte; die
      // Detailantwort liess sie weg. Die Leitungs-Detailansicht liest den
      // Status aber genau aus dieser Antwort — er war dort immer undefined,
      // und die Kette in getStatusText() fiel auf "Geschlossen" durch. Das
      // traf JEDEN Termin; sichtbar wurde es nur, wenn weder Anmeldefrist
      // noch Kapazitaet gesetzt sind, weil sonst eine vorgelagerte Bedingung
      // (Warteliste, Ausgebucht, Vergangen, Pflicht, Abgesagt) das verdeckte.
      // Der Gegenbeweis stand im selben Code: OHNE Verbindung nimmt die
      // Ansicht den Stand aus dem Listen-Cache, der das Feld hat — derselbe
      // Termin stand offline korrekt auf "Offen" und kippte beim naechsten
      // Online-Laden auf "Geschlossen".
      //
      // Gerechnet wird mit denselben Helfern wie in der Liste
      // (utils/terminAnmeldeStatus.js), damit die beiden Ansichten nicht
      // wieder auseinanderlaufen — genau dafuer gibt es die Datei.
      //
      // REIN ADDITIV: zwei neue Felder, kein bestehendes aendert Form oder
      // Typ. Ausgelieferte Apps ignorieren sie — und bekommen die Anzeige
      // sogar ohne Update repariert, weil sie den Wert schon auslesen.
      const detailQuery = `
        SELECT e.id, e.name, e.description, e.event_date, e.event_end_time, e.location,
               e.location_maps_url, e.points, e.point_type, e.type, e.max_participants,
               e.registration_opens_at, e.registration_closes_at, e.has_timeslots,
               e.waitlist_enabled, e.max_waitlist_size, e.teamer_max_participants,
               e.teamer_waitlist_enabled, e.teamer_max_waitlist_size, e.is_series,
               e.series_id, e.mandatory, e.is_konfirmation, e.bring_items,
               e.checkin_window, e.teamer_needed, e.teamer_only, e.cancelled,
               e.cancelled_at, e.qr_token, e.created_by, e.organization_id, e.created_at,
               ${anmeldeStatusSql({
                 kapazitaet: kapazitaetSql('timeslot_capacity.total_capacity'),
                 bestaetigt: 'bstats.registered_count',
                 warteliste: 'bstats.waitlist_count'
               })} as registration_status,
               -- Zweiter, unabhaengiger Status fuer das TEAMER-Kontingent,
               -- wortgleich zur Liste (oben in dieser Datei). Ohne ihn
               -- bewertet die Detailansicht bei "Nur Team"-Terminen das
               -- falsche Kontingent: registration_status rechnet
               -- ausschliesslich mit Konfi-Zahlen.
               CASE
                 WHEN e.cancelled THEN 'cancelled'
                 WHEN NOT (e.teamer_needed OR e.teamer_only) THEN 'none'
                 WHEN NOW() < e.registration_opens_at THEN 'upcoming'
                 WHEN NOW() > e.registration_closes_at THEN 'closed'
                 WHEN COALESCE(e.teamer_max_participants, 0) > 0
                      AND bstats.teamer_count >= e.teamer_max_participants
                      AND (NOT e.teamer_waitlist_enabled
                           OR bstats.teamer_waitlist_count >= COALESCE(e.teamer_max_waitlist_size, 0))
                   THEN 'closed'
                 WHEN COALESCE(e.teamer_max_participants, 0) > 0
                      AND bstats.teamer_count >= e.teamer_max_participants
                   THEN 'waitlist'
                 ELSE 'open'
               END as teamer_registration_status
        FROM events e
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(ebs.konfi_confirmed, 0)  as registered_count,
            COALESCE(ebs.konfi_waitlist, 0)   as waitlist_count,
            COALESCE(ebs.teamer_confirmed, 0) as teamer_count,
            COALESCE(ebs.teamer_waitlist, 0)  as teamer_waitlist_count
          FROM event_booking_stats ebs
          WHERE ebs.event_id = e.id
        ) bstats ON true
        LEFT JOIN LATERAL (
          SELECT SUM(et.max_participants) as total_capacity
          FROM event_timeslots et
          WHERE et.event_id = e.id
        ) timeslot_capacity ON true
        WHERE e.id = $1 AND e.organization_id = $2
      `;
      const { rows: [event] } = await db.query(detailQuery, [eventId, req.user.organization_id]);

      if (!event) {
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      // Get participants
      //
      // absage_nach_zusage (Migration 141) kommt hier ADDITIV mit: Die
      // Leitung sieht damit, ob eine Teamer-Absage eine vorherige Zusage
      // zurueckgenommen hat ("kurzfristig abgesprungen") — der Grund steht
      // wie bisher in opt_out_reason. Kein vorhandenes Feld aendert Form
      // oder Typ; ausgelieferte Apps ignorieren das neue Feld einfach.
      const participantsQuery = `
        SELECT eb.*, eb.opt_out_reason, eb.opt_out_date, eb.absage_nach_zusage,
                u.display_name as participant_name,
                CASE
                  WHEN r.name = 'teamer' THEN (SELECT STRING_AGG(DISTINCT j2.name, ', ' ORDER BY j2.name) FROM user_jahrgang_assignments uja2 JOIN jahrgaenge j2 ON uja2.jahrgang_id = j2.id WHERE uja2.user_id = u.id)
                  ELSE j.name
                END as jahrgang_name,
                kp.jahrgang_id,
                et.start_time as timeslot_start_time,
                et.end_time as timeslot_end_time,
                r.name as role_name
        FROM event_bookings eb
        JOIN users u ON eb.user_id = u.id
        LEFT JOIN roles r ON u.role_id = r.id
        LEFT JOIN konfi_profiles kp ON u.id = kp.user_id
        LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
        LEFT JOIN event_timeslots et ON eb.timeslot_id = et.id
        WHERE eb.event_id = $1 AND u.organization_id = $2 AND u.deleted_at IS NULL
        ORDER BY
          CASE eb.status
            WHEN 'confirmed' THEN 1
            WHEN 'waitlist' THEN 2
            ELSE 3
          END,
          eb.created_at ASC
      `;
      const { rows: participants } = await db.query(participantsQuery, [eventId, req.user.organization_id]);
      
      // Get series events if this is part of a series
      let seriesEvents = [];
      if (event.is_series && event.series_id) {
        const seriesQuery = `
          SELECT e.*, COUNT(eb.id) as registered_count
          FROM events e
          LEFT JOIN event_bookings eb ON e.id = eb.event_id AND eb.status = 'confirmed'
          WHERE e.series_id = $1 AND e.organization_id = $2 AND e.id != $3
          GROUP BY e.id
          ORDER BY e.event_date ASC
        `;
        const { rows } = await db.query(seriesQuery, [event.series_id, req.user.organization_id, eventId]);
        seriesEvents = rows;
      }
      
      // Get timeslots if event has them
      let timeslots = [];
      if (event.has_timeslots) {
        const timeslotsQuery = `
          SELECT et.*,
                 COUNT(eb.id) FILTER (WHERE eb.status = 'confirmed') as registered_count,
                 COUNT(eb.id) FILTER (WHERE eb.status = 'waitlist') as waitlist_count
          FROM event_timeslots et
          LEFT JOIN event_bookings eb ON et.id = eb.timeslot_id
          WHERE et.event_id = $1 AND et.organization_id = $2
          GROUP BY et.id
          ORDER BY et.start_time ASC
        `;
        const { rows } = await db.query(timeslotsQuery, [eventId, req.user.organization_id]);
        timeslots = rows;
      }
      
      // Get jahrgaenge for this event
      const jahrgaengeQuery = `
        SELECT j.id, j.name
        FROM jahrgaenge j
        JOIN event_jahrgang_assignments eja ON j.id = eja.jahrgang_id
        WHERE eja.event_id = $1
      `;
      const { rows: jahrgaenge } = await db.query(jahrgaengeQuery, [eventId]);
      
      // Get categories for this event
      const categoriesQuery = `
        SELECT c.id, c.name
        FROM categories c
        JOIN event_categories ec ON c.id = ec.category_id
        WHERE ec.event_id = $1
      `;
      const { rows: categories } = await db.query(categoriesQuery, [eventId]);

      // Get unregistrations (Abmeldungen) for this event
      const unregistrationsQuery = `
        SELECT eu.*, u.display_name as konfi_name
        FROM event_unregistrations eu
        JOIN users u ON eu.user_id = u.id
        WHERE eu.event_id = $1 AND eu.organization_id = $2 AND u.deleted_at IS NULL
        ORDER BY eu.unregistered_at DESC
      `;
      const { rows: unregistrations } = await db.query(unregistrationsQuery, [eventId, req.user.organization_id]);

      // Check if event has an associated chat room
      const { rows: [eventChat] } = await db.query(
        "SELECT id FROM chat_rooms WHERE event_id = $1",
        [eventId]
      );

      // Bewusst NICHT auf event_booking_stats umgestellt: Hier
      // wird ueber die ohnehin schon geladene Teilnehmerliste gezaehlt, deren
      // Abfrage bereits deleted_at filtert — die Bedeutung ist mit der View
      // deckungsgleich. Ein Griff zur View waere eine zusaetzliche Abfrage fuer
      // Zahlen, die hier schon im Speicher liegen. Aendert sich die Bedeutung
      // der View, muessen diese vier Zeilen mitwandern.
      //
      // registered_count/pending_count sind KONFI-Zahlen — dieselbe Semantik
      // wie die Liste (events.js, bstats-LATERAL). Ohne den Rollenfilter
      // zählte das Detail Teamer mit: bei einem
      // teamer_needed-Event mit Kapazität meldete das Detail "Ausgebucht",
      // während die Liste "Offen" zeigte. Teamer stehen getrennt in
      // teamer_count/teamer_waitlist_count (eigenes Kontingent, Migration 120).
      const registeredCount = participants.filter(p => p.status === 'confirmed' && p.role_name === 'konfi').length;
      const pendingCount = participants.filter(p => p.status === 'waitlist' && p.role_name === 'konfi').length;

      // Teamer-Kontingent: eigene Zähler, getrennt vom Konfi-Kontingent
      // Team-Seite: Teamer:innen UND zugeordnete Leitung.
      const teamerCount = participants.filter(p => p.status === 'confirmed' && p.role_name !== 'konfi').length;
      const teamerWaitlistCount = participants.filter(p => p.status === 'waitlist' && p.role_name !== 'konfi').length;

      // Buchungsstatus des eingeloggten Users (für Konfis UND Teamer:innen —
      // Teamer können seit dem Teamer-Kontingent ebenfalls 'waitlist' haben)
      const ownBooking = participants.find(p => p.user_id === req.user.id);

      // For timeslot events, calculate total capacity and availability
      let totalCapacity = event.max_participants;
      if (event.has_timeslots && timeslots && timeslots.length > 0) {
        totalCapacity = timeslots.reduce((sum, slot) => sum + slot.max_participants, 0);
      }
      
      // Konfis bekommen diese Route zwar (sie ist nur mit rbacVerifier
      // geschuetzt), duerfen aber NICHT alles sehen:
      //  - qr_token: damit könnte sich ein Konfi per POST /qr-checkin von zu
      //    Hause selbst als anwesend eintragen und Punkte gutschreiben.
      //  - participants/unregistrations: enthalten Klarnamen, Jahrgang,
      //    Anwesenheitsstatus und opt_out_reason (Entschuldigungsgruende
      //    Minderjaehriger). Die Konfi-Route /api/konfi/events/:id/participants
      //    anonymisiert dieselben Daten bewusst zu "Vorname N.".
      const istKonfi = req.user.type === 'konfi';
      const { qr_token, ...eventOhneToken } = event;

      res.json({
        ...(istKonfi ? eventOhneToken : event),
        participants: istKonfi ? [] : participants,
        timeslots,
        series_events: seriesEvents,
        jahrgaenge,
        categories,
        unregistrations: istKonfi ? [] : unregistrations,
        registered_count: registeredCount,
        pending_count: pendingCount,
        teamer_count: teamerCount,
        teamer_waitlist_count: teamerWaitlistCount,
        max_participants: totalCapacity,
        available_spots: totalCapacity - registeredCount,
        booking_status: ownBooking ? ownBooking.status : null,
        is_registered: ownBooking ? ownBooking.status === 'confirmed' : false,
        chat_room_id: eventChat?.id || null
      });
      
    } catch (err) {
 console.error('Database error in GET /events/:id:', req.params.id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  return router;
};
