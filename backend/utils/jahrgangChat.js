// jahrgangChat.js — Zentrale Sync-Logik fuer den automatischen Jahrgangs-Chat.
//
// Sollregel (vom Nutzer festgelegt):
//   - Org-Admins (role org_admin) sind IMMER in allen Jahrgangs-Chats ihrer Org
//     und werden NICHT durch Zuweisungs-Entzug entfernt (Vollzugriff).
//   - Admins (role admin) + Teamer (role teamer) sind im Jahrgangs-Chat, wenn sie
//     dem Jahrgang via user_jahrgang_assignment (can_view) zugewiesen sind.
//     Bei Entzug der Zuweisung fliegen sie raus.
//   - Alle Konfis des Jahrgangs sind drin; neue automatisch.
//
// WICHTIG user_type-Konsistenz: chat_participants.user_type MUSS dem
// req.user.type entsprechen, mit dem spaeter gelesen wird:
//   konfi -> 'konfi', teamer -> 'teamer', org_admin/admin -> 'admin'.
// (Frueher wurden Teamer teils als 'admin' gespeichert und fanden ihre Raeume
//  dann nicht — siehe Migration 098.)

// Mappt eine Rolle auf den chat_participants.user_type-Wert.
const roleToParticipantType = (roleName) =>
  roleName === 'konfi' ? 'konfi' : roleName === 'teamer' ? 'teamer' : 'admin';

/**
 * Stellt sicher, dass fuer einen Jahrgang ein Chat-Raum existiert und die
 * Mitgliedschaft exakt der Sollregel entspricht. Idempotent.
 *
 * @param {object} db        Pool ODER Client (muss .query haben). Bei Aufruf
 *                           innerhalb einer Transaktion den Client uebergeben.
 * @param {number} jahrgangId
 * @param {number} organizationId
 * @param {number|null} createdBy  User-ID fuer created_by bei Neuanlage.
 * @returns {Promise<number|null>} room_id des Jahrgangs-Chats (oder null bei Fehler).
 */
async function syncJahrgangChat(db, jahrgangId, organizationId, createdBy = null) {
  // 1. Jahrgang laden (Name fuer Chat-Titel, org-gescopt zur Sicherheit)
  const { rows: [jahrgang] } = await db.query(
    'SELECT id, name FROM jahrgaenge WHERE id = $1 AND organization_id = $2',
    [jahrgangId, organizationId]
  );
  if (!jahrgang) return null;

  // 2. Chat-Raum holen oder anlegen
  let { rows: [room] } = await db.query(
    "SELECT id FROM chat_rooms WHERE type = 'jahrgang' AND jahrgang_id = $1 AND organization_id = $2",
    [jahrgangId, organizationId]
  );
  if (!room) {
    const { rows: [created] } = await db.query(
      `INSERT INTO chat_rooms (name, type, jahrgang_id, organization_id, created_by, created_at)
       VALUES ($1, 'jahrgang', $2, $3, $4, NOW())
       RETURNING id`,
      [`Jahrgang ${jahrgang.name}`, jahrgangId, organizationId, createdBy]
    );
    room = created;
  }
  const roomId = room.id;

  // 3. SOLL-Mitglieder bestimmen.
  //    a) Org-Admins der Org (immer), b) Admin/Teamer mit can_view-Zuweisung,
  //    c) alle Konfis des Jahrgangs. Ergebnis: (user_id, user_type).
  const { rows: sollMembers } = await db.query(
    `
    -- Org-Admins: immer drin
    SELECT u.id AS user_id, 'admin'::text AS user_type
      FROM users u JOIN roles r ON u.role_id = r.id
     WHERE u.organization_id = $2 AND r.name = 'org_admin' AND u.is_active = true
       AND u.deleted_at IS NULL
    UNION
    -- Admins + Teamer mit Zuweisung auf diesen Jahrgang
    SELECT u.id AS user_id,
           CASE WHEN r.name = 'teamer' THEN 'teamer' ELSE 'admin' END AS user_type
      FROM user_jahrgang_assignments uja
      JOIN users u ON uja.user_id = u.id
      JOIN roles r ON u.role_id = r.id
     WHERE uja.jahrgang_id = $1 AND uja.can_view = true
       AND u.organization_id = $2 AND r.name IN ('admin', 'teamer')
       AND u.is_active = true AND u.deleted_at IS NULL
    UNION
    -- Alle Konfis des Jahrgangs
    SELECT kp.user_id, 'konfi'::text AS user_type
      FROM konfi_profiles kp
      JOIN users u ON kp.user_id = u.id
      JOIN roles r ON u.role_id = r.id
     WHERE kp.jahrgang_id = $1 AND r.name = 'konfi'
       AND u.organization_id = $2 AND u.is_active = true AND u.deleted_at IS NULL
    `,
    [jahrgangId, organizationId]
  );

  // 4. Fehlende Soll-Mitglieder hinzufuegen (Set-basiert, Duplikate ignorieren)
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

  // 5. Nicht-mehr-Soll-Mitglieder entfernen — ABER Org-Admins nie (Vollzugriff).
  //    Wir loeschen alle aktuellen Teilnehmer, die nicht in der Soll-Liste stehen
  //    und KEIN org_admin sind.
  const sollKeys = new Set(sollMembers.map((m) => `${m.user_id}:${m.user_type}`));
  const { rows: current } = await db.query(
    'SELECT user_id, user_type FROM chat_participants WHERE room_id = $1',
    [roomId]
  );
  for (const c of current) {
    if (sollKeys.has(`${c.user_id}:${c.user_type}`)) continue;
    // Org-Admin-Schutz: nie entfernen, selbst wenn (theoretisch) nicht in Soll.
    const { rows: [isOrgAdmin] } = await db.query(
      `SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id
        WHERE u.id = $1 AND r.name = 'org_admin'`,
      [c.user_id]
    );
    if (isOrgAdmin) continue;
    await db.query(
      'DELETE FROM chat_participants WHERE room_id = $1 AND user_id = $2 AND user_type = $3',
      [roomId, c.user_id, c.user_type]
    );
  }

  return roomId;
}

module.exports = { syncJahrgangChat, roleToParticipantType };
