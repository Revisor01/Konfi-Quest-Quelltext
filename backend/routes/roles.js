const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');

// ============================================
// VEREINFACHTE ROLLEN-ROUTES
// ============================================
// Rollen sind jetzt hardcoded (5 System-Rollen)
// Keine Erstellung/Löschung/Permission-Verwaltung mehr nötig
// ============================================

module.exports = (db, rbacVerifier, roleHelpers) => {

  // GET /api/roles - Alle Rollen der Organisation anzeigen
  // Nur für org_admin (um User zuzuweisen)
  router.get('/', rbacVerifier, async (req, res) => {
    // Nur org_admin darf Rollen sehen
    if (!['super_admin', 'org_admin'].includes(req.user.role_name)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const organizationId = req.user.organization_id;

    try {
      const query = `
        SELECT r.id, r.name, r.display_name, r.description,
               r.is_system_role, r.is_active, r.created_at,
               COUNT(DISTINCT u.id)::int as user_count
        FROM roles r
        LEFT JOIN users u ON r.id = u.role_id AND u.is_active = true
        WHERE r.organization_id = $1
        GROUP BY r.id
        ORDER BY
          CASE r.name
            WHEN 'org_admin' THEN 1
            WHEN 'admin' THEN 2
            WHEN 'teamer' THEN 3
            WHEN 'konfi' THEN 4
            ELSE 5
          END
      `;

      const { rows } = await db.query(query, [organizationId]);
      res.json(rows);

    } catch (err) {
 console.error('Database error in GET /roles:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // GET /api/roles/:id - Einzelne Rolle anzeigen
  router.get('/:id', rbacVerifier, [param('id').isInt({ min: 1 }).withMessage('Ungültige ID'), handleValidationErrors], async (req, res) => {
    if (!['super_admin', 'org_admin'].includes(req.user.role_name)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const { id } = req.params;
    const organizationId = req.user.organization_id;

    try {
      const roleQuery = `
        SELECT r.id, r.name, r.display_name, r.description,
               r.is_system_role, r.is_active, r.created_at,
               COUNT(DISTINCT u.id)::int as user_count
        FROM roles r
        LEFT JOIN users u ON r.id = u.role_id AND u.is_active = true
        WHERE r.id = $1 AND r.organization_id = $2
        GROUP BY r.id
      `;

      const { rows: [role] } = await db.query(roleQuery, [id, organizationId]);

      if (!role) {
        return res.status(404).json({ error: 'Rolle nicht gefunden' });
      }

      // Statische Berechtigungen basierend auf Rollenname
      const rolePermissions = getRolePermissions(role.name);

      res.json({
        ...role,
        permissions: rolePermissions
      });

    } catch (err) {
 console.error(`Database error in GET /roles/${id}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // GET /api/roles/assignable - Rollen die zugewiesen werden können
  router.get('/list/assignable', rbacVerifier, async (req, res) => {
    if (!['super_admin', 'org_admin', 'admin'].includes(req.user.role_name)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const organizationId = req.user.organization_id;
    const userRole = req.user.role_name;

    try {
      // Welche Rollen kann der User zuweisen?
      let allowedRoles = [];
      if (userRole === 'super_admin') {
        allowedRoles = ['org_admin', 'admin', 'teamer', 'konfi'];
      } else if (userRole === 'org_admin') {
        allowedRoles = ['admin', 'teamer', 'konfi'];
      } else if (userRole === 'admin') {
        allowedRoles = ['teamer', 'konfi'];
      }

      const query = `
        SELECT r.id, r.name, r.display_name
        FROM roles r
        WHERE r.organization_id = $1 AND r.name = ANY($2)
        ORDER BY
          CASE r.name
            WHEN 'admin' THEN 1
            WHEN 'teamer' THEN 2
            WHEN 'konfi' THEN 3
            ELSE 4
          END
      `;

      const { rows } = await db.query(query, [organizationId, allowedRoles]);
      res.json(rows);

    } catch (err) {
 console.error('Database error in GET /roles/list/assignable:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  return router;
};

// ============================================
// STATISCHE ROLLEN-BERECHTIGUNGEN
// ============================================

function getRolePermissions(roleName) {
  const permissions = {
    'super_admin': [
      { name: 'organizations.manage', description: 'Organisationen verwalten' }
    ],
    'org_admin': [
      { name: 'users.manage', description: 'Alle Benutzer verwalten' },
      { name: 'roles.view', description: 'Rollen ansehen' },
      { name: 'settings.edit', description: 'Einstellungen bearbeiten' },
      { name: 'konfis.full', description: 'Volle Konfi-Verwaltung' },
      { name: 'events.full', description: 'Volle Event-Verwaltung' },
      { name: 'badges.full', description: 'Volle Badge-Verwaltung' },
      { name: 'activities.full', description: 'Volle Aktivitäten-Verwaltung' },
      { name: 'requests.full', description: 'Volle Antrags-Verwaltung' },
      { name: 'jahrgaenge.full', description: 'Volle Jahrgänge-Verwaltung' },
      { name: 'chat.full', description: 'Voller Chat-Zugriff' }
    ],
    'admin': [
      { name: 'konfis.full', description: 'Volle Konfi-Verwaltung' },
      { name: 'events.full', description: 'Volle Event-Verwaltung' },
      { name: 'badges.full', description: 'Volle Badge-Verwaltung' },
      { name: 'activities.full', description: 'Volle Aktivitäten-Verwaltung' },
      { name: 'requests.full', description: 'Volle Antrags-Verwaltung' },
      { name: 'jahrgaenge.full', description: 'Volle Jahrgänge-Verwaltung' },
      { name: 'chat.full', description: 'Voller Chat-Zugriff' }
    ],
    'teamer': [
      { name: 'konfis.view', description: 'Konfis ansehen' },
      { name: 'konfis.points', description: 'Punkte vergeben' },
      { name: 'events.full', description: 'Events verwalten' },
      { name: 'activities.view', description: 'Aktivitäten ansehen' },
      { name: 'badges.view', description: 'Badges ansehen' },
      { name: 'jahrgaenge.view', description: 'Jahrgänge ansehen' }
    ],
    'konfi': []
  };

  return permissions[roleName] || [];
}
