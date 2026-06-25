const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors, commonValidations } = require('../middleware/validation');
const PushService = require('../services/pushService');
const liveUpdate = require('../utils/liveUpdate');
const { computeCurrentStreak } = require('../utils/streakCalculation');
// Single Source of Truth: welche Events zaehlen fuer Badges (Konfi vs. Teamer).
const { KONFI_BADGE_EVENT_CONDITION } = require('../utils/badgeEventRule');

// Badge criteria types
const CRITERIA_TYPES = {
  // === PUNKTE-BASIERTE KRITERIEN (Einfach & häufig verwendet) ===
  total_points: { 
    label: "Gesamtpunkte", 
    description: "Mindestanzahl aller Punkte",
    help: "Badge wird vergeben, wenn die Summe aus Gottesdienst- und Gemeindepunkten erreicht wird. Beispiel: Wert 20 = mindestens 20 Punkte insgesamt."
  },
  gottesdienst_points: { 
    label: "Gottesdienst-Punkte", 
    description: "Mindestanzahl gottesdienstlicher Punkte",
    help: "Badge wird vergeben, wenn die angegebene Anzahl gottesdienstlicher Punkte erreicht wird. Beispiel: Wert 10 = mindestens 10 Gottesdienst-Punkte."
  },
  gemeinde_points: { 
    label: "Gemeinde-Punkte", 
    description: "Mindestanzahl gemeindlicher Punkte",
    help: "Badge wird vergeben, wenn die angegebene Anzahl gemeindlicher Punkte erreicht wird. Beispiel: Wert 15 = mindestens 15 Gemeinde-Punkte."
  },
  both_categories: { 
    label: "Beide Kategorien", 
    description: "Mindestpunkte in beiden Bereichen",
    help: "Badge wird vergeben, wenn sowohl bei Gottesdienst- als auch bei Gemeindepunkten der Mindestwert erreicht wird. Beispiel: Wert 5 = mindestens 5 Gottesdienst-Punkte UND 5 Gemeinde-Punkte."
  },
  
  // === AKTIVITÄTS-BASIERTE KRITERIEN (Mittlere Komplexität) ===
  activity_count: {
    label: "Aktivitäten & Events",
    description: "Gesamtanzahl aller Aktivitäten und Events",
    help: "Badge wird vergeben, wenn die angegebene Anzahl von Aktivitäten und besuchten Events erreicht wird. Beispiel: Wert 10 = mindestens 10 Aktivitäten/Events."
  },
  event_count: {
    label: "Event-Teilnahmen",
    description: "Anzahl besuchter Events",
    help: "Badge wird vergeben, wenn die angegebene Anzahl von Events besucht wurde (mit Anwesenheit bestätigt). Beispiel: Wert 6 = mindestens 6 Events besucht."
  },
  mandatory_event_count: {
    label: "Pflicht-Anwesenheit",
    description: "Anzahl besuchter Pflicht-Events",
    help: "Badge wird vergeben, wenn die angegebene Anzahl von Pflicht-Events besucht wurde. Es zählen ausschließlich Events mit Pflicht-Markierung UND bestätigter Anwesenheit. Nicht-Pflicht-Events und nicht besuchte Pflicht-Events zählen nicht mit. Beispiel: Wert 12 = mindestens 12 Pflicht-Events besucht."
  },
  unique_activities: {
    label: "Verschiedene Aktivitäten",
    description: "Anzahl unterschiedlicher Aktivitäten",
    help: "Badge wird vergeben, wenn die angegebene Anzahl verschiedener Aktivitäten absolviert wurde. Mehrfache Teilnahme an derselben Aktivität zählt nur einmal. Beispiel: Wert 3 = 3 verschiedene Aktivitäten."
  },
  
  // === SPEZIFISCHE AKTIVITÄTS-KRITERIEN (Spezifischer) ===
  specific_activity: { 
    label: "Spezifische Aktivität", 
    description: "Bestimmte Aktivität X-mal absolviert",
    help: "Badge wird vergeben, wenn eine bestimmte Aktivität die angegebene Anzahl mal absolviert wurde. Beispiel: Wert 5 + 'Sonntagsgottesdienst' = 5x am Sonntagsgottesdienst teilgenommen."
  },
  category_activities: {
    label: "Kategorie-Aktivitäten",
    description: "Aktivitäten & Events aus Kategorie",
    help: "Badge wird vergeben, wenn die angegebene Anzahl von Aktivitäten und Events aus einer bestimmten Kategorie absolviert wurde. Beispiel: Wert 3 + Kategorie 'Kasualien' = 3 Kasualien (Aktivitäten oder Events)."
  },
  activity_combination: {
    label: "Aktivitäts-Kombination",
    description: "Spezifische Kombination von Aktivitäten",
    help: "Badge wird vergeben, wenn alle ausgewählten Aktivitäten mindestens einmal absolviert wurden. Der Wert gibt die Mindestanzahl an benötigten Aktivitäten aus der Liste an. Beispiel: 'Adventskalender' - alle 24 Türchen besucht."
  },
  
  // === ZEIT-BASIERTE KRITERIEN (Komplex) ===
  time_based: {
    label: "Zeitbasiert",
    description: "Aktivitäten & Events im Zeitraum",
    help: "Badge wird vergeben, wenn die angegebene Anzahl von Aktivitäten und Events innerhalb der festgelegten Wochen absolviert wurde. Beispiel: Wert 2 + 4 Wochen = 2 Aktivitäten/Events in 4 Wochen."
  },
  streak: {
    label: "Serie",
    description: "Aufeinanderfolgende Wochen aktiv",
    help: "Badge wird vergeben, wenn in der angegebenen Anzahl aufeinanderfolgender Wochen mindestens eine Aktivität oder ein Event absolviert wurde. Beispiel: Wert 4 = 4 Wochen in Folge aktiv."
  },
  
  // === SPEZIAL-KRITERIEN (Selten verwendet) ===
  bonus_points: {
    label: "Bonuspunkte",
    description: "Anzahl erhaltener Bonuspunkte",
    help: "Badge wird vergeben, wenn die angegebene Anzahl von Bonuspunkt-Vergaben erhalten wurde (es zählt die Anzahl der Vergaben, nicht die Punktesumme). Beispiel: Wert 2 = mindestens 2 Bonuspunkt-Vergaben erhalten."
  },

  // === TEAMER-SPEZIFISCH ===
  teamer_year: {
    label: "Teamer-Jahr",
    description: "Aktive Teamer-Jahre",
    help: "Badge wird vergeben wenn der Teamer in X verschiedenen Jahren aktiv war (mind. 1 Aktivität oder Event pro Jahr). Inaktive Jahre werden übersprungen."
  }
};

const checkAndAwardBadges = async (db, userId) => {
  try {
    // Rolle des Users prüfen
    const roleCheckQuery = `SELECT u.organization_id, u.display_name as name, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`;
    const { rows: [userInfo] } = await db.query(roleCheckQuery, [userId]);
    if (!userInfo) return { count: 0, badges: [] };

    const isTeamer = userInfo.role_name === 'teamer';
    const organizationId = userInfo.organization_id;

    // =====================================================================
    // TEAMER-BRANCH
    // =====================================================================
    if (isTeamer) {
      return await checkAndAwardTeamerBadges(db, userId, organizationId);
    }

    // =====================================================================
    // KONFI-BRANCH (bestehende Logik)
    // =====================================================================
    const konfiQuery = `
      SELECT kp.*, u.display_name as name, u.organization_id
      FROM konfi_profiles kp
      JOIN users u ON kp.user_id = u.id
      WHERE kp.user_id = $1 AND u.deleted_at IS NULL
    `;
    const { rows: [konfi] } = await db.query(konfiQuery, [userId]);
    if (!konfi) return { count: 0, badges: [] };

    // Jahrgang-Config laden (gottesdienst_enabled/gemeinde_enabled)
    const jahrgangConfigQuery = `
      SELECT j.gottesdienst_enabled, j.gemeinde_enabled
      FROM konfi_profiles kp
      JOIN jahrgaenge j ON kp.jahrgang_id = j.id
      WHERE kp.user_id = $1
    `;
    const { rows: [jahrgangConfig] } = await db.query(jahrgangConfigQuery, [userId]);

    // Nur Konfi-Badges laden
    const { rows: badges } = await db.query(
      "SELECT id, name, description, icon, color, criteria_type, criteria_value, criteria_extra, is_hidden, sort_order, is_active, target_role, organization_id FROM custom_badges WHERE is_active = true AND organization_id = $1 AND target_role = 'konfi'",
      [konfi.organization_id]
    );
    if (badges.length === 0) return { count: 0, badges: [] };

    const { rows: earned } = await db.query("SELECT badge_id FROM user_badges WHERE user_id = $1 AND organization_id = $2", [userId, konfi.organization_id]);
    const alreadyEarned = earned.map(e => e.badge_id);

    let newBadges = 0;
    const earnedBadgeIds = [];
    const earnedBadgeDetails = [];

    // Vorab-Queries: activity_count, event_count, bonus_count, completed_activities, unique_activities
    const [
      { rows: [preActCount] },
      { rows: [preEvCount] },
      { rows: [preBonusCount] },
      { rows: preCompletedActs },
      { rows: preUniqueActs }
    ] = await Promise.all([
      db.query("SELECT COUNT(*) as count FROM user_activities WHERE user_id = $1 AND organization_id = $2", [userId, konfi.organization_id]),
      // event_count/activity_count: nur freiwillige, bestaetigte Events (kein Pflicht/Konfirmation).
      db.query(`SELECT COUNT(*) as count FROM event_bookings eb JOIN events e ON eb.event_id = e.id WHERE eb.user_id = $1 AND ${KONFI_BADGE_EVENT_CONDITION} AND eb.organization_id = $2`, [userId, konfi.organization_id]),
      // bonus_points-Badge meint die SUMME der Bonuspunkte (Frontend-Label "Punkte"),
      // nicht die Anzahl der Eintraege -> SUM(points), konsistent zum Progress (konfi.js).
      db.query("SELECT COALESCE(SUM(points), 0) as count FROM bonus_points WHERE konfi_id = $1 AND organization_id = $2", [userId, konfi.organization_id]),
      db.query("SELECT DISTINCT a.name FROM user_activities ua JOIN activities a ON ua.activity_id = a.id WHERE ua.user_id = $1 AND a.organization_id = $2", [userId, konfi.organization_id]),
      db.query("SELECT DISTINCT activity_id FROM user_activities WHERE user_id = $1 AND organization_id = $2", [userId, konfi.organization_id])
    ]);

    const preloaded = {
      activityCount: parseInt(preActCount.count),
      eventCount: parseInt(preEvCount.count),
      bonusCount: parseInt(preBonusCount.count),
      completedActivityNames: preCompletedActs.map(r => r.name),
      uniqueActivityCount: preUniqueActs.length
    };

    for (const badge of badges) {
      if (alreadyEarned.includes(badge.id)) continue;

      let earned = false;
      const criteria = typeof badge.criteria_extra === 'object' && badge.criteria_extra !== null
        ? badge.criteria_extra
        : JSON.parse(badge.criteria_extra || '{}');

      switch (badge.criteria_type) {
        case 'total_points': {
          if (!jahrgangConfig) { earned = false; break; }
          let total = 0;
          if (jahrgangConfig.gottesdienst_enabled) total += konfi.gottesdienst_points;
          if (jahrgangConfig.gemeinde_enabled) total += konfi.gemeinde_points;
          earned = total >= badge.criteria_value;
          break;
        }
        case 'gottesdienst_points':
          if (!jahrgangConfig?.gottesdienst_enabled) { earned = false; break; }
          earned = konfi.gottesdienst_points >= badge.criteria_value;
          break;
        case 'gemeinde_points':
          if (!jahrgangConfig?.gemeinde_enabled) { earned = false; break; }
          earned = konfi.gemeinde_points >= badge.criteria_value;
          break;
        case 'both_categories':
          if (!jahrgangConfig?.gottesdienst_enabled || !jahrgangConfig?.gemeinde_enabled) { earned = false; break; }
          earned = konfi.gottesdienst_points >= badge.criteria_value && konfi.gemeinde_points >= badge.criteria_value;
          break;

        case 'specific_activity':
          if (criteria.required_activity_name) {
            if (badge.criteria_value <= 1) {
              earned = preloaded.completedActivityNames.includes(criteria.required_activity_name);
            } else {
              const { rows: [result] } = await db.query(`SELECT COUNT(*) as count FROM user_activities ka JOIN activities a ON ka.activity_id = a.id WHERE ka.user_id = $1 AND a.name = $2 AND a.organization_id = $3`, [userId, criteria.required_activity_name, konfi.organization_id]);
              earned = result && parseInt(result.count) >= badge.criteria_value;
            }
          }
          break;

        case 'activity_combination':
          if (criteria.required_activities) {
            const matchCount = criteria.required_activities.filter(req => preloaded.completedActivityNames.includes(req)).length;
            earned = matchCount >= badge.criteria_value;
          }
          break;

        case 'category_activities':
          if (criteria.required_category) {
            const categoryCountQuery = `
              SELECT COUNT(*) as count FROM (
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
              ) as combined
            `;
            const { rows: [result] } = await db.query(categoryCountQuery, [userId, criteria.required_category, konfi.organization_id]);
            earned = result && parseInt(result.count) >= badge.criteria_value;
          }
          break;

        case 'time_based':
          {
            const days = criteria.days || (criteria.weeks ? criteria.weeks * 7 : null);
            if (days) {
              const timeBasedQuery = `
                SELECT completed_date as date FROM user_activities WHERE user_id = $1 AND organization_id = $2
                UNION ALL
                SELECT e.event_date as date FROM event_bookings eb
                JOIN events e ON eb.event_id = e.id
                WHERE eb.user_id = $1 AND ${KONFI_BADGE_EVENT_CONDITION} AND eb.organization_id = $2
                ORDER BY date DESC
              `;
              const { rows: results } = await db.query(timeBasedQuery, [userId, konfi.organization_id]);
              const now = new Date();
              const cutoff = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
              const recentCount = results.filter(r => new Date(r.date) >= cutoff).length;
              earned = recentCount >= badge.criteria_value;
            }
          }
          break;

        case 'activity_count': {
          earned = (preloaded.activityCount + preloaded.eventCount) >= badge.criteria_value;
          break;
        }

        case 'event_count': {
          earned = preloaded.eventCount >= badge.criteria_value;
          break;
        }

        case 'mandatory_event_count': {
          // Zaehlt NUR besuchte Pflicht-Events (events.mandatory=true + attendance_status='present').
          // KONSISTENZ-VERTRAG: Diese Query muss in konfi.js (Progress) byte-identisch verwendet werden.
          const { rows: [mandResult] } = await db.query(
            `SELECT COUNT(*) FROM event_bookings eb JOIN events e ON eb.event_id = e.id
             WHERE eb.user_id = $1 AND eb.attendance_status = 'present' AND e.mandatory = true AND eb.organization_id = $2`,
            [userId, konfi.organization_id]
          );
          earned = parseInt(mandResult.count) >= badge.criteria_value;
          break;
        }

        case 'bonus_points': {
          earned = preloaded.bonusCount >= badge.criteria_value;
          break;
        }

        case 'unique_activities': {
          earned = preloaded.uniqueActivityCount >= badge.criteria_value;
          break;
        }

        case 'streak':
          earned = await checkStreakCriteria(db, userId, konfi.organization_id, badge.criteria_value);
          break;
      }

      if (earned) {
        earnedBadgeIds.push(badge.id);
        earnedBadgeDetails.push({
          id: badge.id,
          name: badge.name,
          icon: badge.icon,
          description: badge.description
        });
        newBadges++;
      }
    }

    if (earnedBadgeIds.length > 0) {
      await insertBadgesAndNotify(db, userId, organizationId, earnedBadgeIds, earnedBadgeDetails);
    }

    return { count: newBadges, badges: earnedBadgeDetails };
  } catch (err) {
    console.error('Error in checkAndAwardBadges:', err);
    throw err;
  }
};

// =====================================================================
// Teamer-Badge-Prüfung
// =====================================================================
async function checkAndAwardTeamerBadges(db, userId, organizationId) {
  // Teamer-Badges laden
  const { rows: badges } = await db.query(
    "SELECT id, name, description, icon, color, criteria_type, criteria_value, criteria_extra, is_hidden, sort_order, is_active, target_role, organization_id FROM custom_badges WHERE is_active = true AND organization_id = $1 AND target_role = 'teamer'",
    [organizationId]
  );
  if (badges.length === 0) return { count: 0, badges: [] };

  const { rows: earned } = await db.query("SELECT badge_id FROM user_badges WHERE user_id = $1 AND organization_id = $2", [userId, organizationId]);
  const alreadyEarned = earned.map(e => e.badge_id);

  // Punkte-basierte Kriterien-Typen die für Teamer irrelevant sind
  const pointsCriteria = ['total_points', 'gottesdienst_points', 'gemeinde_points', 'both_categories', 'bonus_points'];

  let newBadges = 0;
  const earnedBadgeIds = [];
  const earnedBadgeDetails = [];

  // Vorab-Queries: Teamer activity_count, event_count, completed_activities, unique_activities
  const [
    { rows: [teamerActCount] },
    { rows: [teamerEvCount] },
    { rows: teamerCompletedActs },
    { rows: teamerUniqueActs }
  ] = await Promise.all([
    db.query(`SELECT COUNT(*) as count FROM user_activities ua JOIN activities a ON ua.activity_id = a.id WHERE ua.user_id = $1 AND ua.organization_id = $2 AND a.target_role = 'teamer'`, [userId, organizationId]),
    // Teamer: ALLE bestaetigten Events zaehlen (inkl. Pflicht/Konfirmation) — Teamer
    // arbeiten dort mit, das ist eine legitime Zaehlung. (Anders als bei Konfis.)
    db.query("SELECT COUNT(*) as count FROM event_bookings WHERE user_id = $1 AND attendance_status = 'present' AND organization_id = $2", [userId, organizationId]),
    db.query(`SELECT DISTINCT a.name FROM user_activities ua JOIN activities a ON ua.activity_id = a.id WHERE ua.user_id = $1 AND a.organization_id = $2 AND a.target_role = 'teamer'`, [userId, organizationId]),
    db.query(`SELECT DISTINCT ua.activity_id FROM user_activities ua JOIN activities a ON ua.activity_id = a.id WHERE ua.user_id = $1 AND ua.organization_id = $2 AND a.target_role = 'teamer'`, [userId, organizationId])
  ]);

  const teamerPreloaded = {
    activityCount: parseInt(teamerActCount.count),
    eventCount: parseInt(teamerEvCount.count),
    completedActivityNames: teamerCompletedActs.map(r => r.name),
    uniqueActivityCount: teamerUniqueActs.length
  };

  for (const badge of badges) {
    if (alreadyEarned.includes(badge.id)) continue;

    // Punkte-basierte Kriterien sofort überspringen
    if (pointsCriteria.includes(badge.criteria_type)) continue;

    let badgeEarned = false;
    const criteria = JSON.parse(badge.criteria_extra || '{}');

    switch (badge.criteria_type) {
      case 'activity_count': {
        badgeEarned = (teamerPreloaded.activityCount + teamerPreloaded.eventCount) >= badge.criteria_value;
        break;
      }

      case 'event_count': {
        badgeEarned = teamerPreloaded.eventCount >= badge.criteria_value;
        break;
      }

      case 'streak':
        badgeEarned = await checkStreakCriteria(db, userId, organizationId, badge.criteria_value, true);
        break;

      case 'activity_combination': {
        let allMet = true;

        // Aktivitäten-Namen prüfen
        if (criteria.required_activities && criteria.required_activities.length > 0) {
          const actMatch = criteria.required_activities.filter(req => teamerPreloaded.completedActivityNames.includes(req)).length;
          if (actMatch < criteria.required_activities.length) allMet = false;
        }

        // Event-Namen prüfen (falls vorhanden). events-Spalte heisst 'name'
        // (nicht 'title') -> als title aliasen.
        if (allMet && criteria.required_events && criteria.required_events.length > 0) {
          const { rows: attendedEvents } = await db.query(
            `SELECT DISTINCT e.name AS title FROM event_bookings eb
             JOIN events e ON eb.event_id = e.id
             WHERE eb.user_id = $1 AND eb.attendance_status = 'present' AND eb.organization_id = $2`,
            [userId, organizationId]
          );
          const evNames = attendedEvents.map(r => r.title);
          const evMatch = criteria.required_events.filter(req => evNames.includes(req)).length;
          if (evMatch < criteria.required_events.length) allMet = false;
        }

        badgeEarned = allMet && (criteria.required_activities || criteria.required_events);
        break;
      }

      case 'teamer_year': {
        // Zählt nur Jahre mit mind. 1 Aktivität/Event. Lücken erlaubt.
        // Beispiel: Teamer aktiv in 2024 und 2026 (nicht 2025) -> years_active = 2
        // Transition-Datum ermitteln (Fallback-Kette)
        let startYear = null;

        // 1. Versuch: users.teamer_since (Promotions-Datum, Migration 064)
        const { rows: [teamerRow] } = await db.query(
          "SELECT teamer_since FROM users WHERE id = $1",
          [userId]
        );
        if (teamerRow && teamerRow.teamer_since) {
          startYear = new Date(teamerRow.teamer_since).getFullYear();
        }

        // 2. Fallback: älteste Teamer-Aktivität (falls teamer_since NULL, z.B. Altdaten)
        if (!startYear) {
          const { rows: [firstAct] } = await db.query(
            `SELECT MIN(ua.completed_date) as min_date FROM user_activities ua
             JOIN activities a ON ua.activity_id = a.id
             WHERE ua.user_id = $1 AND a.target_role = 'teamer'`,
            [userId]
          );
          if (firstAct && firstAct.min_date) {
            startYear = new Date(firstAct.min_date).getFullYear();
          }
        }

        // Kein Startjahr gefunden -> 0 aktive Jahre
        if (!startYear) {
          badgeEarned = false;
          break;
        }

        // Alle Aktivitäts- und Event-Daten sammeln
        const { rows: allDates } = await db.query(
          `SELECT ua.completed_date as date FROM user_activities ua
           JOIN activities a ON ua.activity_id = a.id
           WHERE ua.user_id = $1 AND a.target_role = 'teamer'
           UNION ALL
           SELECT e.event_date as date FROM event_bookings eb
           JOIN events e ON eb.event_id = e.id
           WHERE eb.user_id = $1 AND eb.attendance_status = 'present' AND eb.organization_id = $2`,
          [userId, organizationId]
        );

        // Jahre zählen in denen mind. 1 Eintrag existiert
        const activeYears = new Set();
        for (const row of allDates) {
          if (row.date) {
            activeYears.add(new Date(row.date).getFullYear());
          }
        }
        // Nur Jahre ab Transition zählen
        const relevantYears = Array.from(activeYears).filter(y => y >= startYear);
        badgeEarned = relevantYears.length >= badge.criteria_value;
        break;
      }

      case 'specific_activity':
        if (criteria.required_activity_name) {
          if (badge.criteria_value <= 1) {
            badgeEarned = teamerPreloaded.completedActivityNames.includes(criteria.required_activity_name);
          } else {
            const { rows: [result] } = await db.query(
              `SELECT COUNT(*) as count FROM user_activities ua
               JOIN activities a ON ua.activity_id = a.id
               WHERE ua.user_id = $1 AND a.name = $2 AND a.organization_id = $3 AND a.target_role = 'teamer'`,
              [userId, criteria.required_activity_name, organizationId]
            );
            badgeEarned = result && parseInt(result.count) >= badge.criteria_value;
          }
        }
        break;

      case 'category_activities':
        if (criteria.required_category) {
          const catQuery = `
            SELECT COUNT(*) as count FROM (
              SELECT ua.id FROM user_activities ua
              JOIN activities a ON ua.activity_id = a.id
              JOIN activity_categories ac ON a.id = ac.activity_id
              JOIN categories c ON ac.category_id = c.id
              WHERE ua.user_id = $1 AND c.name = $2 AND a.organization_id = $3 AND c.organization_id = $3 AND a.target_role = 'teamer'

              UNION ALL

              SELECT eb.id FROM event_bookings eb
              JOIN event_categories ec ON eb.event_id = ec.event_id
              JOIN categories c ON ec.category_id = c.id
              WHERE eb.user_id = $1 AND eb.attendance_status = 'present' AND c.name = $2 AND c.organization_id = $3 AND eb.organization_id = $3
            ) as combined
          `;
          const { rows: [result] } = await db.query(catQuery, [userId, criteria.required_category, organizationId]);
          badgeEarned = result && parseInt(result.count) >= badge.criteria_value;
        }
        break;

      case 'unique_activities': {
        badgeEarned = teamerPreloaded.uniqueActivityCount >= badge.criteria_value;
        break;
      }

      case 'time_based': {
        const days = criteria.days || (criteria.weeks ? criteria.weeks * 7 : null);
        if (days) {
          const tbQuery = `
            SELECT ua.completed_date as date FROM user_activities ua
            JOIN activities a ON ua.activity_id = a.id
            WHERE ua.user_id = $1 AND ua.organization_id = $2 AND a.target_role = 'teamer'
            UNION ALL
            SELECT e.event_date as date FROM event_bookings eb
            JOIN events e ON eb.event_id = e.id
            WHERE eb.user_id = $1 AND eb.attendance_status = 'present' AND eb.organization_id = $2
            ORDER BY date DESC
          `;
          const { rows: results } = await db.query(tbQuery, [userId, organizationId]);
          const now = new Date();
          const cutoff = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
          const recentCount = results.filter(r => new Date(r.date) >= cutoff).length;
          badgeEarned = recentCount >= badge.criteria_value;
        }
        break;
      }
    }

    if (badgeEarned) {
      earnedBadgeIds.push(badge.id);
      earnedBadgeDetails.push({
        id: badge.id,
        name: badge.name,
        icon: badge.icon,
        description: badge.description
      });
      newBadges++;
    }
  }

  if (earnedBadgeIds.length > 0) {
    await insertBadgesAndNotify(db, userId, organizationId, earnedBadgeIds, earnedBadgeDetails);
  }

  return { count: newBadges, badges: earnedBadgeDetails };
}

// =====================================================================
// Shared: Streak-Prüfung (Konfi + Teamer)
// =====================================================================
async function checkStreakCriteria(db, userId, organizationId, criteriaValue, isTeamer = false) {
  // Konfis: Pflicht/Konfirmation zaehlen nicht. Teamer: alle bestaetigten Events.
  const eventCond = isTeamer ? "eb.attendance_status = 'present'" : KONFI_BADGE_EVENT_CONDITION;
  const streakQuery = `
    SELECT completed_date as date FROM user_activities WHERE user_id = $1 AND organization_id = $2
    UNION ALL
    SELECT e.event_date as date FROM event_bookings eb
    JOIN events e ON eb.event_id = e.id
    WHERE eb.user_id = $1 AND ${eventCond} AND eb.organization_id = $2
    ORDER BY date DESC
  `;
  const { rows: streakResults } = await db.query(streakQuery, [userId, organizationId]);

  // Wochen-Streak-Rechnung aus gemeinsamer Util (Single Source of Truth).
  const currentStreak = computeCurrentStreak(streakResults.map(r => r.date));
  return currentStreak >= criteriaValue;
}

// =====================================================================
// Shared: Badges einfuegen und Notifications senden
// =====================================================================
async function insertBadgesAndNotify(db, userId, organizationId, earnedBadgeIds, earnedBadgeDetails) {
  const insertPromises = earnedBadgeIds.map(badgeId =>
    db.query("INSERT INTO user_badges (user_id, badge_id, organization_id) VALUES ($1, $2, $3)", [userId, badgeId, organizationId])
  );
  await Promise.all(insertPromises);

  try {
    for (const badge of earnedBadgeDetails) {
      await db.query(
        "INSERT INTO notifications (user_id, title, message, type, data, organization_id) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          userId,
          `Neues Badge erhalten! ${badge.icon}`,
          `Herzlichen Glückwunsch! Du hast das Badge "${badge.name}" erhalten: ${badge.description}`,
          'badge_earned',
          JSON.stringify({
            badge_id: badge.id,
            badge_name: badge.name,
            badge_icon: badge.icon,
            badge_description: badge.description
          }),
          organizationId
        ]
      );
    }

    for (const badge of earnedBadgeDetails) {
      await PushService.sendBadgeEarnedToKonfi(db, userId, badge.name, badge.icon, badge.description);
    }
  } catch (notifErr) {
    console.error('Error sending badge notifications:', notifErr);
  }
}


// Schema-Migrationen: siehe backend/migrations/076_badges_rename_migrations.sql

// Badges: Teamer darf ansehen, Admin darf bearbeiten
module.exports = (db, rbacVerifier, { requireAdmin, requireTeamer }) => {

  // Validierungsregeln
  const validateCreateBadge = [
    commonValidations.name,
    body('icon').trim().notEmpty().withMessage('Icon ist erforderlich'),
    body('criteria_type').notEmpty().withMessage('Kriterientyp ist erforderlich'),
    body('criteria_value').isInt({ min: 0 }).withMessage('Kriterienwert muss eine nicht-negative Ganzzahl sein'),
    handleValidationErrors
  ];

  const validateUpdateBadge = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    commonValidations.name,
    body('icon').trim().notEmpty().withMessage('Icon ist erforderlich'),
    body('criteria_type').notEmpty().withMessage('Kriterientyp ist erforderlich'),
    handleValidationErrors
  ];

  const validateBadgeId = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors
  ];

  router.get('/criteria-types', rbacVerifier, requireTeamer, (req, res) => {
    res.json(CRITERIA_TYPES);
  });

  router.get('/', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const { target_role } = req.query;
      let targetRoleFilter = '';
      const params = [req.user.organization_id];
      if (target_role) {
        params.push(target_role);
        targetRoleFilter = ` AND cb.target_role = $${params.length}`;
      }
      const badgeQuery = `
        SELECT cb.*,
                u.display_name as created_by_name,
                COALESCE(badge_counts.earned_count, 0)::int as earned_count
        FROM custom_badges cb
        LEFT JOIN users u ON cb.created_by = u.id
        LEFT JOIN (
          SELECT badge_id, COUNT(*) as earned_count
          FROM user_badges
          GROUP BY badge_id
        ) badge_counts ON cb.id = badge_counts.badge_id
        WHERE cb.organization_id = $1${targetRoleFilter}
        ORDER BY cb.created_at DESC
      `;
      const { rows } = await db.query(badgeQuery, params);
      res.json(rows);
    } catch (err) {
 console.error('Database error in GET /api/badges:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  router.get('/:id', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const badgeQuery = `
        SELECT cb.*,
                u.display_name as created_by_name,
                COALESCE(badge_counts.earned_count, 0)::int as earned_count
        FROM custom_badges cb
        LEFT JOIN users u ON cb.created_by = u.id
        LEFT JOIN (
          SELECT badge_id, COUNT(*) as earned_count
          FROM user_badges
          GROUP BY badge_id
        ) badge_counts ON cb.id = badge_counts.badge_id
        WHERE cb.id = $1 AND cb.organization_id = $2
      `;
      const { rows: [badge] } = await db.query(badgeQuery, [req.params.id, req.user.organization_id]);

      if (!badge) {
        return res.status(404).json({ error: 'Badge nicht gefunden' });
      }

      res.json(badge);
    } catch (err) {
 console.error('Database error in GET /api/badges/:id:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  router.post('/', rbacVerifier, requireAdmin, validateCreateBadge, async (req, res) => {
    const { name, icon, description, criteria_type, criteria_value, criteria_extra, is_hidden, color, target_role } = req.body;

    if (!name || !icon || !criteria_type || (criteria_value === null || criteria_value === undefined)) {
      return res.status(400).json({ error: 'Name, Icon, Kriterientyp und Wert sind erforderlich' });
    }

    try {
      const extraJson = criteria_extra ? JSON.stringify(criteria_extra) : null;
      const hiddenFlag = !!is_hidden;
      const badgeTargetRole = target_role || 'konfi';

      const query = `INSERT INTO custom_badges
                    (name, icon, description, criteria_type, criteria_value, criteria_extra, is_hidden, color, created_by, organization_id, target_role)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    RETURNING id`;

      const params = [name, icon, description, criteria_type, criteria_value, extraJson, hiddenFlag, color || '#667eea', req.user.id, req.user.organization_id, badgeTargetRole];
      const { rows: [newBadge] } = await db.query(query, params);
      
      res.status(201).json({ id: newBadge.id, message: 'Badge erfolgreich erstellt' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'badges', 'create');
    } catch (err) {
 console.error('Database error in POST /api/badges:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  router.put('/:id', rbacVerifier, requireAdmin, validateUpdateBadge, async (req, res) => {
    const { name, icon, description, criteria_type, criteria_value, criteria_extra, is_active, is_hidden, color } = req.body;
    
    try {
      const extraJson = criteria_extra ? JSON.stringify(criteria_extra) : null;
      const activeFlag = !!is_active;
      const hiddenFlag = !!is_hidden;
      
      const query = `UPDATE custom_badges 
                    SET name = $1, icon = $2, description = $3, criteria_type = $4, criteria_value = $5, criteria_extra = $6, is_active = $7, is_hidden = $8, color = $9 
                    WHERE id = $10 AND organization_id = $11`;
      
      const params = [name, icon, description, criteria_type, criteria_value, extraJson, activeFlag, hiddenFlag, color || '#667eea', req.params.id, req.user.organization_id];
      const { rowCount } = await db.query(query, params);
      
      if (rowCount === 0) {
        return res.status(404).json({ error: 'Badge nicht gefunden oder keine Berechtigung' });
      }
      res.json({ message: 'Badge erfolgreich aktualisiert' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'badges', 'update');
    } catch (err) {
 console.error(`Database error in PUT /api/badges/${req.params.id}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  router.delete('/:id', rbacVerifier, requireAdmin, validateBadgeId, async (req, res) => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      await client.query("DELETE FROM user_badges WHERE badge_id = $1", [req.params.id]);

      const { rowCount } = await client.query("DELETE FROM custom_badges WHERE id = $1 AND organization_id = $2", [req.params.id, req.user.organization_id]);

      if (rowCount === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Badge nicht gefunden oder keine Berechtigung' });
      }

      await client.query('COMMIT');
      client.release();

      res.json({ message: 'Badge erfolgreich gelöscht' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'badges', 'delete');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
      console.error(`Database error in DELETE /api/badges/${req.params.id}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  router.checkAndAwardBadges = checkAndAwardBadges;
  
  return router;
};

module.exports.checkAndAwardBadges = checkAndAwardBadges;