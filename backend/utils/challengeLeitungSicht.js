// Wer aus der Leitung eine Challenge sieht, sie zaehlt und Mitteilungen zu
// ihr bekommt -- EINE Regel fuer alle Stellen.
//
//   org_admin        jede Challenge der Gemeinde
//   admin, teamer    'nur_team' immer; 'konfis_und_team' und 'konfis' nur
//                    mit einem zugewiesenen Jahrgang der Challenge
//
// Bis dahin stand die Regel an sieben Stellen einzeln (Sichtpruefung,
// Leitungsliste, Teilnehmerliste, Dateiauslieferung, Reiter-Zaehler,
// App-Symbol-Zaehler, Mitteilungsempfaenger) -- und die Mitteilung kannte
// gar keine Bindung: Jeder Admin bekam zu jeder Challenge eine Nachricht,
// sah sie aber in Liste und Reiter nicht.

/** Teilnahmekreis, den das ganze Team ohne Jahrgang sieht. */
const TEAM_ORGWEITE_AUDIENCES = ['nur_team'];

/**
 * SQL-Bedingung "diese Leitungsrolle sieht Challenge <c>".
 *
 * @param {object} opt
 * @param {string} opt.rolle       SQL-Ausdruck fuer den Rollennamen (z. B. '$2', 'z.rolle')
 * @param {string} opt.jahrgaenge  SQL-Ausdruck fuer die can_view-Jahrgaenge als int[]
 * @param {string} [opt.c='c']     Alias der challenges-Tabelle
 * @returns {string}
 */
function leitungSiehtChallengeSql({ rolle, jahrgaenge, c = 'c' }) {
  return `(
    ${rolle} = 'org_admin'
    OR ${c}.audience = 'nur_team'
    OR EXISTS (
      SELECT 1 FROM challenge_jahrgang_assignments cja_sicht
       WHERE cja_sicht.challenge_id = ${c}.id
         AND cja_sicht.jahrgang_id = ANY(${jahrgaenge})
    )
  )`;
}

/**
 * Dieselbe Regel in JavaScript, fuer Stellen ohne passende Abfrage.
 *
 * @param {string} rolle
 * @param {string} audience
 * @param {number[]} challengeJahrgaenge  Jahrgaenge der Challenge
 * @param {number[]} eigeneJahrgaenge     can_view-Jahrgaenge der Person
 */
function leitungSiehtChallenge(rolle, audience, challengeJahrgaenge, eigeneJahrgaenge) {
  if (rolle === 'org_admin') return true;
  if (audience === 'nur_team') return true;
  const eigene = new Set((eigeneJahrgaenge || []).map(Number));
  return (challengeJahrgaenge || []).some((id) => eigene.has(Number(id)));
}

// Mitmachen = die Challenge in der eigenen Teilnahme-Liste haben und
// einreichen duerfen: GET /api/challenges/konfi fuer Team-Rollen und
// maySubmit in routes/challenges.js. Das Team macht bei 'konfis_und_team'
// und 'nur_team' mit, bei 'konfis' nicht (dort liest es nur mit). Welche
// dieser Challenges eine Person sieht, sagt die Regel oben.
//
// Dieselbe Bedingung bestimmt
//   - die Teilnahme-Liste des Teams (GET /api/challenges/konfi),
//   - die Empfaenger der Start-Mitteilung "Neue Challenge" im Team
//     (ladeTeamDasMitmacht, pushService.sendChallengeStartedToJahrgaenge),
//   - "neue Challenge" im Neuigkeiten-Zaehler des Teams
//     (utils/challengeNeuigkeiten.js).
// Bis dahin bekam das Team beim Start nichts -- bei 'nur_team' also
// niemand -- und hatte fuer eine neue Challenge keine Zahl.
// --------------------------------------------------------------------

/** Teilnahmekreise, in denen das Team selbst einreicht. */
const TEAM_MACHT_MIT_AUDIENCES = ['konfis_und_team', 'nur_team'];

/**
 * SQL-Bedingung "diese Team-Rolle macht bei Challenge <c> mit".
 * Parameter wie leitungSiehtChallengeSql.
 */
function teamMachtMitSql({ rolle, jahrgaenge, c = 'c' }) {
  return `(
    ${c}.audience IN (${TEAM_MACHT_MIT_AUDIENCES.map((a) => `'${a}'`).join(', ')})
    AND ${leitungSiehtChallengeSql({ rolle, jahrgaenge, c })}
  )`;
}

/**
 * Alle aus dem Team der Gemeinde, die bei Challenge <challengeId>
 * mitmachen: Rollen org_admin, admin, teamer; beide Quellen der
 * Zugehoerigkeit (Stamm-Gemeinde mit users.role_id, weitere mit
 * user_organizations.role_id -- fuehrt user_organizations die
 * Stamm-Gemeinde doppelt, gilt die Rolle am Konto, wie in
 * orgMitglieder.ladeMitgliedschaftenDerPerson). Jahrgaenge wie in Liste und
 * Zaehler nur mit can_view. Gesperrte und geloeschte Konten nicht.
 *
 * @param {object} db
 * @param {number} challengeId
 * @returns {Promise<Array<number>>} Nutzer-IDs ohne Doppelte
 */
async function ladeTeamDasMitmacht(db, challengeId) {
  const { rows } = await db.query(
    `WITH mitglieder AS (
       SELECT DISTINCT ON (m.user_id) m.user_id, m.rolle
         FROM (
           SELECT u.id AS user_id, r.name AS rolle, 0 AS rang
             FROM challenges ch
             JOIN users u ON u.organization_id = ch.organization_id
             JOIN roles r ON r.id = u.role_id
            WHERE ch.id = $1
              AND u.is_active = true
              AND u.deleted_at IS NULL
           UNION ALL
           SELECT u.id, r.name, 1
             FROM challenges ch
             JOIN user_organizations uo ON uo.organization_id = ch.organization_id
             JOIN users u ON u.id = uo.user_id
             JOIN roles r ON r.id = uo.role_id
            WHERE ch.id = $1
              AND u.is_active = true
              AND u.deleted_at IS NULL
         ) m
        ORDER BY m.user_id, m.rang
     )
     SELECT m.user_id
       FROM mitglieder m
       JOIN challenges c ON c.id = $1
      WHERE m.rolle IN ('org_admin', 'admin', 'teamer')
        AND ${teamMachtMitSql({
          rolle: 'm.rolle',
          jahrgaenge: `ARRAY(SELECT uja.jahrgang_id FROM user_jahrgang_assignments uja
                              WHERE uja.user_id = m.user_id AND uja.can_view = true)`
        })}
      ORDER BY m.user_id`,
    [challengeId]
  );
  return rows.map((r) => r.user_id);
}

module.exports = {
  leitungSiehtChallengeSql,
  leitungSiehtChallenge,
  TEAM_ORGWEITE_AUDIENCES,
  TEAM_MACHT_MIT_AUDIENCES,
  teamMachtMitSql,
  ladeTeamDasMitmacht
};
