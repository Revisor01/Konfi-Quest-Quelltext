const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors, commonValidations, getPointField } = require('../middleware/validation');
const { checkPointTypeEnabled } = require('../utils/pointTypeGuard');
const PushService = require('../services/pushService');
const liveUpdate = require('../utils/liveUpdate');
const { heuteBerlin } = require('../utils/zeitformat');
const { decryptFileToStream } = require('../utils/photoCrypto');
const { deletePhotoFile } = require('../utils/photoStorage');
const { allIdsBelongToOrg } = require('../utils/orgOwnership');
const { darfKonfi } = require('../utils/jahrgangsZugriff');
const { loescheMitteilungenZuAntraegen } = require('../utils/postfachAufraeumen');
// Wer welchen Antrag sieht: EINE Regel fuer Liste, Zaehler und die Empfaenger
// von "Neuer Antrag eingegangen".
const { leitungSiehtAlleAntraege, gebundeneLeitungSiehtAntragSql } = require('../utils/antragLeitungSicht');

// Aktivitäten: Teamer darf ansehen und Punkte vergeben, Admin darf bearbeiten
// Requests: NUR Admin (Datenschutz!)
module.exports = (db, rbacVerifier, { requireAdmin, requireTeamer }, checkAndAwardBadges, io) => {

  // Validierungsregeln
  // Hinweis: type ist bei Teamer-Aktivitäten bewusst null (kein Punkt-Typ).
  // optional({ values: 'null' }) ueberspringt die Prüfung auch bei explizitem
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
    // Beim Ablehnen ist eine Begruendung Pflicht. Die Oberflaeche verlangt sie
    // laengst (ActivityRequestModal.tsx:148), der Server bisher nicht — über
    // die API liess sich kommentarlos ablehnen, und der Konfi las dann nur
    // "wurde leider abgelehnt" ohne zu erfahren warum.
    body('admin_comment')
      .if(body('status').equals('rejected'))
      .trim()
      .isLength({ min: 3 })
      .withMessage('Beim Ablehnen ist eine Begründung erforderlich'),
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
          // Aktivitäten darueber (pink, ohne Punkte). Fehlte es, wurden Teamer-
          // Aktivitäten faelschlich wie Konfi-Aktivitäten (blau/gruen + Punkte) gezeigt.
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
      // Org-Isolation: fremde category_ids abweisen (Cross-Org-Referenzen)
      if (!(await allIdsBelongToOrg(db, 'categories', category_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens eine Kategorie gehört nicht zu deiner Gemeinde' });
      }

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
      // Org-Isolation: fremde category_ids abweisen (Cross-Org-Referenzen)
      if (!(await allIdsBelongToOrg(db, 'categories', category_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens eine Kategorie gehört nicht zu deiner Gemeinde' });
      }

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
 console.error('Database error in PUT /api/activities/%s:', activityId, err);
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

      // Anträge prüfen. Der Fremdschlüssel activity_requests.activity_id hat
      // kein ON DELETE, deshalb muss vorher aufgeraeumt werden — sonst gaebe es
      // statt einer verstaendlichen Meldung einen 500er.
      const { rows: [requestCheck] } = await db.query(
        `SELECT COUNT(*) FILTER (WHERE ar.status = 'pending')::int as pending,
                COUNT(*) FILTER (WHERE ar.status = 'approved')::int as approved,
                COUNT(*) FILTER (WHERE ar.status = 'rejected')::int as rejected
         FROM activity_requests ar
         WHERE ar.activity_id = $1 AND ar.organization_id = $2`,
        [activityId, req.user.organization_id]
      );
      if (requestCheck.pending > 0 || requestCheck.approved > 0) {
        const teile = [];
        if (requestCheck.pending > 0) teile.push(`${requestCheck.pending} offene(r) Antrag/Anträge`);
        if (requestCheck.approved > 0) teile.push(`${requestCheck.approved} genehmigte(r) Antrag/Anträge`);
        return res.status(409).json({
          error: `Aktivität kann nicht gelöscht werden: ${teile.join(' und ')} vorhanden.`
        });
      }

      // Abgelehnte Anträge samt ihrer Nachweisfotos entfernen, dann die
      // Aktivität. In einer Transaktion, damit bei einem Fehler nichts
      // halb Geloeschtes zurueckbleibt.
      const client = await db.getClient();
      let rowCount = 0;
      let fotosZumLoeschen = [];
      try {
        await client.query('BEGIN');
        if (requestCheck.rejected > 0) {
          const { rows: abgelehnte } = await client.query(
            `SELECT id, photo_filename FROM activity_requests
              WHERE activity_id = $1 AND organization_id = $2
                AND status = 'rejected'`,
            [activityId, req.user.organization_id]
          );
          fotosZumLoeschen = abgelehnte.map(f => f.photo_filename).filter(Boolean);
          await client.query(
            "DELETE FROM activity_requests WHERE activity_id = $1 AND organization_id = $2 AND status = 'rejected'",
            [activityId, req.user.organization_id]
          );
          // Postfach: "Neuer Antrag" und "Antrag eingereicht"
          // zu diesen Antraegen gehen mit; die Ablehnung selbst bleibt als
          // Verlauf stehen (utils/postfachAufraeumen.js).
          await loescheMitteilungenZuAntraegen(client, abgelehnte.map(a => a.id));
        }
        const res2 = await client.query(
          "DELETE FROM activities WHERE id = $1 AND organization_id = $2",
          [activityId, req.user.organization_id]
        );
        rowCount = res2.rowCount;
        await client.query('COMMIT');
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
        throw err;
      } finally {
        client.release();
      }

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Aktivität nicht gefunden' });
      }

      // Nachweisfotos erst NACH dem Commit vom Datentraeger nehmen: Schlaegt das
      // fehl, bleibt höchstens eine verwaiste Datei zurück — kein halb
      // geloeschter Datenbestand.
      for (const datei of fotosZumLoeschen) {
        await deletePhotoFile(datei).catch(err =>
          console.error('Foto eines abgelehnten Antrags nicht geloescht:', datei, err.message));
      }

      res.json({ message: 'Aktivität erfolgreich gelöscht' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'activities', 'delete');

    } catch (err) {
 console.error('Database error in DELETE /api/activities/%s:', activityId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ====================================================================
  // ACTIVITY REQUESTS MANAGEMENT
  // ====================================================================

  // Die Felder EINES Antrags, wie Liste und Einzelabruf sie liefern -- ein
  // Ort, damit GET /requests/:id genau die Form eines Listeneintrags hat
  // An der Liste ist die Form ein Vertrag: Store-Apps 2.2.x und
  // 2.3.0 oeffnen einen Antrag, indem sie ihn per .find() aus ihr heraussuchen.
  const ANTRAG_AUSWAHL = `
        SELECT ar.*, u_konfi.display_name as konfi_name, a.name as activity_name, a.points as activity_points, a.type as activity_type,
               a.target_role as activity_target_role,
               u_approved.display_name as approved_by_name
        FROM activity_requests ar
        JOIN users u_konfi ON ar.user_id = u_konfi.id
        JOIN activities a ON ar.activity_id = a.id
        LEFT JOIN users u_approved ON ar.approved_by = u_approved.id`;

  // Die can_view-Jahrgaenge eines jahrgangsgebundenen Admins -- Eingabe fuer
  // gebundeneLeitungSiehtAntragSql (utils/antragLeitungSicht.js).
  const sichtbareJahrgaenge = (user) => (user.assigned_jahrgaenge || [])
    .filter(j => j.can_view)
    .map(j => j.id);

  // GET all activity requests for an organization
  // Pfad: GET /api/admin/activities/requests
  //
  // Optionaler Filter ?user_id=<id>: nur die
  // Antraege dieser Person. Die Detailansicht einer Konfi lud vorher die
  // ganze Antragsgeschichte der Gemeinde, um die Antraege EINER Person zu
  // finden. Die Sichtregel gilt unveraendert daneben -- wer die Person nicht
  // sieht, bekommt ein leeres Array. Ohne Parameter bleibt die Liste exakt,
  // wie sie war (Vertrag mit den Store-Apps).
  router.get('/requests', rbacVerifier, requireAdmin, async (req, res) => {
    try {
      const { status, user_id: userIdRoh } = req.query;
      const erlaubteStatus = ['pending', 'approved', 'rejected'];
      if (status !== undefined && !erlaubteStatus.includes(status)) {
        return res.status(400).json({
          error: `Unbekannter Status. Erlaubt: ${erlaubteStatus.join(', ')}`
        });
      }
      // Wie bei ?status=: ein unbrauchbarer Wert ist ein Fehler, keine
      // stille Vollausgabe.
      if (userIdRoh !== undefined && !(typeof userIdRoh === 'string' && /^[1-9]\d*$/.test(userIdRoh))) {
        return res.status(400).json({ error: 'Ungültige user_id' });
      }

      const params = [req.user.organization_id];
      let statusFilter = '';
      if (status) {
        params.push(status);
        statusFilter = ` AND ar.status = $${params.length}`;
      }
      let personFilter = '';
      if (userIdRoh !== undefined) {
        params.push(userIdRoh);
        personFilter = ` AND ar.user_id = $${params.length}`;
      }

      // Jahrgangs-Bindung als FILTER, nicht als 403: Die Liste
      // ist org-weit und mischt viele Konfis: Ein Admin soll die Anträge aus
      // seinen Jahrgängen sehen, statt die ganze Seite verweigert zu bekommen.
      // Ein Admin ohne Zuweisung sieht entsprechend keine Konfi-Anträge.
      //
      // Antwortform bleibt ein Array (auch leer) — die Store-Apps rufen
      // .filter() darauf.
      //
      // Teamer-Anträge (a.target_role = 'teamer') bleiben immer sichtbar:
      // Teamer:innen sieht ein Admin laut Regel alle, und sie haben keinen
      // Jahrgang, über den gefiltert werden könnte.
      let jahrgangFilter = '';
      if (!leitungSiehtAlleAntraege(req.user)) {
        const sichtbare = sichtbareJahrgaenge(req.user);
        if (sichtbare.length === 0) {
          res.set('X-Kein-Jahrgang-Zugewiesen', 'true');
        }
        // Leeres Array trifft keinen Konfi-Jahrgang: ohne Zuweisung bleiben
        // nur die Teamer-Antraege.
        params.push(sichtbare);
        jahrgangFilter = ` AND ${gebundeneLeitungSiehtAntragSql({ jahrgaenge: `$${params.length}::int[]` })}`;
      }

      const query = `${ANTRAG_AUSWAHL}
        WHERE a.organization_id = $1${statusFilter}${personFilter}${jahrgangFilter}
        ORDER BY ar.created_at DESC
      `;

      const { rows: requests } = await db.query(query, params);
      res.json(requests);

    } catch (err) {
 console.error('Database error in GET /api/activities/requests:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // EIN Antrag.
  // Pfad: GET /api/admin/activities/requests/:id
  //
  // Additiv: Der Antragsdialog der Leitung lud vorher die ganze Liste (ohne
  // LIMIT, genehmigte Antraege werden nie geloescht) und suchte den einen
  // Antrag per .find() heraus. Die Antwort ist genau ein Listeneintrag
  // (ANTRAG_AUSWAHL), die Sichtregel dieselbe wie in der Liste
  // (utils/antragLeitungSicht.js):
  //   - fremde Gemeinde oder unbekannte Id: 404 -- ob es den Antrag
  //     anderswo gibt, verraet die Route nicht;
  //   - Antrag der eigenen Gemeinde, den die Liste diesem Admin nicht zeigt
  //     (Konfi ausserhalb seiner can_view-Jahrgaenge): 403 "Kein Zugriff auf
  //     diesen Konfi", wie PUT/DELETE/Foto an demselben Antrag.
  router.get('/requests/:id', rbacVerifier, requireAdmin,
    [param('id').isInt({ min: 1 }).withMessage('Ungültige ID'), handleValidationErrors],
    async (req, res) => {
      const requestId = req.params.id;
      try {
        const { rows: [antrag] } = await db.query(
          `${ANTRAG_AUSWAHL}
          WHERE a.organization_id = $1 AND ar.id = $2`,
          [req.user.organization_id, requestId]
        );
        if (!antrag) return res.status(404).json({ error: 'Antrag nicht gefunden' });

        if (!leitungSiehtAlleAntraege(req.user)) {
          const { rows: [sichtbar] } = await db.query(
            `SELECT 1
               FROM activity_requests ar
               JOIN activities a ON a.id = ar.activity_id
              WHERE ar.id = $1
                AND ${gebundeneLeitungSiehtAntragSql({ jahrgaenge: '$2::int[]' })}`,
            [requestId, sichtbareJahrgaenge(req.user)]
          );
          if (!sichtbar) {
            return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
          }
        }

        res.json(antrag);
      } catch (err) {
        console.error('Database error in GET /api/admin/activities/requests/%s:', requestId, err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    });

  // PUT (update) an activity request status - zurück zu pending
  // Pfad: PUT /api/activities/requests/:id/reset
  // Einen abgelehnten Antrag endgueltig entfernen.
  //
  // Bewusst NUR abgelehnte: Ein offener Antrag wartet auf eine Entscheidung
  // (dafuer gibt es Genehmigen/Ablehnen), ein genehmigter ist Teil der
  // Punktegeschichte (dafuer gibt es Zuruecksetzen).
  router.delete('/requests/:id', rbacVerifier, requireAdmin,
    [param('id').isInt({ min: 1 }).withMessage('Ungültige ID'), handleValidationErrors],
    async (req, res) => {
      const requestId = req.params.id;
      try {
        const { rows: [antrag] } = await db.query(
          `SELECT ar.id, ar.status, ar.photo_filename, ar.user_id, a.target_role
             FROM activity_requests ar
             JOIN activities a ON ar.activity_id = a.id
            WHERE ar.id = $1 AND a.organization_id = $2`,
          [requestId, req.user.organization_id]
        );
        if (!antrag) return res.status(404).json({ error: 'Antrag nicht gefunden' });

        // Jahrgangs-Bindung: Löschen entfernt den Antrag samt
        // Nachweisfoto einer Konfi endgültig. Wer die Konfi nicht sehen darf,
        // darf auch ihre Anträge nicht wegräumen.
        if (antrag.target_role !== 'teamer') {
          const zugriff = await darfKonfi(db, req, antrag.user_id);
          if (!zugriff.erlaubt) {
            return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
          }
        }

        if (antrag.status !== 'rejected') {
          const grund = antrag.status === 'pending'
            ? 'Offene Anträge werden genehmigt oder abgelehnt, nicht gelöscht.'
            : 'Genehmigte Anträge gehören zur Punktegeschichte. Setze den Antrag zuerst zurück.';
          return res.status(409).json({ error: grund });
        }

        await db.query('DELETE FROM activity_requests WHERE id = $1', [requestId]);
        // Postfach: Die Zustands-Mitteilungen zum Antrag gehen
        // mit ("Neuer Antrag eingegangen" bei der Leitung, "Antrag
        // eingereicht" bei der antragstellenden Person). Die Entscheidung
        // "Antrag abgelehnt" BLEIBT -- sie ist Verlauf, und ihr Ziel, die
        // Antragsliste, gibt es weiter (utils/postfachAufraeumen.js).
        await loescheMitteilungenZuAntraegen(db, [requestId]);

        if (antrag.photo_filename) {
          await deletePhotoFile(antrag.photo_filename).catch(err =>
            console.error('Foto des geloeschten Antrags nicht entfernt:', err.message));
        }

        res.json({ message: 'Antrag gelöscht' });
      } catch (err) {
        console.error('Database error in DELETE /requests/:id:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    });

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

      // Jahrgangs-Bindung: Zurücksetzen ENTZIEHT Punkte und
      // löscht den Aktivitäts-Eintrag — ein Eingriff in die Punktegeschichte
      // einer Konfi, also dieselbe Grenze wie beim Genehmigen.
      if (!isTeamerActivity) {
        const zugriff = await darfKonfi(db, req, request.user_id);
        if (!zugriff.erlaubt) {
          return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
        }
      }

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        // SCHRITT 1: Alte Entscheidung rückgängig machen
        if (oldStatus === 'approved') {
          const { rows: [zuordnung] } = await client.query(
            `SELECT ua.id, COALESCE(ua.points, a.points) AS points
               FROM user_activities ua
               JOIN activities a ON a.id = ua.activity_id
              WHERE ua.user_id = $1 AND ua.activity_id = $2
              ORDER BY ua.completed_date DESC, ua.id DESC
              LIMIT 1`,
            [request.user_id, request.activity_id]
          );

          if (zuordnung) {
            // Punkte abziehen nur für Konfi-Activities (Teamer haben keine bekommen)
            if (!isTeamerActivity && zuordnung.points) {
              const pointField = getPointField(request.type);
              await client.query(`UPDATE konfi_profiles SET ${pointField} = GREATEST(0, ${pointField} - $1) WHERE user_id = $2`, [zuordnung.points, request.user_id]);
            }

            await client.query('DELETE FROM user_activities WHERE id = $1', [zuordnung.id]);
          }
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

      // Live-Updates analog zum Genehmigungs-Handler (Z.492ff). Antragsliste an
      // Admins/Org-Admins/Teamer:innen der Org; Antragsteller:in (Konfi ODER
      // Teamer:in) über den korrekten Socket-Raum per Rolle.
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'requests', 'update');
      liveUpdate.sendToUserByRole(request.user_id, 'requests', 'update');
      // Wurde ein genehmigter Antrag zurückgesetzt, wurden Punkte entzogen
      // (nur bei Konfi-Activities) -> Punkte-/Dashboard-Ansicht aktualisieren.
      if (oldStatus === 'approved' && !isTeamerActivity) {
        liveUpdate.sendToUserByRole(request.user_id, 'points', 'update');
      }

    } catch (err) {
 console.error('Database error in PUT /api/activities/requests/%s/reset:', requestId, err);
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

      // Jahrgangs-Bindung: Genehmigen/Ablehnen vergibt bzw.
      // verweigert Punkte — dieselbe Wirkung wie assign-activity, also
      // dieselbe Grenze. Ein Admin entscheidet nur über Anträge von Konfis
      // aus seinen Jahrgängen; org_admin/super_admin über alle.
      // Teamer-Anträge bleiben ausgenommen (keine konfi_profiles, und
      // Teamer:innen sieht ein Admin laut Regel ohnehin alle).
      if (!isTeamerActivity) {
        const zugriff = await darfKonfi(db, req, request.user_id);
        if (!zugriff.erlaubt) {
          return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
        }
      }

      // Guard: Bei Genehmigung prüfen ob Punkte-Typ aktiviert ist (nur für Konfi-Activities)
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
          // points: der Wert der Aktivität JETZT, am Beleg festgehalten
          // (Migration 163). Ändert die Leitung die Aktivität später, bleibt
          // dieser Wert — Historie und Rücknahme lesen ihn.
          await client.query(
            "INSERT INTO user_activities (user_id, activity_id, admin_id, completed_date, organization_id, points) VALUES ($1, $2, $3, $4, $5, $6)",
            [request.user_id, request.activity_id, req.user.id, request.requested_date, req.user.organization_id, request.points]
          );

          // Punkte nur für Konfi-Activities (Teamer-Activities sind nur Nachweis)
          if (!isTeamerActivity) {
            const pointField = getPointField(request.type);
            await client.query(
              `INSERT INTO konfi_profiles (user_id, organization_id, ${pointField})
               VALUES ($2, $3, $1)
               ON CONFLICT (user_id) DO UPDATE SET ${pointField} = konfi_profiles.${pointField} + $1`,
              [request.points, request.user_id, req.user.organization_id]
            );
          }

          // VORUEBERGEHEND DEAKTIVIERT: Foto-Referenz NICHT entfernen.
          // Grund: Admins müssen genehmigte Antrags-Fotos weiter sehen können,
          // sonst reichen Konfis dasselbe Foto doppelt ein (festgestellt in der
          // Praxis). Datensparsamkeit bleibt das Ziel — Löschung erfolgt später
          // (z.B. zeitversetzt per Cron), aber NICHT sofort bei Genehmigung.
          // if (request.photo_filename) {
          //   await client.query("UPDATE activity_requests SET photo_filename = NULL WHERE id = $1", [requestId]);
          // }
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
        newBadges = await checkAndAwardBadges(db, request.user_id, { organizationId: req.user.organization_id });

        // Level-Check NACH Badge-Check
        try {
          await PushService.checkAndSendLevelUp(db, request.user_id, req.user.organization_id);
        } catch (levelErr) {
          console.error('Level-up check failed:', levelErr);
        }

        // VORUEBERGEHEND DEAKTIVIERT: Foto-Datei NICHT sofort löschen.
        // Grund: Admins müssen genehmigte Antrags-Fotos weiter sehen können,
        // sonst reichen Konfis dasselbe Foto doppelt ein. Datensparsamkeit bleibt
        // das Ziel — physische Löschung erfolgt später (z.B. zeitversetzt per
        // Cron), aber NICHT sofort bei Genehmigung.
        // if (request.photo_filename) {
        //   const fs = require('fs');
        //   const path = require('path');
        //   const photoPath = path.join(__dirname, '../uploads/requests', request.photo_filename);
        //
        //   fs.unlink(photoPath, (err) => {
        //     if (err) {
        //       console.error('Error deleting photo:', err);
        //     }
        //   });
        // }
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


        await PushService.sendActivityRequestStatusToKonfi(
          db,
          request.user_id,
          request.activity_name,
          request.points,
          status,
          admin_comment,
          requestId,
          req.user.organization_id
        );
      } catch (notifErr) {
 console.error('Error sending notification:', notifErr);
        // Don't fail the request if notification fails
      }

      res.json({ message: 'Antragsstatus aktualisiert', newBadges });

      // Live-Update für Antragsliste an alle Admins/Org-Admins/Teamer:innen der
      // Org (sendToOrgAdmins adressiert seit dem Raum-Fix auch Teamer:innen). Der
      // früher hier stehende globale io.emit('konfisUpdate'/'requestsUpdate') war
      // ein Broadcast an ALLE Orgs (Isolation-Verletzung) und ist redundant: die
      // Legacy-Listener in LiveUpdateContext bekommen dieselbe Aktualisierung nun
      // über das reguläre 'liveUpdate'-Event (type 'requests') dieser Sendung.
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'requests', 'update');
      // Antragsteller:in kann Konfi ODER Teamer:in sein (target_role='teamer'):
      // sendToUserByRole trifft den korrekten Socket-Raum, sendToKonfi wuerde bei
      // Teamer-Anträgen in den leeren Konfi-Raum senden.
      liveUpdate.sendToUserByRole(request.user_id, 'points', 'update');
      liveUpdate.sendToUserByRole(request.user_id, 'requests', 'update');
    } catch (err) {
 console.error('Database error in PUT /api/activities/requests/%s:', requestId, err);
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
    // heuteBerlin() statt toISOString(): Letzteres liefert IMMER den UTC-Tag.
    // Zwischen 00:00 und 02:00 Berliner Zeit trug ein Eintrag ohne Datum sonst
    // den Vortag -- und landete damit im falschen Tag der Punktehistorie.
    const date = completed_date || heuteBerlin();

    try {
      const { rows: [activity] } = await db.query("SELECT * FROM activities WHERE id = $1 AND organization_id = $2", [activityId, req.user.organization_id]);
      if (!activity) return res.status(404).json({ error: 'Aktivität nicht gefunden' });

      // Der Ziel-Konfi MUSS zur eigenen Organisation gehören. Geprueft wurde
      // bisher nur die Aktivität — ein Admin konnte damit über eine fremde
      // konfiId Punkte und Aktivitäten bei Konfis ANDERER Gemeinden setzen und
      // dort Badge-/Level-Berechnung auslösen. Der
      // Teamer-Zweig darunter war über den Jahrgangs-Check zufaellig gedeckt,
      // admin/org_admin nicht.
      const { rows: [zielUser] } = await db.query(
        "SELECT 1 FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL",
        [konfiId, req.user.organization_id]
      );
      if (!zielUser) {
        return res.status(404).json({ error: 'Konfi nicht gefunden' });
      }

      // Teamer-Aktivitäten: Keine Punkte-Vergabe und keinen pointTypeGuard-Check
      const isTeamerActivity = activity.target_role === 'teamer';

      // Jahrgangs-Zugriff auf die Zielperson prüfen.
      //
      // NUR für Konfi-Aktivitäten: Bei target_role='teamer' ist die Zielperson
      // eine Teamer:in ohne konfi_profiles-Eintrag. Ein Jahrgangs-Check würde
      // dort ins Leere greifen (kein Profil -> 404) und die Teamer-Vergabe
      // brechen. Ausserdem gilt für Teamer:innen ohnehin die Ausnahme der
      // Regel: die sieht ein Admin alle.
      if (!isTeamerActivity) {
        const zugriff = await darfKonfi(db, req, konfiId);
        if (!zugriff.gefunden) {
          return res.status(404).json({ error: 'Konfi nicht gefunden' });
        }
        if (!zugriff.erlaubt) {
          return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
        }
      }

      if (!isTeamerActivity) {
        // Guard: Punkte-Typ muss für den Jahrgang aktiviert sein
        const { enabled, error } = await checkPointTypeEnabled(db, konfiId, activity.type);
        if (!enabled) return res.status(400).json({ error });
      }

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        // points: Wert der Aktivität zum Zeitpunkt der Vergabe, am Beleg
        // festgehalten.
        await client.query(
          "INSERT INTO user_activities (user_id, activity_id, admin_id, completed_date, organization_id, points) VALUES ($1, $2, $3, $4, $5, $6)",
          [konfiId, activityId, req.user.id, date, req.user.organization_id, activity.points]
        );

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
      const badgeResult = await checkAndAwardBadges(db, konfiId, { organizationId: req.user.organization_id });

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

      // Live-Update an Ziel senden — sendToUserByRole (statt sendToKonfi), weil
      // Aktivitäten auch an Teamer:innen vergeben werden können (isTeamerActivity)
      liveUpdate.sendToUserByRole(konfiId, 'points', 'update');
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
        `SELECT ar.photo_filename, ar.user_id, u.organization_id, a.target_role
         FROM activity_requests ar
         JOIN users u ON ar.user_id = u.id
         JOIN activities a ON ar.activity_id = a.id
         WHERE ar.id = $1`,
        [requestId]
      );

      if (!request) {
        return res.status(404).json({ error: 'Antrag nicht gefunden' });
      }

      // Organization check
      if (request.organization_id !== req.user.organization_id) {
        return res.status(403).json({ error: 'Keine Berechtigung für diese Gemeinde' });
      }

      // Jahrgangs-Bindung: Ein Nachweisfoto ist das persönlichste
      // Datum an einem Antrag (die Route trägt nicht umsonst den Hinweis
      // "NUR Admin (Datenschutz!)" im Dateikopf). Wer die Konfi nicht sehen
      // darf, darf ihr Foto erst recht nicht sehen.
      if (request.target_role !== 'teamer') {
        const zugriff = await darfKonfi(db, req, request.user_id);
        if (!zugriff.erlaubt) {
          return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
        }
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

      // Stromweise entschluesseln und senden (frueher: ganze Datei in den
      // Arbeitsspeicher).
      // Admins sehen das Foto unabhaengig vom Status (auch verbucht/abgelehnt).
      res.setHeader('Content-Type', 'image/jpeg');
      try {
        await decryptFileToStream(photoPath, res);
      } catch (decErr) {
        console.error('Error decrypting activity request photo:', decErr);
        if (!res.headersSent) {
          return res.status(500).json({ error: 'Foto konnte nicht entschlüsselt werden' });
        }
        res.destroy();
      }
    } catch (err) {
 console.error('Error serving activity request photo:', err);
      res.status(500).json({ error: 'Fehler beim Laden des Fotos' });
    }
  });

  // Nachweisfoto eines Antrags manuell löschen (Admin/Org-Admin).
  // Setzt photo_filename = NULL und entfernt die Datei vom Dateisystem.
  // Der Antrag selbst bleibt erhalten (nur das Foto wird entfernt).
  router.delete('/requests/:id/photo', rbacVerifier, async (req, res) => {
    try {
      const requestId = parseInt(req.params.id);

      if (!['admin', 'org_admin'].includes(req.user.role_name)) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }

      const { rows: [request] } = await db.query(
        `SELECT ar.photo_filename, ar.user_id, u.organization_id, a.target_role
         FROM activity_requests ar
         JOIN users u ON ar.user_id = u.id
         JOIN activities a ON ar.activity_id = a.id
         WHERE ar.id = $1`,
        [requestId]
      );

      if (!request) {
        return res.status(404).json({ error: 'Antrag nicht gefunden' });
      }

      if (request.organization_id !== req.user.organization_id) {
        return res.status(403).json({ error: 'Keine Berechtigung für diese Gemeinde' });
      }

      // Jahrgangs-Bindung: analog zur GET-Foto-Route — das Foto
      // gehört zur Konfi, nicht zur Organisation.
      if (request.target_role !== 'teamer') {
        const zugriff = await darfKonfi(db, req, request.user_id);
        if (!zugriff.erlaubt) {
          return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
        }
      }

      if (!request.photo_filename) {
        return res.status(404).json({ error: 'Kein Foto vorhanden' });
      }

      // Erst DB-Referenz entfernen, dann Datei löschen
      await db.query("UPDATE activity_requests SET photo_filename = NULL WHERE id = $1", [requestId]);
      await deletePhotoFile(request.photo_filename);

      res.json({ message: 'Foto erfolgreich gelöscht' });

      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'requests', 'update');
    } catch (err) {
 console.error('Error deleting activity request photo:', err);
      res.status(500).json({ error: 'Fehler beim Löschen des Fotos' });
    }
  });

  return router;
};