const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { fetchTageslosung } = require('../services/losungService');
const { computeCurrentStreak } = require('../utils/streakCalculation');
const PushService = require('../services/pushService');
const liveUpdate = require('../utils/liveUpdate');

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
      return res.status(403).json({ error: 'Nur Teamer können dieses Profil abrufen' });
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

      // Beförderter Teamer = hat ueberhaupt ein konfi_profiles (Konfi-Vergangenheit).
      // NICHT am jahrgang_name festmachen: wird der alte Jahrgang geloescht, ist
      // jahrgang_id=NULL -> jahrgang_name=NULL, aber die WERTE (Punkte/Badges)
      // bleiben und muessen weiter sichtbar sein. Reine Teamer ohne Konfi-
      // Vergangenheit haben kein konfi_profiles -> konfi_data=null.
      const isPromotedKonfi = !!konfiProfile;
      let badges = [];
      if (isPromotedKonfi) {
        const badgesQuery = `
          SELECT kb.badge_id, b.name, b.description, b.icon, b.color,
                 b.criteria_type, b.criteria_value,
                 kb.awarded_date
          FROM user_badges kb
          JOIN custom_badges b ON kb.badge_id = b.id
          WHERE kb.user_id = $1
          ORDER BY kb.awarded_date DESC
        `;
        const result = await db.query(badgesQuery, [userId]);
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

      // Für org_admin/admin: alle Konfis der Organisation
      // Für teamer: nur Konfis der zugewiesenen Jahrgänge
      let jahrgangFilter = '';
      let params = [orgId];
      let placeholderIndex = 2;

      if (req.user.role_name === 'teamer') {
        const viewableJahrgaenge = req.user.assigned_jahrgaenge
          .filter(j => j.can_view)
          .map(j => j.id);

        if (viewableJahrgaenge.length === 0) {
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
  router.get('/konfi-history', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      if (req.user.role_name !== 'teamer') {
        return res.status(403).json({ error: 'Nur Teamer können die Konfi-Historie abrufen' });
      }

      const userId = req.user.id;
      const orgId = req.user.organization_id;

      // Get activities (Gottesdienst & Gemeinde points)
      const activitiesQuery = `
        SELECT
          ka.id,
          a.name as title,
          a.points,
          a.type as category,
          ka.completed_date as date,
          ka.comment,
          'activity' as source_type
        FROM user_activities ka
        JOIN activities a ON ka.activity_id = a.id
        WHERE ka.user_id = $1 AND ka.organization_id = $2
        ORDER BY ka.completed_date DESC
      `;
      const { rows: activities } = await db.query(activitiesQuery, [userId, orgId]);

      // Get bonus points
      const bonusQuery = `
        SELECT
          id,
          description as title,
          points,
          type as category,
          completed_date as date,
          NULL as comment,
          'bonus' as source_type
        FROM bonus_points
        WHERE konfi_id = $1 AND organization_id = $2
        ORDER BY completed_date DESC
      `;
      const { rows: bonusPoints } = await db.query(bonusQuery, [userId, orgId]);

      // Get event points
      const eventPointsQuery = `
        SELECT
          ep.id,
          e.name as title,
          ep.points,
          ep.point_type as category,
          ep.awarded_date as date,
          ep.description as comment,
          'event' as source_type
        FROM event_points ep
        JOIN events e ON ep.event_id = e.id
        WHERE ep.konfi_id = $1 AND ep.organization_id = $2
        ORDER BY ep.awarded_date DESC
      `;
      const { rows: eventPoints } = await db.query(eventPointsQuery, [userId, orgId]);

      // Combine and sort by date (newest first)
      const allPoints = [...activities, ...bonusPoints, ...eventPoints].sort((a, b) => {
        const dateA = new Date(a.date || 0);
        const dateB = new Date(b.date || 0);
        return dateB - dateA;
      });

      // Get konfi_profiles for accurate accumulated points
      const { rows: [konfiProfile] } = await db.query(
        'SELECT gottesdienst_points, gemeinde_points FROM konfi_profiles WHERE user_id = $1',
        [userId]
      );

      const totals = {
        gottesdienst: konfiProfile?.gottesdienst_points || 0,
        gemeinde: konfiProfile?.gemeinde_points || 0,
        total: (konfiProfile?.gottesdienst_points || 0) + (konfiProfile?.gemeinde_points || 0)
      };

      res.json({
        history: allPoints,
        totals
      });

    } catch (err) {
      console.error('Database error in GET /teamer/konfi-history:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ====================================================================
  // TEAMER-BADGES
  // ====================================================================

  // GET /teamer/badges - Alle verfügbaren Teamer-Badges mit earned-Status und Fortschritt
  router.get('/badges', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      if (req.user.role_name !== 'teamer') {
        return res.status(403).json({ error: 'Nur Teamer können Teamer-Badges abrufen' });
      }

      const userId = req.user.id;
      const orgId = req.user.organization_id;

      const badgesQuery = `
        SELECT cb.*,
          CASE WHEN ub.id IS NOT NULL THEN true ELSE false END as earned,
          ub.awarded_date
        FROM custom_badges cb
        LEFT JOIN user_badges ub ON cb.id = ub.badge_id AND ub.user_id = $1
        WHERE cb.organization_id = $2 AND cb.target_role = 'teamer' AND (cb.is_active = true OR ub.id IS NOT NULL)
        ORDER BY ub.awarded_date DESC NULLS LAST, cb.name
      `;
      const { rows: badges } = await db.query(badgesQuery, [userId, orgId]);

      // Hauptmetriken einmalig abfragen für Fortschrittsberechnung
      const [actCountRes, evCountRes, uniqueActRes, activeYearsRes, teamerSinceRes, categoryCountsRes, actNamesRes, eventTitlesRes, allDatesRes] = await Promise.all([
        // Teamer-Aktivitäten + Events
        db.query(
          `SELECT (
            (SELECT COUNT(*) FROM user_activities ua
             JOIN activities a ON ua.activity_id = a.id
             WHERE ua.user_id = $1 AND ua.organization_id = $2 AND a.target_role = 'teamer') +
            (SELECT COUNT(*) FROM event_bookings WHERE user_id = $1 AND attendance_status = 'present' AND organization_id = $2)
          ) as count`,
          [userId, orgId]
        ),
        // Nur Events
        db.query(
          "SELECT COUNT(*) as count FROM event_bookings WHERE user_id = $1 AND attendance_status = 'present' AND organization_id = $2",
          [userId, orgId]
        ),
        // Unique Activities
        db.query(
          `SELECT COUNT(DISTINCT ua.activity_id) as count FROM user_activities ua
           JOIN activities a ON ua.activity_id = a.id
           WHERE ua.user_id = $1 AND ua.organization_id = $2 AND a.target_role = 'teamer'`,
          [userId, orgId]
        ),
        // Aktive Jahre (Jahre mit mind. 1 Teamer-Aktivität oder Event)
        db.query(
          `SELECT DISTINCT EXTRACT(YEAR FROM d.date)::int as year FROM (
            SELECT ua.completed_date as date FROM user_activities ua
            JOIN activities a ON ua.activity_id = a.id
            WHERE ua.user_id = $1 AND ua.organization_id = $2 AND a.target_role = 'teamer'
            UNION ALL
            SELECT e.event_date as date FROM event_bookings eb
            JOIN events e ON eb.event_id = e.id
            WHERE eb.user_id = $1 AND eb.attendance_status = 'present' AND eb.organization_id = $2
          ) d WHERE d.date IS NOT NULL`,
          [userId, orgId]
        ),
        // Startjahr-Quelle (teamer_since, Migration 064) — konsistent zur Wertung (badges.js teamer_year)
        db.query(
          "SELECT teamer_since FROM users WHERE id = $1",
          [userId]
        ),
        // Pro Kategorie: Anzahl Teamer-Aktivitaeten + anwesende Events (fuer
        // category_activities-Progress). Identische Logik wie die Wertung in
        // badges.js (checkAndAwardTeamerBadges, case 'category_activities').
        db.query(
          `SELECT c.name AS category, COUNT(*) AS count FROM (
            SELECT ac.category_id, ua.id FROM user_activities ua
            JOIN activities a ON ua.activity_id = a.id
            JOIN activity_categories ac ON a.id = ac.activity_id
            WHERE ua.user_id = $1 AND a.organization_id = $2 AND a.target_role = 'teamer'
            UNION ALL
            SELECT ec.category_id, eb.id FROM event_bookings eb
            JOIN event_categories ec ON eb.event_id = ec.event_id
            WHERE eb.user_id = $1 AND eb.attendance_status = 'present' AND eb.organization_id = $2
          ) src
          JOIN categories c ON src.category_id = c.id AND c.organization_id = $2
          GROUP BY c.name`,
          [userId, orgId]
        ),
        // Teamer-Aktivitaets-Namen + Anzahl (fuer specific_activity / activity_combination).
        db.query(
          `SELECT a.name, COUNT(*) AS count FROM user_activities ua
           JOIN activities a ON ua.activity_id = a.id
           WHERE ua.user_id = $1 AND a.organization_id = $2 AND a.target_role = 'teamer'
           GROUP BY a.name`,
          [userId, orgId]
        ),
        // Besuchte Event-Namen (fuer activity_combination required_events).
        // events-Spalte heisst 'name' (nicht 'title') -> als title aliasen.
        db.query(
          `SELECT DISTINCT e.name AS title FROM event_bookings eb
           JOIN events e ON eb.event_id = e.id
           WHERE eb.user_id = $1 AND eb.attendance_status = 'present' AND eb.organization_id = $2`,
          [userId, orgId]
        ),
        // Alle Aktivitaets-/Event-Daten (fuer streak / time_based).
        db.query(
          `SELECT ua.completed_date AS date FROM user_activities ua
           JOIN activities a ON ua.activity_id = a.id
           WHERE ua.user_id = $1 AND ua.organization_id = $2 AND a.target_role = 'teamer'
           UNION ALL
           SELECT e.event_date AS date FROM event_bookings eb
           JOIN events e ON eb.event_id = e.id
           WHERE eb.user_id = $1 AND eb.attendance_status = 'present' AND eb.organization_id = $2`,
          [userId, orgId]
        )
      ]);

      const activityCount = parseInt(actCountRes.rows[0].count);
      const eventCount = parseInt(evCountRes.rows[0].count);
      const uniqueActivities = parseInt(uniqueActRes.rows[0].count);
      // Map Kategorie-Name -> Anzahl (fuer category_activities-Progress).
      const categoryCounts = {};
      for (const row of categoryCountsRes.rows) {
        categoryCounts[row.category] = parseInt(row.count);
      }
      // Map Aktivitaets-Name -> Anzahl (specific_activity / activity_combination).
      const activityNameCounts = {};
      for (const row of actNamesRes.rows) {
        activityNameCounts[row.name] = parseInt(row.count);
      }
      const completedActivityNames = actNamesRes.rows.map(r => r.name);
      const attendedEventTitles = eventTitlesRes.rows.map(r => r.title);
      // Datums-Liste (Strings/Dates) fuer streak / time_based.
      const allDates = allDatesRes.rows.map(r => r.date).filter(Boolean);
      // Array der aktiven Jahre (INTEGER) — fuer Startjahr-Filter im teamer_year-Case.
      const activeYearValues = activeYearsRes.rows.map(r => r.year);

      // Startjahr fuer teamer_year (konsistent zur Wertung badges.js):
      // 1. users.teamer_since; 2. Fallback aelteste aktive Jahr (entspricht aelteste Teamer-Aktivitaet).
      let teamerStartYear = null;
      const teamerSince = teamerSinceRes.rows[0]?.teamer_since;
      if (teamerSince) {
        teamerStartYear = new Date(teamerSince).getFullYear();
      } else if (activeYearValues.length > 0) {
        teamerStartYear = Math.min(...activeYearValues);
      }

      // Punkte-basierte Kriterien (irrelevant für Teamer)
      const pointsCriteria = ['total_points', 'gottesdienst_points', 'gemeinde_points', 'both_categories', 'bonus_points'];

      // Fortschritt für jede Badge berechnen
      const enrichedBadges = badges.map(badge => {
        if (badge.earned) {
          return { ...badge, progress_points: badge.criteria_value, progress_percentage: 100 };
        }

        let progressPoints = 0;
        const criteriaValue = badge.criteria_value || 1;

        if (pointsCriteria.includes(badge.criteria_type)) {
          progressPoints = 0;
        } else {
          switch (badge.criteria_type) {
            case 'activity_count':
              progressPoints = activityCount;
              break;
            case 'event_count':
              progressPoints = eventCount;
              break;
            case 'unique_activities':
              progressPoints = uniqueActivities;
              break;
            case 'teamer_year':
              // Nur Jahre ab Startjahr (teamer_since) zaehlen — identisch zur Wertung (kein Mismatch).
              progressPoints = teamerStartYear === null
                ? 0
                : activeYearValues.filter(y => y >= teamerStartYear).length;
              break;
            case 'category_activities': {
              // Echter Progress: Anzahl Teamer-Aktivitaeten + anwesende Events der
              // geforderten Kategorie (deckungsgleich mit der Wertung in badges.js).
              const extra = typeof badge.criteria_extra === 'object' && badge.criteria_extra !== null
                ? badge.criteria_extra
                : JSON.parse(badge.criteria_extra || '{}');
              progressPoints = extra.required_category
                ? (categoryCounts[extra.required_category] || 0)
                : 0;
              break;
            }
            case 'specific_activity': {
              // Anzahl der geforderten Teamer-Aktivitaet (Name), wie Wertung badges.js:476.
              const extra = typeof badge.criteria_extra === 'object' && badge.criteria_extra !== null
                ? badge.criteria_extra : JSON.parse(badge.criteria_extra || '{}');
              progressPoints = extra.required_activity_name
                ? (activityNameCounts[extra.required_activity_name] || 0)
                : 0;
              break;
            }
            case 'activity_combination': {
              // Anzahl erfuellter Teilbedingungen (Aktivitaeten + Events), wie Wertung
              // badges.js:391. Ziel ist die Gesamtanzahl der geforderten Eintraege.
              const extra = typeof badge.criteria_extra === 'object' && badge.criteria_extra !== null
                ? badge.criteria_extra : JSON.parse(badge.criteria_extra || '{}');
              const reqActs = extra.required_activities || [];
              const reqEvents = extra.required_events || [];
              const actMatch = reqActs.filter(n => completedActivityNames.includes(n)).length;
              const evMatch = reqEvents.filter(t => attendedEventTitles.includes(t)).length;
              progressPoints = actMatch + evMatch;
              break;
            }
            case 'streak':
              // Aktueller Wochen-Streak (gleiche Util wie Wertung badges.js checkStreakCriteria).
              progressPoints = computeCurrentStreak(allDates);
              break;
            case 'time_based': {
              // Anzahl Aktivitaeten/Events im Zeitfenster, wie Wertung badges.js:522.
              const extra = typeof badge.criteria_extra === 'object' && badge.criteria_extra !== null
                ? badge.criteria_extra : JSON.parse(badge.criteria_extra || '{}');
              const days = extra.days || (extra.weeks ? extra.weeks * 7 : null);
              if (days) {
                const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
                progressPoints = allDates.filter(d => new Date(d).getTime() >= cutoff).length;
              } else {
                progressPoints = 0;
              }
              break;
            }
            case 'collection':
            case 'yearly':
              // Noch nicht in der Wertung implementiert -> 0.
              progressPoints = 0;
              break;
            default:
              progressPoints = 0;
          }
        }

        const progressPercentage = Math.min(100, Math.round((progressPoints / criteriaValue) * 100));
        return { ...badge, progress_points: progressPoints, progress_percentage: progressPercentage };
      });

      res.json(enrichedBadges);
    } catch (err) {
      console.error('Error loading teamer badges:', err);
      res.status(500).json({ error: 'Fehler beim Laden der Teamer-Badges' });
    }
  });

  // GET /teamer/badges/unseen - Anzahl ungesehener Badges
  router.get('/badges/unseen', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      if (req.user.role_name !== 'teamer') {
        return res.status(403).json({ error: 'Nur Teamer können Badge-Status abrufen' });
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
  router.put('/badges/mark-seen', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      if (req.user.role_name !== 'teamer') {
        return res.status(403).json({ error: 'Nur Teamer können Badges als gesehen markieren' });
      }

      await db.query(
        "UPDATE user_badges SET seen = true WHERE user_id = $1 AND organization_id = $2 AND seen = false",
        [req.user.id, req.user.organization_id]
      );
      res.json({ message: 'Badges als gesehen markiert' });
    } catch (err) {
      console.error('Error marking badges as seen:', err);
      res.status(500).json({ error: 'Fehler beim Aktualisieren des Badge-Status' });
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

  // POST /teamer/certificate-types - Neuen Typ erstellen
  router.post('/certificate-types', rbacVerifier, requireOrgAdmin, validateCreateCertificateType, async (req, res) => {
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
  router.put('/certificate-types/:id', rbacVerifier, requireOrgAdmin, validateUpdateCertificateType, async (req, res) => {
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
  router.delete('/certificate-types/:id', rbacVerifier, requireOrgAdmin, async (req, res) => {
    try {
      // Prüfen ob Zertifikate zugewiesen sind
      const { rows: [usage] } = await db.query(
        'SELECT COUNT(*) as count FROM user_certificates WHERE certificate_type_id = $1',
        [req.params.id]
      );

      if (parseInt(usage.count) > 0) {
        return res.status(409).json({
          error: 'Zertifikat-Typ kann nicht gelöscht werden: bereits an Teamer:innen vergeben.'
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
  router.post('/:userId/certificates', rbacVerifier, requireOrgAdmin, validateCertificate, async (req, res) => {
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
        await PushService.sendToUser(db, req.params.userId, {
          title: 'Neues Zertifikat',
          body: `Du hast das Zertifikat "${certType.name}" erhalten.`,
          data: { type: 'certificate' }
        });
      } catch (pushErr) {
        console.error('Error sending certificate push:', pushErr);
      }
      // Zertifikate haengen an den Teamer-Badge-/Dashboard-Ansichten -> 'badges'.
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
  router.delete('/:userId/certificates/:certId', rbacVerifier, requireOrgAdmin, async (req, res) => {
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
        return res.status(403).json({ error: 'Nur Teamer können das Dashboard abrufen' });
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

      // 3. Events: Naechste 3 anstehende Events (Teamer-Events + Teamer-gesucht)
      const eventsQuery = `
        SELECT e.id, e.name AS title, e.event_date, e.event_end_time, e.location, e.type,
               e.teamer_only, e.teamer_needed, e.bring_items, e.cancelled,
               CASE WHEN eb.id IS NOT NULL THEN true ELSE false END as is_registered,
               eb.status as booking_status
        FROM events e
        LEFT JOIN event_bookings eb ON e.id = eb.event_id AND eb.user_id = $1
        WHERE e.organization_id = $2
          AND e.event_date >= CURRENT_DATE
          AND (e.cancelled IS NOT TRUE)
          AND eb.id IS NOT NULL
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
      config.section_order = teamerSectionOrder || ['zertifikate', 'events', 'badges', 'losung'];

      // Wrapped-Verfuegbarkeit pruefen (Teamer: direkt auf wrapped_snapshots)
      const { rows: [wrappedResult] } = await db.query(
        `SELECT EXISTS(
          SELECT 1 FROM wrapped_snapshots
          WHERE user_id = $1 AND wrapped_type = 'teamer'
        ) as has_wrapped`,
        [userId]
      );
      const has_wrapped = wrappedResult?.has_wrapped || false;

      res.json({ greeting, certificates, events, badges, config, has_wrapped });
    } catch (err) {
      console.error('Error loading teamer dashboard:', err);
      res.status(500).json({ error: 'Fehler beim Laden des Teamer-Dashboards' });
    }
  });

  // ====================================================================
  // TAGESLOSUNG (eigener Endpoint für Teamer)
  // ====================================================================
  router.get('/tageslosung', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      // Bevorzugte Uebersetzung des Teamers (users.bible_translation, Default LUT).
      const { rows: [u] } = await db.query('SELECT bible_translation FROM users WHERE id = $1', [req.user.id]);
      const translation = u?.bible_translation || 'LUT';
      const result = await fetchTageslosung(db, translation);
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('Tageslosung error:', err.message);
      res.status(500).json({ success: false, error: 'Tageslosung konnte nicht geladen werden' });
    }
  });

  // PUT /teamer/bible-translation — Bibeluebersetzung (Tageslosung) des Teamers setzen.
  router.put('/bible-translation', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const { translation } = req.body;
      const validTranslations = ['LUT', 'ELB', 'GNB', 'BIGS', 'NIV', 'LSG', 'RVR60'];
      if (!validTranslations.includes(translation)) {
        return res.status(400).json({ error: 'Ungültige Bibelübersetzung', valid_translations: validTranslations });
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

  // GET /teamer/requests — eigene Antraege (nur Teamer-Aktivitaeten)
  router.get('/requests', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const userId = req.user.id;
      const query = `
        SELECT ar.*, a.name as activity_name, a.points as activity_points, a.type as activity_type
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
  router.post('/requests', rbacVerifier, requireTeamer, validateCreateTeamerRequest, async (req, res) => {
    try {
      const userId = req.user.id;
      const { activity_id, description, photo_filename, requested_date, client_id } = req.body;

      // Idempotency
      if (client_id) {
        const { rows: [existing] } = await db.query(
          'SELECT id, user_id, activity_id, requested_date, comment, photo_filename, status, organization_id, client_id, created_at, updated_at FROM activity_requests WHERE client_id = $1',
          [client_id]
        );
        if (existing) return res.status(200).json(existing);
      }

      const date = requested_date || new Date().toISOString().split('T')[0];

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

      // Push an alle Admins/Org-Admins der Organisation (analog konfi.js:776).
      // In try/catch — ein Push-Fehler darf den Antrag nicht kippen.
      try {
        await PushService.sendNewActivityRequestToAdmins(
          db,
          req.user.organization_id,
          req.user.display_name,
          activity.name,
          activity.points
        );
      } catch (pushErr) {
        console.error('Error sending admin push (teamer request):', pushErr);
      }

      res.status(201).json({ id: newRequest.id, message: 'Antrag eingereicht' });

      // Live-Update an alle Admins/Org-Admins/Teamer:innen der Org (neuer Antrag)
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'requests', 'create');
    } catch (err) {
      console.error('Database error in POST /teamer/requests:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // DELETE /teamer/requests/:id — eigenen Antrag loeschen
  router.delete('/requests/:id', rbacVerifier, requireTeamer, [param('id').isInt({ min: 1 }), handleValidationErrors], async (req, res) => {
    try {
      const userId = req.user.id;
      const requestId = req.params.id;

      // Nur pending eigene Antraege darf der Teamer selbst loeschen
      const { rows: [existing] } = await db.query(
        "SELECT id, status FROM activity_requests WHERE id = $1 AND user_id = $2 AND organization_id = $3",
        [requestId, userId, req.user.organization_id]
      );
      if (!existing) return res.status(404).json({ error: 'Antrag nicht gefunden' });
      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'Nur ausstehende Anträge können gelöscht werden' });
      }

      await db.query('DELETE FROM activity_requests WHERE id = $1', [requestId]);
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
