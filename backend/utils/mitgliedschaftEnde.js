// Was an einer Mitgliedschaft in EINER Gemeinde hängt, geht mit ihr.

/**
 * Entfernt Jahrgangs-Zuweisungen, Chat-Plätze und Postfach-Mitteilungen einer
 * Person in EINER Gemeinde. In der Transaktion des Aufrufers laufen lassen
 * (Client übergeben), zusammen mit dem Löschen der Mitgliedschaft selbst.
 *
 * @param {object} db              Client (in der Transaktion) oder Pool
 * @param {number|string} userId
 * @param {number|string} organizationId  die Gemeinde, deren Mitgliedschaft endet
 * @returns {Promise<{jahrgangIds: number[], chatPlaetze: number, mitteilungen: number}>}
 *   jahrgangIds: die Jahrgänge dieser Gemeinde, deren Zuweisung entfernt
 *   wurde (für syncJahrgangChat danach); chatPlaetze: Zahl der geräumten
 *   Plätze; mitteilungen: Zahl der entfernten Postfach-Einträge.
 */
async function gemeindeZugehoerigkeitRaeumen(db, userId, organizationId) {
  const { rows: jahrgaenge } = await db.query(
    `DELETE FROM user_jahrgang_assignments uja
      USING jahrgaenge j
      WHERE uja.jahrgang_id = j.id AND uja.user_id = $1 AND j.organization_id = $2
      RETURNING j.id`,
    [userId, organizationId]
  );
  const { rowCount: chatPlaetze } = await db.query(
    `DELETE FROM chat_participants cp
      USING chat_rooms r
      WHERE cp.room_id = r.id AND cp.user_id = $1 AND r.organization_id = $2`,
    [userId, organizationId]
  );
  const { rowCount: mitteilungen } = await db.query(
    'DELETE FROM notifications WHERE user_id = $1 AND organization_id = $2',
    [userId, organizationId]
  );
  return { jahrgangIds: jahrgaenge.map((r) => r.id), chatPlaetze, mitteilungen };
}

/**
 * HIER ZUHAUSE, ABER AUCH ANDERSWO MITGLIED: DAS KONTO ZIEHT UM.
 *
 * Die Stamm-Gemeinde des Kontos wird eine der weiteren Gemeinden, mit der
 * Rolle, die es dort hat. Die Zeile dieser weiteren Gemeinde in
 * user_organizations geht (sie ist jetzt die Stamm-Gemeinde), ebenso eine
 * alte Stamm-Zeile der verlassenen Gemeinde (Migration 101 hat jede
 * Stamm-Gemeinde auch dort eingetragen -- sie ist KEINE weitere
 * Mitgliedschaft). Jahrgaenge, Chat-Plaetze und Postfach der verlassenen
 * Gemeinde gehen wie bei jedem Ende einer Mitgliedschaft
 * (gemeindeZugehoerigkeitRaeumen).
 *
 * Welche Gemeinde: zuerst eine aktive, dann die aelteste Mitgliedschaft.
 *
 * In der Transaktion des Aufrufers laufen lassen; der Aufrufer sperrt die
 * Zeile in users vorher und leert danach Rechte-Cache und Sockets.
 *
 * @param {object} client  Client in der Transaktion
 * @param {number|string} userId
 * @param {number|string} organizationId  die Gemeinde, die das Konto verlaesst
 * @returns {Promise<null | {organization_id: number, role_id: number}>}
 *   die neue Stamm-Gemeinde und Rolle; null, wenn es keine weitere
 *   Mitgliedschaft gibt -- dann ist nichts geaendert.
 */
async function inWeitereGemeindeUmziehen(client, userId, organizationId) {
  const { rows: [ziel] } = await client.query(
    `SELECT uo.organization_id, uo.role_id
       FROM user_organizations uo
       JOIN organizations o ON o.id = uo.organization_id
      WHERE uo.user_id = $1 AND uo.organization_id <> $2
      ORDER BY COALESCE(o.is_active, true) DESC,
               uo.created_at ASC NULLS LAST,
               uo.id ASC
      LIMIT 1`,
    [userId, organizationId]
  );
  if (!ziel) return null;

  await client.query(
    'UPDATE users SET organization_id = $2, role_id = $3, updated_at = NOW() WHERE id = $1',
    [userId, ziel.organization_id, ziel.role_id]
  );
  await client.query(
    'DELETE FROM user_organizations WHERE user_id = $1 AND organization_id IN ($2, $3)',
    [userId, ziel.organization_id, organizationId]
  );
  await gemeindeZugehoerigkeitRaeumen(client, userId, organizationId);
  return { organization_id: Number(ziel.organization_id), role_id: Number(ziel.role_id) };
}

module.exports = { gemeindeZugehoerigkeitRaeumen, inWeitereGemeindeUmziehen };
