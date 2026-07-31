const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors, commonValidations } = require('../middleware/validation');
const { checkUserHierarchy, filterUsersByHierarchy } = require('../utils/roleHierarchy');
const { validatePassword } = require('../utils/passwordUtils');
const { invalidateUserCache } = require('../middleware/rbac');
const { syncJahrgangChat } = require('../utils/jahrgangChat');
const { syncTeamChat } = require('../utils/teamChat');
const chatSyncCache = require('../utils/chatSyncCache');
const { deletePhotoFile } = require('../utils/photoStorage');
const liveUpdate = require('../utils/liveUpdate');

// User management routes
// WICHTIGER HINWEIS: Das übergebene 'db'-Objekt ist eine PostgreSQL Pool-Instanz.
// Transaktionen verwenden einen dedizierten Client via db.getClient() (pool.connect()).
// Users: Nur org_admin darf verwalten
module.exports = (db, rbacVerifier, { requireOrgAdmin }, io) => {

  // Validierungsregeln
  const validateCreateUser = [
    commonValidations.username,
    body('display_name').trim().notEmpty().withMessage('Anzeigename ist erforderlich'),
    commonValidations.password,
    body('role_id').isInt({ min: 1 }).withMessage('Ungültige Rollen-ID'),
    handleValidationErrors
  ];

  const validateUpdateUser = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    // Gleiche Zeichenregeln wie beim Anlegen (commonValidations.username) —
    // sonst kann ein Update Usernamen mit Leerzeichen/Sonderzeichen einschleusen.
    body('username').optional()
      .isLength({ min: 3, max: 50 }).withMessage('Benutzername muss zwischen 3 und 50 Zeichen lang sein')
      .matches(/^[a-zA-Z0-9.-]+$/).withMessage('Benutzername darf nur Buchstaben, Zahlen, Punkt (.) und Bindestrich (-) enthalten — keine Leerzeichen oder anderen Sonderzeichen'),
    body('display_name').optional().trim().notEmpty().withMessage('Anzeigename darf nicht leer sein'),
    handleValidationErrors
  ];

  const validateUserId = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors
  ];

  const validateResetPassword = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('password').isLength({ min: 8 }).withMessage('Passwort muss mindestens 8 Zeichen lang sein'),
    handleValidationErrors
  ];

  const validateJahrgangAssignments = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('jahrgang_assignments').isArray().withMessage('jahrgang_assignments muss ein Array sein'),
    handleValidationErrors
  ];

  // Hierarchie-Middleware mit DB-Zugriff
  // Diese Middleware erfordert eine Modifikation in der checkUserHierarchy-Funktion,
  // um asynchron zu sein und das db-Objekt korrekt zu verwenden, falls es dort
  // ebenfalls Datenbankabfragen durchführt. Hier wird angenommen, dass die
  // Übergabe von req.db ausreicht.
  const userHierarchyMiddleware = (operation) => {
    return (req, res, next) => {
      // Das 'db' Objekt wird hier explizit an den Request angehängt.
      // In einer Express-Anwendung ist es oft besser, die DB-Verbindung
      // über eine dedizierte Middleware am Anfang der Kette bereitzustellen.
      req.db = db;
      return checkUserHierarchy(operation)(req, res, next);
    };
  };

  // Get users in current organization
  router.get('/', rbacVerifier, requireOrgAdmin, async (req, res) => {
    const organizationId = req.user.organization_id;

    const query = `
      SELECT u.id, u.username, u.email, u.display_name, u.role_title, u.is_active,
             u.last_login_at, u.created_at, u.updated_at,
             r.name as role_name, r.display_name as role_display_name,
             r.description as role_description,
             COUNT(DISTINCT uja.jahrgang_id) as assigned_jahrgaenge_count
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN user_jahrgang_assignments uja ON u.id = uja.user_id
      WHERE u.organization_id = $1 AND r.name NOT IN ('konfi', 'super_admin')
      GROUP BY u.id, r.name, r.display_name, r.description
      ORDER BY u.created_at DESC
    `;

    try {
      const { rows: users } = await db.query(query, [organizationId]);

      // Markiere Users als editierbar basierend auf Hierarchie statt sie zu filtern
      const usersWithEditability = users.map(user => ({
        ...user,
        can_edit: filterUsersByHierarchy([user], req.user.role_name).length > 0
      }));
      res.json(usersWithEditability);

    } catch (err) {
 console.error('Database error in GET /users:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get single user with details
  router.get('/:id', rbacVerifier, requireOrgAdmin, userHierarchyMiddleware('view'), async (req, res) => {
    const { id } = req.params;
    const organizationId = req.user.organization_id;

    const userQuery = `
      SELECT u.id, u.username, u.email, u.display_name, u.role_title, u.is_active,
             u.last_login_at, u.created_at, u.updated_at,
             r.id as role_id, r.name as role_name, r.display_name as role_display_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = $1 AND u.organization_id = $2
    `;

    const jahrgaengeQuery = `
      SELECT j.id, j.name, uja.can_view, uja.can_edit, uja.assigned_at,
             assigner.display_name as assigned_by_name
      FROM user_jahrgang_assignments uja
      JOIN jahrgaenge j ON uja.jahrgang_id = j.id
      LEFT JOIN users assigner ON uja.assigned_by = assigner.id
      WHERE uja.user_id = $1
      ORDER BY j.name
    `;

    try {
      const { rows: [user] } = await db.query(userQuery, [id, organizationId]);

      if (!user) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }

      const { rows: jahrgaenge } = await db.query(jahrgaengeQuery, [id]);

      res.json({
        ...user,
        assigned_jahrgaenge: jahrgaenge
      });

    } catch (err) {
 console.error(`Database error in GET /users/${id}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Create new user
  router.post('/', rbacVerifier, requireOrgAdmin, userHierarchyMiddleware('create'), validateCreateUser, async (req, res) => {
    const organizationId = req.user.organization_id;
    const { username, email, display_name, role_title, password, role_id } = req.body;

    if (!username || !display_name || !password || !role_id) {
      return res.status(400).json({ error: 'Benutzername, Name, Passwort und Rolle sind erforderlich' });
    }

    try {
      // Verify role exists in organization (name wird unten fuer den Chat-Sync gebraucht)
      const roleCheckQuery = "SELECT id, name FROM roles WHERE id = $1 AND organization_id = $2";
      const { rows: [role] } = await db.query(roleCheckQuery, [role_id, organizationId]);

      if (!role) {
        return res.status(400).json({ error: 'Ungültige Rolle für diese Organisation' });
      }

      // Prüfen ob Benutzername bereits existiert (GLOBAL eindeutig, case-insensitiv —
      // sonst koennten "Anna"/"anna" parallel existieren und der Login waere mehrdeutig).
      const { rows: [existingUser] } = await db.query(
        "SELECT id FROM users WHERE LOWER(username) = LOWER($1)",
        [username]
      );

      if (existingUser) {
        return res.status(409).json({ error: 'Benutzername existiert bereits (muss systemweit eindeutig sein)' });
      }

      // Passwort-Policy prüfen
      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      const insertQuery = `
        INSERT INTO users (organization_id, username, email, display_name, role_title, password_hash, role_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;
      const insertParams = [organizationId, username, email, display_name, role_title || null, passwordHash, role_id];
      const { rows: [newUser] } = await db.query(insertQuery, insertParams);

      res.status(201).json({
        id: newUser.id,
        message: 'Benutzer erfolgreich erstellt',
        username,
        display_name
      });

      // Live-Update NACH der Response: neuer Benutzer in der Benutzer-Liste.
      liveUpdate.sendToOrgAdmins(organizationId, 'users', 'create', { userId: newUser.id });

      // Chat-Mitgliedschaft INLINE pflegen (der TTL-Sync-Cache verlaesst sich
      // darauf, dass Mutations-Handler das tun — sonst erscheinen neue
      // Teamer:innen/Admins erst nach bis zu 10 Minuten im Team-Chat).
      if (['org_admin', 'admin', 'teamer'].includes(role.name)) {
        try {
          await syncTeamChat(db, organizationId, req.user.id);
          // Org-Admins sind ausserdem in ALLEN Jahrgangs-Chats der Org.
          if (role.name === 'org_admin') {
            const { rows: jgs } = await db.query(
              'SELECT id FROM jahrgaenge WHERE organization_id = $1', [organizationId]
            );
            for (const jg of jgs) {
              await syncJahrgangChat(db, jg.id, organizationId, req.user.id);
            }
          }
        } catch (syncErr) {
          console.error('Chat-Sync nach Benutzer-Anlage fehlgeschlagen:', syncErr.message);
        }
      }

    } catch (err) {
      // '23505' is the code for unique_violation in PostgreSQL
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Benutzername oder E-Mail existiert bereits' });
      }
 console.error('Database error in POST /users:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Update user
  router.put('/:id', rbacVerifier, requireOrgAdmin, userHierarchyMiddleware('update'), validateUpdateUser, async (req, res) => {
    const { id } = req.params;
    const organizationId = req.user.organization_id;
    const { username, email, display_name, role_title, role_id, is_active, password } = req.body;

    try {
      // Check if user exists in organization
      const { rows: [user] } = await db.query("SELECT id FROM users WHERE id = $1 AND organization_id = $2", [id, organizationId]);
      if (!user) {
        return res.status(404).json({ error: 'Benutzer in dieser Organisation nicht gefunden' });
      }

      // Verify role exists in organization if role_id is provided
      if (role_id) {
        const { rows: [role] } = await db.query("SELECT id FROM roles WHERE id = $1 AND organization_id = $2", [role_id, organizationId]);
        if (!role) {
          return res.status(400).json({ error: 'Ungültige Rolle für diese Organisation' });
        }
      }

      let updateParams = [];
      let updateFields = [];

      function addUpdate(field, value) {
        if (value !== undefined) {
          updateFields.push(`${field} = $${updateParams.length + 1}`);
          updateParams.push(value);
        }
      }

      addUpdate('username', username);
      addUpdate('email', email);
      addUpdate('display_name', display_name);
      addUpdate('role_title', role_title);
      addUpdate('role_id', role_id);
      addUpdate('is_active', is_active);

      if (password) {
        updateFields.push(`password_hash = $${updateParams.length + 1}`);
        updateParams.push(await bcrypt.hash(password, 10));
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ error: 'Keine Felder zum Aktualisieren' });
      }

      updateFields.push('updated_at = NOW()');

      updateParams.push(id, organizationId);
      const whereClause = `WHERE id = $${updateParams.length - 1} AND organization_id = $${updateParams.length}`;
      let updateQuery = `UPDATE users SET ${updateFields.join(', ')} ${whereClause}`;

      const { rowCount } = await db.query(updateQuery, updateParams);

      if (rowCount === 0) {
        // This case should theoretically not be hit due to the initial check, but is good for safety.
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }

      res.json({ message: 'Benutzer erfolgreich aktualisiert' });

      // Live-Update NACH der Response: geaenderter Benutzer in der Benutzer-Liste.
      liveUpdate.sendToOrgAdmins(organizationId, 'users', 'update', { userId: parseInt(id) });

      // Cache invalidieren damit neues Token sofort wirkt
      if (role_id !== undefined) {
        invalidateUserCache(parseInt(id));
      }

      // Rollen- oder Aktiv-Status-Wechsel aendert die Soll-Mitgliedschaft in
      // Team-/Jahrgangs-Chats -> INLINE syncen (TTL-Cache verlaesst sich darauf)
      // und den Sync-Cache des Users invalidieren.
      if (role_id !== undefined || is_active !== undefined) {
        try {
          chatSyncCache.invalidate(organizationId, parseInt(id));
          await syncTeamChat(db, organizationId, req.user.id);
          const { rows: assigned } = await db.query(
            'SELECT jahrgang_id FROM user_jahrgang_assignments WHERE user_id = $1',
            [id]
          );
          for (const a of assigned) {
            await syncJahrgangChat(db, a.jahrgang_id, organizationId, req.user.id);
          }
        } catch (syncErr) {
          console.error('Chat-Sync nach Benutzer-Aenderung fehlgeschlagen:', syncErr.message);
        }
      }

      // Deaktivierung (is_active=false): Aktive Sockets trennen, damit ein noch
      // verbundener Client mit deaktiviertem Konto nicht weiter Live-Updates
      // mitliest. Deckt alle drei Raum-Typen ab (konfi/teamer/admin).
      if (is_active === false) {
        liveUpdate.disconnectUserSockets(parseInt(id));
      }

      // Bei Rollenänderung: Socket.io-Verbindungen des Users trennen
      // damit der Client sich mit neuem Token (neue Rolle) neu verbindet
      if (role_id !== undefined && io) {
        // User-Room-Name folgt dem Pattern aus server.js: user_{type}_{id}
        // Beide möglichen Typen prüfen (admin und konfi)
        const userRoomAdmin = `user_admin_${id}`;
        const userRoomKonfi = `user_konfi_${id}`;

        for (const roomName of [userRoomAdmin, userRoomKonfi]) {
          const sockets = await io.in(roomName).fetchSockets();
          for (const s of sockets) {
            s.emit('forceDisconnect', { reason: 'role_changed' });
            s.disconnect(true);
          }
        }
      }

    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Benutzername oder E-Mail existiert bereits' });
      }
 console.error(`Database error in PUT /users/${id}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Delete user
  router.delete('/:id', rbacVerifier, requireOrgAdmin, userHierarchyMiddleware('delete'), validateUserId, async (req, res) => {
    const { id } = req.params;
    const organizationId = req.user.organization_id;

    // Prevent self-deletion
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Du kannst dein eigenes Konto nicht löschen' });
    }

    // Prüfe ob letzter Org-Admin
    try {
      const targetUser = await db.query('SELECT role_id FROM users WHERE id = $1 AND organization_id = $2', [id, organizationId]);
      if (targetUser.rows[0]) {
        const targetRole = await db.query('SELECT name FROM roles WHERE id = $1', [targetUser.rows[0].role_id]);
        if (targetRole.rows[0]?.name === 'org_admin') {
          const orgAdminCount = await db.query(
            'SELECT COUNT(*)::int as count FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = $1 AND u.organization_id = $2 AND u.id != $3',
            ['org_admin', organizationId, id]
          );
          if (orgAdminCount.rows[0].count === 0) {
            return res.status(409).json({ error: 'Letzter Org-Admin kann nicht gelöscht werden' });
          }
        }
      }
    } catch (err) {
      console.error('Error checking last org_admin:', err);
      return res.status(500).json({ error: 'Datenbankfehler' });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Delete user jahrgang assignments
      await client.query("DELETE FROM user_jahrgang_assignments WHERE user_id = $1", [id]);

      // Verwaiste FK-Referenzen auf diesen User aufloesen, bevor users geloescht wird.
      // admin_id/created_by referenzieren den HANDELNDEN User (nicht das Subjekt) — diese
      // Historie der Konfis bleibt erhalten, die Referenz wird anonymisiert (SET NULL).
      // Tabellen mit NOT-NULL-Referenz (invite_codes.created_by) werden geloescht.
      // Pro Statement fehlertolerant: nicht vorhandene Spalten/Tabellen duerfen den
      // Loeschvorgang nicht kippen (Schema variiert je nach Migrationsstand).
      const nullifyRefs = [
        "UPDATE bonus_points SET admin_id = NULL WHERE admin_id = $1",
        "UPDATE event_points SET admin_id = NULL WHERE admin_id = $1",
        "UPDATE user_activities SET admin_id = NULL WHERE admin_id = $1",
        "UPDATE user_certificates SET admin_id = NULL WHERE admin_id = $1",
        "UPDATE materials SET created_by = NULL WHERE created_by = $1",
        "UPDATE chat_rooms SET created_by = NULL WHERE created_by = $1",
        "UPDATE activity_requests SET approved_by = NULL WHERE approved_by = $1",
      ];
      for (const sql of nullifyRefs) {
        // SAVEPOINT: bei nicht vorhandener Spalte/Tabelle (42703/42P01) nur dieses
        // eine Statement zuruecknehmen, nicht die ganze Transaktion aborten.
        await client.query('SAVEPOINT ref_nullify');
        try {
          await client.query(sql, [id]);
          await client.query('RELEASE SAVEPOINT ref_nullify');
        } catch (refErr) {
          await client.query('ROLLBACK TO SAVEPOINT ref_nullify');
          if (refErr.code !== '42703' && refErr.code !== '42P01') throw refErr;
        }
      }
      // invite_codes.created_by ist NOT NULL -> Eintraege loeschen
      await client.query("DELETE FROM invite_codes WHERE created_by = $1", [id]);
      // Chat-Daten des Users (Teamer/Admin koennen Teilnehmer/Autoren sein)
      await client.query("DELETE FROM chat_participants WHERE user_id = $1", [id]);
      await client.query("DELETE FROM chat_read_status WHERE user_id = $1", [id]);
      await client.query("DELETE FROM chat_messages WHERE user_id = $1", [id]);
      await client.query(`
        DELETE FROM chat_rooms r
        WHERE r.type = 'direct'
        AND NOT EXISTS (SELECT 1 FROM chat_participants p WHERE p.room_id = r.id)
      `);
      await client.query("DELETE FROM notifications WHERE user_id = $1", [id]);
      await client.query("DELETE FROM push_tokens WHERE user_id = $1", [id]);
      await client.query("DELETE FROM password_resets WHERE user_id = $1", [id]);

      // Nachweisfotos der Antraege dieses Users einsammeln, BEVOR activity_requests
      // im Purge unten geloescht wird — sonst blieben die Dateien als Leichen liegen.
      // Entfernt werden sie erst nach erfolgreichem COMMIT.
      let photoFilenames = [];
      try {
        const { rows } = await client.query(
          "SELECT photo_filename FROM activity_requests WHERE user_id = $1 AND photo_filename IS NOT NULL",
          [id]
        );
        photoFilenames = rows.map(r => r.photo_filename);
      } catch (photoErr) {
        // activity_requests evtl. nicht vorhanden (Schema-Varianz) — nicht kippen
        if (photoErr.code !== '42703' && photoErr.code !== '42P01') throw photoErr;
      }

      // Konfi-History DIESES Users mitloeschen. Wichtig: Diese Tabellen tragen
      // (aus der SQLite-Altlast) einen zweiten NO-ACTION-FK auf users(id) neben
      // dem CASCADE-FK — NO ACTION gewinnt und wuerde den User-Delete sonst mit
      // "violates foreign key constraint" (500) blocken. Der NO-ACTION-Schutz ist
      // gewollt fuer den JAHRGANG-Delete (dort bleibt der User bestehen und behaelt
      // seine History). Wird der USER selbst geloescht, gehoert seine History mit weg.
      // Fehlertolerant (Schema-Varianz je Migrationsstand), analog zu nullifyRefs.
      const purgeHistory = [
        "DELETE FROM activity_requests WHERE user_id = $1",
        "DELETE FROM bonus_points WHERE konfi_id = $1",
        "DELETE FROM user_activities WHERE user_id = $1",
        "DELETE FROM user_badges WHERE user_id = $1",
        "DELETE FROM event_points WHERE konfi_id = $1",
        "DELETE FROM event_bookings WHERE user_id = $1",
        "DELETE FROM konfi_profiles WHERE user_id = $1",
      ];
      for (const sql of purgeHistory) {
        await client.query('SAVEPOINT hist_purge');
        try {
          await client.query(sql, [id]);
          await client.query('RELEASE SAVEPOINT hist_purge');
        } catch (histErr) {
          await client.query('ROLLBACK TO SAVEPOINT hist_purge');
          if (histErr.code !== '42703' && histErr.code !== '42P01') throw histErr;
        }
      }

      // Delete user
      const deleteUserResult = await client.query("DELETE FROM users WHERE id = $1 AND organization_id = $2", [id, organizationId]);

      if (deleteUserResult.rowCount === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Benutzer in dieser Organisation nicht gefunden' });
      }

      await client.query('COMMIT');
      client.release();

      // Aktive Socket-Verbindungen des geloeschten Users sofort trennen — sonst
      // liest ein noch verbundener Client mit toter Session weiter Live-Updates
      // mit, bis er von selbst neu verbindet. Nach dem COMMIT (User ist weg).
      liveUpdate.disconnectUserSockets(parseInt(id));

      // Foto-Dateien nach COMMIT vom Dateisystem entfernen (nicht blockierend)
      for (const filename of photoFilenames) {
        await deletePhotoFile(filename);
      }

      res.json({ message: 'Benutzer erfolgreich gelöscht' });

      // Live-Update NACH der Response: geloeschter Benutzer aus der Benutzer-Liste.
      liveUpdate.sendToOrgAdmins(organizationId, 'users', 'delete', { userId: parseInt(id) });

    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
      console.error(`Database error in DELETE /users/${id}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Assign jahrgaenge to user
  router.post('/:id/jahrgaenge', rbacVerifier, requireOrgAdmin, validateJahrgangAssignments, async (req, res) => {
    const { id: userId } = req.params;
    const organizationId = req.user.organization_id;
    const { jahrgang_assignments } = req.body; // [{ jahrgang_id, can_view, can_edit }]

    if (!Array.isArray(jahrgang_assignments)) {
      return res.status(400).json({ error: 'jahrgang_assignments muss ein Array sein' });
    }

    try {
        // Check if user exists in organization
        const { rows: [user] } = await db.query("SELECT id FROM users WHERE id = $1 AND organization_id = $2", [userId, organizationId]);
        if (!user) {
            return res.status(404).json({ error: 'Benutzer in dieser Organisation nicht gefunden' });
        }

        const client = await db.getClient();
        try {
        await client.query('BEGIN');

        // Get current assignments to determine chat changes
        const { rows: currentAssignments } = await client.query(
            "SELECT jahrgang_id FROM user_jahrgang_assignments WHERE user_id = $1",
            [userId]
        );
        const currentJahrgangIds = currentAssignments.map(a => a.jahrgang_id);
        const newJahrgangIds = jahrgang_assignments.map(a => a.jahrgang_id);

        // Alle betroffenen Jahrgaenge (alt + neu) — fuer diese wird nach dem
        // Setzen der Zuweisungen der Chat synchronisiert (Beitritt bei neuer
        // Zuweisung, Entfernung bei Entzug — Org-Admins bleiben immer drin).
        const affectedJahrgangIds = Array.from(new Set([...currentJahrgangIds, ...newJahrgangIds]));

        // Delete existing assignments for this user
        await client.query("DELETE FROM user_jahrgang_assignments WHERE user_id = $1", [userId]);

        if (jahrgang_assignments.length > 0) {
            // First, verify all jahrgaenge exist in the organization
            const jahrgangIds = jahrgang_assignments.map(a => a.jahrgang_id);
            const placeholders = jahrgangIds.map((_, i) => `$${i + 2}`).join(',');
            const verifyQuery = `SELECT id FROM jahrgaenge WHERE organization_id = $1 AND id IN (${placeholders})`;
            const { rows: validJahrgaenge } = await client.query(verifyQuery, [organizationId, ...jahrgangIds]);

            if (validJahrgaenge.length !== jahrgangIds.length) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(400).json({ error: 'Mindestens eine Jahrgangs-ID ist ungültig oder gehört nicht zu dieser Organisation.' });
            }

            // Now, insert all new assignments
            for (const assignment of jahrgang_assignments) {
                const { jahrgang_id, can_view = true, can_edit = false } = assignment;
                const insertQuery = `
                    INSERT INTO user_jahrgang_assignments (user_id, jahrgang_id, can_view, can_edit, assigned_by)
                    VALUES ($1, $2, $3, $4, $5)
                `;
                await client.query(insertQuery, [userId, jahrgang_id, can_view, can_edit, req.user.id]);
            }
        }

        // Chat-Mitgliedschaft fuer ALLE betroffenen Jahrgaenge (alt + neu)
        // zentral synchronisieren: zugewiesene Admins/Teamer treten bei,
        // entzogene fliegen raus, Org-Admins bleiben immer drin, Chat wird bei
        // Bedarf angelegt. Ersetzt die frueheren manuellen Add/Remove-Schleifen
        // (die Teamer faelschlich als 'admin' eintrugen und Org-Admins ignorierten).
        for (const jahrgangId of affectedJahrgangIds) {
            await syncJahrgangChat(client, jahrgangId, organizationId, req.user.id);
        }

        await client.query('COMMIT');
        client.release();

        res.json({
            message: jahrgang_assignments.length > 0 ? 'Jahrgangs-Zuweisungen aktualisiert' : 'Alle Jahrgangs-Zuweisungen entfernt',
            assignments_count: jahrgang_assignments.length
        });

        // Live-Update NACH der Response: geaenderte Jahrgangs-Zuweisung wirkt auf
        // die Benutzer-Liste (Zugehoerigkeit/Anzeige).
        liveUpdate.sendToOrgAdmins(organizationId, 'users', 'update', { userId: parseInt(userId) });

        } catch (err) {
          try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
          client.release();
          throw err;
        }

    } catch (err) {
      console.error(`Database error in POST /users/${userId}/jahrgaenge:`, err);
        res.status(500).json({ error: 'Datenbankfehler beim Zuweisen der Jahrgänge' });
    }
  });


  // Get current user's jahrgang assignments (must be before /:id route)
  router.get('/me/jahrgaenge', rbacVerifier, async (req, res) => {
    const userId = req.user.id;
    const organizationId = req.user.organization_id;

    const query = `
      SELECT j.id, j.name, uja.can_view, uja.can_edit, uja.assigned_at,
             assigner.display_name as assigned_by_name
      FROM user_jahrgang_assignments uja
      JOIN jahrgaenge j ON uja.jahrgang_id = j.id
      LEFT JOIN users assigner ON uja.assigned_by = assigner.id
      WHERE uja.user_id = $1 AND j.organization_id = $2
      ORDER BY j.name
    `;

    try {
      const { rows } = await db.query(query, [userId, organizationId]);
      res.json(rows);
    } catch (err) {
      console.error('Database error in GET /users/me/jahrgaenge:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get user's jahrgang assignments
  router.get('/:id/jahrgaenge', rbacVerifier, requireOrgAdmin, async (req, res) => {
    const { id } = req.params;
    const organizationId = req.user.organization_id;

    const query = `
      SELECT j.id, j.name, uja.can_view, uja.can_edit, uja.assigned_at,
             assigner.display_name as assigned_by_name
      FROM user_jahrgang_assignments uja
      JOIN jahrgaenge j ON uja.jahrgang_id = j.id
      LEFT JOIN users assigner ON uja.assigned_by = assigner.id
      WHERE uja.user_id = $1 AND j.organization_id = $2
      ORDER BY j.name
    `;

    try {
      const { rows } = await db.query(query, [id, organizationId]);
      res.json(rows);
    } catch (err) {
 console.error(`Database error in GET /users/${id}/jahrgaenge:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ENTFERNT: /users/:id/permissions Route
  // Permissions sind jetzt rollen-basiert (hardcoded), keine DB-Abfrage mehr noetig
  // ENTFERNT: zweite /me/jahrgaenge Route (Duplikat, lieferte andere Spaltenaliase)

  // Reset password for a user (super_admin or org_admin of same org)
  router.put('/:id/reset-password', rbacVerifier, validateResetPassword, async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;

    const passwordError = validatePassword(password || '');
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    try {
      // Prüfen ob User existiert
      const { rows: [targetUser] } = await db.query(`
        SELECT u.id, u.organization_id, r.name as role_name
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE u.id = $1
      `, [id]);

      if (!targetUser) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }

      const isSuperAdmin = req.user.is_super_admin === true;
      const isOrgAdmin = req.user.role_name === 'org_admin';
      const isSameOrg = req.user.organization_id === targetUser.organization_id;

      // super_admin darf alle resetten, org_admin nur in eigener Org
      if (!isSuperAdmin && !(isOrgAdmin && isSameOrg)) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }

      // org_admin darf andere org_admins in seiner Org resetten (neue Regel)
      // Nur super_admin ist geschützt

      const hashedPassword = await bcrypt.hash(password, 10);
      // org-gescopt: id ist eindeutig, organization_id als defensiver Zusatzfilter (matcht den oben geladenen targetUser)
      await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3', [hashedPassword, id, targetUser.organization_id]);

      // Bestehende Socket-Verbindungen des Users trennen: Nach einem Passwort-
      // Reset soll die alte Session nicht ueber einen offenen Socket weiterlaufen.
      // Der Client verbindet sich nach dem naechsten (Re-)Login mit frischem Token.
      liveUpdate.disconnectUserSockets(parseInt(id));

      res.json({ message: 'Passwort erfolgreich zurückgesetzt' });

    } catch (err) {
 console.error(`Database error in PUT /users/${id}/reset-password:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  return router;
};