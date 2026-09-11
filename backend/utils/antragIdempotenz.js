// backend/utils/antragIdempotenz.js
// Wiederholte Antragstellung mit derselben client_id darf nicht zu einem
// zweiten Antrag und nicht zu einem Fehler fuehren, sondern muss den bereits
// vorhandenen Antrag zurueckgeben.
//
// Hintergrund: Die App schickt zu jedem Antrag eine client_id (UUID). Bricht
// die Verbindung nach dem INSERT, aber vor der Antwort ab, versucht die App es
// erneut. Ohne Behandlung liefe der zweite Versuch in den UNIQUE-Index
// idx_activity_requests_client_id (Fehlercode 23505) -- die Nutzerin saehe
// einen Fehler, obwohl ihr Antrag laengst gestellt ist.
//
// Der Vorab-Check allein genuegt nicht: Zwischen SELECT und INSERT passt ein
// zweiter Versuch (Race). Deshalb braucht es BEIDES -- Vorab-Check und
// 23505-Catch.

// Feldliste der Antwort. Bewusst ausgeschrieben statt "*": Die
// ausgelieferten Store-Apps lesen genau diese Felder, ein spaeteres
// Hinzufuegen einer Spalte soll die Antwortform nicht still veraendern.
const ANTRAG_FELDER = `id, user_id, activity_id, requested_date, comment,
  photo_filename, status, organization_id, client_id, created_at, updated_at`;

/**
 * Sucht einen bereits gestellten Antrag zu dieser client_id.
 *
 * @param {object} db - pg Pool
 * @param {string|null|undefined} clientId
 * @returns {Promise<object|null>} vorhandener Antrag oder null
 */
async function findeAntragZuClientId(db, clientId) {
  if (!clientId) return null;
  const { rows: [vorhanden] } = await db.query(
    `SELECT ${ANTRAG_FELDER} FROM activity_requests WHERE client_id = $1`,
    [clientId]
  );
  return vorhanden || null;
}

/**
 * Behandelt einen Fehler aus dem INSERT: Handelt es sich um die
 * client_id-Race (23505), wird der bereits vorhandene Antrag mit 200
 * ausgeliefert und true zurueckgegeben. Sonst false -- die aufrufende Route
 * beantwortet den Fehler dann wie bisher.
 *
 * @param {object} db - pg Pool
 * @param {Error} err - Fehler aus dem INSERT
 * @param {string|null|undefined} clientId
 * @param {object} res - Express-Response
 * @returns {Promise<boolean>} true, wenn bereits geantwortet wurde
 */
async function behandleClientIdRace(db, err, clientId, res) {
  if (err.code !== '23505' || !err.detail?.includes('client_id')) return false;
  try {
    const vorhanden = await findeAntragZuClientId(db, clientId);
    if (vorhanden) {
      res.status(200).json(vorhanden);
      return true;
    }
  } catch (lookupErr) {
    console.error('Error looking up duplicate request:', lookupErr);
  }
  return false;
}

module.exports = { findeAntragZuClientId, behandleClientIdRace, ANTRAG_FELDER };
