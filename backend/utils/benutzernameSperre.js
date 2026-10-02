// WARUM EINE SPERRE UND KEIN INDEX: Der einzige eindeutige Index ist
// (organization_id, username). Er unterscheidet Gross/klein und greift nur in
// einer Gemeinde -- in einer neuen Gemeinde nie. Ein Index auf LOWER(username)
// braeuchte eine Migration, die an jeder Dublette im Bestand scheitert (in
// Produktion ungeprueft), und wuerde die Anlage einer Dublette nur mit einem
// 23505 beantworten, der sich von einem E-Mail-Konflikt nicht sicher
// unterscheiden laesst. Die Sperre braucht nichts davon und laesst die
// normale Pruefung die Meldung geben.
//
// WIE: pg_advisory_xact_lock auf den kleingeschriebenen Namen, in der
// Transaktion des Anlegens, VOR der Pruefung. Die zweite Anlage wartet, bis die
// erste COMMIT oder ROLLBACK gemacht hat; ihre Pruefung sieht danach das neue
// Konto (READ COMMITTED: jede Abfrage liest den Stand bei ihrem Beginn) und
// antwortet 409. Verschiedene Namen warten nicht aufeinander (eine
// Hash-Kollision liesse hoechstens kurz warten).
//
// NUR MIT DEM CLIENT EINER OFFENEN TRANSAKTION rufen: Ausserhalb einer
// Transaktion endet die Sperre mit der Abfrage selbst und schuetzt nichts.

// Schluesselraum dieser Sperre (erste Haelfte des Zwei-Zahlen-Schluessels),
// wie TERMIN_LOESCHEN_SPERRE und CHALLENGE_BEITRAG_SPERRE.
const BENUTZERNAME_SPERRE = 300926;

const MELDUNG_VERGEBEN = 'Benutzername existiert bereits (muss systemweit eindeutig sein)';

/**
 * Sperrt den Namen bis zum Ende der Transaktion und prueft danach, ob es ihn
 * schon gibt (systemweit, ohne Gross/klein).
 * @param {import('pg').PoolClient} client - Client mit offener Transaktion
 * @param {string} username
 * @param {object} [opt]
 * @param {number|string|null} [opt.ausser] - dieses Konto zaehlt nicht mit
 *   (Umbenennen: der eigene Name ist nicht "vergeben")
 * @returns {Promise<boolean>} true, wenn der Name vergeben ist
 */
async function benutzernameSperrenUndPruefen(client, username, { ausser = null } = {}) {
  await client.query(
    'SELECT pg_advisory_xact_lock($1, hashtext(LOWER($2)))',
    [BENUTZERNAME_SPERRE, username]
  );
  const { rows: [vorhanden] } = await client.query(
    `SELECT id FROM users
      WHERE LOWER(username) = LOWER($1)
        AND ($2::bigint IS NULL OR id <> $2::bigint)
      LIMIT 1`,
    [username, ausser]
  );
  return Boolean(vorhanden);
}

module.exports = {
  BENUTZERNAME_SPERRE,
  MELDUNG_VERGEBEN,
  benutzernameSperrenUndPruefen,
};
