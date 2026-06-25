const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors, commonValidations } = require('../middleware/validation');
const liveUpdate = require('../utils/liveUpdate');

// Kategorien: Teamer darf ansehen, Admin darf bearbeiten
module.exports = (db, rbacVerifier, { requireAdmin, requireTeamer }) => {

  // Validierungsregeln
  const validateCreateCategory = [
    commonValidations.name,
    commonValidations.description,
    body('type').optional().isIn(['gottesdienst', 'gemeinde', 'both']).withMessage('Typ muss "gottesdienst", "gemeinde" oder "both" sein'),
    handleValidationErrors
  ];

  const validateUpdateCategory = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    commonValidations.name,
    commonValidations.description,
    body('type').optional().isIn(['gottesdienst', 'gemeinde', 'both']).withMessage('Typ muss "gottesdienst", "gemeinde" oder "both" sein'),
    handleValidationErrors
  ];

  const validateCategoryId = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors
  ];

  // GET all categories for the admin's organization
  router.get('/', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const query = "SELECT * FROM categories WHERE organization_id = $1 ORDER BY name";
      const { rows: categories } = await db.query(query, [req.user.organization_id]);
      res.json(categories);
    } catch (err) {
 console.error('Database error in GET /api/categories:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // POST a new category
  router.post('/', rbacVerifier, requireAdmin, validateCreateCategory, async (req, res) => {
    const { name, description, type } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }

    try {
      const query = "INSERT INTO categories (name, description, type, organization_id) VALUES ($1, $2, $3, $4) RETURNING id";
      const params = [name.trim(), description, type || 'both', req.user.organization_id];
      const { rows: [newCategory] } = await db.query(query, params);

      res.status(201).json({ id: newCategory.id, message: 'Kategorie erfolgreich erstellt' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'categories', 'create');
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Kategoriename existiert bereits' });
      }
 console.error('Database error in POST /api/categories:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // PUT (update) a category
  router.put('/:id', rbacVerifier, requireAdmin, validateUpdateCategory, async (req, res) => {
    const { name, description, type } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }

    try {
      const query = "UPDATE categories SET name = $1, description = $2, type = $3 WHERE id = $4 AND organization_id = $5";
      const params = [name.trim(), description, type, req.params.id, req.user.organization_id];
      const { rowCount } = await db.query(query, params);

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Kategorie nicht gefunden' });
      }
      res.json({ message: 'Kategorie erfolgreich aktualisiert' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'categories', 'update');
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Kategoriename existiert bereits' });
      }
 console.error(`Database error in PUT /api/categories/${req.params.id}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // DELETE a category
  router.delete('/:id', rbacVerifier, requireAdmin, validateCategoryId, async (req, res) => {
    const categoryId = req.params.id;

    try {
      const checkQuery = `
        SELECT
          (SELECT COUNT(*) FROM activity_categories WHERE category_id = $1)::int as activity_count,
          (SELECT COUNT(*) FROM event_categories WHERE category_id = $2)::int as event_count
      `;
      const { rows: [usage] } = await db.query(checkQuery, [categoryId, categoryId]);

      if (usage.activity_count > 0 || usage.event_count > 0) {
        let message = 'Kategorie kann nicht gelöscht werden: ';
        const usages = [];
        if (usage.activity_count > 0) usages.push(`${usage.activity_count} Aktivität(en)`);
        if (usage.event_count > 0) usages.push(`${usage.event_count} Event(s)`);
        message += usages.join(' und ') + ' zugeordnet.';
        return res.status(409).json({ error: message });
      }

      const deleteQuery = "DELETE FROM categories WHERE id = $1 AND organization_id = $2";
      const { rowCount } = await db.query(deleteQuery, [categoryId, req.user.organization_id]);

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Kategorie nicht gefunden' });
      }

      res.json({ message: 'Kategorie erfolgreich gelöscht' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'categories', 'delete');
    } catch (err) {
 console.error(`Database error in DELETE /api/categories/${categoryId}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  return router;
};
