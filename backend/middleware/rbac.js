const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// ============================================
// LRU-CACHE fuer User-Objekte (30s TTL, max 500 Eintraege)
// ============================================
const USER_CACHE_TTL = 30 * 1000; // 30 Sekunden
const USER_CACHE_MAX = 500;
const userCache = new Map();

// Cache-Key haelt die AKTIVE Org mit rein: ein User kann (Multi-Org) je nach
// aktivem Org-Kontext ein voellig anderes req.user-Objekt haben (andere Org,
// andere Rolle, andere Jahrgaenge). Ohne Org im Key wuerde der 30s-Cache nach
// einem Org-Switch die alte Org ausliefern.
const cacheKey = (userId, activeOrgId) => `${userId}:${activeOrgId || 'default'}`;

const getCachedUser = (key) => {
  const entry = userCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > USER_CACHE_TTL) {
    userCache.delete(key);
    return null;
  }
  return entry.data;
};

const setCachedUser = (key, data) => {
  // Evict aelteste Eintraege wenn Max erreicht
  if (userCache.size >= USER_CACHE_MAX) {
    const firstKey = userCache.keys().next().value;
    userCache.delete(firstKey);
  }
  userCache.set(key, { data, timestamp: Date.now() });
};

// Cache invalidieren bei User-Aenderungen (Export fuer andere Module).
// Loescht ALLE Org-Varianten eines Users (Praefix-Match), da der Key
// "userId:orgId" lautet. Ohne userId: kompletter Cache-Clear.
const invalidateUserCache = (userId) => {
  if (userId) {
    const prefix = `${userId}:`;
    for (const key of userCache.keys()) {
      if (key.startsWith(prefix)) userCache.delete(key);
    }
  } else {
    userCache.clear();
  }
};

// ============================================
// ROLLEN-HIERARCHIE (vereinfacht)
// ============================================
// super_admin (5) - Organisations-übergreifend, nur Org-Verwaltung
// org_admin (4)   - Volle Rechte in eigener Organisation
// admin (3)       - Konfis, Events, Badges, Aktivitäten, Requests
// teamer (2)      - Events, Konfis ansehen, Punkte vergeben
// konfi (1)       - Nur eigene Daten
// ============================================

// Token verification - lädt User-Daten ohne Permissions aus DB
const verifyTokenRBAC = (db) => {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }

    try {
      // AKTIVE Organisation bestimmen (Multi-Org): Client sendet die gewuenschte
      // Org per Header X-Active-Organization (oder als Claim im Access-Token, der
      // beim Switch neu ausgestellt wird). Validierung (Mitgliedschaft) erfolgt
      // unten gegen user_organizations. Ohne Angabe -> Primaer-Org aus users.
      const headerOrg = parseInt(req.headers['x-active-organization']);
      const tokenOrg = decoded.active_organization_id ? parseInt(decoded.active_organization_id) : null;
      const requestedActiveOrg = Number.isInteger(headerOrg) ? headerOrg
        : (Number.isInteger(tokenOrg) ? tokenOrg : null);

      // Cache-Check VOR DB-Query (Key inkl. aktiver Org)
      const ckey = cacheKey(decoded.id, requestedActiveOrg);
      const cached = getCachedUser(ckey);
      if (cached) {
        // Soft-Revoke Check auch mit cached Data
        if (cached.token_invalidated_at) {
          const tokenIssuedAt = decoded.iat;
          const invalidatedAt = Math.floor(new Date(cached.token_invalidated_at).getTime() / 1000);
          if (tokenIssuedAt < invalidatedAt) {
            return res.status(401).json({ error: 'Token invalidated' });
          }
        }
        req.user = cached.userObj;
        return next();
      }

      // User-Query mit LEFT JOIN für super_admin (organization_id kann NULL sein)
      const userQuery = `
        SELECT u.id, u.organization_id, u.username, u.display_name, u.is_active,
               u.role_title, u.is_super_admin, u.token_invalidated_at,
               r.name as role_name, r.display_name as role_display_name,
               o.name as organization_name, o.slug as organization_slug,
               COALESCE(o.is_active, true) as organization_active
        FROM users u
        LEFT JOIN organizations o ON u.organization_id = o.id
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE u.id = $1
      `;
      const { rows: [user] } = await db.query(userQuery, [decoded.id]);

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      if (!user.is_active) {
        return res.status(401).json({ error: 'User account is inactive' });
      }

      // Soft-Revoke: Token vor Invalidierung ausgestellt -> 401
      if (user.token_invalidated_at) {
        const tokenIssuedAt = decoded.iat; // Unix-Timestamp aus JWT
        const invalidatedAt = Math.floor(new Date(user.token_invalidated_at).getTime() / 1000);
        if (tokenIssuedAt < invalidatedAt) {
          return res.status(401).json({ error: 'Token invalidated' });
        }
      }

      // AKTIVE Org anwenden: ist eine andere als die Primaer-Org gewuenscht UND
      // ist der User dort Mitglied (user_organizations)? Dann Org + Rolle auf die
      // aktive Org umschreiben. Alle nachgelagerten Org-isolierten Queries lesen
      // danach req.user.organization_id und arbeiten transparent in der aktiven Org.
      if (requestedActiveOrg && requestedActiveOrg !== user.organization_id) {
        const { rows: [membership] } = await db.query(`
          SELECT uo.organization_id,
                 r.id as role_id, r.name as role_name, r.display_name as role_display_name,
                 o.name as organization_name, o.slug as organization_slug,
                 COALESCE(o.is_active, true) as organization_active
          FROM user_organizations uo
          JOIN roles r ON uo.role_id = r.id
          JOIN organizations o ON uo.organization_id = o.id
          WHERE uo.user_id = $1 AND uo.organization_id = $2
        `, [decoded.id, requestedActiveOrg]);

        if (!membership) {
          // Nicht Mitglied der angeforderten Org -> Zugriff verweigern (kein
          // stilles Zurueckfallen auf die Primaer-Org, das waere verwirrend).
          return res.status(403).json({ error: 'Kein Zugriff auf diese Organisation' });
        }

        user.organization_id = membership.organization_id;
        user.role_name = membership.role_name;
        user.role_display_name = membership.role_display_name;
        user.organization_name = membership.organization_name;
        user.organization_slug = membership.organization_slug;
        user.organization_active = membership.organization_active;
      }

      // Super-Admin hat keine Organization - Skip org check
      if (user.role_name !== 'super_admin' && !user.organization_active) {
        return res.status(401).json({ error: 'Organization is inactive' });
      }

      // Jahrgänge laden (nur für nicht-super_admin) — fuer die AKTIVE Org gescopt,
      // damit Teamer-Zuweisungen aus der falschen Org nicht durchschlagen.
      let assignedJahrgaenge = [];
      if (user.organization_id) {
        const jahrgaengeQuery = `
          SELECT j.id, j.name, uja.can_view, uja.can_edit
          FROM user_jahrgang_assignments uja
          JOIN jahrgaenge j ON uja.jahrgang_id = j.id
          WHERE uja.user_id = $1 AND j.organization_id = $2
        `;
        const { rows } = await db.query(jahrgaengeQuery, [decoded.id, user.organization_id]);
        assignedJahrgaenge = rows;
      }

      // User-Objekt für Request
      req.user = {
        id: user.id,
        organization_id: user.organization_id,
        username: user.username,
        display_name: user.display_name,
        role_name: user.role_name,
        role_title: user.role_title,
        role_display_name: user.role_display_name,
        organization_name: user.organization_name,
        organization_slug: user.organization_slug,
        assigned_jahrgaenge: assignedJahrgaenge,
        // Backward compatibility
        type: user.role_name === 'konfi' ? 'konfi' : user.role_name === 'teamer' ? 'teamer' : 'admin',
        // is_super_admin: Rolle ODER DB-Flag
        is_super_admin: user.role_name === 'super_admin' || user.is_super_admin === true,
        is_org_admin: user.role_name === 'org_admin'
      };

      // User-Objekt cachen (30s TTL, Key inkl. aktiver Org)
      setCachedUser(ckey, {
        token_invalidated_at: user.token_invalidated_at,
        userObj: req.user
      });

      next();
    } catch (err) {
 console.error('Database error in verifyTokenRBAC middleware:', err);
      res.status(500).json({ error: 'Database error' });
    }
  };
};

// ============================================
// ROLLEN-BASIERTE ZUGRIFFSKONTROLLE (NEU)
// ============================================

/**
 * Generische Rollen-Prüfung
 * @param {...string} allowedRoles - Erlaubte Rollennamen
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Nicht angemeldet' });
    }

    if (!allowedRoles.includes(req.user.role_name)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    next();
  };
};

// ============================================
// ROLLEN-CHECKS (KORRIGIERT)
// ============================================
// super_admin: NUR Organisations-Verwaltung, sonst KEIN Zugriff
// org_admin: Alles in eigener Organisation (inkl. User)
// admin: Alles AUSSER User-Verwaltung
// teamer: Events, Konfis ansehen, Punkte vergeben
// ============================================

// requireSuperAdmin: super_admin-Rolle ODER gesetztes is_super_admin-Flag.
// Das Flag erlaubt es, einem org_admin zusaetzlich die Org-Verwaltung zu geben,
// ohne die Rolle zu wechseln (verifyTokenRBAC setzt req.user.is_super_admin
// = role_name==='super_admin' || users.is_super_admin === true).
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Nicht angemeldet' });
  }
  if (!req.user.is_super_admin) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  next();
};
const requireOrgAdmin = requireRole('org_admin');               // User-Verwaltung in Org
const requireAdmin = requireRole('org_admin', 'admin');         // Konfis, Requests, Badges, etc.
const requireTeamer = requireRole('org_admin', 'admin', 'teamer'); // Events, Punkte vergeben

// ============================================
// JAHRGANG-ZUGRIFF
// ============================================

const checkJahrgangAccess = (jahrgangIdParam = 'jahrgangId', requireEdit = false) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Nicht angemeldet' });
    }

    // super_admin hat KEINEN Zugriff auf Jahrgangs-Daten
    if (req.user.role_name === 'super_admin') {
      return res.status(403).json({ error: 'Super-Admin hat keinen Zugriff auf Jahrgangs-Daten' });
    }

    // Org-Admin und Admin haben Zugriff auf alle Jahrgänge ihrer Organisation
    if (['org_admin', 'admin'].includes(req.user.role_name)) {
      return next();
    }

    const jahrgangId = parseInt(req.params[jahrgangIdParam] || req.body[jahrgangIdParam] || req.query[jahrgangIdParam]);

    if (!jahrgangId) {
      return res.status(400).json({ error: 'Jahrgang ID erforderlich' });
    }

    const assignedJahrgang = req.user.assigned_jahrgaenge.find(j => j.id === jahrgangId);

    if (!assignedJahrgang) {
      return res.status(403).json({ error: 'Kein Zugriff auf diesen Jahrgang' });
    }

    if (requireEdit && !assignedJahrgang.can_edit) {
      return res.status(403).json({ error: 'Keine Bearbeitungsrechte für diesen Jahrgang' });
    }

    if (!assignedJahrgang.can_view) {
      return res.status(403).json({ error: 'Keine Leserechte für diesen Jahrgang' });
    }

    next();
  };
};

// Filter für Jahrgang-basierte Queries
const filterByJahrgangAccess = (req) => {
  if (!req.user) {
    return { where: 'WHERE 1=0', params: [] };
  }

  // super_admin hat KEINEN Zugriff auf Jahrgangs-Daten
  if (req.user.role_name === 'super_admin') {
    return { where: 'WHERE 1=0', params: [] };
  }

  // Org-Admin und Admin sehen alles in ihrer Organisation
  if (['org_admin', 'admin'].includes(req.user.role_name)) {
    return {
      where: 'WHERE organization_id = $1',
      params: [req.user.organization_id]
    };
  }

  // Teamer sehen nur zugewiesene Jahrgänge
  const viewableJahrgaenge = req.user.assigned_jahrgaenge
    .filter(j => j.can_view)
    .map(j => j.id);

  if (viewableJahrgaenge.length === 0) {
    return { where: 'WHERE 1=0', params: [] };
  }

  const placeholders = viewableJahrgaenge.map((_, i) => `$${i + 2}`).join(',');
  return {
    where: `WHERE organization_id = $1 AND jahrgang_id IN (${placeholders})`,
    params: [req.user.organization_id, ...viewableJahrgaenge]
  };
};

// ============================================
// ORGANISATIONS-ISOLATION
// ============================================

const requireSameOrganization = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Nicht angemeldet' });
  }

  // Super-Admin kann auf alle Organisationen zugreifen
  if (req.user.role_name === 'super_admin') {
    return next();
  }

  const requestedOrgId = parseInt(req.params.organizationId || req.body.organization_id);

  if (requestedOrgId && requestedOrgId !== req.user.organization_id) {
    return res.status(403).json({ error: 'Kein Zugriff auf andere Organisationen' });
  }

  next();
};

module.exports = {
  verifyTokenRBAC,
  invalidateUserCache,
  // Rollen-Checks
  requireRole,
  requireSuperAdmin,
  requireOrgAdmin,
  requireAdmin,
  requireTeamer,
  // Jahrgang-Zugriff
  checkJahrgangAccess,
  filterByJahrgangAccess,
  // Organisation
  requireSameOrganization
};
