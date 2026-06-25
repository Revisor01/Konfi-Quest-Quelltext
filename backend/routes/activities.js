const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors, commonValidations, getPointField } = require('../middleware/validation');
const { checkPointTypeEnabled } = require('../utils/pointTypeGuard');
const PushService = require('../services/pushService');
const liveUpdate = require('../utils/liveUpdate');

// Aktivitäten: Teamer darf ansehen und Punkte vergeben, Admin darf bearbeiten
// Requests: NUR Admin (Datenschutz!)
module.exports = (db, rbacVerifier, { requireAdmin, requireTeamer }, checkAndAwardBadges, io) => {

  // Validierungsregeln
  // Hinweis: type ist bei Teamer-Aktivitaeten bewusst null (kein Punkt-Typ).
  // optional({ values: 'null' }) ueberspringt die Pruefung auch bei explizitem
  // null (nicht nur bei undefined) -> sonst 400 "Validierungsfehler" beim Speichern.
  const validateCreateActivity = [
    commonValidations.name,
    body('points').optional().isInt({ min: 0 }).withMessage('Punkte müssen eine Ganzzahl >= 0 sein'),
    body('type').optional({ values: 'null' }).isIn(['gottesdienst', 'gemeinde']).withMessage('Typ muss "gottesdienst" oder "gemeinde" sein'),
    body('target_role').optional().isIn(['konfi', 'teamer']).withMessage('Zielgruppe muss "konfi" oder "teamer" sein'),
    body('category_ids').optional().isArray().withMessage('Kategorie-IDs müssen ein Array sein'),
    handleValidationErrors
  ];

  const validateUpdateActivity = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    commonValidations.name,
    body('points').optional().isInt({ min: 0 }).withMessage('Punkte müssen eine Ganzzahl >= 0 sein'),
    body('type').optional({ values: 'null' }).isIn(['gottesdienst', 'gemeinde']).withMessage('Typ muss "gottesdienst" oder "gemeinde" sein'),
    body('target_role').optional().isIn(['konfi', 'teamer']).withMessage('Zielgruppe muss "konfi" oder "teamer" sein'),
    handleValidationErrors
  ];

  const validateDeleteActivity = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors
  ];

  const validateAssignActivity = [
    body('konfiId').isInt({ min: 1 }).withMessage('Ungültige Konfi-ID'),
    body('activityId').isInt({ min: 1 }).withMessage('Ungültige Aktivitäts-ID'),
    commonValidations.date,
    handleValidationErrors
  ];

  const validateRequestUpdate = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('status').isIn(['approved', 'rejected']).withMessage('Status muss "approved" oder "rejected" sein'),
    handleValidationErrors
  ];

  // ====================================================================
  // ACTIVITIES MANAGEMENT (Masterliste)
  // ====================================================================

  // GET all activities
  // Pfad: GET /api/activities/
  router.get('/', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const { target_role } = req.query;
      let targetRoleFilter = '';
      const params = [req.user.organization_id];
      if (target_role) {
        params.push(target_role);
        targetRoleFilter = ` AND a.target_role = $${params.length}`;
      }
      const query = `
        SELECT a.*,
               STRING_AGG(c.id || ':' || c.name, ',') as category_data
        FROM activities a
        LEFT JOIN activity_categories ac ON a.id = ac.activity_id
        LEFT JOIN categories c ON ac.category_id = c.id
        WHERE a.organization_id = $1${targetRoleFilter}
        GROUP BY a.id
        ORDER BY a.type, a.name
      `;

      const { rows } = await db.query(query, params);

      // Parse categories from STRING_AGG result
      const activitiesWithCategories = rows.map(row => {
        let categories = [];
        if (row.category_data) {
          categories = row.category_data.split(',').map(catData => {
            const [id, name] = catData.split(':');
            return { id: parseInt(id), name };
          });
        }
        
        return {
          id: row.id,
          name: row.name,
          points: row.points,
          type: row.type,
          // target_role MUSS mit raus: das Frontend faerbt/markiert Teamer-
          // Aktivitaeten darueber (pink, ohne Punkte). Fehlte es, wurden Teamer-
          // Aktivitaeten faelschlich wie Konfi-Aktivitaeten (blau/gruen + Punkte) gezeigt.
          target_role: row.target_role,
          categories: categories,
          created_at: row.created_at
        };
      });
      res.json(activitiesWithCategories);

    } catch (err) {
 console.error('Database error in GET /api/activities/:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // POST a new activity
  // Pfad: POST /api/activities/
  router.post('/', rbacVerifier, requireAdmin, validateCreateActivity, async (req, res) => {
    const { name, points, type, category_ids, target_role } = req.body;
    const activityTargetRole = target_role || 'konfi';

    // Teamer-Aktivitäten: points und type sind optional
    if (activityTargetRole === 'teamer') {
      if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });
    } else {
      if (!name || !points || !type) return res.status(400).json({ error: 'Name, Punkte und Typ sind erforderlich' });
      if (!['gottesdienst', 'gemeinde'].includes(type)) return res.status(400).json({ error: 'Typ muss gottesdienst oder gemeinde sein' });
    }

    try {
      const actPoints = activityTargetRole === 'teamer' ? (points || 0) : points;
      const actType = activityTargetRole === 'teamer' ? (type || null) : type;
      const insertActivityQuery = "INSERT INTO activities (name, points, type, organization_id, target_role) VALUES ($1, $2, $3, $4, $5) RETURNING id";
      const { rows: [newActivity] } = await db.query(insertActivityQuery, [name, actPoints, actType, req.user.organization_id, activityTargetRole]);
      const activityId = newActivity.id;

      if (category_ids && Array.isArray(category_ids) && category_ids.length > 0) {
        const insertCategoryQuery = "INSERT INTO activity_categories (activity_id, category_id) VALUES ($1, $2)";
        for (const catId of category_ids) {
          await db.query(insertCategoryQuery, [activityId, catId]);
        }
      }

      res.status(201).json({ id: activityId, message: 'Aktivität erfolgreich erstellt' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'activities', 'create');

    } catch (err) {
 console.error('Database error in POST /api/activities/:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // PUT (update) an activity
  // Pfad: PUT /api/activities/:id
  router.put('/:id', rbacVerifier, requireAdmin, validateUpdateActivity, async (req, res) => {
    const activityId = req.params.id;
    const { name, points, type, category_ids, target_role } = req.body;
    const activityTargetRole = target_role || 'konfi';

    // Teamer-Aktivitäten: points und type sind optional
    if (activityTargetRole === 'teamer') {
      if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });
    } else {
      if (!name || !points || !type) return res.status(400).json({ error: 'Name, Punkte und Typ sind erforderlich' });
    }

    try {
      const actPoints = activityTargetRole === 'teamer' ? (points || 0) : points;
      const actType = activityTargetRole === 'teamer' ? (type || null) : type;
      const updateQuery = "UPDATE activities SET name = $1, points = $2, type = $3, target_role = $4 WHERE id = $5 AND organization_id = $6";
      const { rowCount } = await db.query(updateQuery, [name, actPoints, actType, activityTargetRole, activityId, req.user.organization_id]);
      
      if (rowCount === 0) {
        return res.status(404).json({ error: 'Aktivität nicht gefunden oder keine Berechtigung' });
      }

      // Update categories: delete all existing and then add the new ones
      await db.query("DELETE FROM activity_categories WHERE activity_id = $1", [activityId]);

      if (category_ids && Array.isArray(category_ids) && category_ids.length > 0) {
        const insertCategoryQuery = "INSERT INTO activity_categories (activity_id, category_id) VALUES ($1, $2)";
        for (const catId of category_ids) {
          await db.query(insertCategoryQuery, [activityId, catId]);
        }
      }

      res.json({ message: 'Aktivität erfolgreich aktualisiert' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'activities', 'update');

    } catch (err) {
 console.error(`Database error in PUT /api/activities/${activityId}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // DELETE an activity
  // Pfad: DELETE /api/activities/:id
  router.delete('/:id', rbacVerifier, requireAdmin, validateDeleteActivity, async (req, res) => {
    const activityId = req.params.id;
    try {
      const checkUsageQuery = `SELECT COUNT(*) as count FROM user_activities ua JOIN activities a ON ua.activity_id = a.id WHERE ua.activity_id = $1 AND a.organization_id = $2`;
      const { rows: [usage] } = await db.query(checkUsageQuery, [activityId, req.user.organization_id]);

      if (usage.count > 0) {
        return res.status(409).json({ error: `Aktivität kann nicht gelöscht werden: ${usage.count} Zuordnung(en) zu Konfis vorhanden.` });
      }

      // Pending Anträge prüfen
      const { rows: [pendingCheck] } = await db.query(
        `SELECT COUNT(*)::int as count FROM activity_requests ar
         WHERE ar.activity_id = $1 AND ar.status = 'pending' AND ar.organization_id = $2`,
        [activityId, req.user.organization_id]
      );
      if (pendingCheck.count > 0) {
        return res.status(409).json({
          error: `Aktivität kann nicht gelöscht werden: ${pendingCheck.count} offene Anträge vorhanden.`
        });
      }

      const deleteQuery = "DELETE FROM activities WHERE id = $1 AND organization_id = $2";
      const { rowCount } = await db.query(deleteQuery, [activityId, req.user.organization_id]);

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Aktivität nicht gefunden' });
      }

      res.json({ message: 'Aktivität erfolgreich gelöscht' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'activities', 'delete');

    } catch (err) {
 console.error(`Database error in DELETE /api/activities/${activityId}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ====================================================================
  // ACTIVITY REQUESTS MANAGEMENT
  // ====================================================================

  // GET all activity requests for an organization
  // Pfad: GET /api/activities/requests
  router.get('/requests', rbacVerifier, requireAdmin, async (req, res) => {
    try {
      const query = `
        SELECT ar.*, u_konfi.display_name as konfi_name, a.name as activity_name, a.points as activity_points, a.type as activity_type,
               a.target_role as activity_target_role,
               u_approved.display_name as approved_by_name
        FROM activity_requests ar
        JOIN users u_konfi ON ar.user_id = u_konfi.id
        JOIN activities a ON ar.activity_id = a.id
        LEFT JOIN users u_approved ON ar.approved_by = u_approved.id
        WHERE a.organization_id = $1
        ORDER BY ar.created_at DESC
      `;

      const { rows: requests } = await db.query(query, [req.user.organization_id]);
      res.json(requests);

    } catch (err) {
 console.error('Database error in GET /api/activities/requests:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // PUT (update) an activity request status - zurück zu pending
  // Pfad: PUT /api/activities/requests/:id/reset
  router.put('/requests/:id/reset', rbacVerifier, requireAdmin, [param('id').isInt({ min: 1 }).withMessage('Ungültige ID'), handleValidationErrors], async (req, res) => {
    const requestId = req.params.id;

    try {
      const getRequestQuery = `
        SELECT ar.*, a.points, a.type, a.target_role, a.name as activity_name, u.display_name as konfi_name
        FROM activity_requests ar
        JOIN activities a ON ar.activity_id = a.id
        JOIN users u ON ar.user_id = u.id
        WHERE ar.id = $1 AND a.organization_id = $2
      `;
      const { rows: [request] } = await db.query(getRequestQuery, [requestId, req.user.organization_id]);
      if (!request) return res.status(404).json({ error: 'Antrag nicht gefunden' });

      const oldStatus = request.status;
      if (oldStatus === 'pending') return res.status(400).json({ error: 'Antrag ist bereits ausstehend' });

      const isTeamerActivity = request.target_role === 'teamer';

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        // SCHRITT 1: Alte Entscheidung rückgängig machen
        if (oldStatus === 'approved') {

          // Punkte abziehen nur fuer Konfi-Activities (Teamer haben keine bekommen)
          if (!isTeamerActivity) {
            const pointField = getPointField(request.type);
            await client.query(`UPDATE konfi_profiles SET ${pointField} = GREATEST(0, ${pointField} - $1) WHERE user_id = $2`, [request.points, request.user_id]);
          }

          // konfi_activity Eintrag löschen
          await client.query(
            `DELETE FROM user_activities
             WHERE id = (
               SELECT id FROM user_activities
               WHERE user_id = $1 AND activity_id = $2
               ORDER BY completed_date DESC, id DESC
               LIMIT 1
             )`,
            [request.user_id, request.activity_id]
          );

        }

        // SCHRITT 2: Status auf pending setzen, Kommentar löschen
        await client.query(
          "UPDATE activity_requests SET status = 'pending', admin_comment = NULL, approved_by = NULL, updated_at = NOW() WHERE id = $1",
          [requestId]
        );

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      res.json({ message: 'Antrag auf ausstehend zurückgesetzt', oldStatus });

    } catch (err) {
 console.error(`Database error in PUT /api/activities/requests/${requestId}/reset:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // PUT (update) an activity request status
  // Pfad: PUT /api/activities/requests/:id
  router.put('/requests/:id', rbacVerifier, requireAdmin, validateRequestUpdate, async (req, res) => {
    const requestId = req.params.id;
    const { status, admin_comment } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });

    try {
      const getRequestQuery = `
        SELECT ar.*, a.points, a.type, a.target_role, a.name as activity_name, u.display_name as konfi_name
        FROM activity_requests ar
        JOIN activities a ON ar.activity_id = a.id
        JOIN users u ON ar.user_id = u.id
        WHERE ar.id = $1 AND a.organization_id = $2
      `;
      const { rows: [request] } = await db.query(getRequestQuery, [requestId, req.user.organization_id]);
      if (!request) return res.status(404).json({ error: 'Antrag nicht gefunden' });

      // Nur pending Anträge können bearbeitet werden
      if (request.status !== 'pending') {
        return res.status(400).json({ error: 'Nur ausstehende Anträge können genehmigt oder abgelehnt werden' });
      }

      const isTeamerActivity = request.target_role === 'teamer';

      // Guard: Bei Genehmigung prüfen ob Punkte-Typ aktiviert ist (nur fuer Konfi-Activities)
      if (status === 'approved' && !isTeamerActivity) {
        const { enabled, error } = await checkPointTypeEnabled(db, request.user_id, request.type);
        if (!enabled) return res.status(400).json({ error });
      }

      const client = await db.getClient();
      let newBadges = 0;
      try {
        await client.query('BEGIN');

        // Status ändern
        const updateRequestQuery = "UPDATE activity_requests SET status = $1, admin_comment = $2, approved_by = $3, updated_at = NOW() WHERE id = $4";
        await client.query(updateRequestQuery, [status, admin_comment, req.user.id, requestId]);

        if (status === 'approved') {
          await client.query("INSERT INTO user_activities (user_id, activity_id, admin_id, completed_date, organization_id) VALUES ($1, $2, $3, $4, $5)", [request.user_id, request.activity_id, req.user.id, request.requested_date, req.user.organization_id]);

          // Punkte nur fuer Konfi-Activities (Teamer-Activities sind nur Nachweis)
          if (!isTeamerActivity) {
            const pointField = getPointField(request.type);
            await client.query(
              `INSERT INTO konfi_profiles (user_id, organization_id, ${pointField})
               VALUES ($2, $3, $1)
               ON CONFLICT (user_id) DO UPDATE SET ${pointField} = konfi_profiles.${pointField} + $1`,
              [request.points, request.user_id, req.user.organization_id]
            );
          }

          // Foto-Referenz in DB entfernen (innerhalb Transaktion)
          if (request.photo_filename) {
            await client.query("UPDATE activity_requests SET photo_filename = NULL WHERE id = $1", [requestId]);
          }
        }

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      // Badge-Check NACH COMMIT (verwendet db Pool)
      if (status === 'approved') {
        newBadges = await checkAndAwardBadges(db, request.user_id);

        // Level-Check NACH Badge-Check
        try {
          await PushService.checkAndSendLevelUp(db, request.user_id, req.user.organization_id);
        } catch (levelErr) {
          console.error('Level-up check failed:', levelErr);
        }

        // Datenschutz: Foto-Datei löschen nach Genehmigung (nicht-kritisch, nach COMMIT)
        if (request.photo_filename) {
          const fs = require('fs');
          const path = require('path');
          const photoPath = path.join(__dirname, '../uploads/requests', request.photo_filename);

          fs.unlink(photoPath, (err) => {
            if (err) {
 console.error('Error deleting photo:', err);
            }
          });
        }
      }

      // Send push notification to konfi
      try {
        const notificationTitle = status === 'approved' 
          ? `Antrag genehmigt!`
          : `Antrag abgelehnt`;
        
        const notificationBody = status === 'approved'
          ? `Dein Antrag für "${request.activity_name}" wurde genehmigt. Du erhältst ${request.points} ${request.points === 1 ? 'Punkt' : 'Punkte'}!`
          : `Dein Antrag für "${request.activity_name}" wurde leider abgelehnt.${admin_comment ? ` Grund: ${admin_comment}` : ''}`;

        // Create notification entry
        await db.query(
          "INSERT INTO notifications (user_id, title, message, type, data, organization_id) VALUES ($1, $2, $3, $4, $5, $6)",
          [
            request.user_id,
            notificationTitle,
            notificationBody,
            'activity_request_decision',
            JSON.stringify({ 
              request_id: requestId, 
              activity_name: request.activity_name,
              status: status,
              points: request.points
            }),
            req.user.organization_id
          ]
        );


        // Send push notification to konfi (mit Request ID für Navigation)
        await PushService.sendActivityRequestStatusToKonfi(
          db,
          request.user_id,
          request.activity_name,
          request.points,
          status,
          admin_comment,
          requestId
        );
      } catch (notifErr) {
 console.error('Error sending notification:', notifErr);
        // Don't fail the request if notification fails
      }

      // Live-Update an ALLE Admins broadcasten: Konfi-Punkte + Antragsliste
      // aendern sich -> jeder sieht es sofort, ohne manuelles Refresh, und es
      // verhindert Doppel-Genehmigungen durch parallele Admins.
      try {
        io.emit('konfisUpdate', { organization_id: req.user.organization_id });
        io.emit('requestsUpdate', { organization_id: req.user.organization_id });
      } catch (emitErr) {
        console.error('Socket-Emit nach Genehmigung fehlgeschlagen:', emitErr.message);
      }

      res.json({ message: 'Antragsstatus aktualisiert', newBadges });

      // Live-Update für Anträge und Konfi-Punkte senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'requests', 'update');
      liveUpdate.sendToKonfi(request.user_id, 'points', 'update');
      liveUpdate.sendToKonfi(request.user_id, 'requests', 'update');
    } catch (err) {
 console.error(`Database error in PUT /api/activities/requests/${requestId}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ====================================================================
  // DIRECT POINT ASSIGNMENT
  // ====================================================================
  
  // Assign activity to a konfi
  // Pfad: POST /api/activities/assign-activity
  router.post('/assign-activity', rbacVerifier, requireTeamer, validateAssignActivity, async (req, res) => {
    const { konfiId, activityId, completed_date } = req.body;
    if (!konfiId || !activityId) return res.status(400).json({ error: 'Konfi-ID und Aktivitäts-ID sind erforderlich' });
    const date = completed_date || new Date().toISOString().split('T')[0];

    try {
      const { rows: [activity] } = await db.query("SELECT * FROM activities WHERE id = $1 AND organization_id = $2", [activityId, req.user.organization_id]);
      if (!activity) return res.status(404).json({ error: 'Aktivität nicht gefunden' });

      // Jahrgang-Zugriff prüfen für Teamer
      if (req.user.role_name === 'teamer') {
        const { rows: [konfiProfile] } = await db.query(
          'SELECT jahrgang_id FROM konfi_profiles WHERE user_id = $1', [konfiId]
        );
        if (!konfiProfile) {
          return res.status(404).json({ error: 'Konfi nicht gefunden' });
        }
        const hasAccess = req.user.assigned_jahrgaenge.some(
          j => j.id === konfiProfile.jahrgang_id && j.can_view
        );
        if (!hasAccess) {
          return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
        }
      }

      // Teamer-Aktivitäten: Keine Punkte-Vergabe und keinen pointTypeGuard-Check
      const isTeamerActivity = activity.target_role === 'teamer';

      if (!isTeamerActivity) {
        // Guard: Punkte-Typ muss für den Jahrgang aktiviert sein
        const { enabled, error } = await checkPointTypeEnabled(db, konfiId, activity.type);
        if (!enabled) return res.status(400).json({ error });
      }

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        await client.query("INSERT INTO user_activities (user_id, activity_id, admin_id, completed_date, organization_id) VALUES ($1, $2, $3, $4, $5)", [konfiId, activityId, req.user.id, date, req.user.organization_id]);

        if (!isTeamerActivity && activity.points && activity.type) {
          const pointField = getPointField(activity.type);
          await client.query(`UPDATE konfi_profiles SET ${pointField} = ${pointField} + $1 WHERE user_id = $2`, [activity.points, konfiId]);
        }

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      // Badge-Check NACH COMMIT (verwendet db Pool) - für Konfis UND Teamer
      const badgeResult = await checkAndAwardBadges(db, konfiId);

      // Level-Check NACH Badge-Check
      try {
        await PushService.checkAndSendLevelUp(db, konfiId, req.user.organization_id);
      } catch (levelErr) {
        console.error('Level-up check failed:', levelErr);
      }

      res.json({ message: 'Aktivität erfolgreich zugewiesen', newBadges: badgeResult.count, badgeDetails: badgeResult.badges });

      // Push-Notification an Konfi senden
      try {
        await PushService.sendActivityAssignedToKonfi(db, konfiId, activity.name, activity.points, activity.type);
      } catch (pushErr) {
 console.error('Error sending activity assigned push:', pushErr);
      }

      // Live-Update an Konfi senden
      liveUpdate.sendToKonfi(konfiId, 'points', 'update');
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'konfis', 'update');
    } catch (err) {
 console.error('Database error in POST /api/activities/assign-activity:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Serve activity request photos (protected admin route)
  router.get('/requests/:id/photo', rbacVerifier, async (req, res) => {
    try {
      const requestId = parseInt(req.params.id);

      // Nur admin und org_admin dürfen Fotos sehen
      if (!['admin', 'org_admin'].includes(req.user.role_name)) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }

      // Get request with photo filename and check organization
      const { rows: [request] } = await db.query(
        `SELECT ar.photo_filename, ar.user_id, u.organization_id
         FROM activity_requests ar
         JOIN users u ON ar.user_id = u.id
         WHERE ar.id = $1`,
        [requestId]
      );

      if (!request) {
        return res.status(404).json({ error: 'Antrag nicht gefunden' });
      }

      // Organization check
      if (request.organization_id !== req.user.organization_id) {
        return res.status(403).json({ error: 'Keine Berechtigung für diese Organisation' });
      }

      if (!request.photo_filename) {
        return res.status(404).json({ error: 'Kein Foto gefunden' });
      }

      const fs = require('fs');
      const path = require('path');
      const photoPath = path.join(__dirname, '../uploads/requests', request.photo_filename);

      if (!fs.existsSync(photoPath)) {
        return res.status(404).json({ error: 'Foto-Datei nicht gefunden' });
      }

      // Set correct content type for images
      res.setHeader('Content-Type', 'image/jpeg');
      res.sendFile(photoPath);
    } catch (err) {
 console.error('Error serving activity request photo:', err);
      res.status(500).json({ error: 'Fehler beim Laden des Fotos' });
    }
  });

  return router;
};