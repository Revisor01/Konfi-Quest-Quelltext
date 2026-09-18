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
                -- DIE FALLE: Das COALESCE in der LATERAL-Unterabfrage weiter
                -- unten schuetzt vor einer NULL-SPALTE, nicht vor einer
                -- FEHLENDEN ZEILE. event_booking_stats entsteht mit GROUP BY
                -- ueber event_bookings -- ein Termin OHNE jede Buchung hat
                -- dort keine Zeile. Die Unterabfrage liefert dann nichts,
                -- das ON true fuellt alle Spalten mit NULL auf, und das
                -- innere COALESCE wird nie ausgewertet.
                --
                -- Nachgewiesen an einem frisch angelegten Termin in
                -- Produktion: registered_count und abgemeldet_count kamen
                -- als null zurueck. Dieselbe Falle steckte in routes/konfi.js
                -- und liess dort "Anmelden (null/4)" auf dem Knopf stehen.
                COALESCE(bstats.registered_count, 0)         as registered_count,
                COALESCE(bstats.waitlist_count, 0)           as waitlist_count,
                COALESCE(bstats.unprocessed_count, 0)        as unprocessed_count,
                COALESCE(bstats.teamer_unprocessed_count, 0) as teamer_unprocessed_count,
                COALESCE(bstats.total_participants, 0)       as total_participants,
                COALESCE(bstats.teamer_count, 0)             as teamer_count,
                COALESCE(bstats.teamer_waitlist_count, 0)    as teamer_waitlist_count,
                COALESCE(bstats.abgemeldet_count, 0)         as abgemeldet_count,
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
                  bestaetigt: 'COALESCE(bstats.registered_count, 0)',
                  warteliste: 'COALESCE(bstats.waitlist_count, 0)'
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
                       AND COALESCE(bstats.teamer_count, 0) >= e.teamer_max_participants
                       AND (NOT e.teamer_waitlist_enabled
                            OR COALESCE(bstats.teamer_waitlist_count, 0) >= COALESCE(e.teamer_max_waitlist_size, 0))
                    THEN 'closed'
                  WHEN COALESCE(e.teamer_max_participants, 0) > 0
                       AND COALESCE(bstats.teamer_count, 0) >= e.teamer_max_participants
                    THEN 'waitlist'
                  ELSE 'open'
                END as teamer_registration_status,
                CASE WHEN eb_user.status = 'confirmed' THEN true ELSE false END as is_registered,
                eb_user.status as booking_status,
                eb_user.attendance_status,
                -- Wer den Termin abgesagt hat (Migration 150), ADDITIV: e.*
                -- bringt cancelled_reason und cancelled_by schon mit, der Name
                -- fehlt aber. LEFT JOIN, weil NULL hier "unbekannt" heisst --
                -- Termine, die vor der Migration abgesagt wurden, haben keinen
                -- Urheber. Ein INNER JOIN wuerde die halbe Terminliste
                -- verschlucken.
                u_cancel.display_name as cancelled_by_name,
                -- Wer den GRUND zuletzt gesetzt hat (Migration 152). Beim
                -- Absagen dieselbe Person wie cancelled_by; erst bei einer
                -- nachtraeglichen Korrektur gehen die beiden auseinander.
                u_grund.display_name as cancelled_reason_set_by_name,
                -- Siehe das LATERAL absage_abm weiter unten.
                COALESCE(absage_abm.anzahl, 0) as durch_absage_abgemeldet_count,
                mat.material_count
        FROM events e
        LEFT JOIN users u_cancel ON e.cancelled_by = u_cancel.id
        LEFT JOIN users u_grund ON e.cancelled_reason_set_by = u_grund.id
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
              + COALESCE(ebs.teamer_opted_out, 0)
              + COALESCE(ebs.konfi_excused, 0)
              + COALESCE(ebs.teamer_excused, 0) as total_participants,
            -- ABGEMELDETE KONFIS, ADDITIV -- dieselbe Zahl und
            -- dieselbe Begruendung wie in konfi.js: beide Abmelde-Arten
            -- zusammen, KONFI-rein wie registered_count daneben. Die Ansicht
            -- kann damit bei einem abgesagten Termin sagen, um wie viele
            -- Personen es ging, ohne registered_count umzudeuten.
            --
            -- NICHT total_participants nehmen: Die Zahl meint ausdruecklich
            -- ALLE Buchungen einschliesslich Team-Seite und ist damit eine
            -- andere Groesse als die Konfi-Zahl daneben.
            COALESCE(ebs.konfi_opted_out, 0)
              + COALESCE(ebs.konfi_excused, 0) as abgemeldet_count
          FROM event_booking_stats ebs
          WHERE ebs.event_id = e.id
        ) bstats ON true
        LEFT JOIN LATERAL (
          -- Wie viele beim Zuruecknehmen der Absage wieder angemeldet wuerden
          -- ADDITIV -- fuer die Rueckfrage vor dem
          -- Zuruecknehmen. Auch in DIESER Liste, nicht nur in
          -- GET /events/cancelled: Die Leitungsansicht nimmt ihren Termin
          -- von hier. Das Feld BLEIBT stehen, auch seit das Zuruecknehmen
          -- am selben Tag auf requireAdmin umgestellt wurde -- ein einmal
          -- geliefertes Feld wegzunehmen bricht ausgelieferte App-Fassungen.
          -- Begruendung, warum nicht aus konfi_excused/teamer_excused: dort.
          SELECT COUNT(*)::int as anzahl
          FROM event_bookings eb
          JOIN users u ON eb.user_id = u.id AND u.deleted_at IS NULL
          WHERE eb.event_id = e.id AND eb.abgemeldet_durch_absage = TRUE
        ) absage_abm ON true
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
                STRING_AGG(DISTINCT j.name, ', ') as jahrgang_names,
                -- Wer abgesagt hat (Migration 150), ADDITIV. e.* bringt
                -- cancelled_reason und cancelled_by mit, nur der Name fehlt.
                -- LEFT JOIN: Termine, die vor der Migration abgesagt wurden,
                -- haben keinen Urheber und muessen trotzdem in der Liste
                -- stehen -- gerade hier, wo ausschliesslich Altbestand liegt.
                u_cancel.display_name as cancelled_by_name,
                -- Wer den GRUND zuletzt gesetzt hat (Migration 152) -- gerade
                -- in dieser Liste relevant: Hier stehen ausschliesslich
                -- abgesagte Termine, und hier wird nachgetragen.
                u_grund.display_name as cancelled_reason_set_by_name,
                -- Wie viele beim Zuruecknehmen der Absage wieder angemeldet
                -- wuerden, ADDITIV. Die Rueckfrage vor dem
                -- Zuruecknehmen kuendigt genau diese Zahl an -- sie schickt
                -- allen einen Push, und wer sie ausloest, soll vorher wissen,
                -- wie viele Leute das erreicht.
                --
                -- NICHT aus konfi_excused + teamer_excused: Die zaehlen JEDE
                -- Abmeldung, auch die einzelne von vor der Absage. Genau die
                -- bleibt beim Zuruecknehmen aber abgemeldet und bekommt
                -- keinen Push. Die Zahl muss dasselbe meinen wie die Auswahl
                -- der Route, sonst kuendigt die Rueckfrage etwas anderes an,
                -- als dann passiert.
                --
                -- Eigenes LATERAL statt eines weiteren JOINs: event_bookings
                -- haengt hier schon an keiner Stelle dran, und ein JOIN
                -- vervielfachte die Zeilen, die STRING_AGG oben gruppiert.
                COALESCE(absage_abm.anzahl, 0) as durch_absage_abgemeldet_count
        FROM events e
        LEFT JOIN users u_cancel ON e.cancelled_by = u_cancel.id
        LEFT JOIN users u_grund ON e.cancelled_reason_set_by = u_grund.id
        LEFT JOIN event_booking_stats ebs ON ebs.event_id = e.id
        LEFT JOIN LATERAL (
          -- Geloeschte Konten zaehlen nicht mit: Sie bekommen keinen Push
          -- (getTokensForUser filtert sie) und stehen in keiner Liste.
          SELECT COUNT(*)::int as anzahl
          FROM event_bookings eb
          JOIN users u ON eb.user_id = u.id AND u.deleted_at IS NULL
          WHERE eb.event_id = e.id AND eb.abgemeldet_durch_absage = TRUE
        ) absage_abm ON true
        LEFT JOIN event_categories ec ON e.id = ec.event_id
        LEFT JOIN categories c ON ec.category_id = c.id
        LEFT JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
        LEFT JOIN jahrgaenge j ON eja.jahrgang_id = j.id
        WHERE e.organization_id = $1 AND e.cancelled = TRUE
        -- Die ebs-Spalten muessen ins GROUP BY: Das STRING_AGG fuer Kategorien
        -- und Jahrgaenge verlangt es, und die View liefert pro Termin genau
        -- eine Zeile, gruppiert also nichts zusammen.
        -- u_cancel.display_name muss mit ins GROUP BY: Der Name ist kein
        -- Aggregat, und e.id allein deckt ihn nicht ab (Postgres erkennt die
        -- funktionale Abhaengigkeit nur ueber den Primaerschluessel DER
        -- gruppierten Tabelle, nicht ueber einen mitgejointen).
        -- u_grund.display_name aus demselben Grund (Migration 152): Auch er
        -- kommt aus einer mitgejointen Tabelle.
        -- absage_abm.anzahl ebenso: Der Zaehler kommt aus einem
        -- LATERAL und ist fuer Postgres kein Aggregat DIESER Abfrage.
        GROUP BY e.id, ebs.konfi_confirmed, ebs.konfi_waitlist, ebs.konfi_offen,
                 ebs.teamer_confirmed, ebs.teamer_waitlist, ebs.teamer_offen,
                 u_cancel.display_name, u_grund.display_name, absage_abm.anzahl
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
               -- Absagegrund und Urheber (Migration 150), ADDITIV: drei neue
               -- Felder, kein bestehendes aendert Form oder Typ. Die
               -- Detailansicht hat im Gegensatz zur Liste eine feste
               -- Spaltenliste, deshalb muessen sie hier ausdruecklich dazu.
               -- Der Name kommt per LEFT JOIN (NULL = unbekannt, siehe
               -- Migration 150 -- kein Backfill fuer Altabsagen).
               e.cancelled_reason, e.cancelled_by, u_cancel.display_name as cancelled_by_name,
               -- Wer den GRUND zuletzt gesetzt hat (Migration 152), samt
               -- Zeitpunkt -- dieselbe Begruendung wie eine Zeile hoeher.
               e.cancelled_reason_set_by, e.cancelled_reason_set_at,
               u_grund.display_name as cancelled_reason_set_by_name,
               -- Wie viele beim Zuruecknehmen der Absage wieder angemeldet
               -- wuerden, ADDITIV -- fuer die Rueckfrage vor dem
               -- Zuruecknehmen. Begruendung ausfuehrlich bei GET
               -- /events/cancelled: nicht aus konfi_excused/teamer_excused,
               -- weil die auch die einzeln Abgemeldeten zaehlen, die
               -- abgemeldet BLEIBEN.
               COALESCE(absage_abm.anzahl, 0) as durch_absage_abgemeldet_count,
               ${anmeldeStatusSql({
                 kapazitaet: kapazitaetSql('timeslot_capacity.total_capacity'),
                 bestaetigt: 'COALESCE(bstats.registered_count, 0)',
                 warteliste: 'COALESCE(bstats.waitlist_count, 0)'
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
                      AND COALESCE(bstats.teamer_count, 0) >= e.teamer_max_participants
                      AND (NOT e.teamer_waitlist_enabled
                           OR COALESCE(bstats.teamer_waitlist_count, 0) >= COALESCE(e.teamer_max_waitlist_size, 0))
                   THEN 'closed'
                 WHEN COALESCE(e.teamer_max_participants, 0) > 0
                      AND COALESCE(bstats.teamer_count, 0) >= e.teamer_max_participants
                   THEN 'waitlist'
                 ELSE 'open'
               END as teamer_registration_status
        FROM events e
        LEFT JOIN users u_cancel ON e.cancelled_by = u_cancel.id
        LEFT JOIN users u_grund ON e.cancelled_reason_set_by = u_grund.id
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
          -- Geloeschte Konten zaehlen nicht mit: Sie bekommen keinen Push
          -- und stehen in keiner Liste.
          SELECT COUNT(*)::int as anzahl
          FROM event_bookings eb
          JOIN users u ON eb.user_id = u.id AND u.deleted_at IS NULL
          WHERE eb.event_id = e.id AND eb.abgemeldet_durch_absage = TRUE
        ) absage_abm ON true
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
                r.name as role_name,
                -- Urheber der Anwesenheit (Migration 148), ADDITIV: eb.* bringt
                -- attendance_set_by/_at schon mit, der Name fehlt aber. LEFT
                -- JOIN, weil NULL hier "unbekannt" heisst -- Bestandszeilen und
                -- Selbst-Check-ins per QR-Code haben keinen. Ein INNER JOIN
                -- wuerde genau die Buchungen aus der Liste werfen.
                u_att.display_name as attendance_set_by_name,
                -- Urheber der NOTIZ (Migration 149), getrennt gefuehrt: Wer
                -- die Notiz geschrieben hat, muss nicht die Person sein, die
                -- den Status gesetzt hat. Ebenfalls LEFT JOIN und aus
                -- demselben Grund -- eine Buchung ohne Notiz-Urheber (keine
                -- Notiz, oder eine von vor der Migration) bleibt in der Liste.
                u_note.display_name as note_set_by_name
        FROM event_bookings eb
        JOIN users u ON eb.user_id = u.id
        LEFT JOIN users u_att ON eb.attendance_set_by = u_att.id
        LEFT JOIN users u_note ON eb.note_set_by = u_note.id
        LEFT JOIN roles r ON u.role_id = r.id
        LEFT JOIN konfi_profiles kp ON u.id = kp.user_id
        LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
        LEFT JOIN event_timeslots et ON eb.timeslot_id = et.id
        -- ORG-FILTER AN DER BUCHUNG, NICHT AN DER PERSON.
        --
        -- Hier stand u.organization_id = $2 -- die HEIMAT-Organisation aus
        -- der users-Tabelle. Wer per Org-Wechsel arbeitet (Multi-Org,
        -- X-Active-Organization), traegt dort eine ANDERE Org als die aktive
        -- und fiel damit aus der Teilnehmerliste des eigenen Termins heraus.
        --
        -- Und weil booking_status weiter unten aus GENAU DIESEM Array
        -- abgeleitet wird, hingen beide Symptome an derselben Zeile: Der
        -- Zusage-Knopf blieb auf "noch nichts entschieden" stehen.
        --
        -- eb.organization_id ist der richtige Anker: Die Buchung selbst
        -- traegt die Organisation (eigene Spalte mit Index und
        -- Fremdschluessel). Der Riegel BLEIBT damit bestehen -- er sitzt nur
        -- an der richtigen Zeile. Ein Termin zeigt weiterhin ausschliesslich
        -- Buchungen seiner eigenen Gemeinde.
        WHERE eb.event_id = $1 AND eb.organization_id = $2 AND u.deleted_at IS NULL
        ORDER BY
          -- 'excused' steht hier AUSDRUECKLICH und nicht nur im ELSE: Der
          -- ELSE-Zweig traefe zwar dieselbe Zahl, sagt aber nicht, dass es so
          -- gemeint ist. Wer die Reihenfolge spaeter aendert, soll sehen,
          -- dass Abgemeldete absichtlich dort unten sitzen.
          CASE eb.status
            WHEN 'confirmed' THEN 1
            WHEN 'waitlist' THEN 2
            WHEN 'excused' THEN 3
            WHEN 'opted_out' THEN 3
            ELSE 3
          END,
          eb.created_at ASC
      `;
      const { rows: participants } = await db.query(participantsQuery, [eventId, req.user.organization_id]);
      
      // Get series events if this is part of a series
      let seriesEvents = [];
      if (event.is_series && event.series_id) {
        // Zahlen aus event_booking_stats statt aus einer eigenen Kopie
        // Die alte Abfrage war die letzte Stelle, an der
        // `registered_count` etwas anderes hiess als ueberall sonst:
        //
        //   COUNT(eb.id) ... LEFT JOIN event_bookings eb ON eb.status = 'confirmed'
        //
        // Kein Rollenfilter -- Teamer und zugeordnete Leitung zaehlten als
        // Konfis mit. Kein deleted_at-Filter -- die Buchung eines geloeschten
        // Kontos zaehlte weiter. Angezeigt wird die Zahl in der Serienliste
        // des Termindetails als "N/max TN", mit demselben Wort und demselben
        // Nenner wie die Kachel darueber, die nur Konfis meint. Ein
        // Serientermin mit 19 Konfis und 4 Teamer:innen meldete dort 23.
        //
        // Das ist derselbe Fehler, den Migration 128 fuer fuenf Endpunkte
        // behoben hat; diese Stelle wurde damals uebersehen.
        const seriesQuery = `
          SELECT e.*, COALESCE(ebs.konfi_confirmed, 0) as registered_count
          FROM events e
          LEFT JOIN event_booking_stats ebs ON ebs.event_id = e.id
          WHERE e.series_id = $1 AND e.organization_id = $2 AND e.id != $3
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
