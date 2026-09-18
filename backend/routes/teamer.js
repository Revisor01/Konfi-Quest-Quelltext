const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { beantworteTageslosung } = require('../services/losungService');
const { getTeamerBadgeProgress } = require('../utils/teamerBadgeProgress');
const { baueBadgeAntwortV2 } = require('../utils/badgeAntwortV2');
const { setzeTeamerZusage } = require('../utils/bookingUtils');
const PushService = require('../services/pushService');
const liveUpdate = require('../utils/liveUpdate');
const { addToEventChat, removeFromEventChat } = require('../utils/eventChat');
const { deletePhotoFile } = require('../utils/photoStorage');
const { getPunkteHistorie } = require('../utils/punkteHistorie');
const { findeAntragZuClientId, behandleClientIdRace } = require('../utils/antragIdempotenz');
const { BIBEL_UEBERSETZUNGEN, KONFSPRUCH_TRANSLATIONS, ladeSpruchliste, ladeKonfspruch } = require('../utils/konfspruch');
const { heuteBerlin } = require('../utils/zeitformat');

module.exports = (db, rbacVerifier, roleHelpers) => {
  const { requireTeamer, requireOrgAdmin, requireAdmin } = roleHelpers;

  // Schema: siehe backend/migrations/064_consolidate_inline_schemas.sql

  // Validierungsregeln
  const validateCreateCertificateType = [
    body('name').notEmpty().trim().isLength({ min: 1, max: 100 }).withMessage('Name erforderlich (1-100 Zeichen)'),
    body('icon').optional().trim().isLength({ max: 50 }).withMessage('Icon max. 50 Zeichen'),
    handleValidationErrors
  ];

  const validateUpdateCertificateType = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Name max. 100 Zeichen'),
    body('icon').optional().trim().isLength({ max: 50 }).withMessage('Icon max. 50 Zeichen'),
    body('is_active').optional().isBoolean().withMessage('is_active muss boolean sein'),
    handleValidationErrors
  ];

  const validateCertificate = [
    param('userId').isInt({ min: 1 }).withMessage('Ungültige Benutzer-ID'),
    body('certificate_type_id').isInt({ min: 1 }).withMessage('certificate_type_id erforderlich'),
    body('issued_date').notEmpty().isISO8601().withMessage('Gültiges Datum erforderlich'),
    body('expiry_date').optional().isISO8601().withMessage('Gültiges Ablaufdatum'),
    handleValidationErrors
  ];

  // ====================================================================
  // TEAMER PROFIL
  // ====================================================================

  // GET /teamer/profile - Eingefrorene Konfi-Daten für Teamer
  router.get('/profile', rbacVerifier, (req, res, next) => {
    // Nur Teamer dürfen ihr Profil abrufen
    if (req.user.role_name !== 'teamer') {
      return res.status(403).json({ error: 'Nur das Team kann dieses Profil abrufen' });
    }
    next();
  }, async (req, res) => {
    try {
      const userId = req.user.id;

      // User-Daten aus DB laden (inkl. email, role_title, teamer_since)
      const userQuery = `
        SELECT u.display_name, u.username, u.email, u.role_title, u.teamer_since,
               u.bible_translation,
               o.name as organization_name
        FROM users u
        LEFT JOIN organizations o ON u.organization_id = o.id
        WHERE u.id = $1
      `;
      const { rows: [userData] } = await db.query(userQuery, [userId]);

      // Konfi-Profildaten (eingefroren nach Transition)
      const profileQuery = `
        SELECT kp.gottesdienst_points, kp.gemeinde_points,
               j.name as jahrgang_name
        FROM konfi_profiles kp
        LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
        WHERE kp.user_id = $1
      `;
      const { rows: [konfiProfile] } = await db.query(profileQuery, [userId]);

      // Beförderter Teamer = hat überhaupt ein konfi_profiles (Konfi-Vergangenheit).
      // NICHT am jahrgang_name festmachen: wird der alte Jahrgang gelöscht, ist
      // jahrgang_id=NULL -> jahrgang_name=NULL, aber die WERTE (Punkte/Badges)
      // bleiben und müssen weiter sichtbar sein. Reine Teamer ohne Konfi-
      // Vergangenheit haben kein konfi_profiles -> konfi_data=null.
      const isPromotedKonfi = !!konfiProfile;
      let badges = [];
      if (isPromotedKonfi) {
        // organization_id kommt im selben Zug dazu: Ohne sie zaehlte die
        // Abfrage Abzeichen aus JEDER Organisation, in der die Person je ein
        // Konto hatte. So macht es der Rest des Hauses auch
        // (konfi-management.js:764, badges.js:208, konfi.js:1077).
        const badgesQuery = `
          SELECT kb.badge_id, b.name, b.description, b.icon, b.color,
                 b.criteria_type, b.criteria_value,
                 kb.awarded_date
          FROM user_badges kb
          JOIN custom_badges b ON kb.badge_id = b.id
          WHERE kb.user_id = $1
            AND b.target_role = 'konfi'
            AND b.organization_id = $2
          ORDER BY kb.awarded_date DESC
        `;
        const result = await db.query(badgesQuery, [userId, req.user.organization_id]);
        badges = result.rows;
      }

      res.json({
        user: {
          display_name: userData?.display_name || req.user.display_name,
          username: userData?.username || req.user.username,
          email: userData?.email || '',
          role_title: userData?.role_title || '',
          teamer_since: userData?.teamer_since || null,
          organization_name: userData?.organization_name || '',
          bible_translation: userData?.bible_translation || 'LUT'
        },
        konfi_data: isPromotedKonfi ? {
          gottesdienst_points: konfiProfile?.gottesdienst_points || 0,
          gemeinde_points: konfiProfile?.gemeinde_points || 0,
          jahrgang_name: konfiProfile?.jahrgang_name || '',
          badges: badges
        } : null
      });
    } catch (err) {
      console.error('Error loading teamer profile:', err);
      res.status(500).json({ error: 'Fehler beim Laden des Teamer-Profils' });
    }
  });

  // ====================================================================
  // TEAMER KONFIS (für DirectMessageModal — nur zugewiesene Jahrgänge)
  // ====================================================================

  // GET /teamer/konfis - Konfis der zugewiesenen Jahrgänge (Chat-Auswahl)
  router.get('/konfis', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const orgId = req.user.organization_id;

      let jahrgangFilter = '';
      let params = [orgId];
      let placeholderIndex = 2;

      if (!req.user.is_super_admin && req.user.role_name !== 'org_admin') {
        const viewableJahrgaenge = req.user.assigned_jahrgaenge
          .filter(j => j.can_view)
          .map(j => j.id);

        if (viewableJahrgaenge.length === 0) {
          // Grund der leeren Liste mitliefern (dasselbe Muster wie GET
          // /admin/konfis): keine Zuweisung, nicht "keine Konfis". Als
          // Header, damit die Antwortform ein Array bleibt.
          res.set('X-Kein-Jahrgang-Zugewiesen', 'true');
          return res.json([]);
        }

        const placeholders = viewableJahrgaenge.map(() => `$${placeholderIndex++}`).join(',');
        jahrgangFilter = `AND j.id IN (${placeholders})`;
        params.push(...viewableJahrgaenge);
      }

      const query = `
        SELECT u.id, u.display_name as name, u.username,
               j.name as jahrgang_name, j.id as jahrgang_id
        FROM users u
        JOIN roles r ON u.role_id = r.id
        LEFT JOIN konfi_profiles kp ON u.id = kp.user_id
        LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
        WHERE r.name = 'konfi' AND u.organization_id = $1 AND u.deleted_at IS NULL ${jahrgangFilter}
        ORDER BY j.name DESC, u.display_name
      `;

      const { rows } = await db.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error('Database error in GET /teamer/konfis:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ====================================================================
  // TEAMER KONFI-HISTORY (Punkte-Verlauf aus der Konfi-Zeit)
  // ====================================================================

  // GET /teamer/konfi-history - Punkte-Verlauf für ehemalige Konfis (jetzt Teamer)
  // Berechnung in utils/punkteHistorie.js — dieselbe Quelle wie
  // GET /konfi/points-history. Beide speisen dasselbe Frontend-Modal
  // (PointsHistoryModal.tsx), muessen also dieselbe Form liefern.
  router.get('/konfi-history', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      if (req.user.role_name !== 'teamer') {
        return res.status(403).json({ error: 'Nur das Team kann die Konfi-Historie abrufen' });
      }

      const { history, totals } = await getPunkteHistorie(db, req.user.id, req.user.organization_id);
      res.json({ history, totals });
    } catch (err) {
      console.error('Database error in GET /teamer/konfi-history:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ====================================================================
  // TEAMER-BADGES
  // ====================================================================

  // GET /teamer/badges - Alle verfügbaren Teamer-Badges mit earned-Status und Fortschritt
  //
  // ==================== ALTE GENERATION — NICHT ANFASSEN ====================
  // Diese Route liefert ein ARRAY plus die Kopfzeilen X-Badges-Secret-Total /
  // X-Badges-Visible-Total. Das ist der Vertrag der AUSGELIEFERTEN Apps
  // (iOS 2.0.0 / Android versionCode 81), und der laesst sich nicht
  // mitdeployen.
  router.get('/badges', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      if (req.user.role_name !== 'teamer') {
        return res.status(403).json({ error: 'Nur das Team kann Teamer-Badges abrufen' });
      }

      // Gerechnet wird in utils/teamerBadgeProgress.js — EINE Quelle fuer
      // diese Route und fuer /badges/v2. Hier steht nur noch die Verpackung.
      const { alle, stats } = await getTeamerBadgeProgress(db, req.user.id, req.user.organization_id);

      const sichtbareBadges = alle.filter(
        b => (!b.is_hidden || b.earned) && (b.earned || !b.unreachable)
      );

      // Die Zaehler gehen als Kopfzeilen mit — im Rumpf waere kein Platz,
      // ohne die Array-Form zu brechen (siehe oben).
      res.set('X-Badges-Secret-Total', String(stats.totalSecret));
      res.set('X-Badges-Visible-Total', String(stats.totalVisible));
      res.json(sichtbareBadges);
    } catch (err) {
      console.error('Error loading teamer badges:', err);
      res.status(500).json({ error: 'Fehler beim Laden der Teamer-Badges' });
    }
  });

  // GET /teamer/badges/v2 - Abzeichen-Generation v2 (Teamer-Haelfte)
  //
  // Gleiche Huelle wie GET /konfi/badges/v2: { available, earned, stats }.
  // Bis auf die Rolle im Pfad ist die Antwort fuer Konfi und Teamer
  // deckungsgleich — dieselben Feldnamen, dieselbe Semantik, die Zaehler im
  // RUMPF statt in Kopfzeilen (der Zwischenspeicher der App sichert nur
  // Daten, keine Kopfzeilen — beide Ansichten mussten sie bisher umstaendlich
  // an die Liste heften).
  //
  // Gegenueber der alten Route fehlen die Verwaltungsfelder created_at,
  // created_by, organization_id und target_role; sie landen auf keinem
  // Bildschirm (Begruendung in utils/badgeAntwortV2.js). `seen` fuehrt der
  // Teamer-Pfad ohnehin nicht — diese Seite markiert pauschal beim Oeffnen.
  router.get('/badges/v2', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      if (req.user.role_name !== 'teamer') {
        return res.status(403).json({ error: 'Nur das Team kann Teamer-Badges abrufen' });
      }

      const ergebnis = await getTeamerBadgeProgress(db, req.user.id, req.user.organization_id);
      res.json(baueBadgeAntwortV2(ergebnis));
    } catch (err) {
      console.error('Error loading teamer badges (v2):', err);
      res.status(500).json({ error: 'Fehler beim Laden der Teamer-Badges' });
    }
  });

  // GET /teamer/badges/unseen - Anzahl ungesehener Badges
  router.get('/badges/unseen', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      if (req.user.role_name !== 'teamer') {
        return res.status(403).json({ error: 'Nur das Team kann Badge-Status abrufen' });
      }

      const { rows: [result] } = await db.query(
        "SELECT COUNT(*) as count FROM user_badges WHERE user_id = $1 AND organization_id = $2 AND seen = false",
        [req.user.id, req.user.organization_id]
      );
      res.json({ unseen: parseInt(result.count) });
    } catch (err) {
      console.error('Error loading unseen badge count:', err);
      res.status(500).json({ error: 'Fehler beim Laden des Badge-Status' });
    }
  });

  // PUT /teamer/badges/mark-seen - Badges als gesehen markieren
  //
  // ALTE GENERATION: PUT, waehrend der Konfi-Pfad seit jeher POST nutzt —
  // dieselbe Handlung, zwei Verben. In v2 ist das aufgeloest (POST, siehe
  // unten). Diese Route bleibt unveraendert, bis keine App im Store sie mehr
  // ruft.
  // Eine Quelle fuer beide Verben: die alte PUT-Route und die neue POST-Route
  // machen exakt dasselbe UPDATE. Zweimal hingeschrieben liefen sie
  // frueher oder spaeter auseinander.
  const markiereAbzeichenGesehen = (userId, orgId) => db.query(
    "UPDATE user_badges SET seen = true WHERE user_id = $1 AND organization_id = $2 AND seen = false",
    [userId, orgId]
  );

  router.put('/badges/mark-seen', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      if (req.user.role_name !== 'teamer') {
        return res.status(403).json({ error: 'Nur das Team kann Badges als gesehen markieren' });
      }

      await markiereAbzeichenGesehen(req.user.id, req.user.organization_id);
      res.json({ message: 'Badges als gesehen markiert' });
    } catch (err) {
      console.error('Error marking badges as seen:', err);
      res.status(500).json({ error: 'Fehler beim Aktualisieren des Badge-Status' });
    }
  });

  // POST /teamer/badges/mark-seen - Abzeichen als gesehen markieren (v2)
  //
  // VERB-ENTSCHEIDUNG: v2 nutzt POST, der Konfi-Pfad tat das
  // seit jeher. Ein PUT verspricht "lege die Ressource unter diesem Pfad auf
  // diesen Zustand" — hier gibt es aber weder eine adressierte Ressource noch
  // einen mitgeschickten Zustand, sondern eine Handlung auf einer Menge
  // eigener Datensaetze. Genau dafuer ist POST da. Praktisch faellt so auch
  // die Konfi-Seite nicht um: sie ruft laengst POST, und die Teamer-Seite
  // aendert nur das Verb.
  //
  // Bewusst NICHT versioniert im Pfad: Die Route ist neu, sie hat keinen
  // alten Vertrag, den sie brechen koennte. Erst wenn die alte PUT-Route
  // faellt, bleibt hier nur noch dieses POST.
  router.post('/badges/mark-seen', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      if (req.user.role_name !== 'teamer') {
        return res.status(403).json({ error: 'Nur das Team kann Badges als gesehen markieren' });
      }

      await markiereAbzeichenGesehen(req.user.id, req.user.organization_id);
      res.json({ message: 'Badges als gesehen markiert' });
    } catch (err) {
      console.error('Error marking badges as seen:', err);
      res.status(500).json({ error: 'Fehler beim Aktualisieren des Badge-Status' });
    }
  });

  // GET /teamer/:userId/badges - Erreichte Badges EINER Teamer:in (Leitungs-
  // Einsicht für die Detailseite). Bewusst ohne Fortschritt zu den noch
  // offenen Badges: die Detailseite zeigt nur, was erreicht wurde — die
  // Fortschrittsberechnung in GET /teamer/badges ist teuer und wäre hier
  // ungenutzt. Zugriff wie bei den Zertifikaten: requireAdmin.
  router.get('/:userId/badges', rbacVerifier, requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;

      // Org-Zugehoerigkeit + Teamer-Rolle prüfen (analog zur Konfi-Variante
      // in konfi-management.js, die auf r.name = 'konfi' filtert).
      const { rows: [teamer] } = await db.query(
        `SELECT u.id FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.id = $1 AND r.name = 'teamer' AND u.organization_id = $2 AND u.deleted_at IS NULL`,
        [userId, req.user.organization_id]
      );

      if (!teamer) {
        return res.status(404).json({ error: 'Teamer:in nicht gefunden' });
      }

      const { rows: badges } = await db.query(
        `SELECT cb.id, cb.name, cb.description, cb.icon, cb.color,
                cb.criteria_type, cb.criteria_value, cb.is_hidden,
                -- Feldname wie beim Konfi-Endpunkt, damit die Detailseite
                -- dieselbe Komponente nutzen kann.
                ub.awarded_date AS earned_at
         FROM user_badges ub
         JOIN custom_badges cb ON ub.badge_id = cb.id
         WHERE ub.user_id = $1 AND ub.organization_id = $2
           AND cb.target_role = 'teamer'
         ORDER BY ub.awarded_date DESC NULLS LAST, cb.name`,
        [userId, req.user.organization_id]
      );

      res.json({ earned: badges });
    } catch (err) {
      console.error('Database error in GET /teamer/:userId/badges:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ====================================================================
  // ZERTIFIKAT-TYPEN CRUD (Admin-only)
  // ====================================================================

  // GET /teamer/certificate-types - Alle aktiven Typen der Organisation
  router.get('/certificate-types', rbacVerifier, requireAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT id, name, icon, is_active, created_at
         FROM certificate_types
         WHERE organization_id = $1 AND is_active = true
         ORDER BY name`,
        [req.user.organization_id]
      );
      res.json(rows);
    } catch (err) {
      console.error('Error loading certificate types:', err);
      res.status(500).json({ error: 'Fehler beim Laden der Zertifikat-Typen' });
    }
  });

  router.post('/certificate-types', rbacVerifier, requireAdmin, validateCreateCertificateType, async (req, res) => {
    try {
      const { name, icon } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Name ist erforderlich' });
      }

      const { rows: [created] } = await db.query(
        `INSERT INTO certificate_types (name, icon, organization_id)
         VALUES ($1, $2, $3)
         RETURNING id, name, icon, is_active, created_at`,
        [name.trim(), icon || 'ribbon', req.user.organization_id]
      );
      res.status(201).json(created);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Ein Zertifikat-Typ mit diesem Namen existiert bereits' });
      }
      console.error('Error creating certificate type:', err);
      res.status(500).json({ error: 'Fehler beim Erstellen des Zertifikat-Typs' });
    }
  });

  // PUT /teamer/certificate-types/:id - Typ bearbeiten
  router.put('/certificate-types/:id', rbacVerifier, requireAdmin, validateUpdateCertificateType, async (req, res) => {
    try {
      const { name, icon, is_active } = req.body;
      const updates = [];
      const params = [];
      let paramIdx = 1;

      if (name !== undefined) {
        if (!name.trim()) {
          return res.status(400).json({ error: 'Name darf nicht leer sein' });
        }
        updates.push(`name = $${paramIdx++}`);
        params.push(name.trim());
      }
      if (icon !== undefined) {
        updates.push(`icon = $${paramIdx++}`);
        params.push(icon);
      }
      if (is_active !== undefined) {
        updates.push(`is_active = $${paramIdx++}`);
        params.push(is_active);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'Keine Änderungen angegeben' });
      }

      params.push(req.params.id, req.user.organization_id);
      const { rowCount } = await db.query(
        `UPDATE certificate_types SET ${updates.join(', ')}
         WHERE id = $${paramIdx++} AND organization_id = $${paramIdx}`,
        params
      );

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Zertifikat-Typ nicht gefunden' });
      }
      res.json({ message: 'Zertifikat-Typ erfolgreich aktualisiert' });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Ein Zertifikat-Typ mit diesem Namen existiert bereits' });
      }
      console.error('Error updating certificate type:', err);
      res.status(500).json({ error: 'Fehler beim Aktualisieren des Zertifikat-Typs' });
    }
  });

  // DELETE /teamer/certificate-types/:id - Typ löschen (nur wenn nicht zugewiesen)
  router.delete('/certificate-types/:id', rbacVerifier, requireAdmin, async (req, res) => {
    try {
      // Prüfen ob Zertifikate zugewiesen sind
      const { rows: [usage] } = await db.query(
        'SELECT COUNT(*) as count FROM user_certificates WHERE certificate_type_id = $1',
        [req.params.id]
      );

      if (parseInt(usage.count) > 0) {
        return res.status(409).json({
          error: 'Zertifikat-Typ kann nicht gelöscht werden: bereits im Team vergeben.'
        });
      }

      const { rowCount } = await db.query(
        'DELETE FROM certificate_types WHERE id = $1 AND organization_id = $2',
        [req.params.id, req.user.organization_id]
      );

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Zertifikat-Typ nicht gefunden' });
      }
      res.json({ message: 'Zertifikat-Typ erfolgreich gelöscht' });
    } catch (err) {
      console.error('Error deleting certificate type:', err);
      res.status(500).json({ error: 'Fehler beim Löschen des Zertifikat-Typs' });
    }
  });

  // ====================================================================
  // ZERTIFIKAT-ZUWEISUNG AN TEAMER (Admin-only)
  // ====================================================================

  // GET /teamer/:userId/certificates - Alle Zertifikate eines Teamers
  router.get('/:userId/certificates', rbacVerifier, requireAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT uc.id, uc.issued_date, uc.expiry_date, uc.created_at,
                ct.id as certificate_type_id, ct.name, ct.icon
         FROM user_certificates uc
         JOIN certificate_types ct ON uc.certificate_type_id = ct.id
         WHERE uc.user_id = $1 AND uc.organization_id = $2
         ORDER BY uc.issued_date DESC`,
        [req.params.userId, req.user.organization_id]
      );
      res.json(rows);
    } catch (err) {
      console.error('Error loading user certificates:', err);
      res.status(500).json({ error: 'Fehler beim Laden der Zertifikate' });
    }
  });

  // POST /teamer/:userId/certificates - Zertifikat zuweisen
  router.post('/:userId/certificates', rbacVerifier, requireAdmin, validateCertificate, async (req, res) => {
    try {
      const { certificate_type_id, issued_date, expiry_date } = req.body;

      if (!certificate_type_id || !issued_date) {
        return res.status(400).json({ error: 'Zertifikat-Typ und Ausstellungsdatum sind erforderlich' });
      }

      // Prüfen: User existiert und ist Teamer
      const { rows: [user] } = await db.query(
        `SELECT u.id FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.id = $1 AND u.organization_id = $2 AND r.name = 'teamer'`,
        [req.params.userId, req.user.organization_id]
      );

      if (!user) {
        return res.status(404).json({ error: 'Teamer nicht gefunden' });
      }

      // Prüfen: Zertifikat-Typ gehört zur Organisation
      const { rows: [certType] } = await db.query(
        'SELECT id, name FROM certificate_types WHERE id = $1 AND organization_id = $2 AND is_active = true',
        [certificate_type_id, req.user.organization_id]
      );

      if (!certType) {
        return res.status(404).json({ error: 'Zertifikat-Typ nicht gefunden oder nicht aktiv' });
      }

      const { rows: [created] } = await db.query(
        `INSERT INTO user_certificates (user_id, certificate_type_id, organization_id, issued_date, expiry_date, admin_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, issued_date, expiry_date`,
        [req.params.userId, certificate_type_id, req.user.organization_id, issued_date, expiry_date || null, req.user.id]
      );

      res.status(201).json({ message: 'Zertifikat erfolgreich zugewiesen', ...created });

      // Push + Live-Update an die Empfaenger:in (Teamer:in). Seiteneffekt NACH res,
      // in try/catch — ein Push-Fehler darf die erfolgreiche Zuweisung nicht kippen.
      try {
        await PushService.sendCertificateToTeamer(db, req.params.userId, certType.name, req.user.organization_id);
      } catch (pushErr) {
        console.error('Error sending certificate push:', pushErr);
      }
      // Zertifikate hängen an den Teamer-Badge-/Dashboard-Ansichten -> 'badges'.
      liveUpdate.sendToUserByRole(req.params.userId, 'badges', 'update');
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Dieses Zertifikat wurde dem Teamer bereits zugewiesen' });
      }
      console.error('Error assigning certificate:', err);
      res.status(500).json({ error: 'Fehler beim Zuweisen des Zertifikats' });
    }
  });

  // DELETE /teamer/:userId/certificates/:certId - Zertifikat entfernen
  router.delete('/:userId/certificates/:certId', rbacVerifier, requireAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        'DELETE FROM user_certificates WHERE id = $1 AND user_id = $2 AND organization_id = $3',
        [req.params.certId, req.params.userId, req.user.organization_id]
      );

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Zertifikat nicht gefunden' });
      }
      res.json({ message: 'Zertifikat erfolgreich entfernt' });
    } catch (err) {
      console.error('Error removing certificate:', err);
      res.status(500).json({ error: 'Fehler beim Entfernen des Zertifikats' });
    }
  });

  // ====================================================================
  // TEAMER-DASHBOARD
  // ====================================================================

  // GET /teamer/dashboard - Dashboard-Daten für Teamer
  router.get('/dashboard', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      if (req.user.role_name !== 'teamer') {
        return res.status(403).json({ error: 'Nur das Team kann das Dashboard abrufen' });
      }

      const userId = req.user.id;
      const orgId = req.user.organization_id;

      // 1. Greeting
      const now = new Date();
      const greeting = {
        display_name: req.user.display_name,
        hour: now.getHours()
      };

      // 2. Certificates: Alle Typen der Org mit LEFT JOIN user_certificates
      const certificatesQuery = `
        SELECT ct.id, ct.name, ct.icon,
               uc.issued_date, uc.expiry_date,
               CASE
                 WHEN uc.id IS NULL THEN 'not_earned'
                 WHEN uc.expiry_date IS NOT NULL AND uc.expiry_date < CURRENT_DATE THEN 'expired'
                 ELSE 'valid'
               END as status
        FROM certificate_types ct
        LEFT JOIN user_certificates uc ON ct.id = uc.certificate_type_id AND uc.user_id = $1
        WHERE ct.organization_id = $2 AND ct.is_active = true
        ORDER BY
          CASE
            WHEN uc.id IS NOT NULL AND (uc.expiry_date IS NULL OR uc.expiry_date >= CURRENT_DATE) THEN 0
            WHEN uc.id IS NOT NULL AND uc.expiry_date < CURRENT_DATE THEN 1
            ELSE 2
          END,
          ct.name
      `;
      const { rows: certificates } = await db.query(certificatesQuery, [userId, orgId]);

      // 3. Events: Naechste anstehende Termine, die Teamer:innen betreffen --
      // eigene Buchungen UND Termine, fuer die Teamer:innen gesucht werden.
      //
      // Der Filter auf teamer_only/teamer_needed fehlte ebenfalls ganz; ohne
      // ihn stuenden auch reine Konfi-Termine auf der Teamer-Startseite.
      // ABGESAGTE TERMINE STEHEN HIER -- ABER NUR FUER DIE EIGENE BUCHUNG
      // 
      //
      // WARUM SIE HINEINGEHOEREN: Wer fuer morgen zugesagt hat, muss auf der
      // Startseite sehen, dass der Termin ausfaellt. Genau dafuer schaut man
      // dort hin. Ein Termin, der still aus der Liste verschwindet, sagt
      // "nichts los" statt "faellt aus" -- und die Zusage bleibt im Kopf.
      //
      // Die drei Absage-Felder kommen ADDITIV dazu, Muster und LEFT JOINs wie
      // in events/lesen.js: Termine, die vor Migration 150/152 abgesagt
      // wurden, haben keinen Urheber -- ein INNER JOIN wuerde sie aus der
      // Liste werfen. NULL heisst hier "kein Grund angegeben" bzw.
      // "unbekannt", nicht "niemand".
      const eventsQuery = `
        SELECT e.id, e.name AS title, e.event_date, e.event_end_time, e.location, e.type,
               e.teamer_only, e.teamer_needed, e.bring_items, e.cancelled,
               e.cancelled_reason, e.cancelled_by, e.cancelled_at,
               u_cancel.display_name as cancelled_by_name,
               u_grund.display_name as cancelled_reason_set_by_name,
               CASE WHEN eb.id IS NOT NULL THEN true ELSE false END as is_registered,
               eb.status as booking_status
        FROM events e
        LEFT JOIN event_bookings eb ON e.id = eb.event_id AND eb.user_id = $1
        LEFT JOIN users u_cancel ON e.cancelled_by = u_cancel.id
        LEFT JOIN users u_grund ON e.cancelled_reason_set_by = u_grund.id
        WHERE e.organization_id = $2
          AND e.event_date >= CURRENT_DATE
          AND (e.cancelled IS NOT TRUE OR eb.id IS NOT NULL)
          AND (
            eb.id IS NOT NULL          -- eigene Buchung: immer zeigen
            OR e.teamer_only = true    -- reiner Team-Termin
            OR e.teamer_needed = true  -- "Teamer:innen gesucht"
          )
        ORDER BY e.event_date ASC
        LIMIT 5
      `;
      const { rows: events } = await db.query(eventsQuery, [userId, orgId]);

      // 4. Badges: Letzte 3 earned + Counts
      const recentBadgesQuery = `
        SELECT cb.icon, cb.name, ub.awarded_date
        FROM user_badges ub
        JOIN custom_badges cb ON ub.badge_id = cb.id
        WHERE ub.user_id = $1 AND ub.organization_id = $2 AND cb.target_role = 'teamer'
        ORDER BY ub.awarded_date DESC
        LIMIT 3
      `;
      const { rows: recentBadges } = await db.query(recentBadgesQuery, [userId, orgId]);

      const earnedCountQuery = `
        SELECT COUNT(*) as count FROM user_badges ub
        JOIN custom_badges cb ON ub.badge_id = cb.id
        WHERE ub.user_id = $1 AND ub.organization_id = $2 AND cb.target_role = 'teamer'
      `;
      const { rows: [earnedResult] } = await db.query(earnedCountQuery, [userId, orgId]);

      const totalCountQuery = `
        SELECT COUNT(*) as count FROM custom_badges
        WHERE organization_id = $1 AND target_role = 'teamer' AND is_active = true
      `;
      const { rows: [totalResult] } = await db.query(totalCountQuery, [orgId]);

      const badges = {
        recent: recentBadges,
        earned_count: parseInt(earnedResult.count),
        total_count: parseInt(totalResult.count)
      };

      // 5. Config: Dashboard-Config aus settings (show_* + section_order)
      const configQuery = `
        SELECT key, value FROM settings
        WHERE organization_id = $1 AND (key LIKE 'teamer_dashboard_show_%' OR key = 'teamer_dashboard_section_order')
      `;
      const { rows: configRows } = await db.query(configQuery, [orgId]);

      let teamerSectionOrder = null;
      const config = {
        show_zertifikate: true,
        show_challenges: true,
        show_konfispruch: true,
        show_events: true,
        show_badges: true,
        show_losung: true
      };

      configRows.forEach(row => {
        if (row.key === 'teamer_dashboard_section_order') {
          try { teamerSectionOrder = JSON.parse(row.value); } catch { /* ignore */ }
        } else {
          config[row.key.replace('teamer_dashboard_show_', 'show_')] = row.value === 'true' || row.value === '1';
        }
      });
      config.section_order = teamerSectionOrder || ['losung', 'challenges', 'events', 'konfispruch', 'zertifikate', 'badges'];

      // 6. Konfispruch: aus konfi_profiles — beförderte Teamer:innen haben ihn
      // aus ihrer Konfi-Zeit, direkt angelegte können ihn über PATCH /profile
      // eintragen. Bei abgeschalteter Karte wird gar nicht erst abgefragt.
      let konfspruch = null;
      if (config.show_konfispruch !== false) {
        konfspruch = await loadKonfspruch(userId, orgId);
      }

      // Wrapped-Verfuegbarkeit prüfen (Teamer: direkt auf wrapped_snapshots)
      const { rows: [wrappedResult] } = await db.query(
        `SELECT EXISTS(
          SELECT 1 FROM wrapped_snapshots
          WHERE user_id = $1 AND wrapped_type = 'teamer'
        ) as has_wrapped`,
        [userId]
      );
      const has_wrapped = wrappedResult?.has_wrapped || false;

      res.json({ greeting, certificates, events, badges, config, has_wrapped, konfspruch });
    } catch (err) {
      console.error('Error loading teamer dashboard:', err);
      res.status(500).json({ error: 'Fehler beim Laden des Teamer-Dashboards' });
    }
  });

  // ====================================================================
  // KONFISPRUCH (Teamer) — gleiche Daten wie bei Konfis (konfi_profiles),
  // damit ein bei der Beförderung mitgebrachter Spruch erhalten bleibt.
  // ====================================================================

  // Gueltige Translation-Keys wie in routes/konfi.js (deskriptive Keys der
  // Tabelle konfspruch_uebersetzungen, NICHT die Tageslosungs-Kuerzel).
  const KONFSPRUCH_TRANSLATIONS = ['luther2017', 'bigs', 'gute_nachricht', 'elberfelder'];

  // Loest den gespeicherten Konfispruch eines Users auf (Listen-Wahl oder
  // Freitext) — Rueckgabeform wie in GET /konfi/profile.
  async function loadKonfspruch(userId, organizationId) {
    const { rows: [kp] } = await db.query(
      `SELECT konfspruch_id, konfspruch_freitext, konfspruch_freitext_referenz,
              konfspruch_translation
       FROM konfi_profiles WHERE user_id = $1`,
      [userId]
    );
    if (!kp) return null;

    if (kp.konfspruch_id) {
      const spruchTranslation = kp.konfspruch_translation || 'luther2017';
      const { rows: [spruch] } = await db.query(
        `SELECT ks.id, ks.reference, ku.text
         FROM konfsprueche ks
         LEFT JOIN konfspruch_uebersetzungen ku
           ON ku.spruch_id = ks.id AND ku.translation = $2
         WHERE ks.id = $1 AND ks.is_active = true
           AND (ks.organization_id IS NULL OR ks.organization_id = $3)`,
        [kp.konfspruch_id, spruchTranslation, organizationId]
      );
      if (spruch) {
        return {
          source: 'liste',
          id: spruch.id,
          reference: spruch.reference,
          text: spruch.text || '',
          translation: kp.konfspruch_translation || null
        };
      }
      return null;
    }

    if (kp.konfspruch_freitext) {
      return {
        source: 'freitext',
        text: kp.konfspruch_freitext,
        reference: kp.konfspruch_freitext_referenz
      };
    }
    return null;
  }

  // GET /teamer/konfsprueche — kuratierte Liste für das Auswahl-Modal
  // (org-gefiltert, gleiche Aufbereitung wie GET /konfi/konfsprueche).
  router.get('/konfsprueche', rbacVerifier, requireTeamer, async (req, res) => {
    if (req.user.role_name !== 'teamer') {
      return res.status(403).json({ error: 'Nur das Team kann die Spruchliste abrufen' });
    }
    try {
      const orgId = req.user.organization_id;
      const { rows } = await db.query(
        `SELECT ks.id, ks.reference, ks.book, ks.chapter, ks.verse,
                COALESCE(
                  json_object_agg(ku.translation, ku.text) FILTER (WHERE ku.translation IS NOT NULL),
                  '{}'::json
                ) AS uebersetzungen
         FROM konfsprueche ks
         LEFT JOIN konfspruch_uebersetzungen ku ON ku.spruch_id = ks.id
         WHERE ks.is_active = true
           AND (ks.organization_id IS NULL OR ks.organization_id = $1)
         GROUP BY ks.id, ks.reference, ks.book, ks.chapter, ks.verse, ks.sort_order
         ORDER BY ks.sort_order, ks.id`,
        [orgId]
      );

      const sprueche = rows.map((row) => {
        const uebersetzungen = {};
        for (const key of KONFSPRUCH_TRANSLATIONS) {
          uebersetzungen[key] = (row.uebersetzungen && row.uebersetzungen[key]) || '';
        }
        return {
          id: row.id,
          reference: row.reference,
          book: row.book,
          chapter: row.chapter,
          verse: row.verse,
          uebersetzungen
        };
      });

      res.json(sprueche);
    } catch (err) {
      console.error('Database error in GET /teamer/konfsprueche:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // PATCH /teamer/profile — eigenen Konfispruch setzen (Listen-Wahl ODER
  // Freitext, genau EINE Quelle aktiv). Anders als bei Konfis wird die
  // konfi_profiles-Zeile per Upsert angelegt: direkt als Teamer:in angelegte
  // Accounts haben noch keine.
  router.patch('/profile', rbacVerifier, requireTeamer, async (req, res) => {
    if (req.user.role_name !== 'teamer') {
      return res.status(403).json({ error: 'Nur das Team kann seinen Konfispruch setzen' });
    }
    try {
      const userId = req.user.id;
      const orgId = req.user.organization_id;
      const { konfspruch_id, translation, konfspruch_freitext, konfspruch_freitext_referenz } = req.body;

      // Modus 1: Listen-Wahl
      if (konfspruch_id !== undefined && konfspruch_id !== null) {
        const spruchId = parseInt(konfspruch_id, 10);
        if (Number.isNaN(spruchId)) {
          return res.status(400).json({ error: 'Ungültige Spruch-ID' });
        }
        if (!KONFSPRUCH_TRANSLATIONS.includes(translation)) {
          return res.status(400).json({
            error: 'Ungültige Bibelübersetzung',
            valid_translations: KONFSPRUCH_TRANSLATIONS
          });
        }
        const { rows: [spruch] } = await db.query(
          `SELECT id FROM konfsprueche
           WHERE id = $1 AND is_active = true
             AND (organization_id IS NULL OR organization_id = $2)`,
          [spruchId, orgId]
        );
        if (!spruch) {
          return res.status(404).json({ error: 'Konfispruch nicht gefunden' });
        }
        await db.query(
          `INSERT INTO konfi_profiles (user_id, organization_id, konfspruch_id, konfspruch_translation)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id) DO UPDATE
           SET konfspruch_id = EXCLUDED.konfspruch_id,
               konfspruch_translation = EXCLUDED.konfspruch_translation,
               konfspruch_freitext = NULL, konfspruch_freitext_referenz = NULL`,
          [userId, orgId, spruchId, translation]
        );
        return res.json({
          success: true,
          konfspruch: { source: 'liste', id: spruchId, translation }
        });
      }

      // Modus 2: Freitext
      if (konfspruch_freitext !== undefined && konfspruch_freitext !== null) {
        const freitext = String(konfspruch_freitext).trim();
        const referenz = konfspruch_freitext_referenz != null
          ? String(konfspruch_freitext_referenz).trim()
          : '';
        if (!freitext) {
          return res.status(400).json({ error: 'Der Spruchtext darf nicht leer sein' });
        }
        if (!referenz) {
          return res.status(400).json({
            error: 'Bei einem eigenen Spruch ist die Stellenangabe (Referenz) verpflichtend'
          });
        }
        if (referenz.length > 100) {
          return res.status(400).json({ error: 'Die Stellenangabe darf höchstens 100 Zeichen lang sein' });
        }
        if (freitext.length > 1000) {
          return res.status(400).json({ error: 'Der Spruchtext ist zu lang' });
        }
        await db.query(
          `INSERT INTO konfi_profiles (user_id, organization_id, konfspruch_freitext, konfspruch_freitext_referenz)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id) DO UPDATE
           SET konfspruch_freitext = EXCLUDED.konfspruch_freitext,
               konfspruch_freitext_referenz = EXCLUDED.konfspruch_freitext_referenz,
               konfspruch_id = NULL`,
          [userId, orgId, freitext, referenz]
        );
        return res.json({
          success: true,
          konfspruch: { source: 'freitext', text: freitext, reference: referenz }
        });
      }

      return res.status(400).json({
        error: 'Bitte entweder einen Spruch aus der Liste (konfspruch_id + translation) oder einen eigenen Spruch (konfspruch_freitext + konfspruch_freitext_referenz) angeben'
      });
    } catch (err) {
      console.error('Database error in PATCH /teamer/profile:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ====================================================================
  // TAGESLOSUNG (eigener Endpoint für Teamer)
  // ====================================================================
  // Tageslosung: gemeinsame Logik in services/losungService.js
  // (beantworteTageslosung), geteilt mit der Konfi-Route. Einziger
  // Unterschied ist der Schluessel des Abschalters -- der Teamer-Schalter
  // aus den Dashboard-Einstellungen.
  // Antwortform unveraendert: ausgelieferte Apps lesen diese Route.
  router.get('/tageslosung', rbacVerifier, requireTeamer, async (req, res) => {
    return beantworteTageslosung(db, req, res, 'teamer_dashboard_show_losung');
  });

  // PUT /teamer/bible-translation — Bibeluebersetzung (Tageslosung) des Teamers setzen.
  router.put('/bible-translation', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const { translation } = req.body;
      if (!BIBEL_UEBERSETZUNGEN.includes(translation)) {
        return res.status(400).json({ error: 'Ungültige Bibelübersetzung', valid_translations: BIBEL_UEBERSETZUNGEN });
      }
      await db.query('UPDATE users SET bible_translation = $1 WHERE id = $2', [translation, req.user.id]);
      res.json({ success: true, message: 'Bibelübersetzung erfolgreich aktualisiert', translation });
    } catch (err) {
      console.error('Database error in PUT /teamer/bible-translation:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ====================================================================
  // AKTIVITAETEN & ANTRAEGE (Teamer)
  // target_role='teamer' Activities mit Antrags-Workflow analog Konfi
  // ====================================================================

  const validateCreateTeamerRequest = [
    body('activity_id').isInt({ min: 1 }).withMessage('Ungültige Aktivitäts-ID'),
    body('requested_date').notEmpty().isISO8601().withMessage('Gültiges Datum erforderlich'),
    body('client_id').optional().isUUID().withMessage('client_id muss eine UUID sein'),
    handleValidationErrors
  ];

  // GET /teamer/activities — nur target_role='teamer'
  router.get('/activities', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const query = `
        SELECT a.id, a.name, a.points, a.type,
               STRING_AGG(c.name, ', ') as category_names
        FROM activities a
        LEFT JOIN activity_categories ac ON a.id = ac.activity_id
        LEFT JOIN categories c ON ac.category_id = c.id
        WHERE a.organization_id = $1 AND a.target_role = 'teamer'
        GROUP BY a.id, a.name, a.points, a.type
        ORDER BY a.type, a.name
      `;
      const { rows: activities } = await db.query(query, [req.user.organization_id]);
      res.json(activities);
    } catch (err) {
      console.error('Database error in GET /teamer/activities:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // GET /teamer/requests — eigene Anträge (nur Teamer-Aktivitäten)
  router.get('/requests', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const userId = req.user.id;
      const query = `
        SELECT ar.*, a.name as activity_name, a.points as activity_points, a.type as activity_type,
               a.target_role as activity_target_role
        FROM activity_requests ar
        JOIN activities a ON ar.activity_id = a.id
        WHERE ar.user_id = $1
          AND ar.organization_id = $2
          AND a.target_role = 'teamer'
        ORDER BY ar.created_at DESC
      `;
      const { rows: requests } = await db.query(query, [userId, req.user.organization_id]);
      res.json(requests);
    } catch (err) {
      console.error('Database error in GET /teamer/requests:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // POST /teamer/requests — neuen Antrag stellen
  // ====================================================================
  // Zusage / Absage zu einem Termin ("Ich bin dabei" / "Ich bin nicht dabei")
  // ====================================================================
  router.post('/events/:id/zusage', rbacVerifier, requireTeamer,
    [param('id').isInt({ min: 1 }), handleValidationErrors],
    async (req, res) => {
      const eventId = parseInt(req.params.id, 10);
      const { dabei, reason } = req.body;

      if (typeof dabei !== 'boolean') {
        return res.status(400).json({ error: 'Bitte "dabei" als true oder false angeben' });
      }

      const client = await db.getClient();
      let ergebnis;
      try {
        await client.query('BEGIN');
        ergebnis = await setzeTeamerZusage(client, {
          eventId,
          userId: req.user.id,
          orgId: req.user.organization_id,
          dabei,
          grund: reason
        });

        if (!ergebnis.ok) {
          await client.query('ROLLBACK');
          // error_code (derzeit nur 'grund_erforderlich') ist ADDITIV: alte
          // Apps lesen nur error, neue erkennen daran den Pflicht-Grund.
          const antwort = { error: ergebnis.error };
          if (ergebnis.error_code) antwort.error_code = ergebnis.error_code;
          return res.status(ergebnis.status).json(antwort);
        }

        await client.query('COMMIT');
        res.json({
          status: ergebnis.status,
          message: dabei ? 'Zusage gespeichert' : 'Absage gespeichert'
        });

        // Chat-Mitgliedschaft dem Stand anpassen und die Leitung informieren.
        // NACH COMMIT und fehlertolerant: daran darf die Zusage nie scheitern.
        try {
          if (dabei) {
            await addToEventChat(db, eventId, req.user.id, req.user.organization_id);
          } else {
            await removeFromEventChat(db, eventId, req.user.id, req.user.organization_id);
          }
        } catch (chatErr) {
          console.error('Event-Chat nach Teamer-Zusage:', chatErr.message);
        }
        liveUpdate.sendToUserByRole(req.user.id, 'events', 'update', { eventId });
        liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'teamer_zusage' });

        try {
          if (dabei) {
            await PushService.sendTeamerEventBookingToAdmins(
              db, req.user.organization_id, req.user.display_name,
              ergebnis.event.name, ergebnis.status, eventId
            );
          } else {
            await PushService.sendTeamerEventCancellationToAdmins(
              db, req.user.organization_id, req.user.display_name,
              ergebnis.event.name, eventId,
              typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null
            );
          }
        } catch (pushErr) {
          console.error('Push nach Teamer-Zusage/-Absage:', pushErr);
        }

        // Ist nach einer Absage jemand von der Team-Warteliste nachgerueckt,
        // erfaehrt er das per Push — wie beim Storno-Weg.
        if (ergebnis.promotedUserId) {
          try {
            await PushService.sendWaitlistPromotionToTeamer(
              db, ergebnis.promotedUserId, ergebnis.event.name, null, eventId, req.user.organization_id
            );
          } catch (pushErr) {
            console.error('Push an nachgerueckte Teamer:in:', pushErr);
          }
        }
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* Connection evtl. tot */ }
        console.error('Database error in POST /teamer/events/:id/zusage:', eventId, err);
        res.status(500).json({ error: 'Datenbankfehler' });
      } finally {
        client.release();
      }
    });

  router.post('/requests', rbacVerifier, requireTeamer, validateCreateTeamerRequest, async (req, res) => {
    try {
      const userId = req.user.id;
      const { activity_id, description, photo_filename, requested_date, client_id } = req.body;

      // Idempotency (Vorab-Check; den Race-Fall faengt der 23505-Catch unten ab)
      const vorhanderAntrag = await findeAntragZuClientId(db, client_id);
      if (vorhanderAntrag) return res.status(200).json(vorhanderAntrag);

      // heuteBerlin() statt toISOString(): Letzteres liefert IMMER den UTC-Tag.
      // Zwischen 00:00 und 02:00 Berliner Zeit trug ein Antrag ohne Datum sonst
      // den Vortag -- und landete damit im falschen Tag der Punktehistorie.
      const date = requested_date || heuteBerlin();

      // Activity muss existieren und target_role='teamer' sein
      const { rows: [activity] } = await db.query(
        "SELECT name, points FROM activities WHERE id = $1 AND organization_id = $2 AND target_role = 'teamer'",
        [activity_id, req.user.organization_id]
      );
      if (!activity) {
        return res.status(404).json({ error: 'Aktivität nicht gefunden' });
      }

      const { rows: [newRequest] } = await db.query(
        `INSERT INTO activity_requests (user_id, activity_id, requested_date, comment, photo_filename, status, organization_id, client_id)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
         RETURNING id`,
        [userId, activity_id, date, description, photo_filename, req.user.organization_id, client_id || null]
      );

      // Notification an Teamer
      try {
        await db.query(
          "INSERT INTO notifications (user_id, title, message, type, data, organization_id) VALUES ($1, $2, $3, $4, $5, $6)",
          [
            userId,
            'Antrag eingereicht',
            `Dein Antrag für "${activity.name}" wurde eingereicht und wird geprüft.`,
            'activity_request_submitted',
            JSON.stringify({ request_id: newRequest.id, activity_name: activity.name, points: activity.points }),
            req.user.organization_id
          ]
        );
      } catch (notifErr) {
        console.error('Notification error (teamer request):', notifErr);
      }

      res.status(201).json({ id: newRequest.id, message: 'Antrag eingereicht' });

      (async () => {
        try {
          const { rows: admins } = await db.query(
            `SELECT u.id FROM users u
             JOIN roles r ON u.role_id = r.id
             WHERE r.name IN ('admin', 'org_admin') AND u.organization_id = $1`,
            [req.user.organization_id]
          );

          if (admins.length > 0) {
            await db.query(
              `INSERT INTO notifications (user_id, title, message, type, data, organization_id)
               SELECT unnest($1::int[]), $2, $3, $4, $5, $6`,
              [
                admins.map(a => a.id),
                'Neuer Antrag eingegangen',
                `${req.user.display_name} hat einen Antrag für "${activity.name}" (${activity.points} ${activity.points === 1 ? 'Punkt' : 'Punkte'}) eingereicht.`,
                'new_activity_request',
                JSON.stringify({
                  request_id: newRequest.id,
                  konfi_id: userId,
                  konfi_name: req.user.display_name,
                  activity_name: activity.name,
                  points: activity.points
                }),
                req.user.organization_id
              ]
            );
          }

          await PushService.sendNewActivityRequestToAdmins(
            db,
            req.user.organization_id,
            req.user.display_name,
            activity.name,
            activity.points
          );
        } catch (notifErr) {
          console.error('Error sending admin notifications (teamer request):', notifErr);
        }
      })();

      // Live-Update an alle Admins/Org-Admins/Teamer:innen der Org (neuer Antrag)
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'requests', 'create');
    } catch (err) {
      if (await behandleClientIdRace(db, err, req.body.client_id, res)) return;
      console.error('Database error in POST /teamer/requests:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // DELETE /teamer/requests/:id — eigenen Antrag löschen
  router.delete('/requests/:id', rbacVerifier, requireTeamer, [param('id').isInt({ min: 1 }), handleValidationErrors], async (req, res) => {
    try {
      const userId = req.user.id;
      const requestId = req.params.id;

      // Nur pending eigene Anträge darf der Teamer selbst löschen
      const { rows: [existing] } = await db.query(
        "SELECT id, status, photo_filename FROM activity_requests WHERE id = $1 AND user_id = $2 AND organization_id = $3",
        [requestId, userId, req.user.organization_id]
      );
      if (!existing) return res.status(404).json({ error: 'Antrag nicht gefunden' });
      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'Nur ausstehende Anträge können gelöscht werden' });
      }

      await db.query('DELETE FROM activity_requests WHERE id = $1', [requestId]);

      if (existing.photo_filename) {
        await deletePhotoFile(existing.photo_filename);
      }

      res.json({ message: 'Antrag gelöscht' });

      // Live-Update an alle Admins/Org-Admins/Teamer:innen der Org (Antrag entfernt)
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'requests', 'delete');
    } catch (err) {
      console.error('Database error in DELETE /teamer/requests/:id:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  return router;
};
