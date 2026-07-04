// teamChat.js — Zentrale Sync-Logik fuer den automatischen Team-Chat.
//
// Sollregel (vom Nutzer festgelegt):
//   - EIN Chat pro Organisation, heisst "Team", type 'admin' (-> pink, Team-Tab).
//   - Drin sind ALLE aktiven Org-Admins, Admins und Teamer:innen der Organisation.
//   - Konfis sind NIE drin.
//   - Auto-Hinzufuegen/Entfernen: wird jemand Teamer/Admin (oder verlaesst die Rolle),
//     passt sich die Mitgliedschaft beim naechsten Sync an.
//
// user_type-Konsistenz (wie beim Jahrgangs-Chat): teamer -> 'teamer',
// org_admin/admin -> 'admin'. So finden Teamer ihren Raum wieder.
//
// Identifikation des Auto-Chats: chat_rooms.is_team_chat = true (Migration 104),
// nicht ueber den Namen (den koennte der Nutzer theoretisch aendern).

/**
 * Stellt sicher, dass fuer eine Organisation ein Team-Chat existiert und die
 * Mitgliedschaft exakt der Sollregel entspricht. Idempotent.
 *
 * @param {object} db        Pool ODER Client (muss .query haben). Innerhalb einer
 *                           Transaktion den Client uebergeben.
 * @param {number} organizationId
 * @param {number|null} createdBy  User-ID fuer created_by bei Neuanlage.
 * @returns {Promise<number|null>} room_id des Team-Chats (oder null bei Fehler).
 */
async function syncTeamChat(db, organizationId, createdBy = null) {
  if (!organizationId) return null;

  // 1. Team-Chat holen oder anlegen (eindeutig per is_team_chat-Flag).
  let { rows: [room] } = await db.query(
    "SELECT id FROM chat_rooms WHERE is_team_chat = true AND organization_id = $1",
    [organizationId]
  );
  if (!room) {
    const { rows: [created] } = await db.query(
      `INSERT INTO chat_rooms (name, type, is_team_chat, organization_id, created_by, created_at)
       VALUES ('Team', 'admin', true, $1, $2, NOW())
       RETURNING id`,
      [organizationId, createdBy]
    );
    room = created;
  }
  const roomId = room.id;

  // 2. SOLL-Mitglieder: alle aktiven Org-Admins/Admins/Teamer der Org.
  //    WICHTIG Multi-Org (Migration 101): Mitgliedschaft kann aus der Primaer-Org
  //    (users.organization_id + users.role_id) ODER aus user_organizations
  //    (Org-Switcher) kommen — beide Quellen zaehlen, sonst entfernt der Sync
  //    eingewechselte Mitglieder aus dem Team-Chat.
  const { rows: sollMembers } = await db.query(
    `
    SELECT u.id AS user_id,
           CASE WHEN r.name = 'teamer' THEN 'teamer' ELSE 'admin' END AS user_type
      FROM users u JOIN roles r ON u.role_id = r.id
     WHERE u.organization_id = $1
       AND r.name IN ('org_admin', 'admin', 'teamer')
       AND u.is_active = true
       AND u.deleted_at IS NULL
    UNION
    SELECT u.id AS user_id,
           CASE WHEN r.name = 'teamer' THEN 'teamer' ELSE 'admin' END AS user_type
      FROM user_organizations uo
      JOIN users u ON uo.user_id = u.id
      JOIN roles r ON uo.role_id = r.id
     WHERE uo.organization_id = $1
       AND r.name IN ('org_admin', 'admin', 'teamer')
       AND u.is_active = true
       AND u.deleted_at IS NULL
    `,
    [organizationId]
  );

  // 3. Fehlende Soll-Mitglieder hinzufuegen (Duplikate ignorieren).
  if (sollMembers.length > 0) {
    const values = [];
    const params = [roomId];
    sollMembers.forEach((m, i) => {
      values.push(`($1, $${i * 2 + 2}, $${i * 2 + 3}, NOW())`);
      params.push(m.user_id, m.user_type);
    });
    await db.query(
      `INSERT INTO chat_participants (room_id, user_id, user_type, joined_at)
       VALUES ${values.join(', ')}
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      params
    );
  }

  // 4. Nicht-mehr-Soll-Mitglieder entfernen (z.B. herabgestufte oder geloeschte).
  const sollKeys = new Set(sollMembers.map((m) => `${m.user_id}:${m.user_type}`));
  const { rows: current } = await db.query(
    'SELECT user_id, user_type FROM chat_participants WHERE room_id = $1',
    [roomId]
  );
  for (const c of current) {
    if (sollKeys.has(`${c.user_id}:${c.user_type}`)) continue;
    await db.query(
      'DELETE FROM chat_participants WHERE room_id = $1 AND user_id = $2 AND user_type = $3',
      [roomId, c.user_id, c.user_type]
    );
  }

  return roomId;
}

module.exports = { syncTeamChat };
