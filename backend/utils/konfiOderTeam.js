// DIE REGEL: Ein Konto ist entweder
//  - Konfi: genau eine Gemeinde, die Stamm-Gemeinde (users.organization_id,
//    users.role_id = konfi), keine weitere Mitgliedschaft; oder
//  - Team: teamer, admin oder org_admin -- auch in mehreren Gemeinden, aber
//    in keiner davon Konfi.
// Das gilt ueber Gemeindegrenzen hinweg: Wer zuhause Teamer:in ist, wird
// nirgends Konfi, und wer Konfi ist, wird nirgends Team.
//
// HIER STEHT DIE REGEL EINMAL. Jeder Schreibweg, der eine Rolle vergibt
// (Einladung annehmen, Zuweisung durch den Super-Admin, Rollenwechsel in der
// Benutzerverwaltung), fragt pruefeKonfiOderTeam, bevor er schreibt.

const KONFI = 'konfi';

/**
 * Alle Mitgliedschaften einer Person mit der Rolle DORT, ueber beide Quellen.
 * Fuehrt user_organizations die Stamm-Gemeinde noch einmal (Altbestand aus
 * Migration 101), gewinnt die Rolle am Konto -- dieselbe Regel wie rbac.js,
 * GET /auth/my-organizations und utils/orgMitglieder.js. Gesperrte Gemeinden
 * zaehlen mit: Eine Sperre ist voruebergehend, die Mitgliedschaft bleibt.
 *
 * @param {object} db  Pool oder Client
 * @param {number|string} userId
 * @returns {Promise<Array<{organization_id:number, role_name:string, stamm:boolean}>>}
 */
async function ladeRollenJeGemeinde(db, userId) {
  const { rows } = await db.query(
    `SELECT u.organization_id, r.name AS role_name, true AS stamm
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1 AND u.deleted_at IS NULL
     UNION ALL
     SELECT uo.organization_id, r.name AS role_name, false AS stamm
       FROM user_organizations uo
       JOIN users u ON u.id = uo.user_id AND u.deleted_at IS NULL
       JOIN roles r ON r.id = uo.role_id
      WHERE uo.user_id = $1
        AND uo.organization_id IS DISTINCT FROM u.organization_id`,
    [userId]
  );
  return rows.map((z) => ({
    organization_id: Number(z.organization_id),
    role_name: z.role_name,
    stamm: z.stamm === true
  }));
}

/**
 * Ist diese Person in irgendeiner Gemeinde Konfi?
 *
 * @param {object} db
 * @param {number|string} userId
 * @returns {Promise<boolean>}
 */
async function istIrgendwoKonfi(db, userId) {
  const mitgliedschaften = await ladeRollenJeGemeinde(db, userId);
  return mitgliedschaften.some((m) => m.role_name === KONFI);
}

/**
 * Darf diese Person in dieser Gemeinde diese Rolle bekommen, ohne dass ein
 * Konto Konfi UND Team zugleich wird?
 *
 * Abgelehnt wird, was einen Mischzustand NEU erzeugt:
 *  - Die Rolle ist konfi, und die Person gehoert noch zu einer anderen
 *    Gemeinde (gleich mit welcher Rolle). Konfi gibt es nur in genau einer
 *    Gemeinde -- in einer weiteren Gemeinde also nie, und zuhause nur ohne
 *    weitere Mitgliedschaft.
 *  - Die Rolle ist eine Team-Rolle, die Person ist in einer anderen Gemeinde
 *    Konfi, und hier war sie bisher nicht schon Team (neue Mitgliedschaft oder
 *    Wechsel von Konfi zu Team). Team -> Team in einem Altbestands-Mischkonto
 *    bleibt moeglich; es macht nichts schlimmer.
 *
 * @param {object} db  Pool oder Client
 * @param {object} p
 * @param {number|string} p.userId
 * @param {number|string} p.organizationId  die Gemeinde, in der geschrieben wird
 * @param {string} p.rolle                  Rollenname (roles.name), der dort gelten soll
 * @returns {Promise<null|{error:string, error_code:string}>}  null = erlaubt
 */
async function pruefeKonfiOderTeam(db, { userId, organizationId, rolle }) {
  const orgId = Number(organizationId);
  const mitgliedschaften = await ladeRollenJeGemeinde(db, userId);
  const hier = mitgliedschaften.find((m) => m.organization_id === orgId);
  const andere = mitgliedschaften.filter((m) => m.organization_id !== orgId);

  // Unveraenderte Rolle erzeugt nichts Neues. Die Oberflaeche schickt beim
  // Bearbeiten das ganze Formular samt role_id mit -- ein Altbestands-
  // Mischkonto muss sich trotzdem umbenennen oder sperren lassen.
  if (hier && hier.role_name === rolle) return null;

  if (rolle === KONFI) {
    if (andere.length > 0) {
      return {
        error: 'Konfi und Team gehen nicht zusammen: Diese Person gehört noch zu einer anderen Gemeinde. Konfi kann nur sein, wer zu genau einer Gemeinde gehört.',
        error_code: 'konfi_und_team'
      };
    }
    return null;
  }

  const schonTeamHier = hier && hier.role_name !== KONFI;
  if (!schonTeamHier && andere.some((m) => m.role_name === KONFI)) {
    return {
      error: 'Konfi und Team gehen nicht zusammen: Diese Person ist in einer anderen Gemeinde Konfi.',
      error_code: 'konfi_und_team'
    };
  }
  return null;
}

/**
 * SQL-Bedingung: Das Konto (Alias) gehoert noch zu einer ANDEREN Gemeinde als
 * seiner Stamm-Gemeinde. Fuer die Auto-Loeschung nach der Konfirmation
 * (services/backgroundService.js): Ein Konfi-Konto, das woanders im Team ist
 * (Altbestand), wird nicht geloescht -- sonst ginge mit dem Konto auch die
 * Mitarbeit in der anderen Gemeinde verloren.
 *
 * Gefragt wird nach JEDER weiteren Mitgliedschaft, nicht nur nach einer
 * Team-Rolle: Auch eine Konfi-Zeile in einer anderen Gemeinde (Altbestand)
 * haengt am selben Konto, und deren Frist ist eine andere.
 *
 * @param {string} alias  Alias der users-Tabelle in der Abfrage
 * @returns {string}
 */
const WOANDERS_MITGLIED_SQL = (alias) => `EXISTS (
  SELECT 1 FROM user_organizations uo_woanders
   WHERE uo_woanders.user_id = ${alias}.id
     AND uo_woanders.organization_id IS DISTINCT FROM ${alias}.organization_id
)`;

module.exports = {
  ladeRollenJeGemeinde,
  istIrgendwoKonfi,
  pruefeKonfiOderTeam,
  WOANDERS_MITGLIED_SQL
};
