const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors, commonValidations } = require('../middleware/validation');
const PushService = require('../services/pushService');
const liveUpdate = require('../utils/liveUpdate');
const { computeCurrentStreak } = require('../utils/streakCalculation');
// Seiteneffekte nach der Antwort (abwartbar im Test) -- siehe utils/nachAntwort.js
const { nachAntwort } = require('../utils/nachAntwort');
// Single Source of Truth: welche Events zählen für Badges (Konfi vs. Teamer).
const { KONFI_BADGE_EVENT_CONDITION } = require('../utils/badgeEventRule');
// Single Source of Truth: aus welchen Kategorien war jemand dabei (category_combination).
const {
  KONFI_KATEGORIE_NAMEN_SQL,
  TEAMER_KATEGORIE_NAMEN_SQL,
  zaehleAbgedeckteKategorien
} = require('../utils/badgeKategorieRegel');

// Farbe je Kriterientyp -- Gegenstueck zu CRITERIA_COLORS im Frontend
// (frontend/src/utils/badgeCriteria.ts). Wird gebraucht, wenn beim Anlegen
// oder Bearbeiten keine Farbe mitkommt.
const CRITERIA_COLORS = {
  total_points: '#ffd700',
  gottesdienst_points: '#ff9500',
  gemeinde_points: '#059669',
  bonus_points: '#ff6b9d',
  both_categories: '#5856d6',
  activity_count: '#3880ff',
  unique_activities: '#10dc60',
  activity_combination: '#7044ff',
  category_activities: '#0cd1e8',
  category_combination: '#0891b2',
  specific_activity: '#ffce00',
  streak: '#eb445a',
  time_based: '#8e8e93',
  event_count: '#e63946',
  mandatory_event_count: '#b91c1c',
  teamer_year: '#5b21b6'
};

/** Farbe fuer ein Badge: die gewaehlte, sonst die des Kriteriums, sonst Blau. */
const farbeFuerBadge = (color, criteriaType) =>
  color || CRITERIA_COLORS[criteriaType] || '#667eea';

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
  category_combination: {
    label: "Kategorie-Kombination",
    description: "Aus wie vielen verschiedenen Kategorien war jemand dabei",
    // Gegenstueck zu category_activities: dort zaehlt EINE Kategorie mehrfach,
    // hier zaehlt jede Kategorie hoechstens einmal. Genau das braucht es fuer
    // "drei verschiedene Freizeiten": dreimal dieselbe Konfifahrt soll das
    // Abzeichen NICHT ausloesen.
    help: "Kreuze die Kategorien an, die in Frage kommen. Der Wert sagt, aus WIE VIELEN davon jemand dabei gewesen sein muss — nicht wie oft. Beispiel: drei Kategorien angekreuzt und Wert 3 heißt: aus allen dreien mindestens einmal. Wert 1 heißt: eine davon genügt. Zwei Termine aus derselben Kategorie zählen zusammen nur einmal. Es zählen Termine und Aktivitäten gleichermaßen."
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
    description: "Summe der erhaltenen Bonuspunkte",
    // Der Hilfetext behauptete das Gegenteil ("Anzahl der Vergaben"), obwohl
    // die Wertung unten SUM(points) nimmt. Wer sich danach richtete, stellte
    // die Schwelle falsch ein.
    help: "Badge wird vergeben, wenn die Bonuspunkte zusammengezählt den angegebenen Wert erreichen — nicht die Anzahl der Vergaben. Beispiel: Wert 5 = fünf Bonuspunkte insgesamt, egal ob in einer Vergabe oder in fünf."
  },

  // === TEAMER-SPEZIFISCH ===
  teamer_year: {
    label: "Teamer-Jahr",
    description: "Aktive Teamer-Jahre",
    help: "Badge wird vergeben wenn der Teamer in X verschiedenen Jahren aktiv war (mind. 1 Aktivität oder Event pro Jahr). Inaktive Jahre werden übersprungen."
  }
};

// Nachtraegliche Vergabe ("Abzeichen neu pruefen"): still, ohne Push und
// In-App-Nachricht. Begruendung: Wer ein Abzeichen aendert, holt damit
// Vergaben fuer die GANZE Gemeinde nach. In Org 1 sind das rund 40 Personen;
// bei einem geaenderten Kriterium koennen ohne Weiteres zwei Dutzend Push-
// Nachrichten auf einen Schlag rausgehen — fuer Erfolge, die die Konfis
// laengst erbracht haben. Der reguläre Weg (Aktivität eintragen) benachrichtigt
// weiter wie bisher; nur der Nachhol-Lauf schweigt.
const STILL = { still: true };

const checkAndAwardBadges = async (db, userId, optionen = {}) => {
  const still = optionen.still === true;
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
      return await checkAndAwardTeamerBadges(db, userId, organizationId, still);
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
    // pg liefert numeric/integer-Spalten als STRING. Ohne Konvertierung macht
    // `total += konfi.gottesdienst_points` String-Konkatenation ("0"+"3"+"5"="035")
    // statt Addition -> total_points/gottesdienst/gemeinde/both_categories werden
    // falsch bewertet (mal zu grosszuegig, mal gar nicht). Hier EINMAL zu Zahl.
    konfi.gottesdienst_points = parseInt(konfi.gottesdienst_points, 10) || 0;
    konfi.gemeinde_points = parseInt(konfi.gemeinde_points, 10) || 0;

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
      "SELECT id, name, description, icon, color, criteria_type, criteria_value::int AS criteria_value, criteria_extra, is_hidden, sort_order, is_active, target_role, organization_id FROM custom_badges WHERE is_active = true AND organization_id = $1 AND target_role = 'konfi'",
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
      { rows: preUniqueActs },
      { rows: preKategorienKonfi }
    ] = await Promise.all([
      db.query("SELECT COUNT(*) as count FROM user_activities WHERE user_id = $1 AND organization_id = $2", [userId, konfi.organization_id]),
      // event_count/activity_count: nur freiwillige, bestaetigte Events (kein Pflicht/Konfirmation).
      db.query(`SELECT COUNT(*) as count FROM event_bookings eb JOIN events e ON eb.event_id = e.id WHERE eb.user_id = $1 AND ${KONFI_BADGE_EVENT_CONDITION} AND eb.organization_id = $2`, [userId, konfi.organization_id]),
      // bonus_points-Badge meint die SUMME der Bonuspunkte (Frontend-Label "Punkte"),
      // nicht die Anzahl der Eintraege -> SUM(points), konsistent zum Progress (konfi.js).
      db.query("SELECT COALESCE(SUM(points), 0) as count FROM bonus_points WHERE konfi_id = $1 AND organization_id = $2", [userId, konfi.organization_id]),
      db.query("SELECT DISTINCT a.name FROM user_activities ua JOIN activities a ON ua.activity_id = a.id WHERE ua.user_id = $1 AND a.organization_id = $2", [userId, konfi.organization_id]),
      db.query("SELECT DISTINCT activity_id FROM user_activities WHERE user_id = $1 AND organization_id = $2", [userId, konfi.organization_id]),
      // category_combination: aus welchen Kategorien war der Konfi dabei.
      // Query-Text aus utils/badgeKategorieRegel.js -- derselbe, den der
      // Fortschritt in utils/konfiBadgeProgress.js benutzt.
      db.query(KONFI_KATEGORIE_NAMEN_SQL, [userId, konfi.organization_id])
    ]);

    const preloaded = {
      activityCount: parseInt(preActCount.count),
      eventCount: parseInt(preEvCount.count),
      bonusCount: parseInt(preBonusCount.count),
      completedActivityNames: preCompletedActs.map(r => r.name),
      uniqueActivityCount: preUniqueActs.length,
      // Set statt Array: gefragt ist nur Enthaltensein, und jede Kategorie
      // darf hoechstens einmal zaehlen.
      kategorieNamen: new Set(preKategorienKonfi.map(r => r.name))
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

        case 'category_combination': {
          // Jede geforderte Kategorie zaehlt HOECHSTENS EINMAL -- das ist der
          // Unterschied zu category_activities. Dreimal dieselbe Konfifahrt
          // ergibt hier 1, nicht 3.
          // KONSISTENZ-VERTRAG: identisch zu utils/badgeProgress.js
          // (case 'category_combination'), beide nutzen
          // zaehleAbgedeckteKategorien aus utils/badgeKategorieRegel.js.
          const treffer = zaehleAbgedeckteKategorien(
            criteria.required_categories, preloaded.kategorieNamen
          );
          // Ohne hinterlegte Kategorien wird nichts vergeben: ein leeres Feld
          // darf das Abzeichen nicht an alle geben (dieselbe Vorsicht wie bei
          // activity_combination im Teamer-Zweig).
          const gefordert = Array.isArray(criteria.required_categories)
            ? new Set(criteria.required_categories).size : 0;
          earned = gefordert > 0 && treffer >= badge.criteria_value;
          break;
        }

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
      await insertBadgesAndNotify(db, userId, organizationId, earnedBadgeIds, earnedBadgeDetails, still);
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
async function checkAndAwardTeamerBadges(db, userId, organizationId, still = false) {
  // Teamer-Badges laden
  const { rows: badges } = await db.query(
    "SELECT id, name, description, icon, color, criteria_type, criteria_value::int AS criteria_value, criteria_extra, is_hidden, sort_order, is_active, target_role, organization_id FROM custom_badges WHERE is_active = true AND organization_id = $1 AND target_role = 'teamer'",
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
    { rows: teamerUniqueActs },
    { rows: teamerKategorien }
  ] = await Promise.all([
    db.query(`SELECT COUNT(*) as count FROM user_activities ua JOIN activities a ON ua.activity_id = a.id WHERE ua.user_id = $1 AND ua.organization_id = $2 AND a.target_role = 'teamer'`, [userId, organizationId]),
    // Teamer: ALLE bestaetigten Events zählen (inkl. Pflicht/Konfirmation) — Teamer
    // arbeiten dort mit, das ist eine legitime Zählung. (Anders als bei Konfis.)
    db.query("SELECT COUNT(*) as count FROM event_bookings WHERE user_id = $1 AND attendance_status = 'present' AND organization_id = $2", [userId, organizationId]),
    db.query(`SELECT DISTINCT a.name FROM user_activities ua JOIN activities a ON ua.activity_id = a.id WHERE ua.user_id = $1 AND a.organization_id = $2 AND a.target_role = 'teamer'`, [userId, organizationId]),
    db.query(`SELECT DISTINCT ua.activity_id FROM user_activities ua JOIN activities a ON ua.activity_id = a.id WHERE ua.user_id = $1 AND ua.organization_id = $2 AND a.target_role = 'teamer'`, [userId, organizationId]),
    // category_combination: aus welchen Kategorien war die Teamer:in dabei.
    // Query-Text aus utils/badgeKategorieRegel.js -- derselbe, den der
    // Fortschritt in utils/teamerBadgeProgress.js benutzt.
    db.query(TEAMER_KATEGORIE_NAMEN_SQL, [userId, organizationId])
  ]);

  const teamerPreloaded = {
    activityCount: parseInt(teamerActCount.count),
    eventCount: parseInt(teamerEvCount.count),
    completedActivityNames: teamerCompletedActs.map(r => r.name),
    uniqueActivityCount: teamerUniqueActs.length,
    kategorieNamen: new Set(teamerKategorien.map(r => r.name))
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
        // Dieselbe Regel wie bei den Konfis (siehe oben, badges.js im
        // Konfi-Zweig): "mindestens criteria_value aus der Liste". Vorher
        // verlangte der Teamer-Zweig ALLE und ignorierte den Wert — Formular,
        // Hilfetext und Fortschrittsanzeige beschreiben aber die
        // Mindestanzahl. Der Fortschritt konnte dadurch 100 Prozent zeigen,
        // ohne dass das Abzeichen kam. In Produktion gab
        // es zum Zeitpunkt der Umstellung kein einziges solches Abzeichen.
        let treffer = 0;
        let gefordert = 0;

        if (criteria.required_activities && criteria.required_activities.length > 0) {
          gefordert += criteria.required_activities.length;
          treffer += criteria.required_activities
            .filter(req => teamerPreloaded.completedActivityNames.includes(req)).length;
        }

        // Termine zählen mit, wenn welche hinterlegt sind. Die Spalte heißt
        // 'name' (nicht 'title') -> als title aliasen.
        if (criteria.required_events && criteria.required_events.length > 0) {
          gefordert += criteria.required_events.length;
          const { rows: attendedEvents } = await db.query(
            `SELECT DISTINCT e.name AS title FROM event_bookings eb
             JOIN events e ON eb.event_id = e.id
             WHERE eb.user_id = $1 AND eb.attendance_status = 'present' AND eb.organization_id = $2`,
            [userId, organizationId]
          );
          const evNames = attendedEvents.map(r => r.title);
          treffer += criteria.required_events.filter(req => evNames.includes(req)).length;
        }

        // Ohne hinterlegte Bedingung wird nichts vergeben. Der Wert 0 oder
        // fehlend fällt auf "alle nötig" zurück, damit ein unausgefuelltes
        // Feld nicht versehentlich jedem das Abzeichen gibt.
        const noetig = badge.criteria_value > 0 ? badge.criteria_value : gefordert;
        badgeEarned = gefordert > 0 && treffer >= noetig;
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

      case 'category_combination': {
        // Wortgleich zum Konfi-Zweig oben -- nur die Kategorie-Herkunft ist
        // rollenspezifisch (Teamer-Aktivitaeten + alle anwesenden Termine).
        // KONSISTENZ-VERTRAG: identisch zu utils/badgeProgress.js.
        const treffer = zaehleAbgedeckteKategorien(
          criteria.required_categories, teamerPreloaded.kategorieNamen
        );
        const gefordert = Array.isArray(criteria.required_categories)
          ? new Set(criteria.required_categories).size : 0;
        badgeEarned = gefordert > 0 && treffer >= badge.criteria_value;
        break;
      }

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
    await insertBadgesAndNotify(db, userId, organizationId, earnedBadgeIds, earnedBadgeDetails, still);
  }

  return { count: newBadges, badges: earnedBadgeDetails };
}

// =====================================================================
// Shared: Streak-Prüfung (Konfi + Teamer)
// =====================================================================
async function checkStreakCriteria(db, userId, organizationId, criteriaValue, isTeamer = false) {
  // Konfis: Pflicht/Konfirmation zählen nicht. Teamer: alle bestaetigten Events.
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
async function insertBadgesAndNotify(db, userId, organizationId, earnedBadgeIds, earnedBadgeDetails, still = false) {
  const insertPromises = earnedBadgeIds.map(badgeId =>
    db.query("INSERT INTO user_badges (user_id, badge_id, organization_id) VALUES ($1, $2, $3)", [userId, badgeId, organizationId])
  );
  await Promise.all(insertPromises);

  try {
    // Stille Vergabe (Nachhol-Lauf ueber "Abzeichen neu pruefen"): weder
    // In-App-Nachricht noch Push. Das Abzeichen steht danach im Profil, es
    // klingelt nur nicht. Das Live-Update unten bleibt — es aktualisiert nur
    // den Zaehler in einer offenen App und macht kein Geraeusch.
    if (still) {
      liveUpdate.sendToUserByRole(userId, 'badges', 'earned', { count: earnedBadgeDetails.length });
      return;
    }

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
      await PushService.sendBadgeEarnedToKonfi(
        db, userId, badge.name, badge.icon, badge.description, badge.id ?? null, organizationId
      );
    }

    // Live-Update an den Empfaenger selbst: Badge-Zähler sofort aktualisieren,
    // ohne dass die App dafuer alle 60s /konfi/badges pollen muss.
    // earnedBadgeDetails ist hier immer nicht-leer (Aufrufer prüft das).
    // sendToUserByRole (statt sendToKonfi), weil Badges auch an Teamer:innen
    // vergeben werden können und deren Socket im Raum user_teamer_ sitzt.
    // Fire-and-forget.
    liveUpdate.sendToUserByRole(userId, 'badges', 'earned', { count: earnedBadgeDetails.length });
  } catch (notifErr) {
    console.error('Error sending badge notifications:', notifErr);
  }
}


// Schema-Migrationen: siehe backend/migrations/076_badges_rename_migrations.sql

// Badges: Teamer darf ansehen, Admin darf bearbeiten
module.exports = (db, rbacVerifier, { requireAdmin, requireTeamer }) => {

  // Validierungsregeln.
  // criteria_value: min 1 — Wert 0 (oder fehlend -> NULL) liesse jedes
  // Zähl-Kriterium sofort für alle auslösen, denn in JavaScript ist
  // `x >= null` wahr. Der PUT validierte den Wert
  // vorher GAR nicht.
  // criteria_extra: Typen mit Auswahl (Aktivität, Kombination, Kategorie,
  // Zeitraum) brauchen ihre Auswahl — ohne sie entsteht ein still
  // unerreichbares Abzeichen; in Produktion lagen 4 solche Altfälle
  // 
  const validateCriteriaExtra = body('criteria_extra').custom((extra, { req }) => {
    const type = req.body.criteria_type;
    const e = (typeof extra === 'object' && extra !== null) ? extra : {};
    if (type === 'specific_activity'
        && !(typeof e.required_activity_name === 'string' && e.required_activity_name.trim())) {
      throw new Error('Bitte eine Aktivität auswählen');
    }
    if (type === 'activity_combination'
        && !(Array.isArray(e.required_activities) && e.required_activities.length > 0)) {
      throw new Error('Bitte mindestens eine Aktivität auswählen');
    }
    if (type === 'category_activities'
        && !(typeof e.required_category === 'string' && e.required_category.trim())) {
      throw new Error('Bitte eine Kategorie auswählen');
    }
    // category_combination braucht MEHRERE Kategorien: mit nur einer waere es
    // ein category_activities mit Wert 1 -- und der Wert (wie viele davon
    // noetig sind) haette keinen Spielraum mehr.
    if (type === 'category_combination') {
      const gewaehlt = Array.isArray(e.required_categories)
        ? [...new Set(e.required_categories.filter(n => typeof n === 'string' && n.trim()))]
        : [];
      if (gewaehlt.length < 2) {
        throw new Error('Bitte mindestens zwei Kategorien auswählen');
      }
      if (parseInt(req.body.criteria_value, 10) > gewaehlt.length) {
        // Sonst entstuende ein Abzeichen, das niemand erreichen kann: "4 aus 3".
        throw new Error('Der Wert darf nicht größer sein als die Anzahl der gewählten Kategorien');
      }
    }
    if (type === 'time_based'
        && !(parseInt(e.days, 10) >= 1 || parseInt(e.weeks, 10) >= 1)) {
      throw new Error('Bitte einen Zeitraum angeben');
    }
    return true;
  });

  const validateCreateBadge = [
    commonValidations.name,
    body('icon').trim().notEmpty().withMessage('Icon ist erforderlich'),
    body('criteria_type').notEmpty().withMessage('Kriterientyp ist erforderlich'),
    body('criteria_value').isInt({ min: 1 }).withMessage('Kriterienwert muss eine positive Ganzzahl sein'),
    validateCriteriaExtra,
    handleValidationErrors
  ];

  const validateUpdateBadge = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    commonValidations.name,
    body('icon').trim().notEmpty().withMessage('Icon ist erforderlich'),
    body('criteria_type').notEmpty().withMessage('Kriterientyp ist erforderlich'),
    body('criteria_value').isInt({ min: 1 }).withMessage('Kriterienwert muss eine positive Ganzzahl sein'),
    validateCriteriaExtra,
    handleValidationErrors
  ];

  const validateBadgeId = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors
  ];

  router.get('/criteria-types', rbacVerifier, requireTeamer, (req, res) => {
    res.json(CRITERIA_TYPES);
  });

  // ==================================================================
  // Abzeichen nachtraeglich pruefen
  // ==================================================================
  //
  // WARUM: Vergeben wurde bisher NUR beim Eintragen einer Aktivitaet
  // (checkAndAwardBadges in activities.js/events/konfi-management.js). Wer ein
  // Abzeichen aenderte oder neu anlegte, musste warten, bis zufaellig jemand
  // etwas eintrug. Konkret passiert: Ein Abzeichen wurde von
  // activity_combination auf category_combination umgestellt, eine Person
  // erfuellte es nachweislich und bekam es trotzdem nicht.
  //
  // ZUSCHNITT — JE ABZEICHEN, nicht je Organisation: Der Anlass ist immer
  // "ich habe DIESES Abzeichen geaendert". Das haelt die Rueckmeldung ehrlich
  // ("3 Personen haben es jetzt" statt einer Sammelzahl) und begrenzt den
  // Personenkreis auf die passende Zielrolle: bei einem Konfi-Abzeichen
  // laufen keine Teamer:innen mit und umgekehrt.
  //
  // ABGRENZUNG: checkAndAwardBadges prueft immer ALLE Abzeichen der Person auf
  // einmal. Ein Lauf kann deshalb nebenbei auch andere faellige Abzeichen
  // vergeben. Das ist gewollt — nichts anderes tut der regulaere Weg auch.
  // Gezaehlt und gemeldet wird nur, wer das ANGEFRAGTE Abzeichen bekommen hat.
  //
  // MISSBRAUCHSSCHUTZ: Ein Lauf geht ueber alle Personen der Zielrolle (Org 1:
  // rund 40) und macht je Person mehrere Abfragen. Deshalb eine Sperre von
  // 60 Sekunden je Organisation — Dauerklicken laeuft ins Leere, nicht in die
  // Datenbank. Der Merker liegt im Prozessspeicher; nach einem Neustart darf
  // wieder geprueft werden, was hier voellig ausreicht.
  const letztePruefungJeOrg = new Map();
  const PRUEF_SPERRE_MS = 60 * 1000;
  // Im Test zuruecksetzbar: Die Test-App wird pro Datei EINMAL erzeugt, der
  // Merker lebt also ueber alle Tests der Datei. Ohne diesen Weg liefe jeder
  // Test nach dem ersten in die Sperre statt in die Pruefung. Der Test fuer
  // die Sperre selbst benutzt den Haken bewusst NICHT.
  router.sperreZuruecksetzen = () => letztePruefungJeOrg.clear();

  // Der eigentliche Lauf, geteilt zwischen Knopf und Auto-Pruefung beim
  // Speichern. Liefert, wie viele Personen geprueft wurden und wie viele das
  // angefragte Abzeichen neu bekommen haben.
  async function pruefeAbzeichenNach(badge, organizationId) {
    const rollenFilter = badge.target_role === 'teamer'
      ? "r.name = 'teamer'"
      : "r.name = 'konfi'";
    const { rows: personen } = await db.query(
      `SELECT DISTINCT u.id
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN user_organizations uo ON uo.user_id = u.id
       WHERE ${rollenFilter}
         AND u.deleted_at IS NULL
         AND u.is_active = true
         AND (u.organization_id = $1 OR uo.organization_id = $1)`,
      [organizationId]
    );

    let neuVergeben = 0;
    let geprueft = 0;
    for (const person of personen) {
      try {
        // STILL: Ein Nachhol-Lauf soll nicht zwei Dutzend Push-Nachrichten
        // auf einmal ausloesen (siehe Kommentar bei STILL oben).
        const ergebnis = await checkAndAwardBadges(db, person.id, STILL);
        geprueft++;
        if (ergebnis.badges.some(b => b.id === badge.id)) neuVergeben++;
      } catch (personErr) {
        // Eine kaputte Person darf den Lauf nicht abbrechen.
        console.error(`Badge-Nachpruefung fuer User ${person.id} fehlgeschlagen:`, personErr);
      }
    }
    return { geprueft, neu_vergeben: neuVergeben };
  }

  // Automatisch nach dem Speichern (POST/PUT), NACH der Antwort.
  //
  // WARUM NICHT VOR DER ANTWORT: Der Lauf geht ueber alle Personen der
  // Zielrolle und macht je Person mehrere Abfragen. Vor der Antwort haenge
  // das Speichern-Formular daran; abgekoppelt bleibt das Speichern so schnell
  // wie bisher. Fehler landen im Log, nicht in einer unbehandelten Promise.
  function pruefeNachSpeichernImHintergrund(req, badgeId, organizationId) {
    nachAntwort(req, async () => {
      const { rows: [badge] } = await db.query(
        'SELECT id, name, target_role, is_active FROM custom_badges WHERE id = $1 AND organization_id = $2',
        [badgeId, organizationId]
      );
      if (!badge || !badge.is_active) return;
      const { neu_vergeben } = await pruefeAbzeichenNach(badge, organizationId);
      if (neu_vergeben > 0) {
        liveUpdate.sendToOrgAdmins(organizationId, 'badges', 'update');
        liveUpdate.sendToOrgKonfis(organizationId, 'badges', 'update');
      }
    }, 'Abzeichen-Pruefung nach Speichern');
  }

  router.post('/:id/pruefen', rbacVerifier, requireAdmin, validateBadgeId, async (req, res) => {
    const organizationId = req.user.organization_id;

    try {
      // Org-Bindung: Das Abzeichen muss der eigenen Organisation gehoeren.
      // Ein fremdes ergibt 404 (wie in PUT/DELETE oben), nicht etwa einen Lauf
      // ueber die fremde Gemeinde.
      const { rows: [badge] } = await db.query(
        'SELECT id, name, target_role, is_active FROM custom_badges WHERE id = $1 AND organization_id = $2',
        [req.params.id, organizationId]
      );
      if (!badge) {
        return res.status(404).json({ error: 'Badge nicht gefunden oder keine Berechtigung' });
      }
      if (!badge.is_active) {
        // Inaktive Abzeichen werden von checkAndAwardBadges ohnehin
        // uebersprungen — dann lieber gleich sagen, warum nichts passiert.
        return res.status(400).json({ error: 'Das Abzeichen ist nicht aktiv' });
      }

      const zuletzt = letztePruefungJeOrg.get(organizationId);
      if (zuletzt && Date.now() - zuletzt < PRUEF_SPERRE_MS) {
        const restSekunden = Math.ceil((PRUEF_SPERRE_MS - (Date.now() - zuletzt)) / 1000);
        return res.status(429).json({
          error: `Die Prüfung lief gerade eben. Bitte ${restSekunden} Sekunden warten.`
        });
      }
      letztePruefungJeOrg.set(organizationId, Date.now());

      // Nur Personen der passenden Zielrolle, nur aktive, nur diese
      // Organisation (siehe pruefeAbzeichenNach).
      const { geprueft, neu_vergeben: neuVergeben } = await pruefeAbzeichenNach(badge, organizationId);

      res.json({
        badge_id: badge.id,
        badge_name: badge.name,
        geprueft,
        neu_vergeben: neuVergeben
      });

      if (neuVergeben > 0) {
        liveUpdate.sendToOrgAdmins(organizationId, 'badges', 'update');
        liveUpdate.sendToOrgKonfis(organizationId, 'badges', 'update');
      }
    } catch (err) {
      console.error('Database error in POST /api/badges/:id/pruefen:', req.params.id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
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

      const params = [name, icon, description, criteria_type, criteria_value, extraJson, hiddenFlag, farbeFuerBadge(color, criteria_type), req.user.id, req.user.organization_id, badgeTargetRole];
      const { rows: [newBadge] } = await db.query(query, params);
      
      res.status(201).json({ id: newBadge.id, message: 'Badge erfolgreich erstellt' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'badges', 'create');
      // Konfis sehen den Badge-Katalog (KonfiBadgesPage abonniert 'badges').
      liveUpdate.sendToOrgKonfis(req.user.organization_id, 'badges', 'create');

      // Neu angelegtes Abzeichen sofort vergeben, wer es schon erfuellt.
      // Laeuft NACH der Antwort, damit das Speichern nicht daran haengt.
      pruefeNachSpeichernImHintergrund(req, newBadge.id, req.user.organization_id);
    } catch (err) {
 console.error('Database error in POST /api/badges:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  router.put('/:id', rbacVerifier, requireAdmin, validateUpdateBadge, async (req, res) => {
    const { name, icon, description, criteria_type, criteria_value, criteria_extra, is_active, is_hidden, color } = req.body;
    
    try {
      const extraJson = criteria_extra ? JSON.stringify(criteria_extra) : null;
      // is_active/is_hidden nur setzen, wenn sie AUSDRUECKLICH mitgeschickt
      // wurden. Vorher stand hier `!!is_active`: Ein Teil-Update ohne das Feld
      // (undefined) wurde damit zu false — ein aktives Abzeichen verschwand
      // still aus der Anzeige, obwohl nur die Beschreibung geaendert werden
      // sollte. COALESCE laesst den Bestandswert stehen,
      // wenn NULL uebergeben wird; ein ausdrueckliches false wirkt weiterhin.
      const activeFlag = is_active === undefined ? null : !!is_active;
      const hiddenFlag = is_hidden === undefined ? null : !!is_hidden;

      const query = `UPDATE custom_badges 
                    SET name = $1, icon = $2, description = $3, criteria_type = $4, criteria_value = $5, criteria_extra = $6, is_active = COALESCE($7, is_active), is_hidden = COALESCE($8, is_hidden), color = $9 
                    WHERE id = $10 AND organization_id = $11`;
      
      const params = [name, icon, description, criteria_type, criteria_value, extraJson, activeFlag, hiddenFlag, farbeFuerBadge(color, criteria_type), req.params.id, req.user.organization_id];
      const { rowCount } = await db.query(query, params);
      
      if (rowCount === 0) {
        return res.status(404).json({ error: 'Badge nicht gefunden oder keine Berechtigung' });
      }
      res.json({ message: 'Badge erfolgreich aktualisiert' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'badges', 'update');
      // Konfis sehen den Badge-Katalog (KonfiBadgesPage abonniert 'badges').
      liveUpdate.sendToOrgKonfis(req.user.organization_id, 'badges', 'update');

      pruefeNachSpeichernImHintergrund(req, req.params.id, req.user.organization_id);
    } catch (err) {
 console.error('Database error in PUT /api/badges/:id:', req.params.id, err);
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
      // Konfis sehen den Badge-Katalog (KonfiBadgesPage abonniert 'badges').
      liveUpdate.sendToOrgKonfis(req.user.organization_id, 'badges', 'delete');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
      console.error('Database error in DELETE /api/badges/:id:', req.params.id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  router.checkAndAwardBadges = checkAndAwardBadges;
  
  return router;
};

module.exports.checkAndAwardBadges = checkAndAwardBadges;