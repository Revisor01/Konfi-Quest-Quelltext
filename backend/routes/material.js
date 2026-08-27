const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { encryptBuffer, decryptBuffer } = require('../utils/photoCrypto');
const { allIdsBelongToOrg } = require('../utils/orgOwnership');
const liveUpdate = require('../utils/liveUpdate');

module.exports = (db, rbacVerifier, roleHelpers, materialUpload) => {
  const { requireTeamer, requireAdmin } = roleHelpers;

  //   Material MIT Jahrgang  -> nur Teamer:innen dieser Jahrgänge
  //   Material OHNE Jahrgang -> alle Teamer:innen der Gemeinde
  //   Leitung (admin, org_admin) -> immer alles, sonst wäre es nicht verwaltbar
  //
  // Vorher war die Jahrgangs-Bindung reine Suchhilfe: Gelesen wurde nur die
  // Organisation, also sah jede Teamer:in jedes Material. Zum Zeitpunkt der
  // Umstellung gab es in Produktion noch kein einziges Material — es kann
  // also niemandem etwas verschwinden.
  //
  // Die Bindung an einen Termin (material_events) bleibt bewusst reine
  // Suchhilfe und grenzt nichts ab.
  //
  // Gibt eine SQL-Bedingung auf `m` zurück, oder null, wenn nicht
  // eingeschraenkt werden muss.
  const jahrgangsSchranke = (user, platzhalter) => {
    if (user.type !== 'teamer') return null;
    return `(
      NOT EXISTS (SELECT 1 FROM material_jahrgaenge mj WHERE mj.material_id = m.id)
      OR EXISTS (
        SELECT 1 FROM material_jahrgaenge mj
        JOIN user_jahrgang_assignments uja ON uja.jahrgang_id = mj.jahrgang_id
        WHERE mj.material_id = m.id AND uja.user_id = ${platzhalter} AND uja.can_view = true
      )
    )`;
  };

  // Validierungsregeln
  const validateCreateMaterial = [
    body('title').notEmpty().trim().isLength({ min: 1, max: 255 }).withMessage('Titel erforderlich (1-255 Zeichen)'),
    handleValidationErrors
  ];

  const validateUpdateMaterial = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('title').optional().trim().isLength({ min: 1, max: 255 }).withMessage('Titel max. 255 Zeichen'),
    handleValidationErrors
  ];

  // Schema: siehe backend/migrations/064_consolidate_inline_schemas.sql

  // ====================================================================
  // MATERIAL ENDPOINTS
  // ====================================================================

  // GET / - Alle Materialien der Organisation laden
  router.get('/', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const orgId = req.user.organization_id;
      const { search, event_id, jahrgang_id } = req.query;

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

      const schranke = jahrgangsSchranke(req.user, `$${paramIndex}`);
      if (schranke) {
        query += ` AND ${schranke}`;
        params.push(req.user.id);
        paramIndex++;
      }

      query += ' ORDER BY m.created_at DESC';

      const { rows: materials } = await db.query(query, params);

      if (materials.length > 0) {
        const materialIds = materials.map(m => m.id);

        // Tags für alle Materialien laden
        // Events für alle Materialien laden
        const { rows: matEvents } = await db.query(
          `SELECT me.material_id, e.id, e.name
           FROM material_events me
           JOIN events e ON me.event_id = e.id
           WHERE me.material_id = ANY($1)`,
          [materialIds]
        );


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
      const schranke = jahrgangsSchranke(req.user, '$3');

      const { rows: materials } = await db.query(
        `SELECT m.id, m.title, m.description, m.created_at,
                u.display_name as created_by_name,
                (SELECT COUNT(*) FROM material_files mf WHERE mf.material_id = m.id) as file_count
         FROM materials m
         LEFT JOIN users u ON m.created_by = u.id
         WHERE m.organization_id = $1
           AND EXISTS (SELECT 1 FROM material_events me WHERE me.material_id = m.id AND me.event_id = $2)
           ${schranke ? `AND ${schranke}` : ''}
         ORDER BY m.created_at DESC`,
        schranke ? [orgId, eventId, req.user.id] : [orgId, eventId]
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
      const schranke = jahrgangsSchranke(req.user, '$3');

      const { rows: [material] } = await db.query(
        `SELECT m.id, m.title, m.description,
                m.created_at, u.display_name as created_by_name
         FROM materials m
         LEFT JOIN users u ON m.created_by = u.id
         WHERE m.id = $1 AND m.organization_id = $2
           ${schranke ? `AND ${schranke}` : ''}`,
        schranke ? [req.params.id, orgId, req.user.id] : [req.params.id, orgId]
      );

      if (!material) {
        return res.status(404).json({ error: 'Material nicht gefunden' });
      }

      // Tags laden

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

      // Jahrgänge laden (Many-to-Many)
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
      const { title, description, event_ids, jahrgang_ids } = req.body;

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

      // Jahrgänge zuordnen (Many-to-Many)
      const resolvedJahrgangIds = jahrgang_ids || [];
      if (resolvedJahrgangIds.length > 0) {
        const jgValues = resolvedJahrgangIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        const jgParams = [material.id, ...resolvedJahrgangIds];
        await db.query(
          `INSERT INTO material_jahrgaenge (material_id, jahrgang_id) VALUES ${jgValues}`,
          jgParams
        );
      }

      res.status(201).json(material);
      // Material-Listen bei Leitung und Teamer:innen aktuell halten — vorher gab
      // es für Material überhaupt kein Live-Update.
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'materials', 'refresh');
    } catch (err) {
      console.error('Fehler beim Erstellen des Materials:', err.message);
      res.status(500).json({ error: 'Fehler beim Erstellen des Materials' });
    }
  });

  // PUT /:id - Material bearbeiten
  router.put('/:id', rbacVerifier, requireAdmin, validateUpdateMaterial, async (req, res) => {
    try {
      const { title, description, event_ids, jahrgang_ids } = req.body;
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

      // Jahrgänge aktualisieren (DELETE + INSERT)
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

      res.json({ message: 'Material aktualisiert' });
      // Material-Listen bei Leitung und Teamer:innen aktuell halten — vorher gab
      // es für Material überhaupt kein Live-Update.
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'materials', 'refresh');
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

      // Dateien vom Dateisystem holen bevor CASCADE löscht
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
      // Material-Listen bei Leitung und Teamer:innen aktuell halten — vorher gab
      // es für Material überhaupt kein Live-Update.
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'materials', 'refresh');
    } catch (err) {
      console.error('Fehler beim Löschen des Materials:', err.message);
      res.status(500).json({ error: 'Fehler beim Löschen des Materials' });
    }
  });

  // ====================================================================
  // DATEI ENDPOINTS
  // ====================================================================

  // POST /:id/files - Dateien zu Material hochladen (AES-256-GCM verschlüsselt)
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
        // Zufaelliger Hex-Dateiname; verschlüsselt schreiben
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
      // Material-Listen bei Leitung und Teamer:innen aktuell halten — vorher gab
      // es für Material überhaupt kein Live-Update.
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'materials', 'refresh');
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

      // Prüfen ob Datei existiert, zur gleichen Organisation gehört und für
      // diese Teamer:in überhaupt sichtbar ist (Jahrgangs-Schranke).
      const schranke = jahrgangsSchranke(req.user, '$3');
      const { rows: [fileRecord] } = await db.query(
        `SELECT mf.id, mf.original_name, mf.mime_type, mf.file_size
         FROM material_files mf
         JOIN materials m ON mf.material_id = m.id
         WHERE mf.stored_name = $1 AND m.organization_id = $2
           ${schranke ? `AND ${schranke}` : ''}`,
        schranke ? [filename, req.user.organization_id, req.user.id] : [filename, req.user.organization_id]
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

      // Datei lesen und (falls verschlüsselt) entschluesseln, dann senden.
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
      // Material-Listen bei Leitung und Teamer:innen aktuell halten — vorher gab
      // es für Material überhaupt kein Live-Update.
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'materials', 'refresh');
    } catch (err) {
      console.error('Fehler beim Löschen der Datei:', err.message);
      res.status(500).json({ error: 'Fehler beim Löschen der Datei' });
    }
  });

  return router;
};
