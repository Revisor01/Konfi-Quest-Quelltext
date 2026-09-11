const { addToEventChat } = require('./eventChat');

// Shared Booking-Logik für Event-Buchungen
// Wird von konfi.js und events.js genutzt
// Keine Push-Notifications oder liveUpdate-Aufrufe — nur Datenbank-Logik

/**
 * Prueft ob ein User bereits für ein Event gebucht ist
 * @param {object} client - DB-Client (innerhalb Transaktion)
 * @param {number} userId - User ID
 * @param {number} eventId - Event ID
 * @returns {object|null} Booking-Objekt oder null
 */
async function checkExistingBooking(client, userId, eventId) {
  const { rows: [existing] } = await client.query(
    'SELECT id, status FROM event_bookings WHERE user_id = $1 AND event_id = $2',
    [userId, eventId]
  );
  return existing || null;
}

/**
 * Bestimmt den Buchungsstatus basierend auf Kapazität und Warteliste
 *
 * Rollenagnostisch: über `options` laesst sich waehlen, welche Wartelisten-
 * Felder des Events gelten. Für das Teamer-Kontingent sind das
 * teamer_waitlist_enabled / teamer_max_waitlist_size, für Konfis die
 * unpraefixierten Felder.
 *
 * @param {object} event - Event-Objekt
 * @param {number} confirmedCount - Anzahl bestaetigter Buchungen
 * @param {number} waitlistCount - Anzahl Wartelisten-Eintraege
 * @param {number} maxCapacity - Maximale Kapazität (0 = unbegrenzt)
 * @param {object} options - { waitlistEnabledField, maxWaitlistSizeField }
 * @returns {string|object} 'confirmed', 'waitlist', oder { error: string, status: number }
 */
function determineBookingStatus(event, confirmedCount, waitlistCount, maxCapacity, options = {}) {
  const {
    waitlistEnabledField = 'waitlist_enabled',
    maxWaitlistSizeField = 'max_waitlist_size'
  } = options;

  const waitlistEnabled = event[waitlistEnabledField];
  const maxWaitlistSize = event[maxWaitlistSizeField] || 10;

  // 0 = unbegrenzt
  if (maxCapacity > 0 && confirmedCount >= maxCapacity) {
    if (waitlistEnabled && waitlistCount < maxWaitlistSize) {
      return 'waitlist';
    }
    // Kein Platz und keine Warteliste oder Warteliste voll
    if (!waitlistEnabled) {
      return { error: 'Das Event ist leider bereits ausgebucht', status: 400 };
    }
    return { error: 'Event ist voll und Warteliste ist auch voll', status: 400 };
  }
  return 'confirmed';
}

/**
 * Wache gegen den haeufigsten Fehlaufruf: Pool statt Client.
 *
 * Ein Pool hat kein `release()`. Der Unterschied ist sonst unsichtbar — beide
 * haben `query()` — und faellt erst im Betrieb auf, wenn eine Transaktion
 * nicht greift.
 */
function verlangeClient(kandidat, wer) {
  if (!kandidat || typeof kandidat.release !== 'function') {
    throw new Error(
      `${wer} braucht einen Client aus db.getClient(), keinen Pool — `
      + 'sonst laeuft der Aufruf ausserhalb der Transaktion.'
    );
  }
}

/**
 * Nimmt die Event-Punkte eines Konfis zurueck, wenn seine Anwesenheit
 * rueckgaengig gemacht wird.
 *
 * Lag vorher viermal als kopierter Block herum — zweimal transaktional,
 * zweimal nicht. Dieselbe Diagnose wie beim Chat-Eintritt weiter unten: Als
 * Kopie war die Regel schon einmal auseinandergelaufen.
 *
 * Der gefaehrliche Riss sitzt zwischen den beiden Schreibzugriffen: Ist die
 * `event_points`-Zeile geloescht, der Saldo aber noch nicht verringert,
 * behaelt der Konfi Punkte, fuer die es keinen Beleg mehr gibt — nicht mehr
 * rekonstruierbar. Deshalb verlangt diese Funktion einen Client.
 *
 * @param {object} client - DB-Client aus db.getClient(), NICHT der Pool
 * @param {number} userId
 * @param {number} eventId
 * @returns {{points: number, point_type: string}|null} was zurueckgenommen wurde
 */
async function takeBackEventPoints(client, userId, eventId) {
  verlangeClient(client, 'takeBackEventPoints');

  const { rows: [pts] } = await client.query(
    'SELECT id, points, point_type FROM event_points WHERE konfi_id = $1 AND event_id = $2',
    [userId, eventId]
  );
  if (!pts) return null;

  await client.query('DELETE FROM event_points WHERE id = $1', [pts.id]);

  // GREATEST(0, ...) faengt den Unterlauf ab — aber nicht die Doppelbuchung.
  // Dagegen hilft nur die Sperre auf der Buchungszeile beim Aufrufer.
  const profilUpdate = pts.point_type === 'gottesdienst'
    ? 'UPDATE konfi_profiles SET gottesdienst_points = GREATEST(0, gottesdienst_points - $1) WHERE user_id = $2'
    : 'UPDATE konfi_profiles SET gemeinde_points = GREATEST(0, gemeinde_points - $1) WHERE user_id = $2';
  await client.query(profilUpdate, [pts.points, userId]);

  return { points: pts.points, point_type: pts.point_type };
}

/**
 * Rueckt den ersten Wartelisten-Eintrag nach (timeslot-aware, rollen-gefiltert)
 *
 * WICHTIG: roleFilter ist PFLICHT-relevant, seit Events ein eigenes
 * Teamer-Kontingent haben. Konfi- und Teamer-Warteliste sind strikt getrennt:
 * ein frei gewordener Konfi-Platz darf NIEMALS von einem Teamer belegt werden
 * und umgekehrt. Ohne Filter wuerde die FIFO-Reihenfolge beide Wartelisten
 * vermischen.
 *
 * Der Doc-Kommentar sagte frueher "Pool oder Client" — und genau das ist
 * zweimal passiert: `events.js` (Teilnehmer entfernen) und `konfi.js`
 * (Abmelden) uebergaben den Pool. Syntaktisch geht das, semantisch nicht:
 * Der FOR-UPDATE-Lock unten faellt dann am Ende des Statements statt am Ende
 * der Transaktion, der vorausgegangene Kapazitaets-Check lief in einer
 * anderen impliziten Transaktion, und `addToEventChat` landet womoeglich auf
 * einer anderen Verbindung. Moegliche Folge: elf Bestaetigte auf zehn
 * Plaetzen, weil zwischen Check und Nachruecken jemand buchen kann.
 *
 * Die Wache faengt den Fehlaufruf beim ersten Testlauf statt im Betrieb.
 *
 * @param {object} db - DB-Client aus db.getClient(), NICHT der Pool
 * @param {number} eventId - Event ID
 * @param {number|null} timeslotId - Timeslot ID (null für Events ohne Timeslots)
 * @param {'teamer'|'not_teamer'} roleFilter - Welche Warteliste nachruecken soll
 * @returns {number|null} User-ID des nachgerueckten Users oder null
 */
async function promoteFromWaitlist(db, eventId, timeslotId, roleFilter) {
  verlangeClient(db, 'promoteFromWaitlist');
  if (roleFilter !== 'teamer' && roleFilter !== 'not_teamer') {
    throw new Error(`promoteFromWaitlist: roleFilter muss 'teamer' oder 'not_teamer' sein (war: ${roleFilter})`);
  }
  // Rollen-Bedingung: Team-Warteliste vs. Konfi-Warteliste.
  // 'teamer' meint hier das TEAM-Kontingent — Teamer:innen und die einem
  // Termin zugeordneten Admins. Wuerde weiter strikt auf
  // r.name = 'teamer' gefiltert, faende ein frei werdender Team-Platz eine
  // wartende Admin-Buchung nie: genau die tote Buchung, gegen die dieser
  // Filter ueberhaupt eingefuehrt wurde.
  // Geloeschte User (deleted_at) ruecken nie nach.
  const roleCondition = roleFilter === 'teamer'
    ? `EXISTS (SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id
                WHERE u.id = eb.user_id AND r.name <> 'konfi' AND u.deleted_at IS NULL)`
    : `EXISTS (SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id
                WHERE u.id = eb.user_id AND r.name = 'konfi' AND u.deleted_at IS NULL)`;

  // Atomar: SELECT des nächsten Wartelisten-Eintrags und UPDATE in EINEM Statement.
  // FOR UPDATE SKIP LOCKED verhindert, dass zwei gleichzeitige Stornierungen
  // denselben Wartelistenplatz nachruecken (Race -> Doppel-Promotion über Kapazität).
  const subSelect = timeslotId
    ? `SELECT eb.id FROM event_bookings eb
        WHERE eb.event_id = $1 AND eb.timeslot_id = $2 AND eb.status = 'waitlist'
          AND ${roleCondition}
        ORDER BY eb.created_at ASC LIMIT 1 FOR UPDATE OF eb SKIP LOCKED`
    : `SELECT eb.id FROM event_bookings eb
        WHERE eb.event_id = $1 AND eb.status = 'waitlist'
          AND ${roleCondition}
        ORDER BY eb.created_at ASC LIMIT 1 FOR UPDATE OF eb SKIP LOCKED`;
  const params = timeslotId ? [eventId, timeslotId] : [eventId];

  // war_auf_warteliste haelt fest, was dieses UPDATE ueberschreibt (Migration
  // 145): Nach dem Wechsel auf 'confirmed' ist sonst nicht mehr erkennbar,
  // dass diese Person gewartet hat. Der Jahresrueckblick erzaehlt daraus
  // "du hast gewartet -- und bist reingekommen"; ohne die Spalte ginge die
  // Information im Moment des Nachrueckens verloren.
  const { rows: [promoted] } = await db.query(
    `UPDATE event_bookings SET status = 'confirmed', war_auf_warteliste = true
     WHERE id = (${subSelect})
     RETURNING user_id, organization_id`,
    params
  );

  if (!promoted) return null;

  // Wer nachrueckt, gehört auch in den Chat zum Termin. Bewusst hier und nicht
  // an den vier Aufrufstellen: Als kopierter Block war genau diese Regel schon
  // einmal auseinandergelaufen.
  await addToEventChat(db, eventId, promoted.user_id, promoted.organization_id);

  return promoted.user_id;
}

/**
 * Prueft ob das Anmeldezeitraum für ein Event offen ist
 * @param {object} event - Event-Objekt mit registration_opens_at und registration_closes_at
 * @returns {object} { valid: boolean, error?: string }
 */
function validateRegistrationWindow(event) {
  const now = new Date();
  if (event.registration_opens_at && now < new Date(event.registration_opens_at)) {
    return { valid: false, error: 'Anmeldung noch nicht geöffnet' };
  }
  if (event.registration_closes_at && now > new Date(event.registration_closes_at)) {
    return { valid: false, error: 'Anmeldung bereits geschlossen' };
  }
  return { valid: true };
}

/**
 * Ist das Event JETZT für Konfis anmeldbar? Grundlage für den
 * "Anmeldung möglich"-Push. Anmeldbar = Anmeldefenster offen UND nicht abgesagt
 * UND nicht reines Teamer-Event (Konfis können sich da nicht anmelden).
 * @param {object} event - Event mit registration_opens_at/closes_at, cancelled, teamer_only
 * @returns {boolean}
 */
function isRegistrationOpenForKonfis(event) {
  if (event.cancelled) return false;
  if (event.teamer_only) return false;
  return validateRegistrationWindow(event).valid;
}


// ====================================================================
// EINE ZAEHLUNG, EIN BUCHUNGSKERN
// ====================================================================
//
// Vorher zaehlten die Schreibpfade dieselbe Zahl an sechs Stellen mit
// mindestens fuenf Bedeutungen: mal ohne `deleted_at`-Filter (geloeschte
// Konten belegten Plaetze), mal `r.name <> 'teamer'` (die zugeordnete
// Leitung zaehlte gegen das Konfi-Kontingent), mal `r.name = 'teamer'`
// (die Leitung fiel aus dem Team-Kontingent heraus). Verbindlich ist
// seit Migration 136 allein die Sicht `event_booking_stats`:
//
//   konfi_*  = ausschliesslich Konfis
//   teamer_* = das TEAM-Kontingent, also Teamer:innen UND zugeordnete Leitung
//   geloeschte Konten (users.deleted_at) zaehlen nie mit
//
// `zaehleBuchungen` ist die einzige Stelle, die diese Bedeutung in SQL
// giesst. Wer sie aendert, aendert die Bedeutung ueberall gleichzeitig —
// genau das ist der Zweck.
//
//   'opted_out' setzen NUR die beiden Wege, bei denen die Absage selbst eine
//   Aussage ist, die die Leitung sehen soll:
//     1. der Konfi-Opt-out von PFLICHTterminen (konfi.js POST /events/:id/
//        opt-out) — die Konfi wurde automatisch eingeschrieben und traegt
//        sich begruendet aus; die Zeile bleibt stehen, damit die Leitung
//        Abmeldung und Grund sieht.
//     2. die Teamer-Absage ("Ich bin nicht dabei", setzeTeamerZusage unten)
//        — eine Absage ist hier eine eigene, sichtbare Rueckmeldung und
//        gerade NICHT dasselbe wie "hat noch nicht reagiert".
//
//   Die SELBST-Abmeldung von freiwilligen Terminen (DELETE /events/:id/book,
//   DELETE /konfi/events/:id/register) LOESCHT die Zeile dagegen und
//   protokolliert in `event_unregistrations` — dort ist die Person danach
//   wieder "offen" und kann regulaer neu buchen.
//
//   Fuer die Zaehlung ist beides gleich: opted_out zaehlt in zaehleBuchungen
//   und in der View event_booking_stats NIE als belegter Platz — eine Absage
//   gibt den Platz frei.

/** Rollenbedingung fuer eine Kontingent-Seite, View-konform (Migration 136). */
function rollenBedingung(seite, alias = 'eb') {
  if (seite !== 'konfi' && seite !== 'team') {
    throw new Error(`zaehleBuchungen: seite muss 'konfi' oder 'team' sein (war: ${seite})`);
  }
  // COALESCE wie in der View: fehlt die Rollenzeile, faellt die Buchung auf
  // die Team-Seite und belegt keinen Konfi-Platz.
  const rollenTest = seite === 'konfi'
    ? "r.name = 'konfi'"
    : "COALESCE(r.name, '') <> 'konfi'";
  return `EXISTS (
    SELECT 1 FROM users u LEFT JOIN roles r ON u.role_id = r.id
     WHERE u.id = ${alias}.user_id AND u.deleted_at IS NULL AND ${rollenTest}
  )`;
}

/**
 * Zaehlt bestaetigte Buchungen und Wartende einer Kontingent-Seite.
 *
 * Semantik identisch zur Sicht `event_booking_stats` (Migration 136):
 * `seite: 'konfi'` liefert konfi_confirmed/konfi_waitlist,
 * `seite: 'team'`  liefert teamer_confirmed/teamer_waitlist.
 *
 * @param {object} db - Client ODER Pool (reine Lesefrage)
 * @param {object} bereich - { eventId } oder { timeslotId } — genau eines
 * @param {'konfi'|'team'} seite
 * @param {object} optionen - { ausserUserId } schliesst die eigene Buchung aus
 * @returns {{confirmed: number, waitlist: number}}
 */
async function zaehleBuchungen(db, bereich, seite, optionen = {}) {
  const { eventId = null, timeslotId = null } = bereich || {};
  if ((eventId === null) === (timeslotId === null)) {
    throw new Error('zaehleBuchungen: genau eines von eventId/timeslotId angeben');
  }
  const { ausserUserId = null } = optionen;

  const params = [eventId !== null ? eventId : timeslotId];
  const bereichsTest = eventId !== null ? 'eb.event_id = $1' : 'eb.timeslot_id = $1';
  let eigeneRaus = '';
  if (ausserUserId !== null) {
    params.push(ausserUserId);
    eigeneRaus = ` AND eb.user_id <> $${params.length}`;
  }

  const { rows: [z] } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE eb.status = 'confirmed')::int AS confirmed,
            COUNT(*) FILTER (WHERE eb.status = 'waitlist')::int  AS waitlist
       FROM event_bookings eb
      WHERE ${bereichsTest}${eigeneRaus} AND ${rollenBedingung(seite)}`,
    params
  );
  return { confirmed: z.confirmed, waitlist: z.waitlist };
}

/**
 * Nur die bestaetigten einer Kontingent-Seite — fuer die Nachrueck-Pruefung.
 */
async function zaehleBestaetigte(db, bereich, seite) {
  const { confirmed } = await zaehleBuchungen(db, bereich, seite);
  return confirmed;
}

/**
 * Darf diese Teamer:in an den Jahrgang dieses Termins?
 *
 * Der Chat hielt sich daran (routes/chat.js ueber utils/jahrgangsZugriff), die
 * Buchung nicht: Beide Buchungswege prueften nur teamer_needed/teamer_only und
 * die Kapazitaet. In Produktion nachgemessen: EIN Fall, ein
 * Teamer ohne jede Zuweisung hatte einen Jahrgangstermin gebucht.
 *
 * AN EINEM ORT, weil es ZWEI Wege zur selben Buchung gibt: bucheTermin
 * (POST /events/:id/book) und setzeTeamerZusage
 * (POST /teamer/events/:id/zusage). Stuende die Pruefung nur im ersten, liesse
 * sie sich ueber den zweiten umgehen -- genau das Auseinanderlaufen, das
 * diesen Baustein ueberhaupt hervorgebracht hat.
 *
 * Zwei Ausnahmen, beide bewusst:
 *   - 'Nur Team' (teamer_only): betrifft keinen Jahrgang, die Regel nennt das
 *     ausdruecklich.
 *   - Ein Termin OHNE jede Jahrgangs-Zuordnung: Es gibt nichts zu schuetzen,
 *     ein solcher Termin gilt der ganzen Gemeinde.
 *
 * org_admin und super_admin bleiben ausgenommen -- dieselbe Semantik wie in
 * utils/jahrgangsZugriff.js (darfJahrgang), nur hier in SQL, weil an dieser
 * Stelle kein req vorliegt.
 *
 * @param {object} client   Client in laufender Transaktion
 * @param {object} event    Termin-Zeile (braucht teamer_only)
 * @param {number} userId
 * @returns {Promise<boolean>} true = darf buchen
 */
async function darfTeamerAnDiesenTermin(client, event, userId) {
  if (event.teamer_only) return true;
  const { rows: [zugang] } = await client.query(
    `SELECT
       EXISTS (SELECT 1 FROM event_jahrgang_assignments WHERE event_id = $1) AS hat_jahrgang,
       EXISTS (
         SELECT 1 FROM event_jahrgang_assignments eja
         JOIN user_jahrgang_assignments uja
           ON uja.jahrgang_id = eja.jahrgang_id AND uja.user_id = $2
         WHERE eja.event_id = $1
       ) AS darf,
       EXISTS (
         SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id
         WHERE u.id = $2 AND (r.name IN ('org_admin', 'super_admin') OR u.is_super_admin = true)
       ) AS vollzugriff`,
    [event.id, userId]
  );
  if (!zugang) return true;
  return !zugang.hat_jahrgang || zugang.darf || zugang.vollzugriff;
}

const JAHRGANG_FREMD = 'Dieser Termin gehört zu einem Jahrgang, dem du nicht zugewiesen bist';

/**
 * DER Buchungskern: eine Selbst-Anmeldung, komplett.
 *
 * Die HUELLEN der beiden Routen bleiben unveraendert (Pfade, Statuscodes,
 * Antwortfelder, Push- und Live-Update-Verhalten). Nur die Entscheidung,
 * OB und mit welchem Status gebucht wird, liegt ab hier an einer Stelle.
 *
 * ERWARTET EINEN CLIENT in laufender Transaktion (BEGIN vorher, COMMIT
 * danach) — der Kern sperrt Event- und Slot-Zeile mit FOR UPDATE, und
 * diese Sperren halten nur bis zum Ende der Transaktion.
 *
 * @param {object} client - Client aus db.getClient(), NICHT der Pool
 * @param {object} eingabe - { eventId, userId, orgId, rolle: 'konfi'|'teamer', timeslotId }
 * @returns {{ok: true, bookingId: number, status: string, event: object, timeslot: object|null, waitlistPosition: number}
 *          |{ok: false, status: number, error: string, error_code?: string}}
 */
async function bucheTermin(client, eingabe) {
  verlangeClient(client, 'bucheTermin');
  const { eventId, userId, orgId, rolle } = eingabe;
  const timeslotId = eingabe.timeslotId ?? null;

  if (rolle !== 'konfi' && rolle !== 'teamer') {
    throw new Error(`bucheTermin: rolle muss 'konfi' oder 'teamer' sein (war: ${rolle})`);
  }

  const fehler = (status, error, error_code) =>
    error_code ? { ok: false, status, error, error_code } : { ok: false, status, error };

  // 1. Termin sperren. Der Gemeinde-Filter gehoert in DIESE Abfrage: eine
  //    fremde Termin-ID darf nie bis zur Buchung durchkommen.
  const { rows: [event] } = await client.query(
    `SELECT id, name, description, event_date, event_end_time, location, points, point_type,
            type, max_participants, registration_opens_at, registration_closes_at,
            has_timeslots, waitlist_enabled, max_waitlist_size,
            teamer_max_participants, teamer_waitlist_enabled, teamer_max_waitlist_size,
            is_series, series_id, mandatory, is_konfirmation, bring_items, checkin_window,
            teamer_needed, teamer_only, cancelled, created_by, organization_id
       FROM events WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
    [eventId, orgId]
  );
  if (!event) return fehler(404, 'Event nicht gefunden');

  // 2. Doppelbuchung — vor allen fachlichen Pruefungen, damit ein zweiter
  //    Versuch immer 409 meldet und nicht je nach Termin etwas anderes.
  //
  //    Bewusst NUR auf der Team-Seite: Konfis nehmen eine Pflicht-Abmeldung
  //    ueber POST /konfi/events/:id/opt-in zurueck (eigene Regeln, eigener
  //    Push an die Leitung) — dieser Weg bleibt fuer sie der einzige.
  const vorhanden = await checkExistingBooking(client, userId, eventId);
  const reaktivierung = !!vorhanden && vorhanden.status === 'opted_out' && rolle === 'teamer';
  if (vorhanden && !reaktivierung) {
    return fehler(409, 'Du bist bereits für dieses Event angemeldet');
  }

  // ---------- TEAM-SEITE ----------
  // Bewusst weiterhin OHNE Zeitslot und OHNE Anmeldefenster: Teamer:innen
  // duerfen sich jederzeit melden, begrenzt wird nur die Anzahl.
  if (rolle === 'teamer') {
    if (!event.teamer_needed && !event.teamer_only) {
      return fehler(403, 'Dieses Event ist nicht für das Team buchbar');
    }

    // Jahrgangsgrenze -- Begruendung bei darfTeamerAnDiesenTermin.
    if (!(await darfTeamerAnDiesenTermin(client, event, userId))) {
      return fehler(403, JAHRGANG_FREMD);
    }

    const zahlen = await zaehleBuchungen(client, { eventId }, 'team');
    const ergebnis = determineBookingStatus(
      event, zahlen.confirmed, zahlen.waitlist, event.teamer_max_participants || 0,
      { waitlistEnabledField: 'teamer_waitlist_enabled', maxWaitlistSizeField: 'teamer_max_waitlist_size' }
    );
    if (typeof ergebnis === 'object') return fehler(ergebnis.status, ergebnis.error);

    let neu;
    if (reaktivierung) {
      // Absage zuruecknehmen: Zeile aktualisieren statt neu anlegen. Grund,
      // Absage-Datum und das Kennzeichen "nach Zusage abgesagt" werden
      // geleert — die neue Zusage ersetzt die Absage, sie ergaenzt sie nicht
      // (gleiches Verhalten wie setzeTeamerZusage bei dabei=true).
      // booking_date auf NOW(): Fuer Warteliste und Nachruecken zaehlt die
      // NEUE Entscheidung, nicht der Zeitpunkt der zurueckgenommenen.
      ({ rows: [neu] } = await client.query(
        `UPDATE event_bookings
            SET status = $3, booking_date = NOW(),
                opt_out_reason = NULL, opt_out_date = NULL,
                absage_nach_zusage = false
          WHERE id = $4 AND user_id = $2 AND event_id = $1
          RETURNING id`,
        [eventId, userId, ergebnis, vorhanden.id]
      ));
    } else {
      ({ rows: [neu] } = await client.query(
        `INSERT INTO event_bookings (event_id, user_id, status, booking_date, organization_id)
         VALUES ($1, $2, $3, NOW(), $4) RETURNING id`,
        [eventId, userId, ergebnis, orgId]
      ));
    }
    await addToEventChat(client, eventId, userId, orgId);
    return {
      ok: true, bookingId: neu.id, status: ergebnis, event, timeslot: null,
      waitlistPosition: zahlen.waitlist + 1
    };
  }

  // ---------- KONFI-SEITE ----------
  if (event.teamer_only) return fehler(403, 'Dieses Event ist nur für das Team');
  if (event.cancelled) return fehler(400, 'Dieser Termin ist abgesagt');

  const fenster = validateRegistrationWindow(event);
  if (!fenster.valid) return fehler(400, fenster.error);

  // Konfirmations-Sperre: nur EIN Konfirmationstermin pro Konfi.
  if (event.is_konfirmation) {
    const { rows: [andere] } = await client.query(
      `SELECT e.id, e.name FROM event_bookings eb
         JOIN events e ON e.id = eb.event_id
        WHERE eb.user_id = $1 AND eb.event_id <> $2 AND eb.status = 'confirmed'
          AND e.is_konfirmation = true AND e.organization_id = $3
          AND (e.cancelled IS NULL OR e.cancelled = false)
        LIMIT 1`,
      [userId, eventId, orgId]
    );
    if (andere) {
      return fehler(
        409,
        `Du bist bereits zu einem Konfirmationstermin angemeldet ("${andere.name}"). `
        + 'Melde dich dort zuerst ab, um einen anderen Termin zu wählen.',
        'konfirmation_already_booked'
      );
    }
  }

  // Kapazitaet. Bei Zeitslot-Terminen zaehlt der SLOT, nicht der Termin —
  // sonst gilt ein voller Slot als "noch Platz", weil die Summe Luft hat.
  let slot = null;
  let zahlen;
  let obergrenze;
  if (event.has_timeslots) {
    if (!timeslotId) return fehler(400, 'Bitte einen Zeitslot auswählen');
    // FOR UPDATE: verhindert, dass zwei gleichzeitige Buchungen denselben
    // letzten Platz bekommen. organization_id: ein Slot aus einer fremden
    // Gemeinde darf nie akzeptiert werden.
    const { rows: [gefunden] } = await client.query(
      `SELECT id, event_id, start_time, end_time, max_participants, organization_id
         FROM event_timeslots
        WHERE id = $1 AND event_id = $2 AND organization_id = $3 FOR UPDATE`,
      [timeslotId, eventId, orgId]
    );
    if (!gefunden) return fehler(400, 'Ungültiger Zeitslot');
    slot = gefunden;
    zahlen = await zaehleBuchungen(client, { timeslotId }, 'konfi');
    obergrenze = slot.max_participants;
  } else {
    if (timeslotId) return fehler(400, 'Dieses Event hat keine Zeitslots');
    zahlen = await zaehleBuchungen(client, { eventId }, 'konfi');
    obergrenze = event.max_participants;
  }

  const ergebnis = determineBookingStatus(event, zahlen.confirmed, zahlen.waitlist, obergrenze);
  if (typeof ergebnis === 'object') return fehler(ergebnis.status, ergebnis.error);

  // organization_id MUSS gesetzt sein, sonst zaehlen die Abzeichen-Abfragen
  // die Buchung nicht (sie filtern auf organization_id).
  const { rows: [neu] } = await client.query(
    `INSERT INTO event_bookings (event_id, user_id, timeslot_id, status, booking_date, organization_id)
     VALUES ($1, $2, $3, $4, NOW(), $5) RETURNING id`,
    [eventId, userId, timeslotId, ergebnis, orgId]
  );
  await addToEventChat(client, eventId, userId, orgId);

  return {
    ok: true, bookingId: neu.id, status: ergebnis, event, timeslot: slot,
    waitlistPosition: zahlen.waitlist + 1
  };
}

/**
 * Teamer-Zusage/-Absage: "Ich bin dabei" / "Ich bin nicht dabei".
 *
 * Drei Zustaende, alle in event_bookings.status (siehe Regel-Block oben):
 * keine Zeile = offen, confirmed/waitlist = zugesagt, opted_out = abgesagt.
 * Jeder Uebergang ist jederzeit erlaubt — die Meinung darf sich aendern.
 *
 * Eine Absage aus "offen" (noch keine Buchung) oder aus einer frueheren
 * Absage braucht weiterhin KEINEN Grund: Da wird keine Zusage zurueck-
 * genommen, es soll nur die Rueckmeldung ueberhaupt da sein.
 *
 * KAPAZITAET: Die Zusage laeuft ueber dieselben Funktionen wie der regulaere
 * Buchungsweg (zaehleBuchungen/determineBookingStatus, Team-Seite im Sinne
 * von Migration 136). Eine Absage aus 'confirmed' gibt einen Team-Platz frei
 * und laesst — wie die Stornierung — aus der TEAM-Warteliste nachruecken.
 *
 * ERWARTET EINEN CLIENT in laufender Transaktion (wie bucheTermin): Event-
 * Zeile wird mit FOR UPDATE gesperrt, das Nachruecken haengt an der Sperre.
 *
 * @param {object} client - Client aus db.getClient(), NICHT der Pool
 * @param {object} eingabe - { eventId, userId, orgId, dabei: boolean, grund?: string }
 * @returns {{ok: true, status: string, vorherigerStatus: string|null, event: object, promotedUserId: number|null}
 *          |{ok: false, status: number, error: string, error_code?: string}}
 */
async function setzeTeamerZusage(client, eingabe) {
  verlangeClient(client, 'setzeTeamerZusage');
  const { eventId, userId, orgId, dabei } = eingabe;
  const grund = typeof eingabe.grund === 'string' && eingabe.grund.trim()
    ? eingabe.grund.trim().slice(0, 500)
    : null;

  const fehler = (status, error, error_code) =>
    error_code ? { ok: false, status, error, error_code } : { ok: false, status, error };

  // Termin sperren — Gemeinde-Filter in DIESER Abfrage (wie bucheTermin).
  const { rows: [event] } = await client.query(
    `SELECT id, name, event_date, teamer_needed, teamer_only, cancelled,
            teamer_max_participants, teamer_waitlist_enabled, teamer_max_waitlist_size,
            organization_id
       FROM events WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
    [eventId, orgId]
  );
  if (!event) return fehler(404, 'Termin nicht gefunden');
  if (event.cancelled) return fehler(400, 'Dieser Termin ist abgesagt');
  // Nur dort, wo Teamer:innen ueberhaupt gebraucht werden. Bei reinen
  // Konfi-Terminen gibt es nichts zuzusagen.
  if (!event.teamer_needed && !event.teamer_only) {
    return fehler(400, 'Für diesen Termin wird kein Team gesucht');
  }
  if (new Date(event.event_date) <= new Date()) {
    return fehler(400, 'Der Termin liegt bereits in der Vergangenheit');
  }
  // Dieselbe Jahrgangsgrenze wie im Buchungskern -- sonst liesse sich die
  // Sperre ueber diesen zweiten Weg umgehen.
  if (!(await darfTeamerAnDiesenTermin(client, event, userId))) {
    return fehler(403, JAHRGANG_FREMD);
  }

  // Eigene Buchung sperren: Der vorherige Status entscheidet ueber den
  // Grund-Zwang und das Nachruecken — er darf sich zwischen Lesen und
  // Schreiben nicht aendern (zwei gleichzeitige Absagen desselben Kontos
  // wuerden sonst beide nachruecken lassen).
  const { rows: [bestehend] } = await client.query(
    'SELECT id, status FROM event_bookings WHERE user_id = $1 AND event_id = $2 FOR UPDATE',
    [userId, eventId]
  );
  const vorherigerStatus = bestehend ? bestehend.status : null;

  let status;
  let promotedUserId = null;

  if (dabei) {
    // Bei einer ZUSAGE gilt das Teamer-Kontingent genauso wie auf dem
    // regulaeren Buchungsweg. Die eigene bestehende Buchung zaehlt nicht als
    // neuer Platz — sonst koennte man sich durch Absage und erneute Zusage
    // selbst aussperren, obwohl der Platz noch einem gehoert.
    const zahlen = await zaehleBuchungen(client, { eventId }, 'team', { ausserUserId: userId });
    const ergebnis = determineBookingStatus(
      event, zahlen.confirmed, zahlen.waitlist,
      event.teamer_max_participants || 0,
      { waitlistEnabledField: 'teamer_waitlist_enabled', maxWaitlistSizeField: 'teamer_max_waitlist_size' }
    );
    if (typeof ergebnis === 'object') return fehler(ergebnis.status, ergebnis.error);
    status = ergebnis; // 'confirmed' oder 'waitlist'
  } else {
    // DER Grund-Zwang: Absage nach Zusage nur mit Grund. Aus 'offen' oder
    // aus einer frueheren Absage bleibt der Grund freiwillig.
    const hatteZugesagt = vorherigerStatus === 'confirmed' || vorherigerStatus === 'waitlist';
    if (hatteZugesagt && !grund) {
      return fehler(
        400,
        'Du hattest zugesagt — bitte gib einen Grund für deine Absage an, damit die Leitung umplanen kann',
        'grund_erforderlich'
      );
    }
    status = 'opted_out';
  }

  // Vorhandene Buchung aktualisieren oder neu anlegen. absage_nach_zusage
  // haelt fest, ob eine Absage eine Zusage zurueckgenommen hat (Migration
  // 141) — bei jeder neuen Zusage wird es wieder geleert.
  //
  // WIEDERHOLTE Absage (vorher schon opted_out, z.B. Doppelversand aus der
  // Offline-Warteschlange): Grund und Kennzeichen BLEIBEN stehen, wenn kein
  // neuer Grund mitkommt — ein Duplikat darf die erste, begruendete Absage
  // nicht zu einer grundlosen machen. Ein neuer Grund ueberschreibt.
  if (bestehend) {
    const nahmZusageZurueck =
      status === 'opted_out' && (vorherigerStatus === 'confirmed' || vorherigerStatus === 'waitlist');
    await client.query(
      `UPDATE event_bookings
          SET status = $3,
              opt_out_reason = CASE WHEN $3 = 'opted_out' THEN COALESCE($4, opt_out_reason) ELSE NULL END,
              opt_out_date   = CASE WHEN $3 = 'opted_out' THEN NOW() ELSE NULL END,
              absage_nach_zusage = CASE
                WHEN $3 <> 'opted_out' THEN false
                WHEN $5 THEN true
                ELSE absage_nach_zusage
              END
        WHERE id = $6 AND organization_id = $7 AND user_id = $1 AND event_id = $2`,
      [userId, eventId, status, grund, nahmZusageZurueck, bestehend.id, orgId]
    );
  } else {
    await client.query(
      `INSERT INTO event_bookings
         (user_id, event_id, status, organization_id, opt_out_reason, opt_out_date, absage_nach_zusage)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $3 = 'opted_out' THEN NOW() ELSE NULL END, false)`,
      [userId, eventId, status, orgId, status === 'opted_out' ? grund : null]
    );
  }

  // Absage aus 'confirmed' gibt einen TEAM-Platz frei -> aus der Team-
  // Warteliste nachruecken, mit derselben Kapazitaetspruefung wie beim
  // Storno (DELETE /events/:id/book). Teamer-Buchungen haben nie einen
  // Timeslot -> event-weite Zaehlung.
  if (status === 'opted_out' && vorherigerStatus === 'confirmed') {
    const teamerMax = event.teamer_max_participants || 0;
    const teamerBestaetigt = await zaehleBestaetigte(client, { eventId }, 'team');
    if (teamerMax === 0 || teamerBestaetigt < teamerMax) {
      promotedUserId = await promoteFromWaitlist(client, eventId, null, 'teamer');
    }
  }

  return { ok: true, status, vorherigerStatus, event, promotedUserId };
}

module.exports = {
  takeBackEventPoints,
  checkExistingBooking,
  determineBookingStatus,
  promoteFromWaitlist,
  validateRegistrationWindow,
  isRegistrationOpenForKonfis,
  zaehleBuchungen,
  zaehleBestaetigte,
  bucheTermin,
  setzeTeamerZusage
};
