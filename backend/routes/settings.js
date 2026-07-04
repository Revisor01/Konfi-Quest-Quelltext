const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const liveUpdate = require('../utils/liveUpdate');

// Settings: Nur org_admin darf bearbeiten
module.exports = (db, rbacVerifier, { requireOrgAdmin }) => {

  // Validierungsregeln
  const validateSettings = [
    body('max_waitlist_size').optional().isInt({ min: 0 }).withMessage('Wartelistengröße muss eine nicht-negative Ganzzahl sein'),
    body('dashboard_show_konfirmation').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('dashboard_show_events').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('dashboard_show_losung').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('dashboard_show_badges').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('dashboard_show_ranking').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('teamer_dashboard_show_zertifikate').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('teamer_dashboard_show_events').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('teamer_dashboard_show_badges').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('teamer_dashboard_show_losung').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('dashboard_section_order').optional().isJSON().withMessage('Section-Order muss JSON sein'),
    body('teamer_dashboard_section_order').optional().isJSON().withMessage('Section-Order muss JSON sein'),
    handleValidationErrors
  ];

  // Sicherstellen, dass settings-Tabelle organization_id-Spalte hat
  // (Migration: idempotent, läuft bei jedem Start)
  const ensureOrgColumn = async () => {
    try {
      // Prüfen ob organization_id Spalte existiert
      const { rows } = await db.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'settings' AND column_name = 'organization_id'
      `);

      if (rows.length === 0) {

        // Spalte hinzufügen (nullable zunächst)
        await db.query('ALTER TABLE settings ADD COLUMN organization_id INTEGER REFERENCES organizations(id)');

        // Bestehende Settings der ersten Organisation zuweisen
        const { rows: orgs } = await db.query('SELECT id FROM organizations ORDER BY id LIMIT 1');
        if (orgs.length > 0) {
          await db.query('UPDATE settings SET organization_id = $1 WHERE organization_id IS NULL', [orgs[0].id]);
        }

        // UNIQUE constraint auf (organization_id, key) setzen
        // Zuerst alten UNIQUE constraint auf key entfernen falls vorhanden
        await db.query(`
          DO $$ BEGIN
            ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_key;
            ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
          EXCEPTION WHEN OTHERS THEN NULL;
          END $$;
        `);
        await db.query('ALTER TABLE settings ADD CONSTRAINT settings_org_key_unique UNIQUE (organization_id, key)');

      }
    } catch (err) {
      console.error('Settings migration error:', err.message);
    }
  };

  // Migration beim Laden ausführen
  ensureOrgColumn();

  // GET settings (alle authentifizierten User der eigenen Org)
  // Auch super_admin wird auf die aktuelle Organisation gescopt: ohne Filter
  // wuerden Settings ALLER Orgs vermischt zurueckgegeben (key-Kollision ueberschreibt Werte).
  router.get('/', rbacVerifier, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT key, value FROM settings WHERE organization_id = $1`,
        [req.user.organization_id]
      );

      const DEFAULT_KONFI_ORDER = ['konfirmation', 'events', 'losung', 'badges', 'ranking'];
      const DEFAULT_TEAMER_ORDER = ['zertifikate', 'events', 'badges', 'losung'];

      const settings = {};
      rows.forEach(row => {
        if (row.key === 'max_waitlist_size') {
          settings[row.key] = parseInt(row.value, 10) || 0;
        } else if (row.key === 'dashboard_section_order') {
          try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = DEFAULT_KONFI_ORDER; }
        } else if (row.key === 'teamer_dashboard_section_order') {
          try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = DEFAULT_TEAMER_ORDER; }
        } else if (row.key === 'waitlist_enabled' || row.key.startsWith('dashboard_show_') || row.key.startsWith('teamer_dashboard_show_')) {
          settings[row.key] = row.value === 'true' || row.value === '1';
        } else {
          settings[row.key] = row.value;
        }
      });

      res.json(settings);
    } catch (err) {
      console.error('Database error in GET /settings:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // PUT settings (nur org_admin der eigenen Org)
  router.put('/', rbacVerifier, requireOrgAdmin, validateSettings, async (req, res) => {
    try {
      const orgId = req.user.organization_id;
      const {
        konfi_chat_permissions,
        waitlist_enabled,
        max_waitlist_size,
        dashboard_show_konfirmation,
        dashboard_show_events,
        dashboard_show_losung,
        dashboard_show_badges,
        dashboard_show_ranking,
        teamer_dashboard_show_zertifikate,
        teamer_dashboard_show_events,
        teamer_dashboard_show_badges,
        teamer_dashboard_show_losung,
        dashboard_section_order,
        teamer_dashboard_section_order
      } = req.body;

      // Dashboard-Widget-Toggles speichern (Konfi + Teamer)
      const dashboardKeys = {
        dashboard_show_konfirmation,
        dashboard_show_events,
        dashboard_show_losung,
        dashboard_show_badges,
        dashboard_show_ranking,
        teamer_dashboard_show_zertifikate,
        teamer_dashboard_show_events,
        teamer_dashboard_show_badges,
        teamer_dashboard_show_losung
      };

      for (const [key, value] of Object.entries(dashboardKeys)) {
        if (value !== undefined) {
          await db.query(
            `INSERT INTO settings (organization_id, key, value) VALUES ($1, $2, $3)
             ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value`,
            [orgId, key, String(value)]
          );
        }
      }

      // Section-Order speichern (JSON-Strings)
      const orderKeys = { dashboard_section_order, teamer_dashboard_section_order };
      for (const [key, value] of Object.entries(orderKeys)) {
        if (value !== undefined) {
          await db.query(
            `INSERT INTO settings (organization_id, key, value) VALUES ($1, $2, $3)
             ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value`,
            [orgId, key, value]
          );
        }
      }

      if (konfi_chat_permissions !== undefined) {
        const validPermissions = [
          'direct_only_admin',
          'direct_only_all',
          'group_direct_admin',
          'group_direct_all'
        ];
        if (!validPermissions.includes(konfi_chat_permissions)) {
          return res.status(400).json({
            error: 'Ungültiger Chat-Berechtigungswert. Gültige Optionen: ' + validPermissions.join(', ')
          });
        }
        await db.query(
          `INSERT INTO settings (organization_id, key, value) VALUES ($1, 'konfi_chat_permissions', $2)
           ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value`,
          [orgId, konfi_chat_permissions]
        );
      }

      if (waitlist_enabled !== undefined) {
        await db.query(
          `INSERT INTO settings (organization_id, key, value) VALUES ($1, 'waitlist_enabled', $2)
           ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value`,
          [orgId, String(waitlist_enabled)]
        );
      }

      if (max_waitlist_size !== undefined) {
        await db.query(
          `INSERT INTO settings (organization_id, key, value) VALUES ($1, 'max_waitlist_size', $2)
           ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value`,
          [orgId, max_waitlist_size]
        );
      }

      res.json({ message: 'Einstellungen erfolgreich aktualisiert' });

      // Live-Update NACH der Response an die gesamte Org: Dashboard-Widget-Toggles
      // und Punkt-Typ-Einstellungen wirken direkt auf Konfi-/Teamer-Dashboards.
      liveUpdate.sendToOrg(orgId, 'dashboard', 'update');

    } catch (err) {
      console.error('Database error in PUT /settings:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  return router;
};
