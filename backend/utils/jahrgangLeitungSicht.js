// Wer aus der Leitung die Meldungen zu einem JAHRGANG bekommt -- neue
// Registrierung und die Warnung vor dem Loeschen.
//
// Die Regel ist die von darfJahrgang (utils/jahrgangsZugriff.js), dort fuer
// die anfragende Person, hier als Empfaengerliste ueber viele:
//
//   Neue Registrierung     Leserecht (can_view): Die neue Konfi steht sofort
//                          in der Konfi-Liste (GET /admin/konfis filtert nach
//                          can_view) -- wer sie dort sieht, erfaehrt davon.
//   Loeschwarnung          Schreibrecht (can_edit): Die Warnung sagt "Letzte
//                          Chance, Konfis zu Teamer:innen zu befoerdern", und
//                          Befoerdern verlangt darfKonfi mit edit.
//
// VORHER: Die Loeschwarnung ging an
// jeden Admin der Gemeinde. Die Registrierung ging an die Leitung "mit
// Zuweisung auf den Jahrgang" -- auch die Org-Admins brauchten eine, obwohl
// sie ohne Zuweisung alles sehen; sobald ein Admin zugewiesen war, fielen
// sie heraus. War niemand zugewiesen, ging sie als Rueckfall an ALLE Admins.
// Beides ist weg: Die Gemeindeleitung bekommt die Meldung immer, und ohne
// zustaendigen Admin bleibt es bei ihr.

const { ladeMitgliederDerOrganisation } = require('./orgMitglieder');
const { abfragenBuendeln } = require('./abfragenBuendeln');

/**
 * Die Leitung eines Jahrgangs -- Empfaenger von "Neue Registrierung" und
 * "Jahrgang wird bald geloescht" (Push, Postfach, Mail).
 *
 * Beide Quellen der Zugehoerigkeit ueber ladeMitgliederDerOrganisation
 * (Rolle je Gemeinde; gesperrte und geloeschte Konten fallen dort heraus).
 * Keine Person doppelt.
 *
 * @param {object} db
 * @param {number} organizationId  Gemeinde des Jahrgangs
 * @param {number|null} jahrgangId  null: nur die org-weite Leitung
 * @param {object} [opt]
 * @param {boolean} [opt.schreibrecht=false]  can_edit statt can_view
 * @returns {Promise<number[]>} Nutzer-IDs, aufsteigend
 */
async function ladeLeitungZumJahrgang(db, organizationId, jahrgangId, { schreibrecht = false } = {}) {
  // Auf dem Client einer Transaktion nacheinander (utils/abfragenBuendeln.js).
  const [orgWeit, admins] = await abfragenBuendeln(db, [
    () => ladeMitgliederDerOrganisation(db, organizationId, ['org_admin']),
    () => ladeMitgliederDerOrganisation(db, organizationId, ['admin'])
  ]);

  let gebunden = [];
  if (admins.length > 0) {
    const recht = schreibrecht ? 'can_edit' : 'can_view';
    const { rows } = await db.query(
      `SELECT u.id
         FROM users u
        WHERE u.id = ANY($1::bigint[])
          AND (
            u.is_super_admin IS TRUE
            OR EXISTS (
              SELECT 1 FROM user_jahrgang_assignments uja
               WHERE uja.user_id = u.id
                 AND uja.jahrgang_id = $2
                 AND uja.${recht} = true
            )
          )`,
      [admins, jahrgangId]
    );
    gebunden = rows.map((r) => r.id);
  }

  return [...new Set([...orgWeit, ...gebunden].map(Number))].sort((x, y) => x - y);
}

module.exports = { ladeLeitungZumJahrgang };
