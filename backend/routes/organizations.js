const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { invalidateUserCache } = require('../middleware/rbac');
const { validatePassword } = require('../utils/passwordUtils');
const liveUpdate = require('../utils/liveUpdate');
const { deletePhotoFile, deleteChallengeFile, deleteChatFile, deleteMaterialFile } = require('../utils/photoStorage');
const { syncTeamChat } = require('../utils/teamChat');
const { syncJahrgangChat } = require('../utils/jahrgangChat');
const chatSyncCache = require('../utils/chatSyncCache');

// Organizations routes
// ============================================
// super_admin: Kann ALLE Orgs sehen, erstellen, löschen
// org_admin: Kann NUR eigene Org sehen und bearbeiten
// ============================================
module.exports = (db, rbacVerifier, { requireSuperAdmin, requireTeamer }) => {

  // Verwaltungszugriff auf Organisationsdaten: super_admin (org-uebergreifend
  // zustaendig) ODER eine Verwaltungsrolle der Organisation. requireTeamer
  // allein wuerde den super_admin aussperren, dessen Rolle in requireRole
  // nicht gelistet ist; requireSuperAdmin allein wuerde org_admin/admin/teamer
  // aussperren. Die Org-Zugehoerigkeit selbst prüfen die Routen weiterhin
  // inline (is_super_admin ODER eigene Org).
  const requireOrgVerwaltung = (req, res, next) => {
    if (req.user && req.user.is_super_admin) return next();
    return requireTeamer(req, res, next);
  };

  // Zentrale Passwort-Policy auch hier anwenden:
  // Diese beiden Routen prüfen bisher nur eine Mindestlaenge von 6 Zeichen —
  // schwaecher als jede andere Stelle, an der Passwoerter gesetzt werden, und
  // das ausgerechnet für org_admin-Konten. validatePassword verlangt 8 Zeichen,
  // Gross-/Kleinbuchstaben, Ziffer, Sonderzeichen und keine Leerzeichen.
  // Die automatisch erzeugten Passwoerter (generateBiblicalPassword, z.B.
  // "Offenbarung23,8") erfuellen die Policy — gegen 300 Stichproben geprüft.
  const passwortPolicy = (feld) => body(feld).custom((wert) => {
    const fehler = validatePassword(wert || '');
    if (fehler) throw new Error(fehler);
    return true;
  });

  // Validierungsregeln
  const validateCreateOrg = [
    body('name').trim().notEmpty().withMessage('Name ist erforderlich'),
    body('slug').trim().notEmpty().withMessage('Slug ist erforderlich'),
    body('display_name').trim().notEmpty().withMessage('Anzeigename ist erforderlich'),
    body('admin_username').trim().notEmpty().withMessage('Admin-Benutzername ist erforderlich'),
    passwortPolicy('admin_password'),
    body('admin_display_name').trim().notEmpty().withMessage('Admin-Anzeigename ist erforderlich'),
    handleValidationErrors
  ];

  const validateUpdateOrg = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('name').trim().notEmpty().withMessage('Name ist erforderlich'),
    body('slug').trim().notEmpty().withMessage('Slug ist erforderlich'),
    body('display_name').trim().notEmpty().withMessage('Anzeigename ist erforderlich'),
    handleValidationErrors
  ];

  const validateOrgId = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors
  ];

  const validateCreateOrgAdmin = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige Organisations-ID'),
    body('username').trim().notEmpty().withMessage('Benutzername ist erforderlich'),
    body('display_name').trim().notEmpty().withMessage('Anzeigename ist erforderlich'),
    passwortPolicy('password'),
    handleValidationErrors
  ];

  // Get all organizations - NUR super_admin
  router.get('/', rbacVerifier, requireSuperAdmin, async (req, res) => {
    try {
      // user_count (Team) zählt BEIDE Quellen: Primaer-User (users.organization_id)
      // UND Multi-Org-Mitglieder (user_organizations), jeweils ohne Konfis und
      // über DISTINCT dedupliziert (ein User, der primaer + Mapping in derselben
      // Org hängt, zählt nur einmal). Als Sub-Query, damit der konfi_count-JOIN
      // die Zählung nicht verzerrt.
      const query = `
        SELECT o.*,
               (
                 SELECT COUNT(*) FROM (
                   SELECT u.id
                   FROM users u JOIN roles r ON u.role_id = r.id
                   WHERE u.organization_id = o.id AND u.is_active = true AND r.name != 'konfi'
                   UNION
                   SELECT u.id
                   FROM user_organizations uo
                   JOIN users u ON uo.user_id = u.id AND u.is_active = true
                   JOIN roles r ON uo.role_id = r.id
                   WHERE uo.organization_id = o.id AND r.name != 'konfi'
                 ) team
               ) as user_count,
               COUNT(DISTINCT kp.user_id) as konfi_count,
               COUNT(DISTINCT e.id) as event_count
        FROM organizations o
        LEFT JOIN konfi_profiles kp ON o.id = kp.organization_id
        LEFT JOIN events e ON o.id = e.organization_id
        GROUP BY o.id
        ORDER BY o.created_at DESC
      `;

      const { rows: organizations } = await db.query(query);
      res.json(organizations);
    } catch (err) {
 console.error('Database error in GET /organizations:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // GET /search-users?q= — bestehende User systemweit suchen (für Multi-Org-
  // Zuweisung). Konfis ausgenommen. MUSS vor /:id stehen, sonst faengt /:id den Pfad.
  router.get('/search-users', rbacVerifier, requireSuperAdmin, async (req, res) => {
    try {
      const q = (req.query.q || '').toString().trim();
      if (q.length < 2) {
        return res.json([]);
      }
      const { rows } = await db.query(`
        SELECT u.id, u.username, u.display_name, u.email,
               o.name as primary_organization_name,
               r.name as primary_role_name
        FROM users u
        LEFT JOIN organizations o ON u.organization_id = o.id
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE (r.name IS NULL OR r.name != 'konfi')
          AND u.is_active = true
          AND (u.username ILIKE $1 OR u.display_name ILIKE $1)
        ORDER BY u.display_name ASC
        LIMIT 20
      `, [`%${q}%`]);
      res.json(rows);
    } catch (err) {
      console.error('Database error in GET /organizations/search-users:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get current organization details (muss VOR /:id stehen, sonst wird "current" als ID gefangen)
  // requireTeamer wie bei GET /:id: Die Route liefert o.* der eigenen
  // Organisation und damit dieselben Kontakt-, Lizenz- und Trial-Daten.
  // Ohne diesen Guard wäre der Schutz an GET /:id wirkungslos — derselbe
  // Datensatz wäre hier weiterhin für jede Konfi abrufbar gewesen
  // 
  router.get('/current', rbacVerifier, requireOrgVerwaltung, async (req, res) => {
    try {
      const organizationId = req.user.organization_id;

      const query = `
        SELECT o.*,
               (
                 SELECT COUNT(*) FROM (
                   SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id
                   WHERE u.organization_id = o.id AND u.is_active = true AND r.name != 'konfi'
                   UNION
                   SELECT u.id FROM user_organizations uo
                   JOIN users u ON uo.user_id = u.id AND u.is_active = true
                   JOIN roles r ON uo.role_id = r.id
                   WHERE uo.organization_id = o.id AND r.name != 'konfi'
                 ) team
               ) as user_count,
               (SELECT COUNT(*) FROM konfi_profiles kp WHERE kp.organization_id = o.id) as konfi_count,
               (SELECT COUNT(*) FROM jahrgaenge j WHERE j.organization_id = o.id) as jahrgang_count,
               (SELECT COUNT(*) FROM activities a WHERE a.organization_id = o.id) as activity_count,
               (SELECT COUNT(*) FROM events e WHERE e.organization_id = o.id) as event_count,
               (SELECT COUNT(*) FROM custom_badges cb WHERE cb.organization_id = o.id) as badge_count
        FROM organizations o
        WHERE o.id = $1
      `;

      const { rows: [organization] } = await db.query(query, [organizationId]);

      if (!organization) {
        return res.status(404).json({ error: 'Organisation nicht gefunden' });
      }

      res.json(organization);
    } catch (err) {
 console.error('Database error in GET /organizations/current:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get single organization by ID
  // super_admin: alle, org_admin: nur eigene
  // OPTIMIERT: Parallele Queries statt JOIN-Monster
  // requireTeamer: Die Route liefert SELECT * der Organisation — Kontaktdaten
  // (Name, Telefon, Privatadresse der Leitung), Lizenz- und Trial-Angaben.
  // Geprueft wurde bisher nur die Org-Zugehoerigkeit, nicht die Rolle: damit
  // bekam auch jede Konfi diese Daten.
  router.get('/:id', rbacVerifier, requireOrgVerwaltung, async (req, res) => {
    try {
      const { id } = req.params;

      // Zugriffsprüfung
      const isSuperAdmin = req.user.is_super_admin === true;
      const isOwnOrg = req.user.organization_id === parseInt(id);

      if (!isSuperAdmin && !isOwnOrg) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }

      // Basis-Organisation laden
      const orgQuery = "SELECT * FROM organizations WHERE id = $1";

      // Statistiken parallel laden (viel schneller als JOINs)
      // Team-Zähler beziehen BEIDE Quellen ein: Primaer-User (users.organization_id)
      // UND Multi-Org-Mitglieder (user_organizations), dedupliziert per UNION/DISTINCT.
      // Sonst zeigen Orgs mit ausschliesslich zugewiesenen (nicht primaeren) Admins
      // faelschlich "0 Team".
      const countQueries = {
        user_count: `SELECT COUNT(*)::int as count FROM (
                       SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id
                       WHERE u.organization_id = $1 AND u.is_active = true AND r.name != 'konfi'
                       UNION
                       SELECT u.id FROM user_organizations uo
                       JOIN users u ON uo.user_id = u.id AND u.is_active = true
                       JOIN roles r ON uo.role_id = r.id
                       WHERE uo.organization_id = $1 AND r.name != 'konfi'
                     ) team`,
        teamer_count: `SELECT COUNT(*)::int as count FROM (
                       SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id
                       WHERE u.organization_id = $1 AND u.is_active = true AND r.name = 'teamer'
                       UNION
                       SELECT u.id FROM user_organizations uo
                       JOIN users u ON uo.user_id = u.id AND u.is_active = true
                       JOIN roles r ON uo.role_id = r.id
                       WHERE uo.organization_id = $1 AND r.name = 'teamer'
                     ) t`,
        admin_count: `SELECT COUNT(*)::int as count FROM (
                       SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id
                       WHERE u.organization_id = $1 AND u.is_active = true AND r.name IN ('admin', 'org_admin')
                       UNION
                       SELECT u.id FROM user_organizations uo
                       JOIN users u ON uo.user_id = u.id AND u.is_active = true
                       JOIN roles r ON uo.role_id = r.id
                       WHERE uo.organization_id = $1 AND r.name IN ('admin', 'org_admin')
                     ) a`,
        konfi_count: "SELECT COUNT(*)::int as count FROM konfi_profiles WHERE organization_id = $1",
        jahrgang_count: "SELECT COUNT(*)::int as count FROM jahrgaenge WHERE organization_id = $1",
        activity_count: "SELECT COUNT(*)::int as count FROM activities WHERE organization_id = $1",
        event_count: "SELECT COUNT(*)::int as count FROM events WHERE organization_id = $1",
        badge_count: "SELECT COUNT(*)::int as count FROM custom_badges WHERE organization_id = $1"
      };

      // Alle Queries parallel ausführen
      const [orgResult, ...countResults] = await Promise.all([
        db.query(orgQuery, [id]),
        ...Object.values(countQueries).map(q => db.query(q, [id]))
      ]);

      const organization = orgResult.rows[0];

      if (!organization) {
        return res.status(404).json({ error: 'Organisation nicht gefunden' });
      }

      // Statistiken zum Ergebnis hinzufügen
      const countKeys = Object.keys(countQueries);
      countResults.forEach((result, index) => {
        organization[countKeys[index]] = result.rows[0]?.count || 0;
      });

      res.json(organization);
    } catch (err) {
 console.error('Database error in GET /organizations/:id:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Create new organization (super admin only)
  router.post('/', rbacVerifier, requireSuperAdmin, validateCreateOrg, async (req, res) => {
    try {
      const {
        name, slug, display_name, description, contact_name, contact_email,
        contact_phone, address, website_url, kirchenkreis, max_konfis, admin_username,
        admin_password, admin_display_name
      } = req.body;

      if (!name || !slug || !display_name) {
        return res.status(400).json({ error: 'Name, Slug und Anzeigename sind erforderlich' });
      }

      if (!admin_username || !admin_password || !admin_display_name) {
        return res.status(400).json({ error: 'Admin-Benutzername, Passwort und Anzeigename sind erforderlich' });
      }

      // max_konfis: nur gueltige Zahl >= 0 oder NULL (unbegrenzt)
      let konfiLimit = null;
      if (max_konfis !== null && max_konfis !== undefined && max_konfis !== '') {
        const parsed = parseInt(max_konfis, 10);
        if (isNaN(parsed) || parsed < 0) {
          return res.status(400).json({ error: 'Konfi-Limit muss eine Zahl ab 0 oder leer sein' });
        }
        konfiLimit = parsed;
      }

      // Zeitraum (trial_ends_at) + Trial-Kennzeichnung (is_trial). Explizite Werte
      // haben Vorrang; fehlen sie, startet eine neue Org als 30-Tage-Testphase.
      //   trial_ends_at: NULL = unbegrenzt; Datum = Zugang bis dahin (dann Sperre).
      //   is_trial:      true = Dashboard-Hinweis; false = stiller Lizenz-Ablauf.
      let trialEndsAt;
      let isTrial;
      if (Object.prototype.hasOwnProperty.call(req.body, 'trial_ends_at')) {
        trialEndsAt = req.body.trial_ends_at || null;
        isTrial = req.body.is_trial === true;
      } else {
        trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        isTrial = true;
      }

      // 1. Create Organization
      const orgQuery = `INSERT INTO organizations (
        name, slug, display_name, description, contact_name, contact_email,
        contact_phone, address, website_url, kirchenkreis, max_konfis, trial_ends_at, is_trial
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`;

      const { rows: [newOrg] } = await db.query(orgQuery, [
        name, slug, display_name, description, contact_name || null, contact_email, contact_phone, address, website_url, kirchenkreis || null, konfiLimit, trialEndsAt, isTrial
      ]);
      const organizationId = newOrg.id;
        
      // 2. Create default roles for the organization
      // WICHTIG: inkl. 'konfi' — konfi-management sucht die Rolle org-gescopt;
      // ohne sie kann die neue Organisation keine Konfis anlegen.
      const defaultRoles = [
        { name: 'org_admin', display_name: 'Organisations-Admin', description: 'Vollzugriff auf alle Jahrgänge der Organisation', is_system_role: true },
        { name: 'admin', display_name: 'Hauptamt', description: 'Vollzugriff mit Jahrgangs-Beschränkungen', is_system_role: true },
        { name: 'teamer', display_name: 'Teamer:in', description: 'Kann Anträge bearbeiten und zugewiesene Jahrgänge verwalten', is_system_role: true },
        { name: 'konfi', display_name: 'Konfirmand:in', description: 'Konfirmand:innen haben Zugriff auf eigene Daten und können Aktivitäten beantragen', is_system_role: true }
      ];
      
      let orgAdminRoleId = null;
      const roleQuery = `INSERT INTO roles (organization_id, name, display_name, description, is_system_role) 
                         VALUES ($1, $2, $3, $4, $5) RETURNING id`;
      
      for (const role of defaultRoles) {
          const { rows: [newRole] } = await db.query(roleQuery, [
              organizationId, role.name, role.display_name, role.description, role.is_system_role
          ]);
          if (role.name === 'org_admin') {
              orgAdminRoleId = newRole.id;
          }
      }
      
      // 3. Create the admin user for the organization
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(admin_password, saltRounds);
      
      const userQuery = `INSERT INTO users (organization_id, role_id, username, email, password_hash, display_name, is_active) 
                         VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`;
      const { rows: [newAdmin] } = await db.query(userQuery, [
        organizationId, orgAdminRoleId, admin_username, contact_email, hashedPassword, admin_display_name
      ]);

      // 4. Create default badges for the organization
      const defaultBadges = [
        { name: "Erster Schritt", icon: "footsteps-outline", description: "Herzlich willkommen! Du hast deine ersten Punkte gesammelt.", criteria_type: "total_points", criteria_value: 1 },
        { name: "Auf dem Weg", icon: "walk-outline", description: "Du sammelst fleißig Punkte!", criteria_type: "total_points", criteria_value: 5 },
        { name: "Fleißiger Sammler", icon: "flag-outline", description: "10 Punkte gesammelt - super gemacht!", criteria_type: "total_points", criteria_value: 10 },
        { name: "Punktesammler", icon: "diamond-outline", description: "15 Punkte erreicht - du bist auf einem guten Weg!", criteria_type: "total_points", criteria_value: 15 },
        { name: "Punkteprofi", icon: "trophy-outline", description: "20 Punkte geschafft - großartig!", criteria_type: "total_points", criteria_value: 20 },
        { name: "Punktemeister", icon: "ribbon-outline", description: "25 Punkte erreicht - du bist spitze!", criteria_type: "total_points", criteria_value: 25 },
        { name: "Gottesdienst-Neuling", icon: "home-outline", description: "Du warst zum ersten Mal im Gottesdienst - toll!", criteria_type: "gottesdienst_points", criteria_value: 1 },
        { name: "Gottesdienst-Fan", icon: "book-outline", description: "5 Gottesdienst-Punkte gesammelt!", criteria_type: "gottesdienst_points", criteria_value: 5 },
        { name: "Gottesdienst-Profi", icon: "star-outline", description: "10 Gottesdienst-Punkte erreicht!", criteria_type: "gottesdienst_points", criteria_value: 10 },
        { name: "Gottesdienst-Experte", icon: "heart-outline", description: "15 Gottesdienst-Punkte geschafft!", criteria_type: "gottesdienst_points", criteria_value: 15 },
        { name: "Gemeinde-Neuling", icon: "people-outline", description: "Du hast dich zum ersten Mal in der Gemeinde engagiert!", criteria_type: "gemeinde_points", criteria_value: 1 },
        { name: "Gemeinde-Helfer", icon: "hand-left-outline", description: "5 Gemeinde-Punkte gesammelt - danke für dein Engagement!", criteria_type: "gemeinde_points", criteria_value: 5 },
        { name: "Gemeinde-Unterstützer", icon: "sunny-outline", description: "10 Gemeinde-Punkte erreicht!", criteria_type: "gemeinde_points", criteria_value: 10 },
        { name: "Gemeinde-Champion", icon: "medal-outline", description: "15 Gemeinde-Punkte geschafft - du bist eine große Hilfe!", criteria_type: "gemeinde_points", criteria_value: 15 },
        { name: "Ausgewogen", icon: "git-compare-outline", description: "Du sammelst in beiden Bereichen Punkte - sehr gut!", criteria_type: "both_categories", criteria_value: 3 },
        { name: "Harmonisch", icon: "musical-notes-outline", description: "5 Punkte in beiden Bereichen - perfekte Balance!", criteria_type: "both_categories", criteria_value: 5 },
        { name: "Aktiv dabei", icon: "fitness-outline", description: "Du hast schon 3 verschiedene Aktivitäten gemacht!", criteria_type: "activity_count", criteria_value: 3 },
        { name: "Vielfalts-Fan", icon: "color-palette-outline", description: "5 Aktivitäten absolviert - du probierst gerne Neues!", criteria_type: "activity_count", criteria_value: 5 },
        { name: "Aktivitäts-Sammler", icon: "stats-chart-outline", description: "10 Aktivitäten geschafft - beeindruckend!", criteria_type: "activity_count", criteria_value: 10 },
        { name: "Bonuspunkte-Gewinner", icon: "gift-outline", description: "Du hast Bonuspunkte erhalten - weiter so!", criteria_type: "bonus_points", criteria_value: 1 },
        { name: "Event-Entdecker", icon: "calendar-outline", description: "Du warst bei 3 Events dabei!", criteria_type: "event_count", criteria_value: 3 },
        { name: "Event-Stammgast", icon: "calendar-number-outline", description: "7 Events besucht - du bist richtig dabei!", criteria_type: "event_count", criteria_value: 7 },
        { name: "Zuverlässig", icon: "checkmark-done-outline", description: "Bei 5 Pflichtterminen anwesend - darauf ist Verlass!", criteria_type: "mandatory_event_count", criteria_value: 5 },
        { name: "Neugierig", icon: "compass-outline", description: "3 verschiedene Aktivitäten ausprobiert!", criteria_type: "unique_activities", criteria_value: 3 },
        { name: "Vielseitig", icon: "telescope-outline", description: "6 verschiedene Aktivitäten ausprobiert - stark!", criteria_type: "unique_activities", criteria_value: 6 },
        { name: "Dranbleiber", icon: "flame-outline", description: "3 Wochen in Folge aktiv gewesen!", criteria_type: "streak", criteria_value: 3 },
        { name: "Durchstarter", icon: "flash-outline", description: "6 Wochen am Stück aktiv - was für eine Serie!", criteria_type: "streak", criteria_value: 6 }
      ];

      // TEAMER-ABZEICHEN. Sie brauchen einen eigenen Satz: custom_badges.
      // target_role steht per DEFAULT auf 'konfi' (Migration 076), und die
      // Teamer-Ansicht fragt ausschliesslich target_role = 'teamer' ab. Ohne
      // diese Zeilen startet eine neue Gemeinde mit einer leeren Abzeichen-
      // Seite fuer ihr Team, waehrend die bestehenden Gemeinden welche haben.
      //
      // Nur Kriterien, die OHNE weitere Einrichtung rechnen: Der Teamer-Zweig
      // (routes/badges.js) kennt zehn Typen, aber specific_activity,
      // category_activities, category_combination und activity_combination
      // verlangen konkrete Aktivitaeten oder Kategorien -- die es in einer
      // frischen Gemeinde noch nicht gibt. Uebrig bleiben activity_count
      // (Aktivitaeten UND Termine), event_count, unique_activities,
      // teamer_year und streak.
      const defaultTeamerBadges = [
        { name: "Willkommen im Team", icon: "hand-right-outline", description: "Dein erster Einsatz als Teamer:in ist eingetragen.", criteria_type: "activity_count", criteria_value: 1 },
        { name: "Mit dabei", icon: "people-circle-outline", description: "5 Einsätze als Teamer:in.", criteria_type: "activity_count", criteria_value: 5 },
        { name: "Feste Größe", icon: "shield-checkmark-outline", description: "15 Einsätze als Teamer:in.", criteria_type: "activity_count", criteria_value: 15 },
        { name: "Erste Begleitung", icon: "calendar-outline", description: "Du warst bei deinem ersten Termin dabei.", criteria_type: "event_count", criteria_value: 1 },
        { name: "Verlässlich dabei", icon: "calendar-number-outline", description: "Bei 10 Terminen dabei gewesen.", criteria_type: "event_count", criteria_value: 10 },
        { name: "Vielseitig im Einsatz", icon: "color-palette-outline", description: "5 verschiedene Aktivitäten begleitet.", criteria_type: "unique_activities", criteria_value: 5 },
        { name: "Ein Jahr im Team", icon: "ribbon-outline", description: "Ein Jahr als Teamer:in aktiv gewesen.", criteria_type: "teamer_year", criteria_value: 1 },
        { name: "Drei Jahre im Team", icon: "trophy-outline", description: "Drei Jahre als Teamer:in aktiv gewesen.", criteria_type: "teamer_year", criteria_value: 3 },
        { name: "Am Ball geblieben", icon: "flame-outline", description: "3 Wochen in Folge im Einsatz.", criteria_type: "streak", criteria_value: 3 }
      ];

      const badgeQuery = `INSERT INTO custom_badges (
        organization_id, name, icon, description, criteria_type, criteria_value, 
        is_active, is_hidden, created_by, target_role
      ) VALUES ($1, $2, $3, $4, $5, $6, true, false, $7, $8)`;

      for (const badge of defaultBadges) {
        await db.query(badgeQuery, [
          organizationId, badge.name, badge.icon, badge.description,
          badge.criteria_type, badge.criteria_value, newAdmin.id, 'konfi'
        ]);
      }

      for (const badge of defaultTeamerBadges) {
        await db.query(badgeQuery, [
          organizationId, badge.name, badge.icon, badge.description,
          badge.criteria_type, badge.criteria_value, newAdmin.id, 'teamer'
        ]);
      }

      // 5. Create default certificate types for the organization
      const defaultCertificates = [
        { name: 'Teamer-Card', icon: 'card' },
        { name: 'JuLeiCa', icon: 'ribbon' },
        { name: 'Rettungsschwimmer', icon: 'water' },
        { name: 'Erste Hilfe', icon: 'medkit' }
      ];

      const certQuery = `INSERT INTO certificate_types (name, icon, organization_id)
                         VALUES ($1, $2, $3)`;
      for (const cert of defaultCertificates) {
        await db.query(certQuery, [cert.name, cert.icon, organizationId]);
      }

      // 6. Create default levels (Startpunkt zum Anpassen — Werte wie Referenz-Org)
      const defaultLevels = [
        { name: 'novize', title: 'Novize', points_required: 2, icon: 'pin', color: '#f5b981' },
        { name: 'lehrling', title: 'Lehrling', points_required: 5, icon: 'hammer', color: '#3b82f6' },
        { name: 'gehilfe', title: 'Gehilfe', points_required: 10, icon: 'personAdd', color: '#8b5cf6' },
        { name: 'experte', title: 'Experte', points_required: 15, icon: 'school', color: '#f59e0b' },
        { name: 'meister', title: 'Meister', points_required: 20, icon: 'construct', color: '#ef4444' },
        { name: 'legende', title: 'Legende', points_required: 30, icon: 'medal', color: '#7c3aed' }
      ];

      const levelQuery = `INSERT INTO levels (organization_id, name, title, points_required, icon, color, is_active, created_by)
                          VALUES ($1, $2, $3, $4, $5, $6, true, $7)`;
      for (const level of defaultLevels) {
        await db.query(levelQuery, [
          organizationId, level.name, level.title, level.points_required, level.icon, level.color, newAdmin.id
        ]);
      }

      // 7. Create default categories (Startpunkt zum Anpassen). type:
      // 'activity' | 'event' | 'both'. key dient nur der Verknuepfung unten.
      //
      // 1. "Unterricht" ist RAUS. Woertlich: "Es heisst bewusst Konfi Zeit!"
      //    Konfi-Arbeit ist keine Schule. Der Begriff wird auch nicht ersetzt,
      //    er faellt ersatzlos weg.
      //
      // 2. "Gottesdienst" und "Gemeinde" sind RAUS als Kategorie. Sie sind der
      //    TYP einer Aktivitaet (activities.type -- die Punkte-Achse
      //    gottesdienst/gemeinde), nicht die Art des Anlasses. Als Kategorie
      //    waren sie eine Doppelung: Jede Aktivitaet ist ohnehin das eine oder
      //    das andere, das steht schon auf der Punkte-Seite des Rueckblicks.
      //    Kategorien beantworten eine andere Frage -- WAS FUER EIN ANLASS war
      //    das (Fest, Konzert, Freizeit) -- und nur die traegt eigene Seiten.
      //
      // BESTAND BLEIBT UNANGETASTET: Diese Liste gilt nur beim ANLEGEN einer
      // neuen Gemeinde. Bestehende Organisationen behalten jede Kategorie, die
      // sie haben, inklusive "Gottesdienst", "Gemeinde" und "Unterricht".
      // Niemandes Daten aendern sich durch diese Zeilen.
      const defaultCategories = [
        { key: 'fest', name: 'Fest', description: 'Gemeindefest, Feiern', type: 'both' },
        { key: 'senioren', name: 'Senior:innen', description: 'Besuche, Seniorenkreis', type: 'both' },
        { key: 'jugend', name: 'Jugend', description: 'Jugendgruppe, Jugendtreff', type: 'both' },
        { key: 'oeffentlichkeit', name: 'Öffentlichkeitsarbeit', description: 'Gemeindebrief, Aushang, Social Media', type: 'both' },
        { key: 'freizeit', name: 'Freizeit', description: 'Fahrten und Freizeiten', type: 'both' },
        { key: 'weihnachten', name: 'Weihnachten', description: 'Adventszeit, Christvesper, Krippenspiel', type: 'both' },
        // Fuer die Teamer:innen -- taucht im Teamer-Rueckblick auf, nicht im
        // Konfi-Rueckblick.
        { key: 'teamtreff', name: 'Teamtreff', description: 'Treffen des Teams', type: 'both' },
        { key: 'konzert', name: 'Konzert', description: 'Konzerte und Musik', type: 'both' },
        { key: 'kinder', name: 'Kinder', description: 'Kindergottesdienst, Kindergruppe', type: 'both' },
        { key: 'kreativ', name: 'Kreativ', description: 'Basteln, Gestalten, Werkstatt', type: 'both' },
        { key: 'seelsorge', name: 'Seelsorge', description: 'Besuche, Gespraeche, Begleitung', type: 'both' },
        // Kasualien bleibt: Die Standard-Aktivitaeten Taufe, Hochzeit und
        // Beerdigung haengen daran (defaultActivities unten). Ohne diese
        // Kategorie liefe das Anlegen einer Gemeinde auf einen leeren
        // Kategorie-Verweis.
        { key: 'kasualien', name: 'Kasualien', description: 'Taufe, Hochzeit, Beerdigung', type: 'activity' },
        // Gottesdienst und Gemeinde bleiben als Kategorie erhalten -- sie
        // schaden hier nicht und viele Gemeinden erwarten sie. Sie tragen nur
        // KEINE eigene Wrapped-Seite, weil sie die Punkte-Achse doppeln
        // (activities.type). Siehe utils/wrappedKategorien.js.
        { key: 'gottesdienst', name: 'Gottesdienst', description: '', type: 'both' },
        { key: 'gemeinde', name: 'Gemeinde', description: '', type: 'both' }
      ];

      const categoryIdByKey = {};
      const categoryQuery = `INSERT INTO categories (name, description, type, organization_id)
                             VALUES ($1, $2, $3, $4) RETURNING id`;
      for (const cat of defaultCategories) {
        const { rows: [newCat] } = await db.query(categoryQuery, [cat.name, cat.description, cat.type, organizationId]);
        categoryIdByKey[cat.key] = newCat.id;
      }

      // 8. Create default activities (Startpunkt zum Anpassen) + Kategorie-Verknuepfung.
      // type: 'gottesdienst' | 'gemeinde'. categoryKey verweist auf defaultCategories.
      const defaultActivities = [
        { name: 'Gottesdienstbesuch', points: 1, type: 'gottesdienst', categoryKey: 'gottesdienst' },
        { name: 'Taufe', points: 1, type: 'gottesdienst', categoryKey: 'kasualien' },
        { name: 'Hochzeit', points: 1, type: 'gottesdienst', categoryKey: 'kasualien' },
        { name: 'Beerdigung', points: 2, type: 'gottesdienst', categoryKey: 'kasualien' },
        { name: 'Küsterdienst', points: 1, type: 'gemeinde', categoryKey: 'gemeinde' }
      ];

      const defaultTeamerActivities = [
        { name: 'Andacht halten', categoryKey: 'gottesdienst' },
        { name: 'Gottesdienst mitgestalten', categoryKey: 'gottesdienst' },
        { name: 'Team-Schulung', categoryKey: 'teamtreff' },
        { name: 'Team-Sitzung', categoryKey: 'teamtreff' }
      ];

      const activityQuery = `INSERT INTO activities (name, points, type, organization_id)
                             VALUES ($1, $2, $3, $4) RETURNING id`;
      const activityCategoryQuery = `INSERT INTO activity_categories (activity_id, category_id)
                                     VALUES ($1, $2)`;
      for (const act of defaultActivities) {
        const { rows: [newAct] } = await db.query(activityQuery, [act.name, act.points, act.type, organizationId]);
        const catId = categoryIdByKey[act.categoryKey];
        if (catId) {
          await db.query(activityCategoryQuery, [newAct.id, catId]);
        }
      }

      const teamerActivityQuery = `INSERT INTO activities (name, points, type, target_role, organization_id)
                                   VALUES ($1, 0, NULL, 'teamer', $2) RETURNING id`;
      for (const act of defaultTeamerActivities) {
        const { rows: [newAct] } = await db.query(teamerActivityQuery, [act.name, organizationId]);
        const catId = categoryIdByKey[act.categoryKey];
        if (catId) {
          await db.query(activityCategoryQuery, [newAct.id, catId]);
        }
      }

      // 9. Beispiel-Challenges (Startpunkt zum Anpassen). Je eine pro
      // challenge_type, als Entwuerfe (is_draft=true) angelegt, damit nichts
      // ungewollt live geht — die Leitung passt Inhalte an und veroeffentlicht
      // selbst. Platzhalter-Zeitraum (7 bis 14 Tage ab jetzt), da eine neue Org
      // noch keine Jahrgänge hat und die Challenges daher bewusst OHNE
      // Jahrgangs-Zuweisung starten (challenge_jahrgang_assignments bleibt leer;
      // routes/challenges.js zeigt Entwuerfe ohne Zuweisung über LEFT JOIN /
      // COALESCE sauber an).
      const defaultChallenges = [
        {
          title: 'Unbezahlbar — Momente, die man nicht kaufen kann',
          description: 'Eine Woche lang achtest du auf Momente, die nichts kosten und dir trotzdem wichtig sind — ein Lachen, ein Sonnenuntergang, ein gutes Gespräch. Teile so einen Moment als Foto oder Text.',
          challenge_type: 'wahrnehmung',
          visibility: 'konfi_choice',
          moderated: true,
          badge_name: 'Unbezahlbar'
        },
        {
          title: 'Dein Song',
          description: 'Es gibt bestimmt einen Song, der etwas mit dir macht — der dich runterholt, aufbaut oder einfach zu dir passt. Teile ihn als Link und schreib in einem Satz, warum genau dieser Song.',
          challenge_type: 'beitrag',
          visibility: 'konfi_choice',
          moderated: false,
          badge_name: 'Dein Song'
        },
        {
          title: 'Eine Woche ein guter Vorsatz',
          description: 'Zieh eine Woche lang etwas Kleines durch, das dir guttut — zum Beispiel morgens an eine Sache denken, für die du dankbar bist, oder jeden Tag einen freundlichen Satz zu jemandem sagen. Schreib am Ende kurz auf, wie es für dich war. Das lesen nur wir.',
          challenge_type: 'praxis',
          visibility: 'private',
          moderated: false,
          badge_name: 'Guter Vorsatz'
        }
      ];

      const challengeQuery = `INSERT INTO challenges (
        organization_id, title, description, challenge_type, visibility, moderated,
        badge_name, created_by, starts_at, ends_at, is_draft
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '7 days', NOW() + INTERVAL '14 days', true)`;

      for (const challenge of defaultChallenges) {
        await db.query(challengeQuery, [
          organizationId, challenge.title, challenge.description, challenge.challenge_type,
          challenge.visibility, challenge.moderated, challenge.badge_name, newAdmin.id
        ]);
      }

      res.status(201).json({
        id: organizationId,
        admin_user_id: newAdmin.id,
        // Wie bei den Aktivitaeten: Konfi- und Teamer-Vorlagen zusammen.
        default_badges_created: defaultBadges.length + defaultTeamerBadges.length,
        default_certificates_created: defaultCertificates.length,
        default_levels_created: defaultLevels.length,
        default_categories_created: defaultCategories.length,
        default_activities_created: defaultActivities.length + defaultTeamerActivities.length,
        default_challenges_created: defaultChallenges.length,
        message: `Organisation erfolgreich erstellt (Standard-Rollen, Admin, ${defaultBadges.length + defaultTeamerBadges.length} Badges, ${defaultCertificates.length} Zertifikate, ${defaultLevels.length} Levels, ${defaultCategories.length} Kategorien, ${defaultActivities.length} Aktivitäten, ${defaultChallenges.length} Beispiel-Challenges)`
      });

      // Live-Update NACH der Response: nur an den ausfuehrenden Super-Admin selbst
      // (Multi-Device-Sync seiner eigenen Sitzung). Die Organisations-Verwaltung ist
      // super-admin-only und org-uebergreifend; ein Org-Broadcast passt hier nicht.
      // Andere Super-Admins sind selten und aktualisieren beim nächsten Seitenaufruf.
      liveUpdate.sendToUserByRole(req.user.id, 'organizations', 'create');

    } catch (err) {
      if (err.code === '23505') { // unique_violation
        return res.status(409).json({ error: 'Organisations-Slug existiert bereits' });
      }
 console.error('Error creating organization:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Update organization
  // super_admin: alle, org_admin: nur eigene
  router.put('/:id', rbacVerifier, validateUpdateOrg, async (req, res) => {
    try {
      const { id } = req.params;
      const {
        name, slug, display_name, description, contact_name, contact_email,
        contact_phone, address, website_url, kirchenkreis, is_active
      } = req.body;

      // Zugriffsprüfung
      const isSuperAdmin = req.user.is_super_admin === true;
      const isOwnOrg = req.user.organization_id === parseInt(id) && req.user.role_name === 'org_admin';

      if (!isSuperAdmin && !isOwnOrg) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }

      // Basis-Felder (von super_admin UND org_admin editierbar)
      const setClauses = [
        'name = $1', 'slug = $2', 'display_name = $3', 'description = $4',
        'contact_name = $5', 'contact_email = $6', 'contact_phone = $7', 'address = $8',
        'website_url = $9', 'kirchenkreis = $10', 'updated_at = NOW()'
      ];
      const params = [
        name, slug, display_name, description, contact_name || null, contact_email, contact_phone,
        address, website_url, kirchenkreis || null
      ];

      // is_active darf NUR der super_admin setzen.
      // Eine inaktive Organisation fuehrt in rbac.js:177 für JEDEN Zugang zu
      // 401 "Organization is inactive" — ein org_admin konnte damit sich selbst
      // und die gesamte Gemeinde aussperren, ohne den Schritt zurueckdrehen zu
      // können: dazu braeuchte es wieder einen Zugang, den es dann nicht mehr
      // gibt. Nur der super_admin kaeme noch heran.
      if (isSuperAdmin && Object.prototype.hasOwnProperty.call(req.body, 'is_active')) {
        params.push(is_active);
        setClauses.push(`is_active = $${params.length}`);
      }

      // trial_ends_at + is_trial darf NUR der super_admin ändern.
      //   trial_ends_at: null = unbegrenzt, Datum = Zugang bis dahin.
      //   is_trial:      true = Dashboard-Hinweis an, false = aus (Lizenz/unbegrenzt).
      if (isSuperAdmin && Object.prototype.hasOwnProperty.call(req.body, 'trial_ends_at')) {
        params.push(req.body.trial_ends_at || null);
        setClauses.push(`trial_ends_at = $${params.length}`);
        // Bei jeder Laufzeit-Änderung den Erinnerungs-Marker zuruecksetzen,
        // damit die nächste anstehende Lizenz-Erinnerung wieder verschickt wird.
        setClauses.push('license_reminder_sent_at = NULL');
      }
      if (isSuperAdmin && Object.prototype.hasOwnProperty.call(req.body, 'is_trial')) {
        params.push(req.body.is_trial === true);
        setClauses.push(`is_trial = $${params.length}`);
      }

      params.push(id);
      const query = `UPDATE organizations SET ${setClauses.join(', ')} WHERE id = $${params.length}`;

      const { rowCount } = await db.query(query, params);
        
      if (rowCount === 0) {
        return res.status(404).json({ error: 'Organisation nicht gefunden' });
      }
        
      res.json({ message: 'Organisation erfolgreich aktualisiert' });

      // Live-Update NACH der Response an den Ausfuehrenden selbst (Multi-Device).
      // Passt für super_admin (org-uebergreifende Verwaltung) und org_admin (eigene Org).
      liveUpdate.sendToUserByRole(req.user.id, 'organizations', 'update');
    } catch (err) {
      if (err.code === '23505') { // unique_violation
        return res.status(409).json({ error: 'Organisations-Slug existiert bereits' });
      }
 console.error('Error updating organization:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Delete organization (super admin only) - Vollständige CASCADE-Löschkette
  router.delete('/:id', rbacVerifier, requireSuperAdmin, validateOrgId, async (req, res) => {
    const client = await db.getClient();
    try {
      const { id } = req.params;
      await client.query('BEGIN');

      // Prüfen ob Organisation existiert
      const { rows: [org] } = await client.query('SELECT id FROM organizations WHERE id = $1', [id]);
      if (!org) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Organisation nicht gefunden' });
      }

      // VOLLSTAENDIGE LOESCHUNG aller Org-Daten in abhaengigkeitssicherer
      // Reihenfolge (Blaetter -> Wurzel). Reihenfolge ist bewusst explizit statt
      // sich auf FK-CASCADE zu verlassen, da viele FKs NO ACTION sind (created_by,
      // admin_id, *.organization_id auf chat_rooms/materials/settings/...). Eine
      // einzige nicht abgeraeumte NO-ACTION-Referenz wuerde sonst die ganze
      // Löschung blockieren (Rollback). Alles läuft in EINER Transaktion.
      //
      // Hinweis Multi-Org: Gast-Mitgliedschaften FREMDER User in dieser Org
      // (user_organizations.organization_id = id) werden hier gelöscht; die
      // Gast-User selbst bleiben (gehören ihrer eigenen Org). Die org-eigenen
      // User werden gelöscht, ihre Gast-Mitgliedschaften in ANDEREN Orgs
      // kaskadieren über den users-FK (user_organizations.user_id CASCADE).

      // Chat-Anhaenge VOR den DB-Deletes einsammeln, damit die Dateien nach
      // dem COMMIT vom Datenträger entfernt werden können.
      const { rows: orgChatFiles } = await client.query(
        'SELECT file_path FROM chat_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE organization_id = $1) AND file_path IS NOT NULL', [id]);

      // 1. Chat-System (Blaetter zuerst). chat_polls hängt an message_id (NICHT
      // room_id) -> über chat_messages der Org-Rooms aufloesen.
      await client.query('DELETE FROM chat_poll_votes WHERE poll_id IN (SELECT id FROM chat_polls WHERE message_id IN (SELECT id FROM chat_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE organization_id = $1)))', [id]);
      await client.query('DELETE FROM chat_polls WHERE message_id IN (SELECT id FROM chat_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE organization_id = $1))', [id]);
      await client.query('DELETE FROM chat_message_reactions WHERE message_id IN (SELECT id FROM chat_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE organization_id = $1))', [id]);
      await client.query('DELETE FROM chat_read_status WHERE room_id IN (SELECT id FROM chat_rooms WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM chat_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM chat_participants WHERE room_id IN (SELECT id FROM chat_rooms WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM chat_rooms WHERE organization_id = $1', [id]);

      // 2. Material-System (hängt an events/jahrgaenge/users der Org).
      // Auch hier: Dateinamen vor dem DB-Delete sichern.
      const { rows: orgMaterialFiles } = await client.query(
        'SELECT mf.stored_name FROM material_files mf JOIN materials m ON mf.material_id = m.id WHERE m.organization_id = $1', [id]);
      await client.query('DELETE FROM material_files WHERE material_id IN (SELECT id FROM materials WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM material_events WHERE material_id IN (SELECT id FROM materials WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM material_jahrgaenge WHERE material_id IN (SELECT id FROM materials WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM materials WHERE organization_id = $1', [id]);

      // 3. Event-Daten
      await client.query('DELETE FROM event_points WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM event_reminders WHERE event_id IN (SELECT id FROM events WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM event_unregistrations WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM event_bookings WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM event_categories WHERE event_id IN (SELECT id FROM events WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM event_jahrgang_assignments WHERE event_id IN (SELECT id FROM events WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM event_timeslots WHERE organization_id = $1 OR event_id IN (SELECT id FROM events WHERE organization_id = $2)', [id, id]);
      // Serien-Selbstreferenz (events.series_id NO ACTION) entkoppeln, dann löschen
      await client.query('UPDATE events SET series_id = NULL WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM events WHERE organization_id = $1', [id]);

      // 4. Konfi-/Aktivitaets-Daten
      await client.query('DELETE FROM user_activities WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM bonus_points WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM user_badges WHERE organization_id = $1', [id]);
      const { rows: orgRequestPhotos } = await client.query(
        'SELECT photo_filename FROM activity_requests WHERE organization_id = $1 AND photo_filename IS NOT NULL', [id]);
      const { rows: orgChallengeFiles } = await client.query(
        'SELECT file_path FROM challenge_submissions WHERE organization_id = $1 AND file_path IS NOT NULL', [id]);
      await client.query('DELETE FROM activity_requests WHERE organization_id = $1', [id]);
      // Challenges explizit (statt CASCADE), passend zum Stil dieser Löschung
      await client.query('DELETE FROM challenge_submissions WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM challenge_jahrgang_assignments WHERE challenge_id IN (SELECT id FROM challenges WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM challenges WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM wrapped_snapshots WHERE organization_id = $1', [id]);

      // 5. Zertifikate (user_certificates -> certificate_types)
      await client.query('DELETE FROM user_certificates WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM certificate_types WHERE organization_id = $1', [id]);

      await client.query('DELETE FROM notifications WHERE organization_id = $1 OR user_id IN (SELECT id FROM users WHERE organization_id = $2)', [id, id]);
      await client.query('DELETE FROM push_tokens WHERE user_id IN (SELECT id FROM users WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE organization_id = $1)', [id]);

      // 7. User-Zuweisungen + Multi-Org-Mitgliedschaften
      await client.query('DELETE FROM user_jahrgang_assignments WHERE user_id IN (SELECT id FROM users WHERE organization_id = $1)', [id]);
      // ALLE Mitgliedschaften in dieser Org (auch Gast-User fremder Orgs).
      // Die betroffenen User VORHER einsammeln: Ihr gecachtes req.user trägt
      // noch die Rolle in dieser Org, und ohne Invalidierung könnten sie bis
      // zu 30 Sekunden weiterarbeiten.
      const { rows: exMitglieder } = await client.query(
        'SELECT DISTINCT user_id FROM user_organizations WHERE organization_id = $1',
        [id]
      );
      await client.query('DELETE FROM user_organizations WHERE organization_id = $1', [id]);

      // 8. Konfsprueche (org-gescopt; konfi_profiles.konfspruch_id ist SET NULL)
      await client.query('DELETE FROM konfspruch_uebersetzungen WHERE spruch_id IN (SELECT id FROM konfsprueche WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM konfsprueche WHERE organization_id = $1', [id]);

      // 9. Stammdaten, die per created_by/admin_id (NO ACTION) auf users zeigen,
      // MUESSEN vor DELETE FROM users weg, sonst blockiert der FK das Löschen.
      await client.query('DELETE FROM activity_categories WHERE activity_id IN (SELECT id FROM activities WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM activities WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM categories WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM user_badges WHERE organization_id = $1', [id]); // vor custom_badges (badge_id NO ACTION)
      await client.query('DELETE FROM custom_badges WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM levels WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM invite_codes WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM settings WHERE organization_id = $1', [id]);

      // 10. Konfi-Profile + Users der Org. Gast-Mitgliedschaften dieser User in
      // ANDEREN Orgs kaskadieren über den users-FK.
      await client.query('DELETE FROM konfi_profiles WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM users WHERE organization_id = $1', [id]);

      // 11. Jahrgänge (nach users; user_jahrgang_assignments ist weg)
      await client.query('DELETE FROM jahrgaenge WHERE organization_id = $1', [id]);

      // 12. Rollen (role_permissions + user_organizations.role_id RESTRICT sind
      // bereits oben abgeraeumt)
      await client.query('DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE organization_id = $1)', [id]);
      await client.query('DELETE FROM roles WHERE organization_id = $1', [id]);

      // 13. Organisation selbst
      const { rowCount } = await client.query('DELETE FROM organizations WHERE id = $1', [id]);
      if (rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Organisation nicht gefunden' });
      }

      await client.query('COMMIT');

      // Cache der ehemaligen Mitglieder leeren — erst nach dem COMMIT, damit
      // ein Rollback keinen unnötig geleerten Cache hinterlaesst. Ohne das
      // könnten Gast-User fremder Organisationen bis zu 30 Sekunden mit ihrer
      // alten Rolle weiterarbeiten.
      for (const m of exMitglieder) {
        invalidateUserCache(m.user_id);
      }

      res.json({ message: 'Organisation und alle zugehörigen Daten erfolgreich gelöscht' });

      // Dateien nach dem COMMIT entfernen (nicht blockierend — ein fehlendes
      // File darf die bereits erfolgte Löschung nicht scheitern lassen).
      for (const row of orgRequestPhotos) {
        try { await deletePhotoFile(row.photo_filename); } catch (e) { console.warn('Org-Delete: Antragsfoto nicht entfernbar:', e.message); }
      }
      for (const row of orgChallengeFiles) {
        try { await deleteChallengeFile(row.file_path); } catch (e) { console.warn('Org-Delete: Challenge-Datei nicht entfernbar:', e.message); }
      }
      for (const row of orgChatFiles) {
        try { await deleteChatFile(row.file_path); } catch (e) { console.warn('Org-Delete: Chat-Anhang nicht entfernbar:', e.message); }
      }
      for (const row of orgMaterialFiles) {
        try { await deleteMaterialFile(row.stored_name); } catch (e) { console.warn('Org-Delete: Material-Datei nicht entfernbar:', e.message); }
      }

      // Live-Update NACH der Response an den ausfuehrenden Super-Admin selbst (Multi-Device).
      liveUpdate.sendToUserByRole(req.user.id, 'organizations', 'delete');

    } catch (err) {
      await client.query('ROLLBACK').catch(rbErr => console.error('Rollback failed:', rbErr));
      console.error('Error deleting organization:', err);
      res.status(500).json({ error: 'Datenbankfehler beim Löschen der Organisation' });
    } finally {
      client.release();
    }
  });

  // Set Konfi-Limit (max_konfis) der Organisation - NUR super_admin
  // Eigener Endpunkt, damit org_admin (der die PUT-Route für die eigene Org nutzen darf)
  // das Limit NICHT setzen und den Tarif aushebeln kann.
  // Body: { max_konfis: <nicht-negativer Integer | null> }. null = unbegrenzt.
  router.patch('/:id/limit', rbacVerifier, requireSuperAdmin, validateOrgId, async (req, res) => {
    try {
      const { id } = req.params;
      const { max_konfis } = req.body;

      // Validierung: null erlaubt (unbegrenzt), sonst nicht-negativer Integer.
      if (max_konfis !== null && max_konfis !== undefined) {
        if (typeof max_konfis !== 'number' || !Number.isInteger(max_konfis) || max_konfis < 0) {
          return res.status(400).json({ error: 'max_konfis muss null oder eine nicht-negative ganze Zahl sein' });
        }
      }

      const value = (max_konfis === undefined) ? null : max_konfis;

      const { rowCount } = await db.query(
        'UPDATE organizations SET max_konfis = $1, updated_at = NOW() WHERE id = $2',
        [value, id]
      );

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Organisation nicht gefunden' });
      }

      res.json({ message: 'Konfi-Limit erfolgreich aktualisiert', max_konfis: value });

      // Live-Update NACH der Response an den ausfuehrenden Super-Admin selbst (Multi-Device).
      liveUpdate.sendToUserByRole(req.user.id, 'organizations', 'update');
    } catch (err) {
      console.error('Error setting organization limit:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get organization users - org_admin für eigene Org, super_admin für alle
  router.get('/:id/users', rbacVerifier, async (req, res) => {
    const isSuperAdmin = req.user.is_super_admin === true;
    const isOwnOrg = req.user.organization_id === parseInt(req.params.id);
    const isOrgAdmin = req.user.role_name === 'org_admin';

    // Zugriffsprüfung: super_admin oder org_admin der eigenen Org
    if (!isSuperAdmin && !(isOwnOrg && isOrgAdmin)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    try {
      const { id } = req.params;

      const query = `
        SELECT u.id, u.username, u.email, u.display_name, u.is_active,
               u.last_login_at, u.created_at,
               r.name as role_name, r.display_name as role_display_name,
               COUNT(DISTINCT uja.jahrgang_id) as assigned_jahrgaenge_count
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        LEFT JOIN user_jahrgang_assignments uja ON u.id = uja.user_id
        WHERE u.organization_id = $1
        GROUP BY u.id, r.name, r.display_name
        ORDER BY u.created_at DESC
      `;

      const { rows: users } = await db.query(query, [id]);
      res.json(users);
    } catch (err) {
 console.error('Error fetching organization users:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get organization admins (org_admin role) - super_admin oder org_admin der eigenen Org
  router.get('/:id/admins', rbacVerifier, async (req, res) => {
    try {
      const { id } = req.params;

      // Zugriffsprüfung: super_admin oder org_admin der eigenen Org
      const isSuperAdmin = req.user.is_super_admin === true;
      const isOwnOrg = req.user.organization_id === parseInt(id) && req.user.role_name === 'org_admin';

      if (!isSuperAdmin && !isOwnOrg) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }

      const query = `
        SELECT u.id, u.username, u.email, u.display_name, u.is_active,
               u.last_login_at, u.created_at
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE u.organization_id = $1 AND r.name = 'org_admin'
        ORDER BY u.created_at ASC
      `;

      const { rows: admins } = await db.query(query, [id]);
      res.json(admins);
    } catch (err) {
 console.error('Error fetching organization admins:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Add new org_admin to organization - super_admin oder org_admin der eigenen Org
  router.post('/:id/admins', rbacVerifier, validateCreateOrgAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { username, display_name, password, email } = req.body;

      // Zugriffsprüfung: super_admin oder org_admin der eigenen Org
      const isSuperAdmin = req.user.is_super_admin === true;
      const isOwnOrg = req.user.organization_id === parseInt(id) && req.user.role_name === 'org_admin';

      if (!isSuperAdmin && !isOwnOrg) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }

      if (!username || !display_name || !password) {
        return res.status(400).json({ error: 'Benutzername, Name und Passwort sind erforderlich' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });
      }

      // Prüfen ob Organisation existiert
      const { rows: [org] } = await db.query("SELECT id FROM organizations WHERE id = $1", [id]);
      if (!org) {
        return res.status(404).json({ error: 'Organisation nicht gefunden' });
      }

      // org_admin Rolle für diese Organisation finden
      const { rows: [role] } = await db.query(
        "SELECT id FROM roles WHERE organization_id = $1 AND name = 'org_admin'",
        [id]
      );

      if (!role) {
        return res.status(500).json({ error: 'Org-Admin Rolle für Organisation nicht gefunden' });
      }

      // Prüfen ob Benutzername bereits existiert (GLOBAL eindeutig!)
      const { rows: [existingUser] } = await db.query(
        "SELECT id, organization_id FROM users WHERE LOWER(username) = LOWER($1)",
        [username]
      );

      if (existingUser) {
        return res.status(409).json({ error: 'Benutzername existiert bereits (muss systemweit eindeutig sein)' });
      }

      // Neuen Admin erstellen
      const hashedPassword = await bcrypt.hash(password, 10);
      const { rows: [newAdmin] } = await db.query(`
        INSERT INTO users (organization_id, role_id, username, email, password_hash, display_name, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        RETURNING id, username, display_name, email, is_active, created_at
      `, [id, role.id, username, email || null, hashedPassword, display_name]);

      res.status(201).json(newAdmin);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Benutzername oder E-Mail existiert bereits' });
      }
 console.error('Error creating org admin:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ============================================
  // MULTI-ORG MITGLIEDSCHAFTEN (nur super_admin)
  // ============================================
  // Weist BESTEHENDE User (Admin/Teamer/Org-Admin) zusaetzlichen Organisationen
  // zu, sodass sie per Org-Switcher zwischen ihnen wechseln können. Konfis sind
  // ausgenommen (Switcher ist ein Verwaltungs-Feature).

  const validateAddMember = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige Organisations-ID'),
    body('user_id').isInt({ min: 1 }).withMessage('Ungültige Benutzer-ID'),
    body('role_name').trim().notEmpty().withMessage('Rolle ist erforderlich'),
    handleValidationErrors
  ];

  // GET /:id/members — alle Multi-Org-Mitglieder dieser Organisation
  router.get('/:id/members', rbacVerifier, requireSuperAdmin, validateOrgId, async (req, res) => {
    try {
      const { id } = req.params;
      // Beide Quellen vereinen und pro User EINMAL ausgeben:
      //  1) Primaer-User der Org (users.organization_id) — haben i.d.R. KEINEN
      //     user_organizations-Eintrag, wuerden sonst hier fehlen (z.B. der
      //     Org-eigene Admin).
      //  2) Multi-Org-Mitglieder (user_organizations-Mapping).
      // is_primary kennzeichnet die Primaer-Org (kann hier nicht entfernt werden).
      // Bei Doppelung (User primaer UND Mapping) gewinnt der Primaer-Eintrag
      // (is_primary=true) per DISTINCT ON + ORDER.
      const { rows } = await db.query(`
        SELECT DISTINCT ON (m.id)
               m.id, m.username, m.display_name, m.email,
               m.role_name, m.role_display_name, m.is_primary, m.created_at
        FROM (
          SELECT u.id, u.username, u.display_name, u.email,
                 r.name as role_name, r.display_name as role_display_name,
                 true as is_primary, u.created_at
          FROM users u
          JOIN roles r ON u.role_id = r.id
          WHERE u.organization_id = $1 AND u.is_active = true AND r.name != 'konfi'
          UNION ALL
          SELECT u.id, u.username, u.display_name, u.email,
                 r.name as role_name, r.display_name as role_display_name,
                 (u.organization_id = uo.organization_id) as is_primary, uo.created_at
          FROM user_organizations uo
          JOIN users u ON uo.user_id = u.id AND u.is_active = true
          JOIN roles r ON uo.role_id = r.id
          WHERE uo.organization_id = $1 AND r.name != 'konfi'
        ) m
        ORDER BY m.id, m.is_primary DESC
      `, [id]);
      // Sekundaer nach Anzeigename sortieren (DISTINCT ON erzwingt Sortierung nach m.id)
      rows.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'de'));
      res.json(rows);
    } catch (err) {
      console.error('Database error in GET /organizations/:id/members:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // POST /:id/members — bestehenden User dieser Organisation zuweisen.
  // role_name (org_admin | admin | teamer) wird in der ZIEL-Org aufgeloest.
  router.post('/:id/members', rbacVerifier, requireSuperAdmin, validateAddMember, async (req, res) => {
    const { id } = req.params;
    const { user_id, role_name } = req.body;
    const orgId = parseInt(id);

    if (role_name === 'konfi' || role_name === 'super_admin') {
      return res.status(400).json({ error: 'Nur org_admin, admin oder teamer sind als Mitglieds-Rolle erlaubt' });
    }

    try {
      // User existiert + ist kein Konfi?
      const { rows: [user] } = await db.query(`
        SELECT u.id, u.organization_id, r.name as role_name
        FROM users u LEFT JOIN roles r ON u.role_id = r.id
        WHERE u.id = $1
      `, [user_id]);
      if (!user) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }
      if (user.role_name === 'konfi') {
        return res.status(400).json({ error: 'Konfis können nicht mehreren Organisationen zugewiesen werden' });
      }

      // Organisation existiert?
      const { rows: [org] } = await db.query('SELECT id FROM organizations WHERE id = $1', [orgId]);
      if (!org) {
        return res.status(404).json({ error: 'Organisation nicht gefunden' });
      }

      // Rolle in der ZIEL-Org aufloesen
      const { rows: [role] } = await db.query(
        'SELECT id FROM roles WHERE organization_id = $1 AND name = $2',
        [orgId, role_name]
      );
      if (!role) {
        return res.status(400).json({ error: `Rolle '${role_name}' existiert in dieser Organisation nicht` });
      }

      // Upsert: vorhandene Mitgliedschaft aktualisiert die Rolle
      await db.query(`
        INSERT INTO user_organizations (user_id, organization_id, role_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, organization_id)
        DO UPDATE SET role_id = EXCLUDED.role_id
      `, [user_id, orgId, role.id]);

      invalidateUserCache(parseInt(user_id));
      res.status(201).json({ message: 'Mitgliedschaft gespeichert' });

      // Chat-Mitgliedschaft der Ziel-Org INLINE pflegen (TTL-Cache verlässt
      // sich darauf): neues Mitglied sofort in Team-Chat, Org-Admins zusaetzlich
      // in alle Jahrgangs-Chats der Ziel-Org.
      try {
        chatSyncCache.invalidate(orgId, parseInt(user_id));
        await syncTeamChat(db, orgId, req.user.id);
        if (role_name === 'org_admin') {
          const { rows: jgs } = await db.query(
            'SELECT id FROM jahrgaenge WHERE organization_id = $1', [orgId]
          );
          for (const jg of jgs) {
            await syncJahrgangChat(db, jg.id, orgId, req.user.id);
          }
        }
      } catch (syncErr) {
        console.error('Chat-Sync nach Mitgliedschafts-Zuweisung fehlgeschlagen:', syncErr.message);
      }
    } catch (err) {
      console.error('Database error in POST /organizations/:id/members:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // DELETE /:id/members/:userId — Mitgliedschaft entfernen.
  // Die PRIMAER-Org eines Users kann nicht entfernt werden (das wäre ein User-
  // Löschen, nicht ein Multi-Org-Entzug) -> dafuer die User-Verwaltung nutzen.
  router.delete('/:id/members/:userId', rbacVerifier, requireSuperAdmin, async (req, res) => {
    const orgId = parseInt(req.params.id);
    const userId = parseInt(req.params.userId);
    if (!Number.isInteger(orgId) || !Number.isInteger(userId)) {
      return res.status(400).json({ error: 'Ungültige ID' });
    }
    try {
      const { rows: [user] } = await db.query('SELECT organization_id FROM users WHERE id = $1', [userId]);
      if (!user) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }
      if (user.organization_id === orgId) {
        return res.status(400).json({ error: 'Die Primär-Organisation kann hier nicht entfernt werden' });
      }
      const { rowCount } = await db.query(
        'DELETE FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
        [userId, orgId]
      );
      if (rowCount === 0) {
        return res.status(404).json({ error: 'Mitgliedschaft nicht gefunden' });
      }

      // Zusaetzlich zum Cache-Leeren die bestehenden Access-Tokens sperren.
      // Der Cache-Reset allein genuegt heute, hängt aber daran, dass genau
      // EIN Backend-Prozess läuft und dass jeder Verbraucher des
      // active_organization_id-Claims durch rbacVerifier geht. Der Soft-Revoke
      // kostet nichts pro Request (die Prüfung existiert in rbac.js) und
      // macht den Entzug davon unabhaengig.
      //
      // Niemand wird dadurch ausgesperrt: Das Refresh-Token bleibt gueltig,
      // der Client holt still ein neues Access-Token — und dieses trägt den
      // entzogenen Claim nicht mehr, weil die Refresh-Route die Mitgliedschaft
      // erneut prüft.
      await db.query('UPDATE users SET token_invalidated_at = NOW() WHERE id = $1', [userId]);
      invalidateUserCache(userId);
      res.json({ message: 'Mitgliedschaft entfernt' });

      // Chat-Mitgliedschaft der Org INLINE aufräumen: Ex-Mitglied fliegt aus
      // Team-Chat und allen Jahrgangs-Chats der Org (Sync entfernt Nicht-Soll).
      try {
        chatSyncCache.invalidate(orgId, userId);
        await syncTeamChat(db, orgId, req.user.id);
        const { rows: jgs } = await db.query(
          'SELECT id FROM jahrgaenge WHERE organization_id = $1', [orgId]
        );
        for (const jg of jgs) {
          await syncJahrgangChat(db, jg.id, orgId, req.user.id);
        }
      } catch (syncErr) {
        console.error('Chat-Sync nach Mitgliedschafts-Entzug fehlgeschlagen:', syncErr.message);
      }
    } catch (err) {
      console.error('Database error in DELETE /organizations/:id/members/:userId:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get organization statistics - nur eigene Org
  // requireTeamer aus demselben Grund wie bei GET /:id: Die Zähler (u.a.
  // pending_requests) sind Verwaltungsdaten und gehen Konfis nichts an.
  router.get('/:id/stats', rbacVerifier, requireOrgVerwaltung, async (req, res) => {
    try {
      const { id } = req.params;

      // Zugriffsprüfung: nur eigene Org (oder super_admin für alle)
      const isSuperAdmin = req.user.is_super_admin === true;
      const isOwnOrg = req.user.organization_id === parseInt(id);

      if (!isSuperAdmin && !isOwnOrg) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }
      
      const statsQueries = {
        konfis: "SELECT COUNT(*)::int as count FROM konfi_profiles WHERE organization_id = $1",
        activities: "SELECT COUNT(*)::int as count FROM activities WHERE organization_id = $1",
        events: "SELECT COUNT(*)::int as count FROM events WHERE organization_id = $1",
        badges: "SELECT COUNT(*)::int as count FROM custom_badges WHERE organization_id = $1",
        requests: "SELECT COUNT(*)::int as count FROM activity_requests ar JOIN konfi_profiles kp ON ar.user_id = kp.user_id WHERE kp.organization_id = $1",
        pending_requests: "SELECT COUNT(*)::int as count FROM activity_requests ar JOIN konfi_profiles kp ON ar.user_id = kp.user_id WHERE kp.organization_id = $1 AND ar.status = 'pending'"
      };
      
      // Execute all queries in parallel
      const queryPromises = Object.values(statsQueries).map(query => db.query(query, [id]));
      const results = await Promise.all(queryPromises);
      
      const stats = {};
      const keys = Object.keys(statsQueries);

      results.forEach((result, index) => {
        const key = keys[index];
        stats[key] = result.rows[0]?.count || 0;
      });
      
      res.json(stats);
    } catch (err) {
 console.error('Database error in GET /organizations/:id/stats:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Standard-Zertifikatstypen für Organisationen nachziehen, die noch keine
  // haben (einmalige Datenmigration für Bestandsorganisationen).
  //
  // Laeuft bewusst NICHT in Tests: Der Aufruf am Ende dieser Datei ist nicht
  // awaited und hängt am Router-Load. In der Testsuite wird createApp() pro
  // Datei neu aufgerufen, während beforeEach die Organisationen löscht und
  // neu anlegt — die noch laufende Schleife schrieb dann gegen bereits
  // geloeschte org-IDs ("violates foreign key constraint
  // certificate_types_organization_id_fkey"). Traf das den
  // POST /certificate-types im beforeEach von teamer.test.js, blieb certTypeId
  // undefined und die Folgetests fielen um — ein sporadisch roter Build, der
  // Deploys blockierte, ohne dass am Code etwas kaputt war.
  const seedDefaultCertificates = async () => {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const { rows: orgs } = await db.query(
        `SELECT o.id FROM organizations o
         WHERE NOT EXISTS (
           SELECT 1 FROM certificate_types ct WHERE ct.organization_id = o.id
         )`
      );
      if (orgs.length === 0) return;
      const defaultCerts = [
        { name: 'Teamer-Card', icon: 'card' },
        { name: 'JuLeiCa', icon: 'ribbon' },
        { name: 'Rettungsschwimmer', icon: 'water' },
        { name: 'Erste Hilfe', icon: 'medkit' }
      ];
      for (const org of orgs) {
        for (const cert of defaultCerts) {
          await db.query(
            'INSERT INTO certificate_types (name, icon, organization_id) VALUES ($1, $2, $3)',
            [cert.name, cert.icon, org.id]
          );
        }
      }
      console.log(`Seeded default certificates for ${orgs.length} organization(s)`);
    } catch (err) {
      console.error('Error seeding default certificates:', err.message);
    }
  };
  seedDefaultCertificates();

  return router;
};