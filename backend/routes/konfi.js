const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const PushService = require('../services/pushService');
const liveUpdate = require('../utils/liveUpdate');
const { fetchTageslosung } = require('../services/losungService');
const { validateMagicBytes } = require('../middleware/uploadValidation');
const { checkExistingBooking, getEventWithCounts, validateRegistrationWindow, determineBookingStatus, promoteFromWaitlist } = require('../utils/bookingUtils');
const { computeCurrentStreak } = require('../utils/streakCalculation');
// Single Source of Truth: welche Events zaehlen fuer Konfi-Badges (kein Pflicht/Konfirmation).
const { KONFI_BADGE_EVENT_CONDITION } = require('../utils/badgeEventRule');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// Konfi-specific routes
module.exports = (db, rbacMiddleware, requestUpload) => {
  const { verifyTokenRBAC } = rbacMiddleware;

  // Validierungsregeln
  const validateCreateRequest = [
    body('activity_id').isInt({ min: 1 }).withMessage('Ungültige Aktivitäts-ID'),
    body('requested_date').notEmpty().isISO8601().withMessage('Gültiges Datum erforderlich'),
    body('client_id').optional().isUUID().withMessage('client_id muss eine UUID sein'),
    handleValidationErrors
  ];

  const validateBibleTranslation = [
    body('translation').trim().notEmpty().withMessage('Bibelübersetzung ist erforderlich'),
    handleValidationErrors
  ];

  // Get konfi dashboard data
  router.get('/dashboard', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }
    
    try {
      const konfiId = req.user.id;
      
      // Get konfi basic info with level information and confirmation location
      const konfiQuery = `
        SELECT u.id, u.display_name, kp.gottesdienst_points, kp.gemeinde_points,
               kp.jahrgang_id, j.name as jahrgang_name, j.konfspruch_enabled,
               j.gottesdienst_enabled, j.gemeinde_enabled, j.target_gottesdienst, j.target_gemeinde,
               kp.current_level_id, l.name as current_level_name, l.title as current_level_title,
               l.icon as current_level_icon, l.color as current_level_color, l.points_required as current_level_points,
               ce.location as confirmation_location, ce.event_date as confirmation_event_date
        FROM users u
        JOIN konfi_profiles kp ON u.id = kp.user_id
        JOIN jahrgaenge j ON kp.jahrgang_id = j.id
        JOIN roles r ON u.role_id = r.id
        LEFT JOIN levels l ON kp.current_level_id = l.id
        LEFT JOIN (
          -- Konfirmationstermin/-ort PRO KONFI: das is_konfirmation-Event, zu dem der
          -- Konfi mit status='confirmed' gebucht ist (es kann mehrere Konfirmations-
          -- Termine je Jahrgang geben; jeder Konfi bucht genau einen). Keine Buchung
          -- -> kein Termin (NULL).
          SELECT eb.user_id, e.location, e.event_date
          FROM event_bookings eb
          JOIN events e ON e.id = eb.event_id
          WHERE eb.status = 'confirmed'
            AND e.is_konfirmation = true
            AND e.organization_id = $2
            AND (e.cancelled IS NULL OR e.cancelled = false)
        ) ce ON ce.user_id = u.id
        WHERE u.id = $1 AND r.name = 'konfi' AND u.deleted_at IS NULL
      `;
      const { rows: [konfi] } = await db.query(konfiQuery, [konfiId, req.user.organization_id]);

      if (!konfi) {
        return res.status(404).json({ error: 'Konfi nicht gefunden' });
      }

      // Check if badges table exists and get badges for this konfi
      let badges = [];
      let badgeCount = 0;
      const checkBadgesTableQuery = "SELECT to_regclass('public.custom_badges')";
      const { rows: [tableExistsResult] } = await db.query(checkBadgesTableQuery);

      if (tableExistsResult && tableExistsResult.to_regclass) {
        // Get total badge count for this organization
        const { rows: [badgeCountResult] } = await db.query(
          'SELECT COUNT(*) as count FROM user_badges kb JOIN users u ON kb.user_id = u.id WHERE kb.user_id = $1 AND kb.organization_id = $2',
          [konfiId, req.user.organization_id]
        );
        badgeCount = parseInt(badgeCountResult.count, 10) || 0;

        // Get recent badges for display
        const badgesQuery = `
          SELECT cb.id, cb.name, cb.description, cb.icon, cb.criteria_type, cb.criteria_value,
                 kb.awarded_date AS earned_at
          FROM custom_badges cb
          LEFT JOIN user_badges kb ON cb.id = kb.badge_id AND kb.user_id = $1 AND kb.organization_id = $2
          WHERE kb.awarded_date IS NOT NULL AND cb.organization_id = $2
          ORDER BY kb.awarded_date DESC
          LIMIT 3
        `;
        const { rows: badgeResults } = await db.query(badgesQuery, [konfiId, req.user.organization_id]);
        badges = badgeResults;
      }

      // Get ranking for jahrgang (nur aktive Punkte-Typen)
      const rankingQuery = `
        SELECT u.id, u.display_name,
               (CASE WHEN j.gottesdienst_enabled THEN kp.gottesdienst_points ELSE 0 END
               + CASE WHEN j.gemeinde_enabled THEN kp.gemeinde_points ELSE 0 END) as points
        FROM users u
        JOIN konfi_profiles kp ON u.id = kp.user_id
        JOIN roles r ON u.role_id = r.id
        JOIN jahrgaenge j ON kp.jahrgang_id = j.id
        WHERE kp.jahrgang_id = $1 AND r.name = 'konfi' AND u.deleted_at IS NULL
        ORDER BY points DESC
        LIMIT 3
      `;
      const { rows: ranking } = await db.query(rankingQuery, [konfi.jahrgang_id]);

      // Add initials to ranking
      const rankingWithInitials = ranking.map(r => ({
        ...r,
        initials: r.display_name ? r.display_name.split(' ').map(word => word.charAt(0)).join('').toUpperCase().substring(0, 2) : '??'
      }));

      // Get bonus points total for this konfi
      const { rows: [bonusPointsResult] } = await db.query(
        'SELECT COALESCE(SUM(points), 0) as bonus_total FROM bonus_points WHERE konfi_id = $1 AND organization_id = $2',
        [konfiId, req.user.organization_id]
      );
      const bonusPointsTotal = parseInt(bonusPointsResult.bonus_total, 10) || 0;

      // Total points: nur aktive Punkte-Typen summieren
      // Bonus ist bereits in konfi_profiles enthalten, daher NICHT nochmal addieren
      const totalPoints = (konfi.gottesdienst_enabled ? (konfi.gottesdienst_points || 0) : 0)
                        + (konfi.gemeinde_enabled ? (konfi.gemeinde_points || 0) : 0);
      const userRankingQuery = `
        WITH MyRank AS (
          SELECT
            (CASE WHEN j.gottesdienst_enabled THEN kp.gottesdienst_points ELSE 0 END
            + CASE WHEN j.gemeinde_enabled THEN kp.gemeinde_points ELSE 0 END) as total_points,
            RANK() OVER (PARTITION BY kp.jahrgang_id ORDER BY
              (CASE WHEN j.gottesdienst_enabled THEN kp.gottesdienst_points ELSE 0 END
              + CASE WHEN j.gemeinde_enabled THEN kp.gemeinde_points ELSE 0 END) DESC) as rank_in_jahrgang
          FROM users u
          JOIN konfi_profiles kp ON u.id = kp.user_id
          JOIN roles r ON u.role_id = r.id
          JOIN jahrgaenge j ON kp.jahrgang_id = j.id
          WHERE kp.jahrgang_id = $1 AND r.name = 'konfi' AND u.deleted_at IS NULL
        ), TotalCount AS (
           SELECT COUNT(*) as total_in_jahrgang
           FROM users u2
           JOIN konfi_profiles kp2 ON u2.id = kp2.user_id
           JOIN roles r2 ON u2.role_id = r2.id
           WHERE kp2.jahrgang_id = $1 AND r2.name = 'konfi' AND u2.deleted_at IS NULL
        )
        SELECT r.rank_in_jahrgang, tc.total_in_jahrgang
        FROM MyRank r, TotalCount tc
        WHERE r.total_points = $2
        LIMIT 1;
      `;
      const { rows: [userRanking] } = await db.query(userRankingQuery, [konfi.jahrgang_id, totalPoints]);

      // Get registered events count
      const { rows: [eventCountResult] } = await db.query(
        'SELECT COUNT(*) as count FROM event_bookings WHERE user_id = $1 AND organization_id = $2',
        [konfiId, req.user.organization_id]
      );
      const eventCount = parseInt(eventCountResult.count, 10) || 0;

      // Get recent registered events
      const eventsQuery = `
        SELECT e.name as title, e.event_date, eb.booking_date
        FROM events e
        JOIN event_bookings eb ON e.id = eb.event_id
        WHERE eb.user_id = $1
        ORDER BY eb.booking_date DESC
        LIMIT 3
      `;
      const { rows: recentEvents } = await db.query(eventsQuery, [konfiId]);

      // Calculate days to confirmation (Termin stammt aus dem is_konfirmation-Event)
      let daysToConfirmation = null;
      if (konfi.confirmation_event_date) {
        const confirmationDate = new Date(konfi.confirmation_event_date);
        const now = new Date();
        const diffTime = confirmationDate.getTime() - now.getTime();
        daysToConfirmation = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }

      // Get ALL levels for this organization to calculate correct level dynamically
      const allLevelsQuery = `
        SELECT id, name, title, icon, color, points_required, sort_order
        FROM levels
        WHERE organization_id = $1 AND is_active = true
        ORDER BY points_required ASC
      `;
      const { rows: allLevels } = await db.query(allLevelsQuery, [req.user.organization_id]);

      // Calculate correct current level based on total points (NOT from DB!)
      let currentLevel = null;
      let nextLevel = null;
      let levelIndex = 0;

      for (let i = 0; i < allLevels.length; i++) {
        if (totalPoints >= allLevels[i].points_required) {
          currentLevel = allLevels[i];
          levelIndex = i + 1; // 1-based index for stars
        } else {
          nextLevel = allLevels[i];
          break;
        }
      }

      // If user reached max level, no next level
      if (!nextLevel && currentLevel) {
        // User is at max level
        nextLevel = null;
      }

      // Update current_level_id in DB if it's wrong
      if (currentLevel && konfi.current_level_id !== currentLevel.id) {
        await db.query(
          'UPDATE konfi_profiles SET current_level_id = $1 WHERE user_id = $2',
          [currentLevel.id, konfiId]
        );
      }

      // Calculate progress to next level
      let levelProgress = 100;
      let pointsToNextLevel = 0;

      if (nextLevel && currentLevel) {
        const pointsNeeded = nextLevel.points_required - currentLevel.points_required;
        const pointsAchieved = totalPoints - currentLevel.points_required;
        levelProgress = Math.max(0, Math.min(100, (pointsAchieved / pointsNeeded) * 100));
        pointsToNextLevel = nextLevel.points_required - totalPoints;
      } else if (nextLevel && !currentLevel) {
        // User hasn't reached first level yet
        levelProgress = (totalPoints / nextLevel.points_required) * 100;
        pointsToNextLevel = nextLevel.points_required - totalPoints;
      }

      // Point config aus Jahrgang-Daten
      const point_config = {
        gottesdienst_enabled: konfi.gottesdienst_enabled !== false,
        gemeinde_enabled: konfi.gemeinde_enabled !== false,
        target_gottesdienst: konfi.target_gottesdienst || 10,
        target_gemeinde: konfi.target_gemeinde || 10
      };

      // Dashboard config aus Settings laden (show_* + section_order)
      const { rows: dashboardSettings } = await db.query(
        "SELECT key, value FROM settings WHERE organization_id = $1 AND (key LIKE 'dashboard_show_%' OR key = 'dashboard_section_order')",
        [req.user.organization_id]
      );
      const dashboardMap = {};
      let sectionOrder = null;
      dashboardSettings.forEach(row => {
        if (row.key === 'dashboard_section_order') {
          try { sectionOrder = JSON.parse(row.value); } catch { /* ignore */ }
        } else {
          dashboardMap[row.key] = row.value === 'true' || row.value === '1';
        }
      });
      // Bereits gespeicherte Reihenfolgen kennen 'konfispruch' noch nicht (Phase 118).
      // Fehlt der Eintrag, fuegen wir ihn direkt nach 'konfirmation' ein (oder ans Ende,
      // falls 'konfirmation' fehlt), damit auch Orgs mit gespeicherter Order die Card sehen.
      // Kein DB-Write - nur die ausgelieferte Order wird ergaenzt.
      if (Array.isArray(sectionOrder) && !sectionOrder.includes('konfispruch')) {
        const konfIndex = sectionOrder.indexOf('konfirmation');
        if (konfIndex >= 0) {
          sectionOrder.splice(konfIndex + 1, 0, 'konfispruch');
        } else {
          sectionOrder.push('konfispruch');
        }
      }
      const dashboard_config = {
        show_konfirmation: dashboardMap.dashboard_show_konfirmation !== undefined ? dashboardMap.dashboard_show_konfirmation : true,
        show_events: dashboardMap.dashboard_show_events !== undefined ? dashboardMap.dashboard_show_events : true,
        show_losung: dashboardMap.dashboard_show_losung !== undefined ? dashboardMap.dashboard_show_losung : true,
        show_badges: dashboardMap.dashboard_show_badges !== undefined ? dashboardMap.dashboard_show_badges : true,
        show_ranking: dashboardMap.dashboard_show_ranking !== undefined ? dashboardMap.dashboard_show_ranking : true,
        section_order: sectionOrder || ['konfirmation', 'konfispruch', 'events', 'losung', 'badges', 'ranking']
      };

      // Wrapped-Verfuegbarkeit pruefen (ueber wrapped_released_at auf Jahrgang)
      const { rows: [wrappedResult] } = await db.query(
        `SELECT EXISTS(
          SELECT 1 FROM jahrgaenge j
          JOIN konfi_profiles kp ON kp.jahrgang_id = j.id
          WHERE kp.user_id = $1
            AND j.wrapped_released_at IS NOT NULL
            AND j.wrapped_released_at <= NOW()
        ) as has_wrapped`,
        [konfiId]
      );
      const has_wrapped = wrappedResult?.has_wrapped || false;

      // Konfispruch-Sichtbarkeit (Backend-Gate, SPRUCH-07): Flag aus
      // jahrgaenge.konfspruch_enabled. Frontend rendert die Card nur bei true.
      const konfspruch_visible = konfi.konfspruch_enabled === true;

      // Return dashboard data
      res.json({
        konfi: {
          ...konfi,
          confirmation_location: konfi.confirmation_location
        },
        point_config,
        dashboard_config,
        recent_badges: badges,
        badge_count: badgeCount,
        recent_events: recentEvents,
        event_count: eventCount,
        ranking: rankingWithInitials,
        total_points: totalPoints,
        rank_in_jahrgang: userRanking ? userRanking.rank_in_jahrgang : null,
        total_in_jahrgang: userRanking ? userRanking.total_in_jahrgang : null,
        days_to_confirmation: daysToConfirmation > 0 ? daysToConfirmation : null,
        confirmation_date: konfi.confirmation_event_date || null,
        has_wrapped,
        konfspruch_visible,
        level_info: {
          current_level: currentLevel ? {
            id: currentLevel.id,
            name: currentLevel.name,
            title: currentLevel.title,
            icon: currentLevel.icon,
            color: currentLevel.color,
            points_required: currentLevel.points_required
          } : null,
          next_level: nextLevel || null,
          progress_percentage: Math.round(levelProgress),
          points_to_next_level: pointsToNextLevel,
          level_index: levelIndex, // 1-6 for stars display
          total_levels: allLevels.length,
          all_levels: allLevels.map(l => ({
            id: l.id,
            name: l.name,
            title: l.title,
            icon: l.icon,
            color: l.color,
            points_required: l.points_required
          }))
        }
      });
      
    } catch (err) {
 console.error('Database error in GET /dashboard:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get konfi profile
  router.get('/profile', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }
    
    try {
      const konfiId = req.user.id;
      
      const query = `
        SELECT u.id, u.display_name, u.email, u.username, u.created_at, kp.gottesdienst_points, kp.gemeinde_points,
               kp.jahrgang_id, kp.bible_translation, kp.konfspruch_translation,
               kp.konfspruch_id, kp.konfspruch_freitext, kp.konfspruch_freitext_referenz,
               j.name as jahrgang_name,
               j.gottesdienst_enabled, j.gemeinde_enabled
        FROM users u
        JOIN konfi_profiles kp ON u.id = kp.user_id
        JOIN jahrgaenge j ON kp.jahrgang_id = j.id
        JOIN roles r ON u.role_id = r.id
        WHERE u.id = $1 AND r.name = 'konfi' AND u.deleted_at IS NULL
      `;
      const { rows: [konfi] } = await db.query(query, [konfiId]);
      
      if (!konfi) {
        return res.status(404).json({ error: 'Konfi nicht gefunden' });
      }

      // Get bonus points
      const bonusQuery = `
        SELECT COALESCE(SUM(points), 0) as bonus_points
        FROM bonus_points
        WHERE konfi_id = $1 AND organization_id = $2
      `;
      const { rows: [bonus] } = await db.query(bonusQuery, [konfiId, req.user.organization_id]);
      const bonusPoints = parseInt(bonus?.bonus_points || 0);

      // Get additional profile stats
      const statsQuery = `
        SELECT 
          COALESCE(badge_stats.badge_count, 0) as badge_count,
          COALESCE(activity_stats.activity_count, 0) as activity_count,
          COALESCE(event_stats.event_count, 0) as event_count,
          COUNT(DISTINCT CASE WHEN ar.status = 'pending' THEN ar.id END) as pending_requests
        FROM users u
        JOIN konfi_profiles kp ON u.id = kp.user_id
        JOIN roles r ON u.role_id = r.id
        LEFT JOIN activity_requests ar ON u.id = ar.user_id AND ar.organization_id = $2
        LEFT JOIN (
          SELECT user_id, COUNT(*) as badge_count
          FROM user_badges
          WHERE organization_id = $2
          GROUP BY user_id
        ) badge_stats ON u.id = badge_stats.user_id
        LEFT JOIN (
          SELECT user_id, COUNT(*) as activity_count
          FROM user_activities
          WHERE organization_id = $2
          GROUP BY user_id
        ) activity_stats ON u.id = activity_stats.user_id
        LEFT JOIN (
          SELECT user_id, COUNT(*) as event_count 
          FROM event_bookings 
          GROUP BY user_id
        ) event_stats ON u.id = event_stats.user_id
        WHERE u.id = $1 AND r.name = 'konfi' AND u.deleted_at IS NULL
        GROUP BY badge_stats.badge_count, activity_stats.activity_count, event_stats.event_count
      `;
      const { rows: [stats] } = await db.query(statsQuery, [konfiId, req.user.organization_id]);
      
      // Konfirmations-Termin und -Ort aus dem is_konfirmation-Event der gebuchten Events.
      let confirmationEventDate = null;
      let confirmationLocation = null;
      try {
        const confirmationQuery = `
          SELECT e.event_date, e.location
          FROM events e
          JOIN event_bookings eb ON e.id = eb.event_id
          WHERE eb.user_id = $1
            AND eb.status = 'confirmed'
            AND e.is_konfirmation = true
            AND e.organization_id = $2
          ORDER BY e.event_date ASC
          LIMIT 1
        `;
        const { rows: [confirmationEvent] } = await db.query(confirmationQuery, [konfiId, req.user.organization_id]);
        if (confirmationEvent) {
          confirmationEventDate = confirmationEvent.event_date;
          confirmationLocation = confirmationEvent.location;
        }
      } catch (err) {
        console.warn('Could not fetch confirmation event date:', err);
        // Kein Fallback mehr: ohne is_konfirmation-Event bleibt der Termin null.
      }

      // Get ranking position (nur aktive Punkte-Typen)
      // Bonus ist bereits in konfi_profiles enthalten, daher NICHT nochmal addieren
      const gottesdienstPoints = parseInt(konfi.gottesdienst_points || 0);
      const gemeindePoints = parseInt(konfi.gemeinde_points || 0);
      const totalPoints = (konfi.gottesdienst_enabled ? gottesdienstPoints : 0)
                        + (konfi.gemeinde_enabled ? gemeindePoints : 0);
      const rankingQuery = `
        WITH MyRank AS (
          SELECT
            (CASE WHEN j.gottesdienst_enabled THEN kp.gottesdienst_points ELSE 0 END
            + CASE WHEN j.gemeinde_enabled THEN kp.gemeinde_points ELSE 0 END) as total_points,
            RANK() OVER (PARTITION BY kp.jahrgang_id ORDER BY
              (CASE WHEN j.gottesdienst_enabled THEN kp.gottesdienst_points ELSE 0 END
              + CASE WHEN j.gemeinde_enabled THEN kp.gemeinde_points ELSE 0 END) DESC) as rank_in_jahrgang
          FROM users u
          JOIN konfi_profiles kp ON u.id = kp.user_id
          JOIN roles r ON u.role_id = r.id
          JOIN jahrgaenge j ON kp.jahrgang_id = j.id
          WHERE kp.jahrgang_id = $1 AND r.name = 'konfi' AND u.deleted_at IS NULL
        ), TotalCount AS (
           SELECT COUNT(*) as total_in_jahrgang
           FROM users u2
           JOIN konfi_profiles kp2 ON u2.id = kp2.user_id
           JOIN roles r2 ON u2.role_id = r2.id
           WHERE kp2.jahrgang_id = $1 AND r2.name = 'konfi' AND u2.deleted_at IS NULL
        )
        SELECT r.rank_in_jahrgang, tc.total_in_jahrgang
        FROM MyRank r, TotalCount tc
        WHERE r.total_points = $2
        LIMIT 1;
      `;
      const { rows: [ranking] } = await db.query(rankingQuery, [konfi.jahrgang_id, totalPoints]);

      // Mock progress overview
      const progressOverview = {
        achievements: {
          total_activities: stats.activity_count || 0,
          total_events: stats.event_count || 0,
          total_badges: stats.badge_count || 0
        }
      };

      // Gewaehlten Konfispruch aufloesen (genau EINE Quelle aktiv: Listen-Wahl ODER Freitext)
      let konfspruch = null;
      if (konfi.konfspruch_id) {
        // Listen-Wahl: gewaehlte Konfispruch-Uebersetzung (konfspruch_translation) nachladen.
        // Org-gescopt + is_active wie in der Listen- und PATCH-Route. Bei NULL-Translation
        // greift ein Default (luther2017), damit der Text nicht leer bleibt.
        const spruchTranslation = konfi.konfspruch_translation || 'luther2017';
        const spruchQuery = `
          SELECT ks.id, ks.reference, ks.book, ks.chapter, ks.verse, ku.text
          FROM konfsprueche ks
          LEFT JOIN konfspruch_uebersetzungen ku
            ON ku.spruch_id = ks.id AND ku.translation = $2
          WHERE ks.id = $1
            AND ks.is_active = true
            AND (ks.organization_id IS NULL OR ks.organization_id = $3)
        `;
        const { rows: [spruch] } = await db.query(spruchQuery, [konfi.konfspruch_id, spruchTranslation, req.user.organization_id]);
        if (spruch) {
          konfspruch = {
            source: 'liste',
            id: spruch.id,
            reference: spruch.reference,
            text: spruch.text || '',
            translation: konfi.konfspruch_translation || null
          };
        }
      } else if (konfi.konfspruch_freitext) {
        // Freitext-Spruch mit Pflicht-Referenz
        konfspruch = {
          source: 'freitext',
          text: konfi.konfspruch_freitext,
          reference: konfi.konfspruch_freitext_referenz
        };
      }

      res.json({
        ...konfi,
        konfspruch,
        total_points: totalPoints,
        gottesdienst_points: gottesdienstPoints,
        gemeinde_points: gemeindePoints,
        bonus_points: bonusPoints,
        badge_count: stats.badge_count || 0,
        activity_count: stats.activity_count || 0,
        event_count: stats.event_count || 0,
        pending_requests: stats.pending_requests || 0,
        rank_in_jahrgang: ranking ? ranking.rank_in_jahrgang : null,
        total_in_jahrgang: ranking ? ranking.total_in_jahrgang : null,
        // Konfirmationstermin ausschliesslich aus dem is_konfirmation-Event (kein Jahrgang-Fallback mehr)
        confirmation_date: confirmationEventDate,
        confirmation_location: confirmationLocation,
        recent_activities: [], // Could be enhanced
        progress_overview: progressOverview
      });

    } catch (err) {
 console.error('Database error in GET /profile:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get konfi's points history (all activities, bonus points, events with dates)
  router.get('/points-history', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }

    try {
      const konfiId = req.user.id;
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
      const { rows: activities } = await db.query(activitiesQuery, [konfiId, orgId]);

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
      const { rows: bonusPoints } = await db.query(bonusQuery, [konfiId, orgId]);

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
      const { rows: eventPoints } = await db.query(eventPointsQuery, [konfiId, orgId]);

      // Combine and sort by date (newest first)
      const allPoints = [...activities, ...bonusPoints, ...eventPoints].sort((a, b) => {
        const dateA = new Date(a.date || 0);
        const dateB = new Date(b.date || 0);
        return dateB - dateA;
      });

      // Get konfi_profiles for accurate accumulated points (same as dashboard)
      const { rows: [konfiProfile] } = await db.query(
        'SELECT gottesdienst_points, gemeinde_points FROM konfi_profiles WHERE user_id = $1 AND organization_id = $2',
        [konfiId, orgId]
      );

      // konfi_profiles enthält bereits alle Punkte (Aktivitäten + Events + Bonus)
      // Single Source of Truth - direkt verwenden
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
 console.error('Database error in GET /points-history:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get konfi's activity requests
  router.get('/requests', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }
    
    try {
      const konfiId = req.user.id;
      const query = `
        SELECT ar.*, a.name as activity_name, a.points as activity_points, a.type as activity_type
        FROM activity_requests ar
        LEFT JOIN activities a ON ar.activity_id = a.id
        WHERE ar.user_id = $1 AND ar.organization_id = $2
        ORDER BY ar.created_at DESC
      `;
      const { rows: requests } = await db.query(query, [konfiId, req.user.organization_id]);
      res.json(requests);
    } catch (err) {
 console.error('Database error in GET /requests:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Submit new activity request
  router.post('/requests', verifyTokenRBAC, validateCreateRequest, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }
    
    try {
      const konfiId = req.user.id;
      const { activity_id, description, photo_filename, requested_date, client_id } = req.body;

      if (!activity_id) {
        return res.status(400).json({ error: 'Aktivitäts-ID ist erforderlich' });
      }

      // Idempotency: Prüfen ob Antrag mit dieser client_id bereits existiert
      if (client_id) {
        const { rows: [existing] } = await db.query(
          'SELECT id, user_id, activity_id, requested_date, comment, photo_filename, status, organization_id, client_id, created_at, updated_at FROM activity_requests WHERE client_id = $1', [client_id]
        );
        if (existing) {
          return res.status(200).json(existing);
        }
      }
      
      const date = requested_date || new Date().toISOString().split('T')[0];
      
      // Get activity details for notification
      const { rows: [activity] } = await db.query(
        "SELECT name, points FROM activities WHERE id = $1 AND organization_id = $2",
        [activity_id, req.user.organization_id]
      );

      if (!activity) {
        return res.status(404).json({ error: 'Aktivität nicht gefunden' });
      }

      const insertQuery = `
        INSERT INTO activity_requests (user_id, activity_id, requested_date, comment, photo_filename, status, organization_id, client_id)
        VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
        RETURNING id
      `;
      const { rows: [newRequest] } = await db.query(insertQuery, [konfiId, activity_id, date, description, photo_filename, req.user.organization_id, client_id || null]);
      
      // Send confirmation notification to konfi
      try {
        await db.query(
          "INSERT INTO notifications (user_id, title, message, type, data, organization_id) VALUES ($1, $2, $3, $4, $5, $6)",
          [
            konfiId,
            'Antrag eingereicht',
            `Dein Antrag für "${activity.name}" wurde eingereicht und wird geprüft.`,
            'activity_request_submitted',
            JSON.stringify({ 
              request_id: newRequest.id,
              activity_name: activity.name,
              points: activity.points
            }),
            req.user.organization_id
          ]
        );
      } catch (notifErr) {
 console.error('Error sending notification:', notifErr);
        // Don't fail the request if notification fails
      }

      // Send notification to all admins about new request
      try {
        const { rows: admins } = await db.query(
          `SELECT u.id, u.display_name 
           FROM users u 
           JOIN roles r ON u.role_id = r.id 
           WHERE r.name = 'admin' AND u.organization_id = $1`,
          [req.user.organization_id]
        );

        const { rows: [konfiData] } = await db.query(
          "SELECT display_name FROM users WHERE id = $1",
          [konfiId]
        );

        if (admins.length > 0) {
          const adminIds = admins.map(a => a.id);
          await db.query(
            `INSERT INTO notifications (user_id, title, message, type, data, organization_id)
             SELECT unnest($1::int[]), $2, $3, $4, $5, $6`,
            [
              adminIds,
              'Neuer Antrag eingegangen',
              `${konfiData.display_name} hat einen Antrag für "${activity.name}" (${activity.points} ${activity.points === 1 ? 'Punkt' : 'Punkte'}) eingereicht.`,
              'new_activity_request',
              JSON.stringify({
                request_id: newRequest.id,
                konfi_id: konfiId,
                konfi_name: konfiData.display_name,
                activity_name: activity.name,
                points: activity.points
              }),
              req.user.organization_id
            ]
          );
        }


        // Send push notifications to admins
        await PushService.sendNewActivityRequestToAdmins(
          db,
          req.user.organization_id,
          konfiData.display_name,
          activity.name,
          activity.points
        );
      } catch (notifErr) {
 console.error('Error sending admin notifications:', notifErr);
        // Don't fail the request if notification fails
      }

      res.status(201).json({
        id: newRequest.id,
        message: 'Antrag erfolgreich eingereicht'
      });

      // Live-Update an alle Admins über neuen Antrag senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'requests', 'create');
    } catch (err) {
      // Race Condition: Antrag wurde zwischen Check und Insert eingefügt
      if (err.code === '23505' && err.detail?.includes('client_id')) {
        try {
          const { rows: [existing] } = await db.query(
            'SELECT id, user_id, activity_id, requested_date, comment, photo_filename, status, organization_id, client_id, created_at, updated_at FROM activity_requests WHERE client_id = $1', [req.body.client_id]
          );
          if (existing) return res.status(200).json(existing);
        } catch (lookupErr) {
          console.error('Error looking up duplicate request:', lookupErr);
        }
      }
      console.error('Database error in POST /requests:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Upload photo for activity request (encrypted storage)
  router.post('/upload-photo', verifyTokenRBAC, requestUpload.single('photo'), validateMagicBytes, async (req, res) => {
    if (req.user.type !== 'konfi' && req.user.type !== 'teamer') {
      return res.status(403).json({ error: 'Konfi- oder Teamer-Zugriff erforderlich' });
    }
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Kein Foto hochgeladen' });
      }
      
      res.json({ 
        filename: req.file.filename,
        message: 'Foto erfolgreich hochgeladen' 
      });
    } catch (err) {
 console.error('Error uploading photo:', err);
      res.status(500).json({ error: 'Fehler beim Hochladen des Fotos' });
    }
  });

  // Serve activity request photos (protected route)
  router.get('/activity-requests/:id/photo', verifyTokenRBAC, async (req, res) => {
    try {
      const requestId = parseInt(req.params.id);
      
      // Get request with photo filename
      const { rows: [request] } = await db.query(
        'SELECT photo_filename, user_id FROM activity_requests WHERE id = $1 AND organization_id = $2',
        [requestId, req.user.organization_id]
      );
      
      if (!request) {
        return res.status(404).json({ error: 'Antrag nicht gefunden' });
      }
      
      if (!request.photo_filename) {
        return res.status(404).json({ error: 'Kein Foto gefunden' });
      }
      
      // Check permissions: Admin can see all, Konfi/Teamer can only see own
      const isAdmin = req.user.type === 'admin';
      const isOwnRequest = (req.user.type === 'konfi' || req.user.type === 'teamer') && req.user.id === request.user_id;

      if (!isAdmin && !isOwnRequest) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
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
 console.error('Error serving photo:', err);
      res.status(500).json({ error: 'Serverfehler' });
    }
  });

  // Delete own activity request (only if pending)
  router.delete('/requests/:id', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }
    
    try {
      const requestId = req.params.id;
      const konfiId = req.user.id;
      
      // Check if request exists and belongs to this konfi and is pending
      const { rows: [request] } = await db.query(
        "SELECT id, user_id, activity_id, requested_date, comment, photo_filename, status, organization_id, client_id, created_at, updated_at FROM activity_requests WHERE id = $1 AND user_id = $2 AND organization_id = $3",
        [requestId, konfiId, req.user.organization_id]
      );
      
      if (!request) {
        return res.status(404).json({ error: 'Antrag nicht gefunden' });
      }
      
      if (request.status !== 'pending') {
        return res.status(400).json({ error: 'Nur wartende Anträge können gelöscht werden' });
      }
      
      // Delete the request
      await db.query(
        "DELETE FROM activity_requests WHERE id = $1 AND user_id = $2 AND organization_id = $3",
        [requestId, konfiId, req.user.organization_id]
      );
      
      res.json({ message: 'Antrag erfolgreich gelöscht' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'requests', 'delete');
    } catch (err) {
 console.error('Database error in DELETE /requests/:id:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get available activities for requests
  router.get('/activities', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }
    
    try {
      // Jahrgang-Config des Konfis: nur AKTIVIERTE Punkt-Typen anbieten, sonst
      // koennte der Konfi eine Aktivitaet einreichen, die der Admin nie genehmigen
      // kann (Punkt-Typ im Jahrgang deaktiviert -> 400 beim Genehmigen).
      const { rows: [cfg] } = await db.query(
        `SELECT COALESCE(j.gottesdienst_enabled, true) AS gottesdienst_enabled,
                COALESCE(j.gemeinde_enabled, true) AS gemeinde_enabled
         FROM konfi_profiles kp
         LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
         WHERE kp.user_id = $1`,
        [req.user.id]
      );
      const gottesdienstEnabled = cfg ? cfg.gottesdienst_enabled : true;
      const gemeindeEnabled = cfg ? cfg.gemeinde_enabled : true;

      const query = `
        SELECT a.id, a.name, a.points, a.type,
               STRING_AGG(c.name, ', ') as category_names
        FROM activities a
        LEFT JOIN activity_categories ac ON a.id = ac.activity_id
        LEFT JOIN categories c ON ac.category_id = c.id
        WHERE a.organization_id = $1
          AND (a.target_role IS NULL OR a.target_role = 'konfi')
          AND (a.type = 'gottesdienst' AND $2::boolean OR a.type = 'gemeinde' AND $3::boolean)
        GROUP BY a.id, a.name, a.points, a.type
        ORDER BY a.type, a.name
      `;
      const { rows: activities } = await db.query(query, [req.user.organization_id, gottesdienstEnabled, gemeindeEnabled]);
      res.json(activities);
    } catch (err) {
 console.error('Database error in GET /activities:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get konfi's badges
  router.get('/badges', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }
    
    try {
      const konfiId = req.user.id;
      const checkBadgesTableQuery = "SELECT to_regclass('public.custom_badges')";
      const { rows: [tableExistsResult] } = await db.query(checkBadgesTableQuery);

      if (!tableExistsResult || !tableExistsResult.to_regclass) {
        return res.json({
          available: [],
          earned: []
        });
      }

      const query = `
        SELECT cb.*,
               CASE WHEN kb.user_id IS NOT NULL THEN TRUE ELSE FALSE END as earned,
               kb.awarded_date AS earned_at,
               COALESCE(kb.seen, false) as seen
        FROM custom_badges cb
        LEFT JOIN user_badges kb ON cb.id = kb.badge_id AND kb.user_id = $1 AND kb.organization_id = $2
        WHERE cb.is_active = TRUE AND cb.organization_id = $2 AND cb.target_role = 'konfi'
        ORDER BY earned DESC, cb.name
      `;
      const { rows: badges } = await db.query(query, [konfiId, req.user.organization_id]);

      // Punkte-Daten EINMAL vorab laden (statt pro Punkte-Badge erneut) — vermeidet N+1
      // fuer die Cases total_points/gottesdienst_points/gemeinde_points/both_categories.
      const { rows: [pointsRow] } = await db.query(
        `SELECT kp.gottesdienst_points, kp.gemeinde_points, j.gottesdienst_enabled, j.gemeinde_enabled
         FROM konfi_profiles kp JOIN jahrgaenge j ON kp.jahrgang_id = j.id WHERE kp.user_id = $1`,
        [konfiId]
      );
      const gdEnabled = !!pointsRow?.gottesdienst_enabled;
      const gmEnabled = !!pointsRow?.gemeinde_enabled;
      const gdPoints = gdEnabled ? (pointsRow?.gottesdienst_points || 0) : 0;
      const gmPoints = gmEnabled ? (pointsRow?.gemeinde_points || 0) : 0;

      // Badges, deren Punkt-Kategorie im Jahrgang deaktiviert ist, sind fuer
      // diesen Konfi NICHT erreichbar -> markieren, damit das Frontend sie
      // ausblenden/ausgrauen kann (kein irrefuehrender Fortschritt).
      const isUnreachable = (badge) => {
        switch (badge.criteria_type) {
          case 'gottesdienst_points': return !gdEnabled;
          case 'gemeinde_points': return !gmEnabled;
          case 'both_categories': return !gdEnabled || !gmEnabled;
          case 'total_points': return !gdEnabled && !gmEnabled;
          default: return false;
        }
      };

      // Calculate progress for each badge
      for (let badge of badges) {
        badge.unreachable = !badge.earned && isUnreachable(badge);

        if (badge.earned) {
          badge.progress = { current: badge.criteria_value, target: badge.criteria_value, percentage: 100 };
          continue;
        }

        let progress = { current: 0, target: badge.criteria_value || 1, percentage: 0 };
        
        try {
          switch (badge.criteria_type) {
            case 'total_points': {
              // Nutzt vorab geladene Punkte-Daten (kein Query pro Badge)
              progress.current = gdPoints + gmPoints;
              break;
            }
            case 'gottesdienst_points': {
              progress.current = gdPoints;
              break;
            }
            case 'gemeinde_points': {
              progress.current = gmPoints;
              break;
            }
            case 'both_categories': {
              // Fortschritt = Minimum beider Kategorien; nur wenn beide Typen aktiv sind
              progress.current = (!gdEnabled || !gmEnabled) ? 0 : Math.min(gdPoints, gmPoints);
              break;
            }
              
            case 'activity_count': {
              // Wertung (badges.js:272) addiert activityCount + eventCount.
              // Progress muss identisch zaehlen, sonst Wertung/Progress-Mismatch.
              const { rows: [activityCountResult] } = await db.query(
                'SELECT COUNT(*) as count FROM user_activities WHERE user_id = $1 AND organization_id = $2',
                [konfiId, req.user.organization_id]
              );
              const { rows: [acEventCountResult] } = await db.query(
                `SELECT COUNT(*) as count FROM event_bookings eb JOIN events e ON eb.event_id = e.id WHERE eb.user_id = $1 AND ${KONFI_BADGE_EVENT_CONDITION} AND eb.organization_id = $2`,
                [konfiId, req.user.organization_id]
              );
              progress.current = parseInt(activityCountResult?.count || 0) + parseInt(acEventCountResult?.count || 0);
              break;
            }

            case 'event_count': {
              // Anzahl besuchter Events — nur freiwillige (kein Pflicht/Konfirmation),
              // identisch zur Wertung (badges.js KONFI_BADGE_EVENT_CONDITION).
              const { rows: [eventCountResult] } = await db.query(
                `SELECT COUNT(*) as count FROM event_bookings eb JOIN events e ON eb.event_id = e.id WHERE eb.user_id = $1 AND ${KONFI_BADGE_EVENT_CONDITION} AND eb.organization_id = $2`,
                [konfiId, req.user.organization_id]
              );
              progress.current = parseInt(eventCountResult?.count || 0);
              break;
            }

            case 'mandatory_event_count': {
              // KONSISTENZ-VERTRAG: byte-identisch zur Wertung in badges.js (Plan 01).
              const { rows: [mandResult] } = await db.query(
                `SELECT COUNT(*) FROM event_bookings eb JOIN events e ON eb.event_id = e.id
             WHERE eb.user_id = $1 AND eb.attendance_status = 'present' AND e.mandatory = true AND eb.organization_id = $2`,
                [konfiId, req.user.organization_id]
              );
              progress.current = parseInt(mandResult?.count || 0);
              break;
            }

            case 'teamer_year': {
              // teamer_year nur im Teamer-Endpoint (teamer.js) relevant; hier defensiv 0.
              // GET /konfi/badges liefert nur target_role='konfi', dieser Case greift fuer Konfis nie.
              progress.current = 0;
              break;
            }
              
            case 'unique_activities':
              const { rows: [uniqueActivitiesResult] } = await db.query(
                'SELECT COUNT(DISTINCT activity_id) as count FROM user_activities WHERE user_id = $1',
                [konfiId]
              );
              progress.current = parseInt(uniqueActivitiesResult?.count || 0);
              break;

            case 'specific_activity':
              // Extra-Feld-Fix: Wertung nutzt required_activity_name (Name), NICHT activity_id.
              // Identisch zur Wertung badges.js:209-214 (JOIN activities a ON ... a.name = $2).
              let requiredActivityName = null;
              try {
                const extraData = typeof badge.criteria_extra === 'string' ? JSON.parse(badge.criteria_extra || '{}') : (badge.criteria_extra || {});
                requiredActivityName = extraData.required_activity_name;
              } catch (e) {
 console.error('Error parsing criteria_extra for specific_activity badge:', e);
              }

              if (requiredActivityName) {
                const { rows: [specificResult] } = await db.query(
                  `SELECT COUNT(*) as count FROM user_activities ua
                   JOIN activities a ON ua.activity_id = a.id
                   WHERE ua.user_id = $1 AND a.name = $2 AND a.organization_id = $3`,
                  [konfiId, requiredActivityName, req.user.organization_id]
                );
                progress.current = parseInt(specificResult?.count || 0);
              } else {
                progress.current = 0;
              }
              break;

            case 'category_activities':
              // Count activities in specific category (criteria_extra contains required_category)
              let requiredCategory = null;
              try {
                const extraData = typeof badge.criteria_extra === 'string' ? JSON.parse(badge.criteria_extra || '{}') : (badge.criteria_extra || {});
                requiredCategory = extraData.required_category;
              } catch (e) {
 console.error('Error parsing criteria_extra for category_activities badge:', e);
              }
              
              if (requiredCategory) {
                // KONSISTENZ-VERTRAG: byte-identisch zur Wertung (badges.js:222-242).
                // Zaehlt Aktivitaeten UND anwesende Events der Kategorie (UNION) +org.
                const { rows: [categoryResult] } = await db.query(
                  `SELECT COUNT(*) as count FROM (
                     SELECT ka.id FROM user_activities ka
                     JOIN activities a ON ka.activity_id = a.id
                     JOIN activity_categories ac ON a.id = ac.activity_id
                     JOIN categories c ON ac.category_id = c.id
                     WHERE ka.user_id = $1 AND c.name = $2 AND a.organization_id = $3 AND c.organization_id = $3
                     UNION ALL
                     SELECT eb.id FROM event_bookings eb
                     JOIN events e ON eb.event_id = e.id
                     JOIN event_categories ec ON eb.event_id = ec.event_id
                     JOIN categories c ON ec.category_id = c.id
                     WHERE eb.user_id = $1 AND ${KONFI_BADGE_EVENT_CONDITION} AND c.name = $2 AND c.organization_id = $3 AND eb.organization_id = $3
                   ) as combined`,
                  [konfiId, requiredCategory, req.user.organization_id]
                );
                progress.current = parseInt(categoryResult?.count || 0);
              } else {
                progress.current = 0;
              }
              break;

            case 'activity_combination':
              // Extra-Feld-Fix: Wertung nutzt required_activities (Namen), NICHT activity_ids.
              // Identisch zur Wertung badges.js:221-223 (Abgleich gegen erledigte Aktivitaets-Namen).
              let requiredActivities = [];
              try {
                const extraData = typeof badge.criteria_extra === 'string' ? JSON.parse(badge.criteria_extra || '{}') : (badge.criteria_extra || {});
                requiredActivities = extraData.required_activities || [];
              } catch (e) {
 console.error('Error parsing criteria_extra for activity_combination badge:', e);
              }

              if (requiredActivities.length > 0) {
                const placeholders = requiredActivities.map((_, i) => `$${i + 2}`).join(',');
                const { rows: [combinationResult] } = await db.query(
                  `SELECT COUNT(DISTINCT a.name) as count
                   FROM user_activities ua
                   JOIN activities a ON ua.activity_id = a.id
                   WHERE ua.user_id = $1 AND a.name IN (${placeholders}) AND a.organization_id = $${requiredActivities.length + 2}`,
                  [konfiId, ...requiredActivities, req.user.organization_id]
                );
                progress.current = parseInt(combinationResult?.count || 0);
              } else {
                progress.current = 0;
              }
              break;

            case 'bonus_points':
              // Count total bonus points
              const { rows: [bonusResult] } = await db.query(
                'SELECT COALESCE(SUM(points), 0) as total FROM bonus_points WHERE konfi_id = $1',
                [konfiId]
              );
              progress.current = parseInt(bonusResult?.total || 0);
              break;
              
            case 'streak': {
              // Streak: Wochen mit mindestens einer Aktivitaet/Event in Folge
              const streakQuery = `
                SELECT completed_date as date FROM user_activities WHERE user_id = $1 AND organization_id = $2
                UNION ALL
                SELECT e.event_date as date FROM event_bookings eb
                JOIN events e ON eb.event_id = e.id
                WHERE eb.user_id = $1 AND ${KONFI_BADGE_EVENT_CONDITION} AND eb.organization_id = $2
                ORDER BY date DESC
              `;
              const { rows: streakResults } = await db.query(streakQuery, [konfiId, req.user.organization_id]);

              // Wochen-Streak-Rechnung aus gemeinsamer Util (Single Source of Truth,
              // identisch zur Badge-Wertung in badges.js checkStreakCriteria).
              progress.current = computeCurrentStreak(streakResults.map(r => r.date));
              break;
            }

            case 'time_based': {
              // Time-based: Anzahl Aktivitaeten/Events im konfigurierten Zeitraum
              let tbDays = null;
              try {
                const extraData = typeof badge.criteria_extra === 'string' ? JSON.parse(badge.criteria_extra || '{}') : (badge.criteria_extra || {});
                tbDays = extraData.days || (extraData.weeks ? extraData.weeks * 7 : null);
              } catch (e) {
                console.error('Error parsing criteria_extra for time_based badge:', e);
              }
              if (tbDays) {
                const tbQuery = `
                  SELECT completed_date as date FROM user_activities WHERE user_id = $1 AND organization_id = $2
                  UNION ALL
                  SELECT e.event_date as date FROM event_bookings eb
                  JOIN events e ON eb.event_id = e.id
                  WHERE eb.user_id = $1 AND ${KONFI_BADGE_EVENT_CONDITION} AND eb.organization_id = $2
                  ORDER BY date DESC
                `;
                const { rows: tbResults } = await db.query(tbQuery, [konfiId, req.user.organization_id]);
                const now = new Date();
                const cutoff = new Date(now.getTime() - (tbDays * 24 * 60 * 60 * 1000));
                progress.current = tbResults.filter(r => new Date(r.date) >= cutoff).length;
              }
              break;
            }
          }
          
          progress.percentage = Math.min((progress.current / progress.target) * 100, 100);
        } catch (err) {
 console.error(`Error calculating progress for badge ${badge.id}:`, err);
        }
        
        badge.progress = progress;
      }
      
      // Separate earned and available badges correctly
      const earned = badges.filter(badge => badge.earned);
      // Available = not earned AND not hidden AND erreichbar. Badges, deren
      // Punkt-Kategorie im Jahrgang deaktiviert ist (unreachable), tauchen NICHT
      // als erreichbare Badges auf — der Konfi koennte sie nie bekommen, ein
      // Fortschrittsbalken waere irrefuehrend.
      const available = badges.filter(badge => !badge.earned && !badge.is_hidden && !badge.unreachable);
      
      // Get total counts for dashboard stats
      const { rows: [totalStats] } = await db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE is_hidden = false) as total_visible,
          COUNT(*) FILTER (WHERE is_hidden = true) as total_secret
        FROM custom_badges 
        WHERE is_active = TRUE AND organization_id = $1
      `, [req.user.organization_id]);
      
      res.json({
        available: available,
        earned: earned,
        stats: {
          totalVisible: parseInt(totalStats.total_visible) || 0,
          totalSecret: parseInt(totalStats.total_secret) || 0
        }
      });
    } catch (err) {
 console.error('Database error in GET /badges:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get badge statistics for konfi
  router.get('/badges/stats', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }
    
    try {
      const konfiId = req.user.id;
      const checkBadgesTableQuery = "SELECT to_regclass('public.custom_badges')";
      const { rows: [tableExistsResult] } = await db.query(checkBadgesTableQuery);
      
      if (!tableExistsResult || !tableExistsResult.to_regclass) {
        return res.json({ total_badges: 0, earned_badges: 0 });
      }

      const statsQuery = `
        SELECT
          (SELECT COUNT(*) FROM custom_badges WHERE organization_id = $2 AND target_role = 'konfi' AND is_active = TRUE) as total_badges,
          COUNT(kb.badge_id) as earned_badges
        FROM user_badges kb
        WHERE kb.user_id = $1 AND kb.organization_id = $2
      `;
      const { rows: [stats] } = await db.query(statsQuery, [konfiId, req.user.organization_id]);
      res.json({
        total_badges: parseInt(stats.total_badges, 10) || 0,
        earned_badges: parseInt(stats.earned_badges, 10) || 0
      });
    } catch (err) {
 console.error('Database error in GET /badges/stats:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Mark all badges as seen for konfi
  router.post('/badges/mark-seen', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }

    try {
      const konfiId = req.user.id;
      await db.query(
        'UPDATE user_badges SET seen = true WHERE user_id = $1 AND organization_id = $2 AND seen = false',
        [konfiId, req.user.organization_id]
      );
      res.json({ success: true, message: 'Alle Badges als gesehen markiert' });
    } catch (err) {
 console.error('Database error in POST /badges/mark-seen:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get events with konfi-specific data (registration status, attendance status)
  router.get('/events', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }
    
    try {
      const konfiId = req.user.id;

      // Jahrgang des Konfis laden für Filterung
      const { rows: [konfiProfile] } = await db.query(
        'SELECT jahrgang_id FROM konfi_profiles WHERE user_id = $1',
        [konfiId]
      );

      if (!konfiProfile || !konfiProfile.jahrgang_id) {
        return res.json([]); // Konfi ohne Jahrgang sieht keine Events
      }

      const jahrgangId = konfiProfile.jahrgang_id;

      // Get all events with konfi-specific data, filtered by jahrgang
      const query = `
        SELECT e.*,
               COUNT(DISTINCT CASE WHEN eb_all.status = 'confirmed' THEN eb_all.id END) as registered_count,
               COUNT(DISTINCT CASE WHEN eb_all.status = 'waitlist' THEN eb_all.id END) as waitlist_count,
               COUNT(DISTINCT CASE WHEN eb_all.status = 'confirmed' AND r_book.name = 'teamer' THEN eb_all.id END) as teamer_count,
               CASE 
                 WHEN e.has_timeslots THEN COALESCE(timeslot_capacity.total_capacity, e.max_participants)
                 ELSE e.max_participants
               END as max_participants,
               STRING_AGG(DISTINCT c.id::text, ',') as category_ids,
               STRING_AGG(DISTINCT c.name, ', ') as category_names,
               CASE 
                 WHEN e.cancelled = true THEN 'cancelled'
                 WHEN NOW() < e.registration_opens_at THEN 'upcoming'
                 WHEN NOW() > e.registration_closes_at THEN 'closed'
                 WHEN COUNT(DISTINCT CASE WHEN eb_all.status = 'confirmed' THEN eb_all.id END) >= 
                   CASE 
                     WHEN e.has_timeslots THEN COALESCE(timeslot_capacity.total_capacity, e.max_participants)
                     ELSE e.max_participants
                   END AND 
                      (NOT e.waitlist_enabled OR COUNT(DISTINCT CASE WHEN eb_all.status = 'waitlist' THEN eb_all.id END) >= COALESCE(e.max_waitlist_size, 0)) THEN 'closed'
                 ELSE 'open'
               END as registration_status,
               -- Konfi-specific data
               eb_konfi.status as booking_status,
               eb_konfi.attendance_status,
               eb_konfi.timeslot_id as booked_timeslot_id,
               et_booked.start_time as booked_timeslot_start,
               et_booked.end_time as booked_timeslot_end,
               CASE WHEN eb_konfi.status = 'confirmed' THEN true ELSE false END as is_registered,
               CASE WHEN eb_konfi.status = 'opted_out' THEN true ELSE false END as is_opted_out,
               CASE 
                 WHEN e.cancelled = true THEN false
                 WHEN eb_konfi.id IS NOT NULL THEN false
                 WHEN NOW() < e.registration_opens_at OR NOW() > e.registration_closes_at THEN false
                 ELSE true
               END as can_register,
               -- Wartelisten-Position berechnen
               CASE 
                 WHEN eb_konfi.status = 'waitlist' THEN
                   (SELECT COUNT(*) + 1 FROM event_bookings eb2 
                    WHERE eb2.event_id = e.id 
                    AND eb2.status = 'waitlist' 
                    AND eb2.created_at < eb_konfi.created_at)
                 ELSE NULL
               END as waitlist_position
        FROM events e
        INNER JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
        LEFT JOIN event_bookings eb_all ON e.id = eb_all.event_id
        LEFT JOIN users u_book ON eb_all.user_id = u_book.id
        LEFT JOIN roles r_book ON u_book.role_id = r_book.id
        LEFT JOIN event_bookings eb_konfi ON e.id = eb_konfi.event_id AND eb_konfi.user_id = $2
        LEFT JOIN event_timeslots et_booked ON eb_konfi.timeslot_id = et_booked.id
        LEFT JOIN event_categories ec ON e.id = ec.event_id
        LEFT JOIN categories c ON ec.category_id = c.id
        LEFT JOIN (
          SELECT event_id, SUM(max_participants) as total_capacity
          FROM event_timeslots
          GROUP BY event_id
        ) timeslot_capacity ON e.id = timeslot_capacity.event_id
        WHERE e.organization_id = $1
          AND eja.jahrgang_id = $3
          AND e.teamer_only IS NOT TRUE
          AND (e.cancelled IS NOT TRUE OR eb_konfi.id IS NOT NULL)
        GROUP BY e.id, timeslot_capacity.total_capacity, eb_konfi.id, eb_konfi.status, eb_konfi.attendance_status, eb_konfi.created_at, eb_konfi.timeslot_id, et_booked.start_time, et_booked.end_time
        ORDER BY e.event_date ASC
      `;

      const { rows } = await db.query(query, [req.user.organization_id, konfiId, jahrgangId]);
      
      // Transform the data to include categories arrays
      const eventsWithRelations = rows.map(row => {
        const categories = [];
        if (row.category_ids) {
          const ids = row.category_ids.split(',');
          const names = row.category_names.split(',');
          for (let i = 0; i < ids.length; i++) {
            categories.push({
              id: parseInt(ids[i], 10),
              name: names[i]
            });
          }
        }
        
        return {
          ...row,
          categories: categories
        };
      });
      
      res.json(eventsWithRelations);
      
    } catch (err) {
 console.error('Database error in GET /konfi/events:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get konfi's registration status for a specific event
  router.get('/events/:id/status', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }
    
    try {
      const konfiId = req.user.id;
      const eventId = req.params.id;
      
      // Check if konfi is registered
      const { rows: [registration] } = await db.query(
        'SELECT id, user_id, event_id, status, booking_date, timeslot_id, organization_id FROM event_bookings WHERE user_id = $1 AND event_id = $2',
        [konfiId, eventId]
      );

      // Get event details with same logic as events API
      const { rows: [event] } = await db.query(`
        SELECT e.*, 
               COUNT(DISTINCT CASE WHEN eb.status = 'confirmed' THEN eb.id END) as registered_count,
               COUNT(DISTINCT CASE WHEN eb.status = 'waitlist' THEN eb.id END) as waitlist_count,
               CASE 
                 WHEN e.has_timeslots THEN COALESCE(timeslot_capacity.total_capacity, e.max_participants)
                 ELSE e.max_participants
               END as max_participants,
               CASE 
                 WHEN NOW() < e.registration_opens_at THEN 'upcoming'
                 WHEN NOW() > e.registration_closes_at THEN 'closed'
                 WHEN COUNT(DISTINCT CASE WHEN eb.status = 'confirmed' THEN eb.id END) >= 
                   CASE 
                     WHEN e.has_timeslots THEN COALESCE(timeslot_capacity.total_capacity, e.max_participants)
                     ELSE e.max_participants
                   END AND 
                      (NOT e.waitlist_enabled OR COUNT(DISTINCT CASE WHEN eb.status = 'waitlist' THEN eb.id END) >= COALESCE(e.max_waitlist_size, 0)) THEN 'closed'
                 ELSE 'open'
               END as registration_status
        FROM events e
        LEFT JOIN event_bookings eb ON e.id = eb.event_id
        LEFT JOIN (
          SELECT event_id, SUM(max_participants) as total_capacity
          FROM event_timeslots
          GROUP BY event_id
        ) timeslot_capacity ON e.id = timeslot_capacity.event_id
        WHERE e.id = $1 AND e.organization_id = $2 AND (e.cancelled = FALSE OR e.cancelled IS NULL)
        GROUP BY e.id, timeslot_capacity.total_capacity
      `, [eventId, req.user.organization_id]);
      
      if (!event) {
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }
      
      const confirmedCount = parseInt(event.registered_count) || 0;
      const waitlistCount = parseInt(event.waitlist_count) || 0;
      const can_register = !registration && event.registration_status === 'open';
      
      // Get waitlist position if user is on waitlist
      let waitlist_position = null;
      if (registration && registration.status === 'waitlist') {
        const positionQuery = `
          SELECT COUNT(*) + 1 as position
          FROM event_bookings
          WHERE event_id = $1 AND status = 'waitlist' AND booking_date < $2
        `;
        const { rows: [posResult] } = await db.query(positionQuery, [eventId, registration.booking_date]);
        waitlist_position = parseInt(posResult.position) || 1;
      }
      
      res.json({
        is_registered: !!registration,
        registration_status: registration?.status || null,
        can_register: can_register,
        registration_date: registration?.booking_date,
        event_status: event.registration_status,
        confirmed_count: confirmedCount,
        waitlist_count: waitlistCount,
        waitlist_position: waitlist_position,
        max_participants: event.max_participants,
        max_waitlist_size: event.max_waitlist_size,
        waitlist_enabled: event.waitlist_enabled
      });
    } catch (err) {
 console.error('Database error in GET /events/:id/status:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get event participants for konfi view (anonymized: Vorname N.)
  router.get('/events/:id/participants', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }

    try {
      const eventId = req.params.id;

      // Get confirmed participants with anonymized names — Teamer rausfiltern
      const participantsQuery = `
        SELECT
          u.id,
          u.display_name
        FROM event_bookings eb
        JOIN users u ON eb.user_id = u.id
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE eb.event_id = $1
          AND eb.status = 'confirmed'
          AND (r.name IS NULL OR r.name <> 'teamer')
        ORDER BY u.display_name ASC
      `;
      const { rows: participants } = await db.query(participantsQuery, [eventId]);

      // Anonymize names: "Vorname N." (first name + first letter of last name with period)
      const anonymizedParticipants = participants.map(p => {
        const nameParts = (p.display_name || '').trim().split(' ');
        if (nameParts.length >= 2) {
          const firstName = nameParts[0];
          const lastName = nameParts[nameParts.length - 1];
          return {
            id: p.id,
            display_name: `${firstName} ${lastName.charAt(0).toUpperCase()}.`
          };
        }
        // If only one name part, just use it as is
        return {
          id: p.id,
          display_name: nameParts[0] || 'Unbekannt'
        };
      });

      res.json(anonymizedParticipants);
    } catch (err) {
 console.error('Database error in GET /events/:id/participants:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get daily verse (Tageslosung) with caching
  router.get('/tageslosung', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }

    try {
      const konfiId = req.user.id;

      // Get konfi's preferred translation
      const { rows: [konfi] } = await db.query(
        'SELECT kp.bible_translation FROM users u JOIN konfi_profiles kp ON u.id = kp.user_id WHERE u.id = $1',
        [konfiId]
      );

      const translation = konfi?.bible_translation || 'LUT';
      const result = await fetchTageslosung(db, translation);

      res.json({ success: true, ...result });
    } catch (err) {
      console.error('Error fetching Tageslosung:', err);

      // Fallback: letzte gecachte Losung aus DB
      try {
        const { rows: [fallbackCached] } = await db.query(
          'SELECT verse_data, translation FROM daily_verses ORDER BY date DESC LIMIT 1'
        );

        if (fallbackCached) {
          return res.json({
            success: true,
            data: fallbackCached.verse_data,
            translation: fallbackCached.translation,
            fallback: true,
            error: 'Aktuelle Tageslosung nicht verfügbar - verwende letzte verfügbare Losung'
          });
        }
      } catch (fallbackErr) {
        console.error('Fallback cache error:', fallbackErr.message);
      }

      // Statischer Fallback
      res.json({
        success: true,
        data: {
          date: new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
          losung: { text: "Der HERR ist mein Hirte, mir wird nichts mangeln.", reference: "Psalm 23,1", testament: "AT" },
          lehrtext: { text: "Jesus spricht: Ich bin der gute Hirte. Der gute Hirte lässt sein Leben für die Schafe.", reference: "Johannes 10,11", testament: "NT" },
          translation: { code: "LUT", name: "Lutherbibel 2017", language: "German" },
          source: "Fallback"
        },
        fallback: true,
        error: 'Losungen API nicht erreichbar - Fallback verwendet'
      });
    }
  });

  // Get timeslots for a specific event (Konfi access)
  router.get('/events/:id/timeslots', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }

    try {
      const eventId = req.params.id;

      // Verify event exists and belongs to organization
      const { rows: [event] } = await db.query(
        'SELECT id, has_timeslots FROM events WHERE id = $1 AND organization_id = $2',
        [eventId, req.user.organization_id]
      );

      if (!event) {
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      if (!event.has_timeslots) {
        return res.json([]);
      }

      // Get timeslots with registration counts
      const timeslotsQuery = `
        SELECT et.*, COUNT(eb.id) as registered_count
        FROM event_timeslots et
        LEFT JOIN event_bookings eb ON et.id = eb.timeslot_id AND eb.status = 'confirmed'
        WHERE et.event_id = $1 AND et.organization_id = $2
        GROUP BY et.id
        ORDER BY et.start_time ASC
      `;
      const { rows: timeslots } = await db.query(timeslotsQuery, [eventId, req.user.organization_id]);

      res.json(timeslots);
    } catch (err) {
 console.error('Database error in GET /events/:id/timeslots:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Register for event
  // HINWEIS: Dieser Endpunkt ist die primäre Konfi-Buchungsroute.
  // events.js POST /:id/book ist die ältere Route (wird vom Admin-Frontend genutzt).
  // Beide verwenden einheitlich status='waitlist' für Wartelisten-Einträge.
  router.post('/events/:id/register', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }

    try {
      const konfiId = req.user.id;
      const eventId = req.params.id;
      const { timeslot_id } = req.body; // Optional timeslot for timeslot events

      // Transaktion starten für Race-Condition-Schutz
      const client = await db.getClient();
      try {
      await client.query('BEGIN');

      // Check if already registered
      const existing = await checkExistingBooking(client, konfiId, eventId);

      if (existing) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({ error: 'Du bist bereits für dieses Event angemeldet' });
      }

      // Check if this is a Konfirmation event and if user already has one
      // (flag-basiert seit Phase 117 — Migration 091 hat die "Konfirmation"-Kategorie entfernt)
      const isKonfirmationQuery = `
        SELECT e.id
        FROM events e
        WHERE e.id = $1 AND e.is_konfirmation = true
      `;
      const { rows: [isKonfirmation] } = await client.query(isKonfirmationQuery, [eventId]);

      if (isKonfirmation) {
        // Check if user already has a confirmed konfirmation booking
        const existingKonfirmationQuery = `
          SELECT eb.id
          FROM event_bookings eb
          JOIN events e ON eb.event_id = e.id
          WHERE eb.user_id = $1
            AND eb.status = 'confirmed'
            AND e.is_konfirmation = true
            AND e.organization_id = $2
        `;
        const { rows: [existingKonfirmation] } = await client.query(existingKonfirmationQuery, [konfiId, req.user.organization_id]);

        if (existingKonfirmation) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(409).json({
            error: 'Du hast bereits einen Konfirmationstermin gebucht. Bitte melde dich zuerst vom bisherigen Termin ab.'
          });
        }
      }

      // Get event details and current registration count (FOR UPDATE sperrt die Event-Zeile)
      const event = await getEventWithCounts(client, eventId, req.user.organization_id);

      if (!event) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      // Registrierungsfenster prüfen
      const regCheck = validateRegistrationWindow(event);
      if (!regCheck.valid) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ error: regCheck.error });
      }

      // Check if event has timeslots and validate timeslot selection
      let selectedTimeslot = null;
      let maxCapacity = event.max_participants;
      let confirmedCount = parseInt(event.confirmed_count) || 0;
      let waitlistCount = parseInt(event.waitlist_count) || 0;

      if (event.has_timeslots) {
        if (!timeslot_id) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({ error: 'Bitte wähle einen Zeitslot aus' });
        }

        // Validate timeslot exists and belongs to this event
        const { rows: [timeslot] } = await client.query(
          'SELECT id, event_id, start_time, end_time, max_participants, organization_id FROM event_timeslots WHERE id = $1 AND event_id = $2',
          [timeslot_id, eventId]
        );

        if (!timeslot) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(404).json({ error: 'Zeitslot nicht gefunden' });
        }

        selectedTimeslot = timeslot;

        // Get timeslot-specific counts
        const timeslotCountQuery = `
          SELECT
            COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed_count,
            COUNT(*) FILTER (WHERE status = 'waitlist') as waitlist_count
          FROM event_bookings
          WHERE timeslot_id = $1
        `;
        const { rows: [timeslotCounts] } = await client.query(timeslotCountQuery, [timeslot_id]);
        confirmedCount = parseInt(timeslotCounts.confirmed_count) || 0;
        waitlistCount = parseInt(timeslotCounts.waitlist_count) || 0;
        maxCapacity = timeslot.max_participants;
      }

      // Determine registration status
      const statusResult = determineBookingStatus(event, confirmedCount, waitlistCount, maxCapacity);
      if (typeof statusResult === 'object') {
        await client.query('ROLLBACK');
        client.release();
        return res.status(statusResult.status).json({ error: statusResult.error });
      }
      const status = statusResult;

      // Register for event (with optional timeslot_id).
      // organization_id MUSS gesetzt sein, sonst zaehlen Badge-Queries (event_count,
      // activity_count, ...) die Buchung nicht (sie filtern auf organization_id).
      const insertQuery = `
        INSERT INTO event_bookings (user_id, event_id, timeslot_id, status, booking_date, organization_id)
        VALUES ($1, $2, $3, $4, NOW(), $5)
        RETURNING id
      `;
      const { rows: [newBooking] } = await client.query(insertQuery, [konfiId, eventId, timeslot_id || null, status, req.user.organization_id]);

      // Transaktion abschliessen
      await client.query('COMMIT');
      client.release();

      const message = status === 'confirmed'
        ? 'Erfolgreich angemeldet'
        : `Auf Warteliste gesetzt (Platz ${waitlistCount + 1})`;

      res.json({
        message,
        registration_id: newBooking.id,
        status,
        timeslot_id: timeslot_id || null
      });

      // Push-Notification an Konfi senden (nach COMMIT)
      try {
        await PushService.sendEventRegisteredToKonfi(db, konfiId, event.name, event.event_date, status, eventId, selectedTimeslot);
      } catch (pushErr) {
        console.error('Error sending event registration push:', pushErr);
      }

      // Live-Update an Konfi und Admins senden
      liveUpdate.sendToKonfi(konfiId, 'events', 'update');
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update');

      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
        client.release();
        throw err;
      }
    } catch (err) {
      console.error('Database error in POST /events/:id/register:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Unregister from event
  router.delete('/events/:id/register', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }
    
    try {
      const konfiId = req.user.id;
      const eventId = req.params.id;
      const { reason } = req.body;

      // Guard: Pflicht-Events können nicht über DELETE abgemeldet werden
      const { rows: [eventCheck] } = await db.query(
        'SELECT mandatory FROM events WHERE id = $1',
        [eventId]
      );
      if (eventCheck && eventCheck.mandatory) {
        return res.status(400).json({ error: 'Pflicht-Events können nur über Opt-out abgemeldet werden' });
      }

      // Check if konfi is registered
      const { rows: [registration] } = await db.query(
        'SELECT id, user_id, event_id, status, booking_date, timeslot_id, organization_id FROM event_bookings WHERE user_id = $1 AND event_id = $2',
        [konfiId, eventId]
      );

      if (!registration) {
        return res.status(400).json({ error: 'Du bist nicht für dieses Event angemeldet' });
      }
      
      // Check if event exists and get event details
      const { rows: [event] } = await db.query(
        'SELECT name, event_date FROM events WHERE id = $1 AND organization_id = $2',
        [eventId, req.user.organization_id]
      );
      
      if (!event) {
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }
      
      // Check if unregistration is still allowed (2 days before event)
      const eventDate = new Date(event.event_date);
      const now = new Date();
      const twoDaysBeforeEvent = new Date(eventDate.getTime() - (2 * 24 * 60 * 60 * 1000));
      
      if (now >= twoDaysBeforeEvent) {
        return res.status(400).json({ 
          error: 'Abmeldung ist nur bis 2 Tage vor dem Event möglich' 
        });
      }
      
      // Delete registration
      await db.query(
        'DELETE FROM event_bookings WHERE user_id = $1 AND event_id = $2',
        [konfiId, eventId]
      );

      // Nachrücken von Warteliste wenn ein bestätigter Platz frei wird
      if (registration.status === 'confirmed') {
        try {
          // Kapazitaet pruefen: Nur nachruecken wenn confirmedCount < maxCapacity
          const { rows: [countResult] } = await db.query(
            "SELECT COUNT(*) as confirmed_count FROM event_bookings WHERE event_id = $1 AND status = 'confirmed'",
            [eventId]
          );
          const maxCapacity = event.max_participants || 0;
          const confirmedCount = parseInt(countResult?.confirmed_count || '0', 10);

          if (maxCapacity === 0 || confirmedCount < maxCapacity) {
            const promotedUserId = await promoteFromWaitlist(db, eventId, registration.timeslot_id);

            if (promotedUserId) {
              // Push-Notification an nachgerückten Konfi
              try {
                await PushService.sendWaitlistPromotionToKonfi(db, promotedUserId, event.name, event.event_date, eventId);
              } catch (pushErr) {
                console.error('Error sending waitlist promotion push:', pushErr);
              }

              // Live-Update an nachgerückten Konfi
              liveUpdate.sendToKonfi(promotedUserId, 'events', 'update');
            }
          }
        } catch (promotionErr) {
          console.error('Error promoting from waitlist:', promotionErr);
          // Stornierung war bereits erfolgreich, Promotion-Fehler nicht an User weitergeben
        }
      }

      // IMMER Abmeldung protokollieren (mit oder ohne Grund)
      await db.query(
        'INSERT INTO event_unregistrations (user_id, event_id, reason, unregistered_at, organization_id) VALUES ($1, $2, $3, NOW(), $4)',
        [konfiId, eventId, reason || null, req.user.organization_id]
      );

      // Hole Konfi-Name für Admin-Push
      const { rows: [konfiData] } = await db.query(
        'SELECT display_name FROM users WHERE id = $1',
        [konfiId]
      );
      const konfiName = konfiData?.display_name || 'Ein Konfi';

      res.json({ message: 'Abmeldung erfolgreich' });

      // Push-Notification an Konfi senden
      try {
        await PushService.sendEventUnregisteredToKonfi(db, konfiId, event.name);
      } catch (pushErr) {
 console.error('Error sending event unregistration push to konfi:', pushErr);
      }

      // Push-Notification an ALLE Admins senden
      try {
        await PushService.sendEventUnregistrationToAdmins(db, req.user.organization_id, konfiName, event.name, reason);
      } catch (pushErr) {
 console.error('Error sending event unregistration push to admins:', pushErr);
      }

      // Live-Update an Konfi und Admins senden
      liveUpdate.sendToKonfi(konfiId, 'events', 'update');
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update');
    } catch (err) {
 console.error('Database error in DELETE /events/:id/register:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Opt-out from mandatory event
  router.post('/events/:id/opt-out', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }

    try {
      const konfiId = req.user.id;
      const eventId = req.params.id;
      const { reason } = req.body;

      // Validierung: Begründung muss mindestens 5 Zeichen haben
      if (!reason || reason.trim().length < 5) {
        return res.status(400).json({ error: 'Begründung muss mindestens 5 Zeichen haben' });
      }

      // Event laden
      const { rows: [event] } = await db.query(
        'SELECT name, event_date, mandatory, organization_id FROM events WHERE id = $1 AND organization_id = $2',
        [eventId, req.user.organization_id]
      );

      if (!event) {
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      // Guard: Nur bei Pflicht-Events
      if (!event.mandatory) {
        return res.status(400).json({ error: 'Opt-out nur bei Pflicht-Events möglich' });
      }

      // Guard: Event darf nicht vorbei sein
      if (new Date(event.event_date) <= new Date()) {
        return res.status(400).json({ error: 'Event ist bereits vorbei' });
      }

      // Status-Wechsel: confirmed -> opted_out
      const { rowCount } = await db.query(
        `UPDATE event_bookings SET status = 'opted_out', opt_out_reason = $3, opt_out_date = NOW()
         WHERE user_id = $1 AND event_id = $2 AND status = 'confirmed'`,
        [konfiId, eventId, reason.trim()]
      );

      if (rowCount === 0) {
        return res.status(400).json({ error: 'Keine aktive Anmeldung gefunden' });
      }

      res.json({ message: 'Abmeldung erfolgreich' });

      // Push an Admins (fire-and-forget)
      try {
        const konfiName = req.user.display_name || req.user.username;
        await PushService.sendEventOptOutToAdmins(db, req.user.organization_id, konfiName, event.name, reason.trim());
      } catch (pushErr) {
        console.error('Opt-out push error:', pushErr);
      }

      // Live-Update
      liveUpdate.sendToKonfi(konfiId, 'events', 'update');
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update');

    } catch (err) {
      console.error('Database error in POST /events/:id/opt-out:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Opt-in back to mandatory event (reverse opt-out)
  router.post('/events/:id/opt-in', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }

    try {
      const konfiId = req.user.id;
      const eventId = req.params.id;

      // Event laden
      const { rows: [event] } = await db.query(
        'SELECT name, event_date, mandatory, organization_id FROM events WHERE id = $1 AND organization_id = $2',
        [eventId, req.user.organization_id]
      );

      if (!event) {
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      // Guard: Nur bei Pflicht-Events
      if (!event.mandatory) {
        return res.status(400).json({ error: 'Opt-in nur bei Pflicht-Events möglich' });
      }

      // Guard: Event darf nicht vorbei sein
      if (new Date(event.event_date) <= new Date()) {
        return res.status(400).json({ error: 'Event ist bereits vorbei' });
      }

      // Status-Wechsel: opted_out -> confirmed (opt_out_reason bleibt erhalten)
      const { rowCount } = await db.query(
        `UPDATE event_bookings SET status = 'confirmed'
         WHERE user_id = $1 AND event_id = $2 AND status = 'opted_out'`,
        [konfiId, eventId]
      );

      if (rowCount === 0) {
        return res.status(400).json({ error: 'Keine Opt-out-Anmeldung gefunden' });
      }

      res.json({ message: 'Wieder angemeldet' });

      // Push an Admins (fire-and-forget)
      try {
        const konfiName = req.user.display_name || req.user.username;
        await PushService.sendEventOptInToAdmins(db, req.user.organization_id, konfiName, event.name);
      } catch (pushErr) {
        console.error('Opt-in push error:', pushErr);
      }

      // Live-Update
      liveUpdate.sendToKonfi(konfiId, 'events', 'update');
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update');

    } catch (err) {
      console.error('Database error in POST /events/:id/opt-in:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Update bible translation preference
  router.put('/bible-translation', verifyTokenRBAC, validateBibleTranslation, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }
    
    try {
      const konfiId = req.user.id;
      const { translation } = req.body;
      
      // Validate translation
      const validTranslations = ['LUT', 'ELB', 'GNB', 'BIGS', 'NIV', 'LSG', 'RVR60'];
      if (!validTranslations.includes(translation)) {
        return res.status(400).json({ 
          error: 'Ungültige Bibelübersetzung',
          valid_translations: validTranslations
        });
      }
      
      // Update konfi profile with new translation preference
      await db.query(
        'UPDATE konfi_profiles SET bible_translation = $1 WHERE user_id = $2',
        [translation, konfiId]
      );
      
      res.json({
        success: true,
        message: 'Bibelübersetzung erfolgreich aktualisiert',
        translation: translation
      });
      
    } catch (err) {
 console.error('Database error in PUT /bible-translation:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Gueltige Translation-Keys fuer den Konfispruch (deskriptiv, NICHT die Kuerzel
  // aus PUT /bible-translation). Diese Werte landen in der DEDIZIERTEN Spalte
  // konfspruch_translation - getrennt von der Tageslosungs-Praeferenz bible_translation,
  // damit sich die beiden Features nicht gegenseitig ueberschreiben.
  const KONFSPRUCH_TRANSLATIONS = ['luther2017', 'bigs', 'gute_nachricht', 'elberfelder'];

  // Kuratierte Konfsprueche fuer das Auswahl-Modal (org-gefiltert)
  router.get('/konfsprueche', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }

    try {
      const orgId = req.user.organization_id;
      const query = `
        SELECT ks.id, ks.reference, ks.book, ks.chapter, ks.verse,
               COALESCE(
                 json_object_agg(ku.translation, ku.text) FILTER (WHERE ku.translation IS NOT NULL),
                 '{}'::json
               ) AS uebersetzungen
        FROM konfsprueche ks
        LEFT JOIN konfspruch_uebersetzungen ku ON ku.spruch_id = ks.id
        WHERE ks.is_active = true
          AND (ks.organization_id IS NULL OR ks.organization_id = $1)
        GROUP BY ks.id, ks.reference, ks.book, ks.chapter, ks.verse, ks.sort_order
        ORDER BY ks.sort_order, ks.id
      `;
      const { rows } = await db.query(query, [orgId]);

      // Sicherstellen, dass alle 4 Keys vorhanden sind (fehlende -> leerer Platzhalter)
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
      console.error('Database error in GET /konfsprueche:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Konfispruch setzen: Listen-Wahl ODER Freitext (genau EINE Quelle aktiv).
  // RBAC: nur Konfi, nur eigenes Profil (WHERE user_id = req.user.id).
  router.patch('/profile', verifyTokenRBAC, async (req, res) => {
    if (req.user.type !== 'konfi') {
      return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
    }

    try {
      const konfiId = req.user.id;
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
        // Spruch muss existieren und fuer die Org sichtbar sein
        const { rows: [spruch] } = await db.query(
          `SELECT id FROM konfsprueche
           WHERE id = $1 AND is_active = true
             AND (organization_id IS NULL OR organization_id = $2)`,
          [spruchId, orgId]
        );
        if (!spruch) {
          return res.status(404).json({ error: 'Konfispruch nicht gefunden' });
        }
        // Listen-Wahl setzen, Freitext loeschen (Exklusivitaet).
        // konfspruch_translation ist die DEDIZIERTE Spalte - bible_translation (Tageslosung)
        // wird hier bewusst NICHT angefasst.
        await db.query(
          `UPDATE konfi_profiles
           SET konfspruch_id = $1, konfspruch_translation = $2,
               konfspruch_freitext = NULL, konfspruch_freitext_referenz = NULL
           WHERE user_id = $3`,
          [spruchId, translation, konfiId]
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
        // Laengen-Validierung (referenz -> VARCHAR(100), freitext -> sinnvolles Limit),
        // damit ein zu langer Wert einen sauberen 400 statt eines Postgres-22001/500 liefert.
        if (referenz.length > 100) {
          return res.status(400).json({ error: 'Die Stellenangabe darf höchstens 100 Zeichen lang sein' });
        }
        if (freitext.length > 1000) {
          return res.status(400).json({ error: 'Der Spruchtext ist zu lang' });
        }
        // Freitext setzen, Listen-Wahl loeschen (Exklusivitaet).
        // konfspruch_translation bleibt unveraendert (Freitext hat keine Uebersetzungs-Tabs).
        await db.query(
          `UPDATE konfi_profiles
           SET konfspruch_freitext = $1, konfspruch_freitext_referenz = $2,
               konfspruch_id = NULL
           WHERE user_id = $3`,
          [freitext, referenz, konfiId]
        );
        return res.json({
          success: true,
          konfspruch: { source: 'freitext', text: freitext, reference: referenz }
        });
      }

      // Weder gueltige Listen-Wahl noch Freitext
      return res.status(400).json({
        error: 'Bitte entweder einen Spruch aus der Liste (konfspruch_id + translation) oder einen eigenen Spruch (konfspruch_freitext + konfspruch_freitext_referenz) angeben'
      });
    } catch (err) {
      console.error('Database error in PATCH /profile:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  return router;
};