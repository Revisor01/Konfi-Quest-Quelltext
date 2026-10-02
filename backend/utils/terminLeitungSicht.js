// Wer aus Leitung und Team einen Termin sieht, ihn am Verbuchen-Reiter zaehlt
// und die Termin-Meldungen an die Leitung bekommt -- EINE Regel fuer alle
// Stellen.
//
//   org_admin, super_admin    jeder Termin der Gemeinde
//   (Rolle ODER Merkmal
//   users.is_super_admin)
//   admin, teamer             Termine "Nur Team" (teamer_only) und Termine
//                             ohne jeden Jahrgang immer -- die beiden
//                             Team-Ausnahmen; jahrgangsgebundene Termine nur
//                             mit can_view-Zuweisung auf EINEN ihrer
//                             Jahrgaenge (Termine sind n:m)
//
// Und die Mitteilungen kannten gar keine Bindung: Konfi-Abmeldung samt Grund,
// Pflicht-Opt-out/-in und Zu-/Absagen des Teams gingen ueber
// ladeLeitungDerOrganisation an JEDEN Admin der Gemeinde, die
// taegliche Verbuchen-Erinnerung nannte jedem Admin die Zahl der ganzen
// Gemeinde.
//
// EINGESETZT an: Terminliste GET /events (routes/events/lesen.js),
// badge-counts.pendingEvents (routes/notifications.js), App-Symbol und
// Gemeinde-Umschalter (utils/appIconBadge.js), Empfaenger der Termin-
// Meldungen (ladeLeitungZumTermin) und die Verbuchen-Erinnerung um 09:00
// (zaehleWartendeTermineJeLeitung, services/backgroundService.js).
// darfTermin (utils/jahrgangsZugriff.js) prueft dieselbe Regel fuer den
// Einzelzugriff, dort mit wahlweise can_edit.
//
// Teamer:innen sehen die Termine nach derselben Regel, bekommen die
// Leitungs-Meldungen aber nicht: Abmeldungen und Zusagen zu
// verwalten ist Sache der Leitung.

const { ladeMitgliederDerOrganisation } = require('./orgMitglieder');
const { abfragenBuendeln } = require('./abfragenBuendeln');

/**
 * Sieht diese Person ALLE Termine ihrer aktiven Gemeinde?
 * Dieselbe Definition wie der Vollzugriff in darfJahrgang
 * (utils/jahrgangsZugriff.js).
 *
 * @param {{ role_name?: string, is_super_admin?: boolean }} user  req.user
 * @returns {boolean}
 */
function leitungSiehtAlleTermine(user) {
  if (!user) return false;
  return user.is_super_admin === true
    || user.role_name === 'org_admin'
    || user.role_name === 'super_admin';
}

/**
 * Sieht ein jahrgangsgebundener Admin bzw. eine Teamer:in mit diesen
 * can_view-Jahrgaengen diesen Termin? Fassung fuer Stellen, die den Termin
 * schon geladen haben (Terminliste).
 *
 * @param {object} termin
 * @param {boolean} termin.teamerOnly     events.teamer_only
 * @param {number[]} termin.jahrgangIds   Jahrgaenge des Termins
 * @param {number[]} sichtbareJahrgaenge  can_view-Jahrgaenge der Person
 * @returns {boolean}
 */
function gebundeneLeitungSiehtTermin({ teamerOnly, jahrgangIds }, sichtbareJahrgaenge) {
  if (teamerOnly) return true;
  const ids = (jahrgangIds || []).map(Number);
  if (ids.length === 0) return true;
  const eigene = new Set((sichtbareJahrgaenge || []).map(Number));
  return ids.some((id) => eigene.has(id));
}

/**
 * Dieselbe Regel als SQL-Bedingung "sieht Termin <e>".
 *
 * @param {object} opt
 * @param {string} opt.jahrgaenge  SQL-Ausdruck fuer die can_view-Jahrgaenge als int[]
 * @param {string} [opt.e='e']     Alias der events-Tabelle
 * @returns {string}
 */
function gebundeneLeitungSiehtTerminSql({ jahrgaenge, e = 'e' }) {
  return `(
    ${e}.teamer_only IS TRUE
    OR NOT EXISTS (
      SELECT 1 FROM event_jahrgang_assignments eja_sicht
       WHERE eja_sicht.event_id = ${e}.id
    )
    OR EXISTS (
      SELECT 1 FROM event_jahrgang_assignments eja_sicht
       WHERE eja_sicht.event_id = ${e}.id
         AND eja_sicht.jahrgang_id = ANY(${jahrgaenge})
    )
  )`;
}

/**
 * SQL-Bedingung "Termin <e> steht unter Verbuchen": begonnen, nicht
 * abgesagt, mindestens eine bestaetigte Buchung ohne Anwesenheit.
 *
 * Dieselbe Fassung fuer badge-counts.pendingEvents, das App-Symbol und die
 * Verbuchen-Erinnerung um 09:00 -- die Erinnerung nennt jeder Person genau
 * die Zahl, die ihr Reiter zeigt.
 *
 * @param {object} [opt]
 * @param {string} [opt.e='e']  Alias der events-Tabelle
 * @returns {string}
 */
function terminWartetAufVerbuchungSql({ e = 'e' } = {}) {
  return `(
    ${e}.event_date < NOW()
    AND ${e}.cancelled IS NOT TRUE
    AND EXISTS (
      SELECT 1 FROM event_bookings eb_offen
        JOIN users u_offen ON u_offen.id = eb_offen.user_id AND u_offen.deleted_at IS NULL
       WHERE eb_offen.event_id = ${e}.id
         AND eb_offen.status = 'confirmed'
         AND eb_offen.attendance_status IS NULL
    )
  )`;
}

/** Die can_view-Jahrgaenge der Person u als SQL-Ausdruck (int[]). */
const SICHTBARE_JAHRGAENGE_VON_U = `ARRAY(
  SELECT uja.jahrgang_id::int FROM user_jahrgang_assignments uja
   WHERE uja.user_id = u.id AND uja.can_view = true
)`;

/** Ohne Doppelte, ohne `ausser`, aufsteigend. */
function eindeutig(ids, ausser) {
  const menge = new Set();
  for (const id of ids) {
    const zahl = Number(id);
    if (ausser != null && zahl === Number(ausser)) continue;
    menge.add(zahl);
  }
  return [...menge].sort((x, y) => x - y);
}

/**
 * Die Leitung, die diesen Termin sieht -- die Empfaenger der Termin-
 * Meldungen an die Leitung (Konfi-Abmeldung, Pflicht-Opt-out/-in, Zu- und
 * Absagen des Teams; Push und Postfach).
 *
 *   org_admin                   immer
 *   admin mit is_super_admin    immer (wie in der Liste)
 *   admin                       "Nur Team" und ohne Jahrgang immer, sonst
 *                               mit can_view-Zuweisung auf einen Jahrgang
 *                               des Termins
 *   teamer                      nie
 *
 * Beide Quellen der Zugehoerigkeit ueber ladeMitgliederDerOrganisation
 * (Rolle je Gemeinde, gesperrte und geloeschte Konten fallen dort heraus).
 * Kein stiller Rueckfall: Wer den Termin nicht sieht, bekommt nichts --
 * notfalls nur die Gemeindeleitung.
 *
 * @param {object} db
 * @param {number|string} eventId
 * @param {object} [opt]
 * @param {number|string|null} [opt.ausser]  die handelnde Person (bekommt
 *   keine Meldung ueber den eigenen Vorgang -- die Zusage-Route steht hinter
 *   requireTeamer, auch Admins sagen dort zu)
 * @returns {Promise<number[]>} Nutzer-IDs, aufsteigend
 */
async function ladeLeitungZumTermin(db, eventId, { ausser = null } = {}) {
  const { rows: [termin] } = await db.query(
    'SELECT organization_id FROM events WHERE id = $1',
    [eventId]
  );
  if (!termin) return [];

  // Auf dem Client einer Transaktion nacheinander (utils/abfragenBuendeln.js).
  const [orgWeit, admins] = await abfragenBuendeln(db, [
    () => ladeMitgliederDerOrganisation(db, termin.organization_id, ['org_admin']),
    () => ladeMitgliederDerOrganisation(db, termin.organization_id, ['admin'])
  ]);

  // Die Rolle admin durch DIESELBE Bedingung wie Liste und Zaehler. Ein
  // Jahrgang gehoert genau einer Gemeinde -- eine Zuweisung aus einer
  // anderen Gemeinde trifft die Jahrgaenge dieses Termins nie.
  let gebunden = [];
  if (admins.length > 0) {
    const { rows } = await db.query(
      `SELECT u.id
         FROM users u
         JOIN events e ON e.id = $2
        WHERE u.id = ANY($1::bigint[])
          AND (
            u.is_super_admin IS TRUE
            OR ${gebundeneLeitungSiehtTerminSql({ jahrgaenge: SICHTBARE_JAHRGAENGE_VON_U })}
          )`,
      [admins, eventId]
    );
    gebunden = rows.map((r) => r.id);
  }

  return eindeutig([...orgWeit, ...gebunden], ausser);
}

/**
 * Die Verbuchen-Erinnerung um 09:00: fuer jede Leitungsperson der
 * angegebenen Gemeinden die Zahl der Termine, die IHR Reiter unter
 * "Verbuchen" zaehlt. Dieselbe Regel wie badge-counts.pendingEvents
 * -- org_admin und admin mit is_super_admin die ganze Gemeinde, admin nach
 * gebundeneLeitungSiehtTerminSql. Wer 0 hat, fehlt in der Rueckgabe.
 *
 * Abfragen: zwei je Gemeinde fuer die Empfaenger (beide Quellen der
 * Zugehoerigkeit, wie bei jeder Leitungs-Meldung) und EINE Zaehlung fuer
 * alle Personen zusammen -- keine Abfrage je Person.
 *
 * @param {object} db
 * @param {number[]} orgIds
 * @returns {Promise<Array<{ user_id: number, organization_id: number, anzahl: number }>>}
 */
async function zaehleWartendeTermineJeLeitung(db, orgIds) {
  if (!Array.isArray(orgIds) || orgIds.length === 0) return [];

  // Gemeinde fuer Gemeinde, nicht alle auf einmal: Der Lauf ist nicht
  // eilig, und ein Promise.all ueber alle Gemeinden belegte bei vielen
  // Gemeinden den ganzen Pool (20 Plaetze, database.js).
  const personen = [];
  for (const orgId of orgIds) {
    const [orgWeit, admins] = await abfragenBuendeln(db, [
      () => ladeMitgliederDerOrganisation(db, orgId, ['org_admin']),
      () => ladeMitgliederDerOrganisation(db, orgId, ['admin'])
    ]);
    const voll = new Set(orgWeit.map(Number));
    for (const id of voll) personen.push({ id, orgId, voll: true });
    for (const id of new Set(admins.map(Number))) {
      if (!voll.has(id)) personen.push({ id, orgId, voll: false });
    }
  }
  if (personen.length === 0) return [];

  const { rows } = await db.query(
    `SELECT z.user_id, z.organization_id, COUNT(e.id)::int AS anzahl
       FROM unnest($1::bigint[], $2::int[], $3::boolean[]) AS z(user_id, organization_id, voll)
       JOIN users u ON u.id = z.user_id
       JOIN events e
         ON e.organization_id = z.organization_id
        AND ${terminWartetAufVerbuchungSql()}
        AND (
          z.voll
          OR u.is_super_admin IS TRUE
          OR ${gebundeneLeitungSiehtTerminSql({ jahrgaenge: SICHTBARE_JAHRGAENGE_VON_U })}
        )
      GROUP BY z.user_id, z.organization_id
      ORDER BY z.organization_id, z.user_id`,
    [personen.map((p) => p.id), personen.map((p) => p.orgId), personen.map((p) => p.voll)]
  );
  return rows.map((r) => ({
    user_id: Number(r.user_id),
    organization_id: Number(r.organization_id),
    anzahl: r.anzahl
  }));
}

module.exports = {
  leitungSiehtAlleTermine,
  gebundeneLeitungSiehtTermin,
  gebundeneLeitungSiehtTerminSql,
  terminWartetAufVerbuchungSql,
  ladeLeitungZumTermin,
  zaehleWartendeTermineJeLeitung
};
