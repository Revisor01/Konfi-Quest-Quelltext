const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { encryptBuffer, decryptBuffer } = require('../utils/photoCrypto');
const { allIdsBelongToOrg } = require('../utils/orgOwnership');

module.exports = (db, rbacVerifier, roleHelpers, materialUpload) => {
  const { requireTeamer, requireAdmin } = roleHelpers;

  // Validierungsregeln
  const validateCreateTag = [
    body('name').notEmpty().trim().isLength({ min: 1, max: 100 }).withMessage('Name erforderlich (1-100 Zeichen)'),
    handleValidationErrors
  ];

  const validateUpdateTag = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('name').notEmpty().trim().isLength({ min: 1, max: 100 }).withMessage('Name erforderlich (1-100 Zeichen)'),
    handleValidationErrors
  ];

  const validateCreateMaterial = [
    body('title').notEmpty().trim().isLength({ min: 1, max: 255 }).withMessage('Titel erforderlich (1-255 Zeichen)'),
    body('tag_ids').optional().isArray().withMessage('tag_ids muss ein Array sein'),
    handleValidationErrors
  ];

  const validateUpdateMaterial = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('title').optional().trim().isLength({ min: 1, max: 255 }).withMessage('Titel max. 255 Zeichen'),
    handleValidationErrors
  ];

  // Schema: siehe backend/migrations/064_consolidate_inline_schemas.sql

  // ====================================================================
  // TAG ENDPOINTS (Lesen: requireTeamer, CRUD: requireAdmin)
  // ====================================================================

  // GET /tags - Tags der eigenen Organisation laden
  router.get('/tags', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const { rows } = await db.query(
        'SELECT id, name, created_at FROM material_tags WHERE organization_id = $1 ORDER BY name',
        [req.user.organization_id]
      );
      res.json(rows);
    } catch (err) {
      console.error('Fehler beim Laden der Tags:', err.message);
      res.status(500).json({ error: 'Fehler beim Laden der Tags' });
    }
  });

  // POST /tags - Neuen Tag erstellen
  router.post('/tags', rbacVerifier, requireAdmin, validateCreateTag, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Tag-Name ist erforderlich' });
      }

      const { rows: [tag] } = await db.query(
        'INSERT INTO material_tags (name, organization_id) VALUES ($1, $2) RETURNING id, name, created_at',
        [name.trim(), req.user.organization_id]
      );
      res.status(201).json(tag);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Ein Tag mit diesem Namen existiert bereits' });
      }
      console.error('Fehler beim Erstellen des Tags:', err.message);
      res.status(500).json({ error: 'Fehler beim Erstellen des Tags' });
    }
  });

  // PUT /tags/:id - Tag umbenennen
  router.put('/tags/:id', rbacVerifier, requireAdmin, validateUpdateTag, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Tag-Name ist erforderlich' });
      }

      const { rows: [tag] } = await db.query(
        'UPDATE material_tags SET name = $1 WHERE id = $2 AND organization_id = $3 RETURNING id, name',
        [name.trim(), req.params.id, req.user.organization_id]
      );

      if (!tag) {
        return res.status(404).json({ error: 'Tag nicht gefunden' });
      }
      res.json(tag);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Ein Tag mit diesem Namen existiert bereits' });
      }
      console.error('Fehler beim Umbenennen des Tags:', err.message);
      res.status(500).json({ error: 'Fehler beim Umbenennen des Tags' });
    }
  });

  // DELETE /tags/:id - Tag löschen (CASCADE löscht Zuordnungen)
  router.delete('/tags/:id', rbacVerifier, requireAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        'DELETE FROM material_tags WHERE id = $1 AND organization_id = $2',
        [req.params.id, req.user.organization_id]
      );

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Tag nicht gefunden' });
      }
      res.json({ message: 'Tag gelöscht' });
    } catch (err) {
      console.error('Fehler beim Löschen des Tags:', err.message);
      res.status(500).json({ error: 'Fehler beim Löschen des Tags' });
    }
  });

  // ====================================================================
  // MATERIAL ENDPOINTS
  // ====================================================================

  // GET / - Alle Materialien der Organisation laden
  router.get('/', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const orgId = req.user.organization_id;
      const { tag_id, search, event_id, jahrgang_id } = req.query;

      let query = `
        SELECT m.id, m.title, m.description,
               m.created_at, u.display_name as created_by_name,
               (SELECT COUNT(*) FROM material_files mf WHERE mf.material_id = m.id) as file_count,
               (SELECT COUNT(*) FROM material_events me WHERE me.material_id = m.id) as event_count,
               (SELECT COUNT(*) FROM material_jahrgaenge mj WHERE mj.material_id = m.id) as jahrgang_count
        FROM materials m
        LEFT JOIN users u ON m.created_by = u.id
        WHERE m.organization_id = $1
      `;
      const params = [orgId];
      let paramIndex = 2;

      if (tag_id) {
        query += ` AND EXISTS (SELECT 1 FROM material_file_tags mft WHERE mft.material_id = m.id AND mft.tag_id = $${paramIndex})`;
        params.push(tag_id);
        paramIndex++;
      }

      if (search) {
        query += ` AND (m.title ILIKE $${paramIndex} OR m.description ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      if (event_id) {
        query += ` AND EXISTS (SELECT 1 FROM material_events me WHERE me.material_id = m.id AND me.event_id = $${paramIndex})`;
        params.push(event_id);
        paramIndex++;
      }

      if (jahrgang_id) {
        query += ` AND EXISTS (SELECT 1 FROM material_jahrgaenge mj WHERE mj.material_id = m.id AND mj.jahrgang_id = $${paramIndex})`;
        params.push(jahrgang_id);
        paramIndex++;
      }

      query += ' ORDER BY m.created_at DESC';

      const { rows: materials } = await db.query(query, params);

      if (materials.length > 0) {
        const materialIds = materials.map(m => m.id);

        // Tags für alle Materialien laden
        const { rows: tags } = await db.query(
          `SELECT mft.material_id, mt.id, mt.name
           FROM material_file_tags mft
           JOIN material_tags mt ON mft.tag_id = mt.id
           WHERE mft.material_id = ANY($1)`,
          [materialIds]
        );

        // Events für alle Materialien laden
        const { rows: matEvents } = await db.query(
          `SELECT me.material_id, e.id, e.name
           FROM material_events me
           JOIN events e ON me.event_id = e.id
           WHERE me.material_id = ANY($1)`,
          [materialIds]
        );

        const tagsByMaterial = {};
        for (const tag of tags) {
          if (!tagsByMaterial[tag.material_id]) tagsByMaterial[tag.material_id] = [];
          tagsByMaterial[tag.material_id].push({ id: tag.id, name: tag.name });
        }

        const eventsByMaterial = {};
        for (const ev of matEvents) {
          if (!eventsByMaterial[ev.material_id]) eventsByMaterial[ev.material_id] = [];
          eventsByMaterial[ev.material_id].push({ id: ev.id, name: ev.name });
        }

        // Jahrgänge für alle Materialien laden
        const { rows: matJahrgaenge } = await db.query(
          `SELECT mj.material_id, j.id, j.name
           FROM material_jahrgaenge mj
           JOIN jahrgaenge j ON mj.jahrgang_id = j.id
           WHERE mj.material_id = ANY($1)`,
          [materialIds]
        );

        const jahrgaengeByMaterial = {};
        for (const jg of matJahrgaenge) {
          if (!jahrgaengeByMaterial[jg.material_id]) jahrgaengeByMaterial[jg.material_id] = [];
          jahrgaengeByMaterial[jg.material_id].push({ id: jg.id, name: jg.name });
        }

        for (const material of materials) {
          material.tags = tagsByMaterial[material.id] || [];
          material.events = eventsByMaterial[material.id] || [];
          material.jahrgaenge = jahrgaengeByMaterial[material.id] || [];
          material.file_count = parseInt(material.file_count, 10);
          material.event_count = parseInt(material.event_count, 10);
          material.jahrgang_count = parseInt(material.jahrgang_count, 10);
        }
      }

      res.json(materials);
    } catch (err) {
      console.error('Fehler beim Laden der Materialien:', err.message);
      res.status(500).json({ error: 'Fehler beim Laden der Materialien' });
    }
  });

  // GET /by-event/:eventId - Material zu einem bestimmten Event
  router.get('/by-event/:eventId', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const orgId = req.user.organization_id;
      const eventId = req.params.eventId;

      const { rows: materials } = await db.query(
        `SELECT m.id, m.title, m.description, m.created_at,
                u.display_name as created_by_name,
                (SELECT COUNT(*) FROM material_files mf WHERE mf.material_id = m.id) as file_count
         FROM materials m
         LEFT JOIN users u ON m.created_by = u.id
         WHERE m.organization_id = $1
           AND EXISTS (SELECT 1 FROM material_events me WHERE me.material_id = m.id AND me.event_id = $2)
         ORDER BY m.created_at DESC`,
        [orgId, eventId]
      );

      for (const material of materials) {
        material.file_count = parseInt(material.file_count, 10);
      }

      res.json(materials);
    } catch (err) {
      console.error('Fehler beim Laden der Event-Materialien:', err.message);
      res.status(500).json({ error: 'Fehler beim Laden der Event-Materialien' });
    }
  });

  // GET /:id - Einzelnes Material mit Dateien und Tags
  router.get('/:id', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const orgId = req.user.organization_id;

      const { rows: [material] } = await db.query(
        `SELECT m.id, m.title, m.description,
                m.created_at, u.display_name as created_by_name
         FROM materials m
         LEFT JOIN users u ON m.created_by = u.id
         WHERE m.id = $1 AND m.organization_id = $2`,
        [req.params.id, orgId]
      );

      if (!material) {
        return res.status(404).json({ error: 'Material nicht gefunden' });
      }

      // Tags laden
      const { rows: tags } = await db.query(
        `SELECT mt.id, mt.name
         FROM material_file_tags mft
         JOIN material_tags mt ON mft.tag_id = mt.id
         WHERE mft.material_id = $1`,
        [material.id]
      );
      material.tags = tags;

      // Events laden (Many-to-Many)
      const { rows: matEvents } = await db.query(
        `SELECT e.id, e.name, e.event_date
         FROM material_events me
         JOIN events e ON me.event_id = e.id
         WHERE me.material_id = $1
         ORDER BY e.event_date DESC`,
        [material.id]
      );
      material.events = matEvents;

      // Jahrgaenge laden (Many-to-Many)
      const { rows: matJahrgaenge } = await db.query(
        `SELECT j.id, j.name
         FROM material_jahrgaenge mj
         JOIN jahrgaenge j ON mj.jahrgang_id = j.id
         WHERE mj.material_id = $1
         ORDER BY j.name`,
        [material.id]
      );
      material.jahrgaenge = matJahrgaenge;

      // Dateien laden
      const { rows: files } = await db.query(
        `SELECT id, original_name, stored_name, mime_type, file_size, created_at
         FROM material_files
         WHERE material_id = $1
         ORDER BY created_at`,
        [material.id]
      );
      material.files = files;

      res.json(material);
    } catch (err) {
      console.error('Fehler beim Laden des Materials:', err.message);
      res.status(500).json({ error: 'Fehler beim Laden des Materials' });
    }
  });

  // POST / - Material erstellen
  router.post('/', rbacVerifier, requireAdmin, validateCreateMaterial, async (req, res) => {
    try {
      const { title, description, event_ids, jahrgang_ids, tag_ids } = req.body;

      if (!title || !title.trim()) {
        return res.status(400).json({ error: 'Titel ist erforderlich' });
      }

      // Org-Isolation: fremde IDs abweisen (Cross-Org-Referenzen)
      if (!(await allIdsBelongToOrg(db, 'events', event_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens ein Event gehört nicht zu deiner Organisation' });
      }
      if (!(await allIdsBelongToOrg(db, 'jahrgaenge', jahrgang_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens ein Jahrgang gehört nicht zu deiner Organisation' });
      }
      if (!(await allIdsBelongToOrg(db, 'material_tags', tag_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens ein Tag gehört nicht zu deiner Organisation' });
      }

      const { rows: [material] } = await db.query(
        `INSERT INTO materials (title, description, organization_id, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, description, created_at`,
        [title.trim(), description || null, req.user.organization_id, req.user.id]
      );

      // Events zuordnen (Many-to-Many)
      const resolvedEventIds = event_ids || [];
      if (resolvedEventIds.length > 0) {
        const eventValues = resolvedEventIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        const eventParams = [material.id, ...resolvedEventIds];
        await db.query(
          `INSERT INTO material_events (material_id, event_id) VALUES ${eventValues}`,
          eventParams
        );
      }

      // Jahrgaenge zuordnen (Many-to-Many)
      const resolvedJahrgangIds = jahrgang_ids || [];
      if (resolvedJahrgangIds.length > 0) {
        const jgValues = resolvedJahrgangIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        const jgParams = [material.id, ...resolvedJahrgangIds];
        await db.query(
          `INSERT INTO material_jahrgaenge (material_id, jahrgang_id) VALUES ${jgValues}`,
          jgParams
        );
      }

      // Tags zuordnen
      if (tag_ids && tag_ids.length > 0) {
        const tagValues = tag_ids.map((tagId, i) => `($1, $${i + 2})`).join(', ');
        const tagParams = [material.id, ...tag_ids];
        await db.query(
          `INSERT INTO material_file_tags (material_id, tag_id) VALUES ${tagValues}`,
          tagParams
        );
      }

      res.status(201).json(material);
    } catch (err) {
      console.error('Fehler beim Erstellen des Materials:', err.message);
      res.status(500).json({ error: 'Fehler beim Erstellen des Materials' });
    }
  });

  // PUT /:id - Material bearbeiten
  router.put('/:id', rbacVerifier, requireAdmin, validateUpdateMaterial, async (req, res) => {
    try {
      const { title, description, event_ids, jahrgang_ids, tag_ids } = req.body;
      const orgId = req.user.organization_id;
      const materialId = req.params.id;

      // Prüfen ob Material existiert und zur Organisation gehört
      const { rows: [existing] } = await db.query(
        'SELECT id FROM materials WHERE id = $1 AND organization_id = $2',
        [materialId, orgId]
      );

      if (!existing) {
        return res.status(404).json({ error: 'Material nicht gefunden' });
      }

      // Org-Isolation: fremde IDs abweisen (Cross-Org-Referenzen)
      if (!(await allIdsBelongToOrg(db, 'events', event_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens ein Event gehört nicht zu deiner Organisation' });
      }
      if (!(await allIdsBelongToOrg(db, 'jahrgaenge', jahrgang_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens ein Jahrgang gehört nicht zu deiner Organisation' });
      }
      if (!(await allIdsBelongToOrg(db, 'material_tags', tag_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens ein Tag gehört nicht zu deiner Organisation' });
      }

      const updates = [];
      const params = [];
      let paramIndex = 1;

      if (title !== undefined) {
        updates.push(`title = $${paramIndex}`);
        params.push(title.trim());
        paramIndex++;
      }
      if (description !== undefined) {
        updates.push(`description = $${paramIndex}`);
        params.push(description);
        paramIndex++;
      }

      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        params.push(materialId);
        await db.query(
          `UPDATE materials SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
          params
        );
      }

      // Events aktualisieren (DELETE + INSERT)
      const resolvedEventIds = event_ids;
      if (resolvedEventIds !== undefined) {
        await db.query('DELETE FROM material_events WHERE material_id = $1', [materialId]);
        if (resolvedEventIds.length > 0) {
          const eventValues = resolvedEventIds.map((_, i) => `($1, $${i + 2})`).join(', ');
          const eventParams = [materialId, ...resolvedEventIds];
          await db.query(
            `INSERT INTO material_events (material_id, event_id) VALUES ${eventValues}`,
            eventParams
          );
        }
      }

      // Jahrgaenge aktualisieren (DELETE + INSERT)
      const resolvedJahrgangIds = jahrgang_ids;
      if (resolvedJahrgangIds !== undefined) {
        await db.query('DELETE FROM material_jahrgaenge WHERE material_id = $1', [materialId]);
        if (resolvedJahrgangIds.length > 0) {
          const jgValues = resolvedJahrgangIds.map((_, i) => `($1, $${i + 2})`).join(', ');
          const jgParams = [materialId, ...resolvedJahrgangIds];
          await db.query(
            `INSERT INTO material_jahrgaenge (material_id, jahrgang_id) VALUES ${jgValues}`,
            jgParams
          );
        }
      }

      // Tags aktualisieren (DELETE + INSERT)
      if (tag_ids !== undefined) {
        await db.query('DELETE FROM material_file_tags WHERE material_id = $1', [materialId]);
        if (tag_ids.length > 0) {
          const tagValues = tag_ids.map((tagId, i) => `($1, $${i + 2})`).join(', ');
          const tagParams = [materialId, ...tag_ids];
          await db.query(
            `INSERT INTO material_file_tags (material_id, tag_id) VALUES ${tagValues}`,
            tagParams
          );
        }
      }

      res.json({ message: 'Material aktualisiert' });
    } catch (err) {
      console.error('Fehler beim Bearbeiten des Materials:', err.message);
      res.status(500).json({ error: 'Fehler beim Bearbeiten des Materials' });
    }
  });

  // DELETE /:id - Material löschen
  router.delete('/:id', rbacVerifier, requireAdmin, async (req, res) => {
    try {
      const orgId = req.user.organization_id;
      const materialId = req.params.id;

      // Dateien vom Dateisystem holen bevor CASCADE loescht
      const { rows: files } = await db.query(
        `SELECT mf.stored_name FROM material_files mf
         JOIN materials m ON mf.material_id = m.id
         WHERE mf.material_id = $1 AND m.organization_id = $2`,
        [materialId, orgId]
      );

      const { rowCount } = await db.query(
        'DELETE FROM materials WHERE id = $1 AND organization_id = $2',
        [materialId, orgId]
      );

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Material nicht gefunden' });
      }

      // Dateien vom Dateisystem löschen
      const materialDir = path.join(__dirname, '..', 'uploads', 'material');
      for (const file of files) {
        try {
          const filePath = path.join(materialDir, file.stored_name);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (fileErr) {
          console.warn(`Konnte Datei ${file.stored_name} nicht löschen:`, fileErr.message);
        }
      }

      res.json({ message: 'Material gelöscht' });
    } catch (err) {
      console.error('Fehler beim Löschen des Materials:', err.message);
      res.status(500).json({ error: 'Fehler beim Löschen des Materials' });
    }
  });

  // ====================================================================
  // DATEI ENDPOINTS
  // ====================================================================

  // POST /:id/files - Dateien zu Material hochladen (AES-256-GCM verschluesselt)
  router.post('/:id/files', rbacVerifier, requireAdmin, materialUpload.array('files', 10), async (req, res) => {
    try {
      const orgId = req.user.organization_id;
      const materialId = req.params.id;

      // Prüfen ob Material existiert und zur Organisation gehört
      const { rows: [material] } = await db.query(
        'SELECT id FROM materials WHERE id = $1 AND organization_id = $2',
        [materialId, orgId]
      );

      if (!material) {
        return res.status(404).json({ error: 'Material nicht gefunden' });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Keine Dateien hochgeladen' });
      }

      // Magic-Bytes-Validierung auf den Buffern (echte Dateitypen erzwingen).
      const { fileTypeFromBuffer } = await import('file-type');
      const textMimes = ['text/plain', 'text/csv'];
      const allowedPrefixes = [
        'image/', 'video/', 'audio/', 'application/pdf',
        'application/vnd.openxmlformats', 'application/msword',
        'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
        'application/vnd.oasis.opendocument',
        'application/zip', 'application/x-cfb'
      ];
      for (const file of req.files) {
        if (!file.buffer) {
          return res.status(400).json({ error: 'Datei konnte nicht gelesen werden' });
        }
        if (textMimes.includes(file.mimetype)) { continue; }
        const detected = await fileTypeFromBuffer(file.buffer);
        if (!detected || !allowedPrefixes.some(p => detected.mime.startsWith(p))) {
          return res.status(415).json({ error: `Dateityp nicht verifizierbar: ${file.originalname}` });
        }
      }

      const crypto = require('crypto');
      const materialDir = path.join(__dirname, '..', 'uploads', 'material');
      await fs.promises.mkdir(materialDir, { recursive: true });

      const insertedFiles = [];
      for (const file of req.files) {
        // Zufaelliger Hex-Dateiname; verschluesselt schreiben
        const storedName = crypto.randomBytes(32).toString('hex');
        const storedPath = path.join(materialDir, storedName);
        await fs.promises.writeFile(storedPath, encryptBuffer(file.buffer));

        const { rows: [inserted] } = await db.query(
          `INSERT INTO material_files (material_id, original_name, stored_name, mime_type, file_size)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, original_name, mime_type, file_size, created_at`,
          [materialId, file.originalname, storedName, file.mimetype, file.size]
        );
        insertedFiles.push(inserted);
      }

      // updated_at aktualisieren
      await db.query('UPDATE materials SET updated_at = NOW() WHERE id = $1', [materialId]);

      res.status(201).json(insertedFiles);
    } catch (err) {
      console.error('Fehler beim Hochladen der Dateien:', err.message);
      res.status(500).json({ error: 'Fehler beim Hochladen der Dateien' });
    }
  });

  // GET /files/:filename - Datei herunterladen
  router.get('/files/:filename', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const filename = path.basename(req.params.filename);

      // Path-Traversal-Schutz: Nur Hex-Namen akzeptieren (randomBytes(32) = 64 Hex).
      // Aeltere SHA-256-Namen sind ebenfalls 64 Hex -> selbe Regel.
      if (!/^[a-f0-9]{64}$/.test(filename)) {
        return res.status(400).json({ error: 'Ungültiger Dateiname' });
      }

      // Prüfen ob Datei existiert und zur gleichen Organisation gehört
      const { rows: [fileRecord] } = await db.query(
        `SELECT mf.id, mf.original_name, mf.mime_type, mf.file_size
         FROM material_files mf
         JOIN materials m ON mf.material_id = m.id
         WHERE mf.stored_name = $1 AND m.organization_id = $2`,
        [filename, req.user.organization_id]
      );

      if (!fileRecord) {
        return res.status(404).json({ error: 'Datei nicht gefunden' });
      }

      const materialDir = path.join(__dirname, '..', 'uploads', 'material');
      const filePath = path.join(materialDir, filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Datei nicht auf dem Server gefunden' });
      }

      if (fileRecord.mime_type) {
        res.setHeader('Content-Type', fileRecord.mime_type);
      }
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileRecord.original_name)}"`);

      // Datei lesen und (falls verschluesselt) entschluesseln, dann senden.
      const fileBuffer = await fs.promises.readFile(filePath);
      let dataBuffer;
      try {
        dataBuffer = decryptBuffer(fileBuffer);
      } catch (decErr) {
        console.error('Error decrypting material file:', decErr);
        return res.status(500).json({ error: 'Datei konnte nicht entschlüsselt werden' });
      }
      res.send(dataBuffer);
    } catch (err) {
      console.error('Fehler beim Herunterladen der Datei:', err.message);
      res.status(500).json({ error: 'Fehler beim Herunterladen der Datei' });
    }
  });

  // DELETE /files/:fileId - Einzelne Datei löschen
  router.delete('/files/:fileId', rbacVerifier, requireAdmin, async (req, res) => {
    try {
      const orgId = req.user.organization_id;
      const fileId = req.params.fileId;

      // Datei-Info holen und Organisation prüfen
      const { rows: [fileRecord] } = await db.query(
        `SELECT mf.id, mf.stored_name, mf.material_id
         FROM material_files mf
         JOIN materials m ON mf.material_id = m.id
         WHERE mf.id = $1 AND m.organization_id = $2`,
        [fileId, orgId]
      );

      if (!fileRecord) {
        return res.status(404).json({ error: 'Datei nicht gefunden' });
      }

      // DB-Eintrag löschen
      await db.query('DELETE FROM material_files WHERE id = $1', [fileId]);

      // Datei vom Dateisystem löschen
      const materialDir = path.join(__dirname, '..', 'uploads', 'material');
      const filePath = path.join(materialDir, fileRecord.stored_name);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (fileErr) {
        console.warn(`Konnte Datei ${fileRecord.stored_name} nicht löschen:`, fileErr.message);
      }

      // updated_at aktualisieren
      await db.query('UPDATE materials SET updated_at = NOW() WHERE id = $1', [fileRecord.material_id]);

      res.json({ message: 'Datei gelöscht' });
    } catch (err) {
      console.error('Fehler beim Löschen der Datei:', err.message);
      res.status(500).json({ error: 'Fehler beim Löschen der Datei' });
    }
  });

  return router;
};
