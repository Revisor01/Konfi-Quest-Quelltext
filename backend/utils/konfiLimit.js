// backend/utils/konfiLimit.js
// Gemeinsame Konfi-Limit-Prüfung (Single Source of Truth).
// Wird von beiden Anlage-Wegen genutzt (Wave 2): POST-Konfi-Route (Leitung legt an)
// und Invite-Code-Selbstregistrierung. Analog deleteKonfiCascade aus Phase 114 wird
// die Logik EINMAL gebaut, damit die Durchsetzung nicht auseinanderlaeuft.

// Kulanz-Puffer über dem Tarif-Limit: bis zu GRACE_BUFFER weitere Konfis
// duerfen mit Bestaetigung angelegt werden, danach harte Grenze.
const GRACE_BUFFER = 5;

const TARIF_STUFEN = [15, 50, 75, 100];

/**
 * Ermittelt die naechsthoehere Tarif-Stufe über dem aktuellen Limit.
 * @param {number|null} limit - aktuelles max_konfis der Org
 * @returns {number|null} kleinste Stufe > limit, oder null wenn keine groessere existiert
 */
function nextTier(limit) {
  if (limit === null || limit === undefined) return null;
  for (const stufe of TARIF_STUFEN) {
    if (stufe > limit) return stufe;
  }
  return null;
}

/**
 * Ermittelt die Limit-Stufe einer Organisation anhand der aktiven Konfi-Anzahl.
 *
 * Stufen:
 *   - max_konfis IS NULL                         -> { stufe: 'under_limit', count, limit: null }
 *   - count < max_konfis                         -> { stufe: 'under_limit', count, limit }
 *   - max_konfis <= count < max_konfis + 5       -> { stufe: 'grace',       count, limit }
 *   - count >= max_konfis + 5                    -> { stufe: 'hard_block',  count, limit }
 *
 * Gezaehlt werden ausschliesslich aktive Konfis (Rolle 'konfi') der Org mit
 * deleted_at IS NULL — soft-geloeschte Konfis (Phase 114) zählen NICHT.
 * Die Zählung ist org-isoliert (organization_id = $1).
 *
 * db kann ein Pool ODER ein laufender Client (aus db.getClient()) sein, damit die
 * Prüfung in eine Transaktion des Aufrufers eingebettet werden kann (Util-Muster Phase 114).
 *
 * @param {{ query: Function }} db - DB-Pool oder Client
 * @param {number} organizationId - Organisation, deren Limit geprüft wird
 * @returns {Promise<{ count: number, limit: number|null, stufe: 'under_limit'|'grace'|'hard_block' }>}
 */
async function checkKonfiLimit(db, organizationId) {
  // 1. Limit der Org lesen.
  const { rows: orgRows } = await db.query(
    'SELECT max_konfis FROM organizations WHERE id = $1',
    [organizationId]
  );
  const limit = orgRows.length > 0 && orgRows[0].max_konfis !== null
    ? Number(orgRows[0].max_konfis)
    : null;

  // 2. Aktive Konfis der Org zählen (NICHT konfi_profiles — das filtert deleted_at nicht).
  const { rows: countRows } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM users u
       JOIN roles r ON u.role_id = r.id
      WHERE r.name = 'konfi'
        AND u.organization_id = $1
        AND u.deleted_at IS NULL`,
    [organizationId]
  );
  const count = countRows[0].count;

  // 3. Stufe bestimmen.
  if (limit === null) {
    return { count, limit: null, stufe: 'under_limit' };
  }
  if (count < limit) {
    return { count, limit, stufe: 'under_limit' };
  }
  if (count < limit + GRACE_BUFFER) {
    return { count, limit, stufe: 'grace' };
  }
  return { count, limit, stufe: 'hard_block' };
}

module.exports = { checkKonfiLimit, GRACE_BUFFER, nextTier, TARIF_STUFEN };
