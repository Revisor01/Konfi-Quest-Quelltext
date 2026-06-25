// Utility functions for chat system

// Holt den ersten aktiven Admin einer Organisation (gecacht pro Aufruf)
async function getFirstActiveAdmin(db, organizationId) {
  const { rows } = await db.query(
    `SELECT u.id FROM users u
     JOIN roles r ON u.role_id = r.id
     WHERE r.name = 'admin' AND u.organization_id = $1 AND u.is_active = true
     ORDER BY u.id ASC LIMIT 1`,
    [organizationId]
  );
  if (rows.length === 0) {
    console.warn(`Kein aktiver Admin fuer Organisation ${organizationId} gefunden, Fallback auf ID 1`);
    return 1;
  }
  return rows[0].id;
}

// Initialize default chat rooms - UPDATED FOR RBAC SYSTEM
const initializeChatRooms = (db) => {
  return async () => {
    try {

      // Create jahrgang chat rooms for each organization
      const { rows: jahrgaenge } = await db.query("SELECT * FROM jahrgaenge ORDER BY organization_id, id", []);

      // Admin-Lookup pro Organisation cachen (nicht pro Jahrgang)
      const adminByOrg = new Map();
      const orgIds = [...new Set(jahrgaenge.map(j => j.organization_id))];
      for (const orgId of orgIds) {
        adminByOrg.set(orgId, await getFirstActiveAdmin(db, orgId));
      }

      for (const jahrgang of jahrgaenge) {
        const { rows: [existingRoom] } = await db.query(
          "SELECT id FROM chat_rooms WHERE type = 'jahrgang' AND jahrgang_id = $1 AND organization_id = $2",
          [jahrgang.id, jahrgang.organization_id]
        );

        if (!existingRoom) {

          // Create room with dynamic admin of this organization
          const createdBy = adminByOrg.get(jahrgang.organization_id);
          const insertRoomQuery = `
            INSERT INTO chat_rooms (name, type, jahrgang_id, organization_id, created_by, created_at)
            VALUES ($1, 'jahrgang', $2, $3, $4, NOW())
            RETURNING id
          `;
          const { rows: [newRoom] } = await db.query(insertRoomQuery, [
            `Jahrgang ${jahrgang.name}`,
            jahrgang.id,
            jahrgang.organization_id,
            createdBy
          ]);
          const newRoomId = newRoom.id;

          // Add all konfis of this jahrgang to the room (RBAC structure)
          const konfisQuery = `
            SELECT u.id 
            FROM users u
            JOIN roles r ON u.role_id = r.id
            JOIN konfi_profiles kp ON u.id = kp.user_id
            WHERE r.name = 'konfi' 
              AND kp.jahrgang_id = $1 
              AND u.organization_id = $2
          `;
          const { rows: konfis } = await db.query(konfisQuery, [jahrgang.id, jahrgang.organization_id]);
          
          for (const konfi of konfis) {
            const insertParticipantQuery = `
              INSERT INTO chat_participants (room_id, user_id, user_type, joined_at) 
              VALUES ($1, $2, 'konfi', NOW())
            `;
            await db.query(insertParticipantQuery, [newRoomId, konfi.id]);
          }
          
        } else {
        }
      }
      
    } catch (err) {
 console.error('Error during chat room initialization:', err);
    }
  };
};

module.exports = {
  initializeChatRooms
};