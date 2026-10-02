// Eine Challenge loeschen -- EIN Weg fuer zwei Aufrufer.
//
// WAS WEGGEHT: die Challenge selbst; per ON DELETE CASCADE ihre Beitraege
// (challenge_submissions), Jahrgangs-Zuordnungen und Lesestaende; die
// Postfach-Eintraege, die auf sie zeigen (utils/postfachAufraeumen.js). Die
// verschluesselten Dateien der Beitraege loescht der Aufrufer NACH dem COMMIT
// (entferneChallengeDateien) -- ein ROLLBACK soll keine Dateien verlieren.

const { loescheMitteilungenZuChallenge } = require('./postfachAufraeumen');
const { deleteChallengeFile } = require('./photoStorage');

// Rollen, deren Stempel bewahrt werden. Konfis nicht: Ihr Andenken sind die
// Abzeichen (user_badges), und ihre Challenges gehen mit dem Jahrgang.
const TEAM_ROLLEN = ['org_admin', 'admin', 'teamer'];

/**
 * Legt die Stempel des Teams aus einer Challenge dauerhaft ab.
 *
 * Wer zaehlt als Team: die Rolle IN DER GEMEINDE DER CHALLENGE, aus beiden
 * Quellen der Zugehoerigkeit (users.organization_id mit users.role_id,
 * user_organizations mit deren role_id) -- dieselbe Regel wie in
 * utils/orgMitglieder.js. Deaktivierte Konten behalten ihren Stempel auch;
 * geloeschte Konten nehmen ihn ohnehin mit (ON DELETE CASCADE).
 *
 * earned_at wie in allen Stempel-Listen: der frueheste freigegebene eigene
 * Beitrag, bei Bestand ohne approved_at dessen created_at.
 *
 * @param {{query: Function}} client
 * @param {number|string} challengeId
 * @returns {Promise<number>} Anzahl bewahrter Stempel
 */
async function bewahreTeamStempel(client, challengeId) {
  const { rowCount } = await client.query(
    `INSERT INTO bewahrte_stempel
       (user_id, organization_id, challenge_id, herkunft_challenge_id,
        title, description, badge_icon, badge_name, earned_at)
     SELECT s.user_id, c.organization_id, c.id, c.id,
            c.title, c.description, c.badge_icon, c.badge_name,
            MIN(COALESCE(s.approved_at, s.created_at))
       FROM challenge_submissions s
       JOIN challenges c ON c.id = s.challenge_id
      WHERE s.challenge_id = $1
        AND s.moderation_status = 'approved'
        AND c.badge_name IS NOT NULL
        AND (
          EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id
                   WHERE u.id = s.user_id AND u.organization_id = c.organization_id
                     AND r.name = ANY($2::text[]))
          OR EXISTS (SELECT 1 FROM user_organizations uo JOIN roles r ON r.id = uo.role_id
                      WHERE uo.user_id = s.user_id AND uo.organization_id = c.organization_id
                        AND r.name = ANY($2::text[]))
        )
      GROUP BY s.user_id, c.organization_id, c.id, c.title, c.description, c.badge_icon, c.badge_name
     ON CONFLICT (user_id, herkunft_challenge_id) DO NOTHING`,
    [challengeId, TEAM_ROLLEN]
  );
  return rowCount;
}

/**
 * Loescht eine Challenge samt Beitraegen und Postfach-Eintraegen.
 *
 * @param {{query: Function}} client  Pool oder Transaktions-Client
 * @param {number|string} challengeId
 * @param {number|string} organizationId  Mandantengrenze
 * @param {object} [opt]
 * @param {boolean} [opt.teamStempelBewahren=false]  Stempel des Teams vorher
 *   in bewahrte_stempel ablegen (Jahrgang loeschen). Das Einzel-Loeschen
 *   durch die Leitung raeumt bewusst alles ab.
 * @returns {Promise<{geloescht: boolean, dateien: string[], jahrgangIds: number[], bewahrt: number}>}
 */
async function loescheChallenge(client, challengeId, organizationId, { teamStempelBewahren = false } = {}) {
  // Jahrgaenge VOR dem Loeschen merken: danach sind die Zuordnungen weg und
  // das Live-Update findet niemanden mehr.
  const { rows: jahrgaenge } = await client.query(
    'SELECT jahrgang_id FROM challenge_jahrgang_assignments WHERE challenge_id = $1',
    [challengeId]
  );
  // Dateien VOR dem Loeschen einsammeln (danach sind die Zeilen weg).
  const { rows: dateien } = await client.query(
    'SELECT file_path FROM challenge_submissions WHERE challenge_id = $1 AND file_path IS NOT NULL',
    [challengeId]
  );

  const bewahrt = teamStempelBewahren ? await bewahreTeamStempel(client, challengeId) : 0;

  const { rowCount } = await client.query(
    'DELETE FROM challenges WHERE id = $1 AND organization_id = $2',
    [challengeId, organizationId]
  );
  // Stempel, "Beitrag ausgeblendet" und "Neuer Beitrag" zu dieser Challenge
  // zeigen auf nichts mehr.
  await loescheMitteilungenZuChallenge(client, challengeId);

  return {
    geloescht: rowCount > 0,
    dateien: dateien.map((d) => d.file_path),
    jahrgangIds: jahrgaenge.map((j) => Number(j.jahrgang_id)),
    bewahrt
  };
}

/**
 * Entfernt Beitrags-Dateien vom Dateisystem -- nach dem COMMIT. Wirft nicht
 * (deleteChallengeFile protokolliert und gibt false zurueck).
 *
 * @param {string[]} dateien
 */
async function entferneChallengeDateien(dateien) {
  for (const datei of dateien || []) {
    await deleteChallengeFile(datei);
  }
}

module.exports = { loescheChallenge, bewahreTeamStempel, entferneChallengeDateien, TEAM_ROLLEN };
