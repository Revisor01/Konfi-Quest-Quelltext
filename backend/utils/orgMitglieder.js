// Mitglieder einer Organisation nach Rolle -- ueber BEIDE Quellen der
// Zugehoerigkeit.
//
// DAS MUSTER IST NICHT NEU: rbac.js loest die aktive Organisation seit
// Migration 101 gegen user_organizations auf, liveUpdate.js,
// teamChat.js und jahrgangChat.js vereinen fuer ihre Empfaenger dieselben
// zwei Quellen per UNION. Hier steht es einmal, damit es nicht an vierzehn
// Stellen einzeln nachgezogen werden muss.
//
// DIE ROLLE GILT JE ORGANISATION: user_organizations traegt ein eigenes
// role_id. Wer in Gemeinde A org_admin ist und in Gemeinde B nur Teamer:in,
// bekommt in B keine Leitungs-Meldungen. Deshalb wird die Rolle je Quelle
// getrennt gezogen -- users.role_id fuer die Stamm-Organisation,
// uo.role_id fuer die Zusatzzugehoerigkeit -- und NICHT pauschal ueber die
// Rolle am Nutzerkonto.

const { abfragenBuendeln } = require('./abfragenBuendeln');

/**
 * @param {object} db
 * @param {number} organizationId  Organisation des INHALTS
 * @param {string[]} rollen        Rollennamen, z.B. ['admin', 'org_admin']
 * @param {object} [opt]
 * @param {number[]|null} [opt.jahrgangIds]  Nur Personen mit einer Zuweisung
 *   (user_jahrgang_assignments) MIT Leserecht (can_view) auf mindestens einen
 *   dieser Jahrgaenge.
 * @returns {Promise<Array<number|string>>} Nutzer-IDs ohne Doppelte, so wie
 *   pg sie liefert (users.id ist bigint).
 */
async function ladeMitgliederDerOrganisation(db, organizationId, rollen, { jahrgangIds = null } = {}) {
  if (!Array.isArray(rollen) || rollen.length === 0) return [];
  if (Array.isArray(jahrgangIds) && jahrgangIds.length === 0) return [];

  const params = [organizationId, rollen];
  let jahrgangFilter = '';
  if (Array.isArray(jahrgangIds)) {
    params.push(jahrgangIds);
    // can_view gehoert dazu: Listen,
    // Zaehler und Jahrgangs-Chat verlangen Leserecht auf den Jahrgang
    // (notifications.js, jahrgangChat.js, darfJahrgang). Ohne diese Bedingung
    // loeste eine Zuweisung mit can_view = false Mitteilungen aus, deren
    // Vorgang die Person in keiner Liste sieht.
    jahrgangFilter = `
       AND EXISTS (
         SELECT 1 FROM user_jahrgang_assignments uja
          WHERE uja.user_id = u.id AND uja.jahrgang_id = ANY($3::int[])
            AND uja.can_view = true
       )`;
  }

  const { rows } = await db.query(
    `
    -- Stamm-Organisation: Rolle aus users.role_id
    SELECT u.id
      FROM users u
      JOIN roles r ON r.id = u.role_id
     WHERE u.organization_id = $1
       AND r.name = ANY($2::text[])
       AND u.is_active = true
       AND u.deleted_at IS NULL${jahrgangFilter}
    UNION
    -- Zusatzzugehoerigkeit: Rolle aus user_organizations.role_id DIESER Org
    SELECT u.id
      FROM user_organizations uo
      JOIN users u ON u.id = uo.user_id
      JOIN roles r ON r.id = uo.role_id
     WHERE uo.organization_id = $1
       AND r.name = ANY($2::text[])
       AND u.is_active = true
       AND u.deleted_at IS NULL${jahrgangFilter}
    `,
    params
  );
  return rows.map((r) => r.id);
}

const LEITUNGSROLLEN = ['admin', 'org_admin'];

/**
 * Die Leitung einer Organisation (admin + org_admin), ueber beide Quellen.
 */
function ladeLeitungDerOrganisation(db, organizationId, opt) {
  return ladeMitgliederDerOrganisation(db, organizationId, LEITUNGSROLLEN, opt);
}

/**
 * Dieselben zwei Quellen wie oben und wie GET /auth/my-organizations:
 * Stamm-Organisation mit users.role_id, Zusatzzugehoerigkeiten mit
 * uo.role_id. Fuehrt user_organizations die Stamm-Organisation doppelt,
 * gewinnt die Rolle am Nutzerkonto (wie in my-organizations). Gesperrte
 * Organisationen fallen heraus, wie dort.
 *
 * Die Jahrgaenge kommen ueber jahrgaenge.organization_id an ihre Gemeinde --
 * ein Jahrgang gehoert genau einer Organisation. Damit kann eine Zuweisung
 * aus Gemeinde A nie in Gemeinde B mitzaehlen (Jahrgangsbindung, siehe
 * utils/jahrgangsZugriff.js).
 *
 * Zwei Abfragen, unabhaengig von der Anzahl der Gemeinden.
 *
 * Die Stamm-Gemeinde steht vorn, die weiteren folgen nach ihrer id:
 * Die Zahl am App-Symbol bucht dort, was keiner
 * Gemeinde der Liste gehoert (siehe utils/appIconBadge.js).
 *
 * @param {object} db
 * @param {number} userId
 * @returns {Promise<Array<{organization_id:number, role_name:string, type:string,
 *   assigned_jahrgaenge:Array<{id:number, can_view:boolean, can_edit:boolean}>}>>}
 *   type wie im Token: konfi, teamer oder admin (alle Leitungsrollen).
 */
async function ladeMitgliedschaftenDerPerson(db, userId) {
  const jePerson = await ladeMitgliedschaftenVieler(db, [userId]);
  const eintrag = jePerson.get(Number(userId));
  return eintrag ? eintrag.mitgliedschaften : [];
}

/**
 * Dasselbe fuer viele Personen auf einmal.
 *
 * Die Zahl am App-Symbol setzen der Push (eine Person oder ein Block) und
 * der Hintergrund-Lauf (alle Konten, alle fuenf Minuten). Beide brauchen die
 * Rolle JE GEMEINDE -- vorher nahmen sie die Rolle am Nutzerkonto fuer jede
 * Gemeinde. Hier steht die Regel EINMAL, ladeMitgliedschaftenDerPerson ist
 * derselbe Weg mit einer Person. Zwei Abfragen, unabhaengig von der Zahl der
 * Personen und Gemeinden.
 *
 * Geloeschte Konten tauchen nicht auf (wie im Push-Weg vorher).
 *
 * @param {object} db
 * @param {Array<number>} userIds
 * @returns {Promise<Map<number, {stamm_organization_id:number|null,
 *   mitgliedschaften:Array<{organization_id:number, role_name:string, type:string,
 *   assigned_jahrgaenge:Array<{id:number, can_view:boolean, can_edit:boolean}>}>}>>}
 *   Je Person die Stamm-Gemeinde aus users.organization_id -- auch wenn sie
 *   gesperrt ist; der Push setzt sie als Rueckfall in den Payload -- und die
 *   Mitgliedschaften in AKTIVEN Gemeinden, die Stamm-Gemeinde zuerst.
 */
async function ladeMitgliedschaftenVieler(db, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter(Number.isFinite))];
  const jePerson = new Map();
  if (ids.length === 0) return jePerson;

  const [{ rows: zeilen }, { rows: jahrgaenge }] = await abfragenBuendeln(db, [
    () => db.query(
      `
      SELECT m.user_id, m.organization_id, m.role_name, m.is_primary, m.org_aktiv
        FROM (
          SELECT u.id AS user_id, u.organization_id, r.name AS role_name, true AS is_primary,
                 COALESCE(o.is_active, true) AS org_aktiv
            FROM users u
            JOIN roles r ON r.id = u.role_id
            JOIN organizations o ON o.id = u.organization_id
           WHERE u.id = ANY($1::bigint[]) AND u.deleted_at IS NULL
          UNION ALL
          SELECT uo.user_id, uo.organization_id, r.name AS role_name, false AS is_primary,
                 COALESCE(o.is_active, true) AS org_aktiv
            FROM user_organizations uo
            JOIN users u ON u.id = uo.user_id AND u.deleted_at IS NULL
            JOIN roles r ON r.id = uo.role_id
            JOIN organizations o ON o.id = uo.organization_id
           WHERE uo.user_id = ANY($1::bigint[])
        ) m
       ORDER BY m.user_id, m.is_primary DESC, m.organization_id
      `,
      [ids]
    ),
    () => db.query(
      `SELECT uja.user_id, uja.jahrgang_id AS id, uja.can_view, uja.can_edit, j.organization_id
         FROM user_jahrgang_assignments uja
         JOIN jahrgaenge j ON j.id = uja.jahrgang_id
        WHERE uja.user_id = ANY($1::bigint[])`,
      [ids]
    )
  ]);

  // Jahrgaenge je (Person, Gemeinde): Ein Jahrgang gehoert genau einer
  // Organisation, eine Zuweisung aus A zaehlt so nie in B.
  const jahrgaengeJe = new Map();
  for (const j of jahrgaenge) {
    const k = `${Number(j.user_id)}_${j.organization_id}`;
    if (!jahrgaengeJe.has(k)) jahrgaengeJe.set(k, []);
    jahrgaengeJe.get(k).push({ id: j.id, can_view: j.can_view, can_edit: j.can_edit });
  }

  for (const z of zeilen) {
    const userId = Number(z.user_id);
    if (!jePerson.has(userId)) {
      jePerson.set(userId, { stamm_organization_id: null, mitgliedschaften: [], gesehen: new Set() });
    }
    const eintrag = jePerson.get(userId);
    if (z.is_primary) eintrag.stamm_organization_id = z.organization_id;
    // Gesperrte Gemeinden fallen heraus (wie GET /auth/my-organizations).
    // Fuehrt user_organizations die Stamm-Gemeinde doppelt, gewinnt die Rolle
    // am Nutzerkonto: Die Stamm-Zeile kommt durch die Sortierung zuerst.
    if (!z.org_aktiv || eintrag.gesehen.has(z.organization_id)) continue;
    eintrag.gesehen.add(z.organization_id);
    eintrag.mitgliedschaften.push({
      organization_id: z.organization_id,
      role_name: z.role_name,
      type: z.role_name === 'konfi' ? 'konfi' : (z.role_name === 'teamer' ? 'teamer' : 'admin'),
      assigned_jahrgaenge: jahrgaengeJe.get(`${userId}_${z.organization_id}`) || []
    });
  }
  for (const eintrag of jePerson.values()) delete eintrag.gesehen;
  return jePerson;
}

/**
 * Gehoert diese Person zur Gemeinde? Ueber BEIDE Quellen der Zugehoerigkeit
 * Stamm-Gemeinde
 * (users.organization_id) oder Zusatzzugehoerigkeit (user_organizations).
 * Geloeschte Konten gehoeren nirgends mehr dazu. Die Rolle spielt hier keine
 * Rolle -- es geht darum, ob ein Schreibweg die Gemeindegrenze ueberschreitet.
 *
 * @param {object} db
 * @param {number|string} userId
 * @param {number} organizationId
 * @returns {Promise<boolean>}
 */
async function istMitgliedDerOrganisation(db, userId, organizationId) {
  const { rows: [r] } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM users u
        WHERE u.id = $1 AND u.deleted_at IS NULL
          AND (u.organization_id = $2
               OR EXISTS (SELECT 1 FROM user_organizations uo
                           WHERE uo.user_id = u.id AND uo.organization_id = $2))
     ) AS mitglied`,
    [userId, organizationId]
  );
  return r.mitglied === true;
}

/**
 * Fuer Routen, in denen die Leitung eine Person ihrer Gemeinde nach deren
 * Rolle DORT prueft (etwa "ist Teamer:in") -- vorher lasen sie die Rolle am
 * Konto und die Stamm-Gemeinde, und die Leitung einer weiteren Gemeinde bekam
 * fuer ihre Teamer:in 404.
 *
 * @param {object} db
 * @param {number|string} userId
 * @param {number|string} organizationId
 * @returns {Promise<string|null>}  Rollenname oder null (kein Mitglied,
 *   geloeschtes Konto)
 */
async function ladeRolleInGemeinde(db, userId, organizationId) {
  const { rows: [z] } = await db.query(
    `SELECT CASE WHEN u.organization_id = $2 THEN r_stamm.name ELSE r_dort.name END AS role_name
       FROM users u
       JOIN roles r_stamm ON r_stamm.id = u.role_id
       LEFT JOIN user_organizations uo ON uo.user_id = u.id AND uo.organization_id = $2
       LEFT JOIN roles r_dort ON r_dort.id = uo.role_id
      WHERE u.id = $1 AND u.deleted_at IS NULL
        AND (u.organization_id = $2 OR uo.id IS NOT NULL)`,
    [userId, organizationId]
  );
  return z ? z.role_name : null;
}

module.exports = {
  istMitgliedDerOrganisation,
  ladeRolleInGemeinde,
  ladeMitgliederDerOrganisation,
  ladeLeitungDerOrganisation,
  ladeMitgliedschaftenDerPerson,
  ladeMitgliedschaftenVieler,
  LEITUNGSROLLEN
};
