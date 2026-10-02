// Wer aus der Leitung einen Aktivitaets-Antrag sieht, ihn zaehlt und die
// Mitteilung "Neuer Antrag eingegangen" bekommt -- EINE Regel fuer alle
// Stellen.
//
// KONFI OHNE JAHRGANG: kp.jahrgang_id IS NULL trifft kein `= ANY(...)` --
// den Antrag sieht nur die org-weite Leitung, also bekommt nur sie die
// Mitteilung. Genauso entscheidet darfKonfi (utils/jahrgangsZugriff.js) beim
// Genehmigen: ohne Jahrgang kommt nur der Vollzugriff durch.
//
// VORHER stand die Regel an drei Stellen einzeln (Antragsliste in
// activities.js, pendingRequests in badge-counts, antragZaehlerGebunden im
// App-Symbol) -- und die Mitteilung kannte gar keine: konfi.js und teamer.js
// schrieben "Neuer Antrag eingegangen" an ladeLeitungDerOrganisation, also an
// JEDEN Admin der Gemeinde, und PushService.sendNewActivityRequestToAdmins
// schickte den Push an dieselben. Ein Admin ohne passende Zuweisung bekam
// damit eine Mitteilung (die an Glocke, Gemeinde-Umschalter und App-Symbol
// mitzaehlte) zu einem Antrag, den er nirgends oeffnen konnte.

const { ladeMitgliederDerOrganisation } = require('./orgMitglieder');
const { abfragenBuendeln } = require('./abfragenBuendeln');

/**
 * Sieht diese Person ALLE Antraege ihrer aktiven Gemeinde?
 * Dieselbe Definition wie der Vollzugriff in darfJahrgang
 * (utils/jahrgangsZugriff.js).
 *
 * @param {{ role_name?: string, is_super_admin?: boolean }} user  req.user
 * @returns {boolean}
 */
function leitungSiehtAlleAntraege(user) {
  if (!user) return false;
  return user.is_super_admin === true
    || user.role_name === 'org_admin'
    || user.role_name === 'super_admin';
}

/**
 * SQL-Bedingung "ein jahrgangsgebundener Admin mit diesen Jahrgaengen sieht
 * Antrag <ar> zur Aktivitaet <a>".
 *
 * Teamer-Antraege immer, Konfi-Antraege ueber den Jahrgang des Konfis. Ein
 * leeres Array trifft nichts: ohne Zuweisung bleiben nur Teamer-Antraege.
 *
 * @param {object} opt
 * @param {string} opt.jahrgaenge  SQL-Ausdruck fuer die can_view-Jahrgaenge als int[]
 * @param {string} [opt.a='a']     Alias der activities-Tabelle
 * @param {string} [opt.ar='ar']   Alias der activity_requests-Tabelle
 * @returns {string}
 */
function gebundeneLeitungSiehtAntragSql({ jahrgaenge, a = 'a', ar = 'ar' }) {
  return `(
    ${a}.target_role = 'teamer'
    OR EXISTS (
      SELECT 1 FROM konfi_profiles kp_sicht
       WHERE kp_sicht.user_id = ${ar}.user_id
         AND kp_sicht.jahrgang_id = ANY(${jahrgaenge})
    )
  )`;
}

/**
 * Die Leitung, die diesen Antrag sieht -- die Empfaenger von "Neuer Antrag
 * eingegangen" (Postfach und Push).
 *
 * Beide Quellen der Zugehoerigkeit (users.organization_id UND
 * user_organizations, Rolle je Gemeinde) ueber ladeMitgliederDerOrganisation
 * -- dasselbe Muster wie sendChallengeSubmissionToLeadership. Gesperrte und
 * geloeschte Konten fallen dort schon heraus. Keine Person doppelt; die
 * antragstellende Person nie.
 *
 * @param {object} db
 * @param {number} antragId  activity_requests.id
 * @returns {Promise<number[]>} Nutzer-IDs in aufsteigender Reihenfolge
 */
async function ladeLeitungZumAntrag(db, antragId) {
  const { rows: [antrag] } = await db.query(
    `SELECT ar.user_id, a.organization_id
       FROM activity_requests ar
       JOIN activities a ON a.id = ar.activity_id
      WHERE ar.id = $1`,
    [antragId]
  );
  if (!antrag) return [];

  // Auf dem Client einer Transaktion nacheinander (utils/abfragenBuendeln.js).
  const [orgWeit, admins] = await abfragenBuendeln(db, [
    () => ladeMitgliederDerOrganisation(db, antrag.organization_id, ['org_admin']),
    () => ladeMitgliederDerOrganisation(db, antrag.organization_id, ['admin'])
  ]);

  // Die Rolle admin durch DIESELBE Bedingung wie Liste und Zaehler: das
  // Merkmal is_super_admin wie org_admin, sonst die can_view-Jahrgaenge der
  // Person (ein Jahrgang gehoert genau einer Gemeinde -- eine Zuweisung aus
  // einer anderen Gemeinde trifft den Konfi-Jahrgang nie).
  let gebunden = [];
  if (admins.length > 0) {
    const { rows } = await db.query(
      `SELECT u.id
         FROM users u
         JOIN activity_requests ar ON ar.id = $2
         JOIN activities a ON a.id = ar.activity_id
        WHERE u.id = ANY($1::int[])
          AND (
            u.is_super_admin IS TRUE
            OR ${gebundeneLeitungSiehtAntragSql({
              jahrgaenge: `ARRAY(SELECT uja.jahrgang_id FROM user_jahrgang_assignments uja
                                  WHERE uja.user_id = u.id AND uja.can_view = true)`
            })}
          )`,
      [admins, antragId]
    );
    gebunden = rows.map((r) => r.id);
  }

  const empfaenger = new Set();
  for (const id of [...orgWeit, ...gebunden]) {
    const zahl = Number(id);
    if (zahl === Number(antrag.user_id)) continue;
    empfaenger.add(zahl);
  }
  return [...empfaenger].sort((x, y) => x - y);
}

module.exports = { leitungSiehtAlleAntraege, gebundeneLeitungSiehtAntragSql, ladeLeitungZumAntrag };
