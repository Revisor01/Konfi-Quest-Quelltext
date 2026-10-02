// ============================================
// ROLLEN-HIERARCHIE
// ============================================
// Definiert die Hierarchie zwischen den 5 System-Rollen

const ROLE_HIERARCHY = {
  'super_admin': 5,  // Organisations-übergreifend
  'org_admin': 4,    // Volle Rechte in eigener Organisation
  'admin': 3,        // Konfis, Events, Badges, Aktivitäten, Requests
  'teamer': 2,       // Events, Konfis ansehen, Punkte vergeben
  'konfi': 1         // Nur eigene Daten
};

/**
 * Prüft ob eine Rolle eine andere verwalten darf
 * Regel: Man kann nur Rollen verwalten, die niedriger in der Hierarchie sind
 *
 * @param {string} userRole - Die Rolle des ausführenden Users
 * @param {string} targetRole - Die Rolle die verwaltet werden soll
 * @returns {boolean} - true wenn erlaubt
 */
const canManageRole = (userRole, targetRole) => {
  const userLevel = ROLE_HIERARCHY[userRole] || 0;
  const targetLevel = ROLE_HIERARCHY[targetRole] || 0;

  // Super-Admin kann alle außer sich selbst verwalten
  if (userRole === 'super_admin') {
    return targetRole !== 'super_admin';
  }

  // Org-Admin kann ALLE Rollen in seiner Organisation verwalten (inkl. andere org_admins)
  if (userRole === 'org_admin') {
    return ['org_admin', 'admin', 'teamer', 'konfi'].includes(targetRole);
  }

  // Admin kann teamer und konfi verwalten
  if (userRole === 'admin') {
    return ['teamer', 'konfi'].includes(targetRole);
  }

  // Teamer kann nur konfi verwalten (eingeschränkt)
  if (userRole === 'teamer') {
    return targetRole === 'konfi';
  }

  // Konfi kann niemanden verwalten
  return false;
};

/**
 * Prüft ob eine Rolle eine andere erstellen darf
 * @param {string} userRole - Die Rolle des ausführenden Users
 * @param {string} targetRole - Die Rolle die erstellt werden soll
 * @returns {boolean} - true wenn erlaubt
 */
const canCreateRole = (userRole, targetRole) => {
  return canManageRole(userRole, targetRole);
};

/**
 * @param {{ role_name?: string, is_super_admin?: boolean }} konto
 * @returns {boolean}
 */
const istSuperAdminKonto = (konto) =>
  konto?.role_name === 'super_admin' || konto?.is_super_admin === true;

/**
 * Middleware für User-Management-Operationen
 * Prüft ob der aktuelle User die Ziel-User-Rolle verwalten darf
 */
const checkUserHierarchy = (operation = 'manage') => {
  return async (req, res, next) => {
    try {
      const userRole = req.user.role_name;
      const targetUserId = req.params.id;
      const targetRoleId = req.body.role_id;

      if (!userRole) {
        return res.status(403).json({ error: 'Benutzerrolle nicht gefunden' });
      }

      // Bei Create-Operationen haben wir die role_id im Body
      if (operation === 'create' && targetRoleId) {
        const { rows: [role] } = await req.db.query('SELECT name FROM roles WHERE id = $1', [targetRoleId]);
        if (!role) {
          return res.status(404).json({ error: 'Zielrolle nicht gefunden' });
        }
        if (!canCreateRole(userRole, role.name)) {
          return res.status(403).json({
            error: `Du kannst keine Benutzer mit der Rolle '${role.name}' erstellen.`
          });
        }
        return next();
      }

      // Bei Update/Delete/View-Operationen müssen wir erst den Ziel-User laden
      if (targetUserId) {
        // DIE ROLLE GILT JE GEMEINDE: user_organizations traegt ein eigenes
        // role_id. Geprueft wird die Rolle in DIESER Gemeinde, nicht die am
        // Konto -- sonst liesse sich eine Person, die hier org_admin und in
        // ihrer Stamm-Gemeinde Teamer:in ist, von einem Admin verwalten.
        // Fuehren beide Quellen dieselbe Gemeinde, gewinnt die Rolle am
        // Nutzerkonto (wie in GET /auth/my-organizations und orgMitglieder.js).
        const query = `
          SELECT u.id, r.id AS role_id, r.name as role_name, u.is_super_admin
          FROM users u
          JOIN roles r ON r.id = u.role_id
          WHERE u.id = $1 AND u.organization_id = $2
          UNION ALL
          SELECT u.id, r.id AS role_id, r.name as role_name, u.is_super_admin
          FROM user_organizations uo
          JOIN users u ON u.id = uo.user_id
          JOIN roles r ON r.id = uo.role_id
          WHERE uo.user_id = $1 AND uo.organization_id = $2
            AND u.organization_id <> $2
          LIMIT 1
        `;
        const { rows: [targetUser] } = await req.db.query(query, [targetUserId, req.user.organization_id]);

        if (!targetUser) {
          return res.status(404).json({ error: 'Zielbenutzer nicht in deiner Gemeinde gefunden' });
        }

        if (istSuperAdminKonto(targetUser) && req.user.is_super_admin !== true) {
          return res.status(403).json({
            error: 'Super-Admin-Konten kann nur ein Super-Admin bearbeiten.'
          });
        }
        if (!canManageRole(userRole, targetUser.role_name)) {
          return res.status(403).json({
            error: `Du kannst Benutzer mit der Rolle '${targetUser.role_name}' nicht bearbeiten.`
          });
        }

        // Zusätzlich bei Role-Updates prüfen
        if (operation === 'update' && targetRoleId && targetRoleId !== targetUser.role_id) {
          const { rows: [newRole] } = await req.db.query('SELECT name FROM roles WHERE id = $1', [targetRoleId]);
          if (!newRole) {
            return res.status(404).json({ error: 'Neue Rolle nicht gefunden' });
          }
          if (!canCreateRole(userRole, newRole.name)) {
            return res.status(403).json({
              error: `Du kannst die Rolle '${newRole.name}' nicht zuweisen.`
            });
          }
        }

        return next();
      }

      next();
    } catch (err) {
 console.error('Database error in checkUserHierarchy middleware:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  };
};

/**
 * Filtert Users basierend auf der Hierarchie
 * Zeigt nur Users an, die der aktuelle User verwalten darf
 */
const filterUsersByHierarchy = (users, userRole) => {
  return users.filter(user => canManageRole(userRole, user.role_name));
};

/**
 * Filtert Rollen basierend auf der Hierarchie
 * Zeigt nur Rollen an, die der aktuelle User zuweisen darf
 */
const filterRolesByHierarchy = (roles, userRole) => {
  return roles.filter(role => canManageRole(userRole, role.name));
};

module.exports = {
  ROLE_HIERARCHY,
  canManageRole,
  canCreateRole,
  istSuperAdminKonto,
  checkUserHierarchy,
  filterUsersByHierarchy,
  filterRolesByHierarchy
};
