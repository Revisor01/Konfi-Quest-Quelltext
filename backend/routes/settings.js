const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const liveUpdate = require('../utils/liveUpdate');

// Settings: Nur org_admin darf bearbeiten
module.exports = (db, rbacVerifier, { requireOrgAdmin }) => {

  // Validierungsregeln
  const validateSettings = [
    body('dashboard_show_konfirmation').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('dashboard_show_events').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('dashboard_show_losung').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('dashboard_show_badges').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('dashboard_show_ranking').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('dashboard_show_challenges').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('dashboard_show_konfispruch').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('teamer_dashboard_show_zertifikate').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('teamer_dashboard_show_challenges').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('teamer_dashboard_show_konfispruch').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('teamer_dashboard_show_events').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('teamer_dashboard_show_badges').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('teamer_dashboard_show_losung').optional().isBoolean().withMessage('Dashboard-Toggle muss Boolean sein'),
    body('dashboard_section_order').optional().isJSON().withMessage('Section-Order muss JSON sein'),
    body('teamer_dashboard_section_order').optional().isJSON().withMessage('Section-Order muss JSON sein'),
    handleValidationErrors
  ];

  // KEIN LAUFZEIT-DDL MEHR. Hier stand `ensureOrgColumn`: beim
  // Laden eine Abfrage auf information_schema und, falls
  // settings.organization_id fehlte, ALTER TABLE samt DROP CONSTRAINT
  // settings_pkey. Die Spalte entsteht laengst auf beiden Wegen -- neue
  // Instanz: init-scripts/01-create-schema.sql; Bestand: Migration 064
  // (dieselbe Logik, idempotent), dazu 174 mit NOT NULL und dem
  // Primaerschluessel (organization_id, key). Der Block haette im Ernstfall
  // genau diesen Primaerschluessel wieder abgerissen.
  // Test: tests/routes/settingsOhneLaufzeitDdl.test.js.

  // GET settings (alle authentifizierten User der eigenen Org)
  // Auch super_admin wird auf die aktuelle Organisation gescopt: ohne Filter
  // wuerden Settings ALLER Orgs vermischt zurueckgegeben (key-Kollision überschreibt Werte).
  router.get('/', rbacVerifier, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT key, value FROM settings WHERE organization_id = $1`,
        [req.user.organization_id]
      );

      const DEFAULT_KONFI_ORDER = ['konfirmation', 'challenges', 'konfispruch', 'events', 'losung', 'badges', 'ranking'];
      const DEFAULT_TEAMER_ORDER = ['zertifikate', 'challenges', 'konfispruch', 'events', 'badges', 'losung'];

      const settings = {};
      rows.forEach(row => {
        if (row.key === 'dashboard_section_order') {
          try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = DEFAULT_KONFI_ORDER; }
        } else if (row.key === 'teamer_dashboard_section_order') {
          try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = DEFAULT_TEAMER_ORDER; }
        } else if (row.key.startsWith('dashboard_show_') || row.key.startsWith('teamer_dashboard_show_')) {
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
        dashboard_show_konfirmation,
        dashboard_show_events,
        dashboard_show_losung,
        dashboard_show_badges,
        dashboard_show_ranking,
        dashboard_show_challenges,
        dashboard_show_konfispruch,
        teamer_dashboard_show_zertifikate,
        teamer_dashboard_show_challenges,
        teamer_dashboard_show_konfispruch,
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
        dashboard_show_challenges,
        dashboard_show_konfispruch,
        teamer_dashboard_show_zertifikate,
        teamer_dashboard_show_challenges,
        teamer_dashboard_show_konfispruch,
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
