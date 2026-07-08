// backend/utils/konfiBadgeProgress.js
// Berechnet fuer EINEN Konfi (beliebige user_id in einer Organisation) die
// vollstaendige Badge-Liste inkl. Fortschritt — identisch zur Anzeige, die der
// Konfi selbst unter GET /konfi/badges sieht.
//
// Extrahiert aus konfi.js GET /badges, damit die Admin-Konfi-Detail-View
// (GET /admin/konfis/:id/badges) exakt dieselbe Wertung/Progress-Logik nutzt
// wie die Konfi-App — EINE Quelle statt zweier auseinanderlaufender Kopien.
//
// KONSISTENZ-VERTRAG: Die Zaehl-Semantik jeder Query bleibt identisch zur
// Wertung in badges.js (checkAndAwardBadges). Progress und Vergabe muessen
// exakt gleich zaehlen, sonst zeigt die App 10/10 ohne dass der Badge kommt.

const { computeCurrentStreak } = require('./streakCalculation');
const { KONFI_BADGE_EVENT_CONDITION } = require('./badgeEventRule');

// Ermittelt Badges (earned + available + Fortschritt) fuer einen Konfi.
// Erwartet: db (pg Pool), konfiId (users.id), organizationId.
// Gibt { available, earned, stats } zurueck — dasselbe Shape wie GET /konfi/badges.
async function getKonfiBadgeProgress(db, konfiId, organizationId) {
  const checkBadgesTableQuery = "SELECT to_regclass('public.custom_badges')";
  const { rows: [tableExistsResult] } = await db.query(checkBadgesTableQuery);

  if (!tableExistsResult || !tableExistsResult.to_regclass) {
    return { available: [], earned: [], stats: { totalVisible: 0, totalSecret: 0 } };
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
  // Streak- und time_based-Badges teilen sich dieselbe Datumsliste.
  const datesQuery = `
    SELECT completed_date as date FROM user_activities WHERE user_id = $1 AND organization_id = $2
    UNION ALL
    SELECT e.event_date as date FROM event_bookings eb
    JOIN events e ON eb.event_id = e.id
    WHERE eb.user_id = $1 AND ${KONFI_BADGE_EVENT_CONDITION} AND eb.organization_id = $2
    ORDER BY date DESC
  `;
  const [
    badgesRes,
    pointsRes,
    activityCountRes,
    eventCountRes,
    mandatoryEventCountRes,
    uniqueActivitiesRes,
    bonusPointsRes,
    datesRes,
    categoryCountsRes,
    activityNameCountsRes,
    totalStatsRes
  ] = await Promise.all([
    db.query(query, [konfiId, organizationId]),
    db.query(
      `SELECT kp.gottesdienst_points, kp.gemeinde_points, j.gottesdienst_enabled, j.gemeinde_enabled
       FROM konfi_profiles kp JOIN jahrgaenge j ON kp.jahrgang_id = j.id WHERE kp.user_id = $1`,
      [konfiId]
    ),
    db.query(
      'SELECT COUNT(*) as count FROM user_activities WHERE user_id = $1 AND organization_id = $2',
      [konfiId, organizationId]
    ),
    db.query(
      `SELECT COUNT(*) as count FROM event_bookings eb JOIN events e ON eb.event_id = e.id WHERE eb.user_id = $1 AND ${KONFI_BADGE_EVENT_CONDITION} AND eb.organization_id = $2`,
      [konfiId, organizationId]
    ),
    db.query(
      `SELECT COUNT(*) FROM event_bookings eb JOIN events e ON eb.event_id = e.id
         WHERE eb.user_id = $1 AND eb.attendance_status = 'present' AND e.mandatory = true AND eb.organization_id = $2`,
      [konfiId, organizationId]
    ),
    db.query(
      'SELECT COUNT(DISTINCT activity_id) as count FROM user_activities WHERE user_id = $1 AND organization_id = $2',
      [konfiId, organizationId]
    ),
    db.query(
      'SELECT COALESCE(SUM(points), 0) as total FROM bonus_points WHERE konfi_id = $1 AND organization_id = $2',
      [konfiId, organizationId]
    ),
    db.query(datesQuery, [konfiId, organizationId]),
    db.query(
      `SELECT name, COUNT(*) as count FROM (
         SELECT ka.id, c.name FROM user_activities ka
         JOIN activities a ON ka.activity_id = a.id
         JOIN activity_categories ac ON a.id = ac.activity_id
         JOIN categories c ON ac.category_id = c.id
         WHERE ka.user_id = $1 AND a.organization_id = $2 AND c.organization_id = $2
         UNION ALL
         SELECT eb.id, c.name FROM event_bookings eb
         JOIN events e ON eb.event_id = e.id
         JOIN event_categories ec ON eb.event_id = ec.event_id
         JOIN categories c ON ec.category_id = c.id
         WHERE eb.user_id = $1 AND ${KONFI_BADGE_EVENT_CONDITION} AND c.organization_id = $2 AND eb.organization_id = $2
       ) as combined GROUP BY name`,
      [konfiId, organizationId]
    ),
    db.query(
      `SELECT a.name, COUNT(*) as count FROM user_activities ua
       JOIN activities a ON ua.activity_id = a.id
       WHERE ua.user_id = $1 AND a.organization_id = $2
       GROUP BY a.name`,
      [konfiId, organizationId]
    ),
    db.query(
      `SELECT
        COUNT(*) FILTER (WHERE is_hidden = false) as total_visible,
        COUNT(*) FILTER (WHERE is_hidden = true) as total_secret
      FROM custom_badges
      WHERE is_active = TRUE AND organization_id = $1`,
      [organizationId]
    )
  ]);

  const badges = badgesRes.rows;
  const pointsRow = pointsRes.rows[0];
  const gdEnabled = !!pointsRow?.gottesdienst_enabled;
  const gmEnabled = !!pointsRow?.gemeinde_enabled;
  // parseInt: pg liefert die Punkte als String -> sonst String-Konkatenation statt Addition.
  const gdPoints = gdEnabled ? (parseInt(pointsRow?.gottesdienst_points, 10) || 0) : 0;
  const gmPoints = gmEnabled ? (parseInt(pointsRow?.gemeinde_points, 10) || 0) : 0;

  const activityCount = parseInt(activityCountRes.rows[0]?.count || 0);
  const eventCount = parseInt(eventCountRes.rows[0]?.count || 0);
  const mandatoryEventCount = parseInt(mandatoryEventCountRes.rows[0]?.count || 0);
  const uniqueActivityCount = parseInt(uniqueActivitiesRes.rows[0]?.count || 0);
  const bonusPointsTotal = parseInt(bonusPointsRes.rows[0]?.total || 0);
  const allDates = datesRes.rows.map(r => r.date);
  const currentStreak = computeCurrentStreak(allDates);
  // Map statt Plain Object: schuetzt vor Prototype-Keys als Kategorie-/Aktivitaetsnamen.
  const categoryCounts = new Map(categoryCountsRes.rows.map(r => [r.name, parseInt(r.count)]));
  const activityNameCounts = new Map(activityNameCountsRes.rows.map(r => [r.name, parseInt(r.count)]));

  const isUnreachable = (badge) => {
    switch (badge.criteria_type) {
      case 'gottesdienst_points': return !gdEnabled;
      case 'gemeinde_points': return !gmEnabled;
      case 'both_categories': return !gdEnabled || !gmEnabled;
      case 'total_points': return !gdEnabled && !gmEnabled;
      default: return false;
    }
  };

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
          progress.current = (!gdEnabled || !gmEnabled) ? 0 : Math.min(gdPoints, gmPoints);
          break;
        }
        case 'activity_count': {
          progress.current = activityCount + eventCount;
          break;
        }
        case 'event_count': {
          progress.current = eventCount;
          break;
        }
        case 'mandatory_event_count': {
          progress.current = mandatoryEventCount;
          break;
        }
        case 'teamer_year': {
          progress.current = 0;
          break;
        }
        case 'unique_activities':
          progress.current = uniqueActivityCount;
          break;
        case 'specific_activity': {
          let requiredActivityName = null;
          try {
            const extraData = typeof badge.criteria_extra === 'string' ? JSON.parse(badge.criteria_extra || '{}') : (badge.criteria_extra || {});
            requiredActivityName = extraData.required_activity_name;
          } catch (e) {
            console.error('Error parsing criteria_extra for specific_activity badge:', e);
          }
          progress.current = requiredActivityName ? (activityNameCounts.get(requiredActivityName) || 0) : 0;
          break;
        }
        case 'category_activities': {
          let requiredCategory = null;
          try {
            const extraData = typeof badge.criteria_extra === 'string' ? JSON.parse(badge.criteria_extra || '{}') : (badge.criteria_extra || {});
            requiredCategory = extraData.required_category;
          } catch (e) {
            console.error('Error parsing criteria_extra for category_activities badge:', e);
          }
          progress.current = requiredCategory ? (categoryCounts.get(requiredCategory) || 0) : 0;
          break;
        }
        case 'activity_combination': {
          let requiredActivities = [];
          try {
            const extraData = typeof badge.criteria_extra === 'string' ? JSON.parse(badge.criteria_extra || '{}') : (badge.criteria_extra || {});
            requiredActivities = extraData.required_activities || [];
          } catch (e) {
            console.error('Error parsing criteria_extra for activity_combination badge:', e);
          }
          progress.current = requiredActivities.filter(name => (activityNameCounts.get(name) || 0) > 0).length;
          break;
        }
        case 'bonus_points':
          progress.current = bonusPointsTotal;
          break;
        case 'streak': {
          progress.current = currentStreak;
          break;
        }
        case 'time_based': {
          let tbDays = null;
          try {
            const extraData = typeof badge.criteria_extra === 'string' ? JSON.parse(badge.criteria_extra || '{}') : (badge.criteria_extra || {});
            tbDays = extraData.days || (extraData.weeks ? extraData.weeks * 7 : null);
          } catch (e) {
            console.error('Error parsing criteria_extra for time_based badge:', e);
          }
          if (tbDays) {
            const now = new Date();
            const cutoff = new Date(now.getTime() - (tbDays * 24 * 60 * 60 * 1000));
            progress.current = allDates.filter(d => new Date(d) >= cutoff).length;
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

  const earned = badges.filter(badge => badge.earned);
  const available = badges.filter(badge => !badge.earned && !badge.is_hidden && !badge.unreachable);

  const totalStats = totalStatsRes.rows[0];

  return {
    available,
    earned,
    stats: {
      totalVisible: parseInt(totalStats.total_visible) || 0,
      totalSecret: parseInt(totalStats.total_secret) || 0
    }
  };
}

module.exports = { getKonfiBadgeProgress };
