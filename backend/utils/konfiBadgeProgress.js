// backend/utils/konfiBadgeProgress.js
// Berechnet für EINEN Konfi (beliebige user_id in einer Organisation) die
// vollstaendige Badge-Liste inkl. Fortschritt — identisch zur Anzeige, die der
// Konfi selbst unter GET /konfi/badges sieht.
//
// Extrahiert aus konfi.js GET /badges, damit die Admin-Konfi-Detail-View
// (GET /admin/konfis/:id/badges) exakt dieselbe Wertung/Progress-Logik nutzt
// wie die Konfi-App — EINE Quelle statt zweier auseinanderlaufender Kopien.
//
// KONSISTENZ-VERTRAG: Die Zaehl-Semantik jeder Query bleibt identisch zur
// Wertung in badges.js (checkAndAwardBadges). Progress und Vergabe müssen
// exakt gleich zählen, sonst zeigt die App 10/10 ohne dass der Badge kommt.

const { computeCurrentStreak } = require('./streakCalculation');
const { KONFI_BADGE_EVENT_CONDITION } = require('./badgeEventRule');
const { berechneBadgeProgress, bedingungFehlt } = require('./badgeProgress');
const { KONFI_KATEGORIE_NAMEN_SQL } = require('./badgeKategorieRegel');

// Ermittelt Badges (earned + available + Fortschritt) für einen Konfi.
// Erwartet: db (pg Pool), konfiId (users.id), organizationId.
// Gibt { available, earned, stats } zurück — dasselbe Shape wie GET /konfi/badges.
async function getKonfiBadgeProgress(db, konfiId, organizationId) {
  // Der to_regclass-Legacy-Check auf custom_badges wurde entfernt:
  // Die Tabelle ist seit Migration 076/090 der aktive Badge-Pfad und
  // existiert dauerhaft. Der Check lief VOR dem Promise.all und war damit ein
  // zusaetzlicher serieller Roundtrip auf GET /konfi/badges — dem meist-
  // genutzten der langsamen Endpunkte. In routes/konfi.js (Dashboard) wurde er
  // aus demselben Grund bereits gestrichen.
  const query = `
    SELECT cb.*,
           CASE WHEN kb.user_id IS NOT NULL THEN TRUE ELSE FALSE END as earned,
           kb.awarded_date AS earned_at,
           COALESCE(kb.seen, false) as seen
    FROM custom_badges cb
    LEFT JOIN user_badges kb ON cb.id = kb.badge_id AND kb.user_id = $1 AND kb.organization_id = $2
    -- Verdiente Abzeichen bleiben, auch wenn die Leitung sie später
    -- abschaltet (etwa zum Saisonende): Sonst verschwaende ein einmal
    -- erreichtes Abzeichen aus der Ansicht, während die Zähler auf dem
    -- Dashboard es weiter mitzaehlen — die Zahlen widersprechen dann der
    -- Liste. Der Teamer-Pfad macht es seit jeher so (teamer.js:282),
    -- der Konfi-Pfad nicht.
    WHERE (cb.is_active = TRUE OR kb.id IS NOT NULL)
      AND cb.organization_id = $2 AND cb.target_role = 'konfi'
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
    kategorieNamenRes
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
    // category_combination: aus welchen Kategorien war der Konfi dabei.
    // Query-Text aus utils/badgeKategorieRegel.js -- byte-identisch zur
    // Wertung in routes/badges.js (Konfi-Zweig).
    db.query(KONFI_KATEGORIE_NAMEN_SQL, [konfiId, organizationId])
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
  // Set statt Map: bei category_combination zaehlt jede Kategorie hoechstens
  // einmal, die Anzahl interessiert dort nicht.
  const abgedeckteKategorien = new Set(kategorieNamenRes.rows.map(r => r.name));

  const isUnreachable = (badge) => {
    if (bedingungFehlt(badge)) return true;
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

    // Fortschritt aus dem gemeinsamen Kern (utils/badgeProgress.js).
    // Die Zaehler bleiben hier, weil sie konfi-spezifisch sind — der Kern
    // rechnet nur. `aktivitaetenUndEvents` heisst so, weil beide Pfade eine
    // Variable `activityCount` hatten, die Verschiedenes bedeutete: hier sind
    // Events NICHT enthalten und werden addiert, beim Teamer schon.
    // Addition wie in der Wertung (`badges.js:282`).
    const progress = berechneBadgeProgress(badge, {
      punkteGesamt: gdPoints + gmPoints,
      punkteGottesdienst: gdPoints,
      punkteGemeinde: gmPoints,
      // Abgeschaltete Punktearten zaehlen nicht: null statt einer 0, damit im
      // Kern der Unterschied "keine Punkte" / "gibt es hier nicht" bleibt.
      beideKategorien: (!gdEnabled || !gmEnabled) ? null : Math.min(gdPoints, gmPoints),
      punkteBonus: bonusPointsTotal,
      aktivitaetenUndEvents: activityCount + eventCount,
      events: eventCount,
      pflichtEvents: mandatoryEventCount,
      verschiedeneAktivitaeten: uniqueActivityCount,
      // Konfis sind keine Teamer:innen — der Wert bleibt bewusst 0, damit ein
      // faelschlich auf 'konfi' gestelltes teamer_year-Abzeichen nicht
      // plötzlich Fortschritt zeigt.
      teamerJahre: 0,
      proKategorie: categoryCounts,
      proAktivitaetsname: activityNameCounts,
      abgedeckteKategorien,
      // erfuellteEventTitel bewusst NICHT gesetzt: Die Konfi-Wertung zaehlt
      // bei activity_combination allein die Aktivitaeten.
      streak: currentStreak,
      alleDaten: allDates
    });

    badge.progress = progress;
  }

  const earned = badges.filter(badge => badge.earned);
  const available = badges.filter(badge => !badge.earned && !badge.is_hidden && !badge.unreachable);

  // Gesamtzahlen fuer die Anzeige "x von y". Sie ZAEHLEN NICHT MIT, was
  // ausgeblendet wird: Ein unerreichbares Abzeichen (Bedingung fehlt, oder
  // die Punkteart ist im Jahrgang abgeschaltet) steht in keiner Liste, wurde
  // in der Gesamtzahl aber weiter mitgezaehlt. Im Dashboard stand dann etwa
  // "3/10", obwohl nur 8 ueberhaupt erreichbar waren — eine Zahl, die man nie
  // vollmachen kann. In Org 1 waren zehn solcher Abzeichen angelegt
  // 
  //
  // Verdiente zaehlen immer mit, auch wenn die Bedingung inzwischen fehlt —
  // sie sind ja erreicht worden. `unreachable` ist oben schon so gesetzt
  // (`!badge.earned && isUnreachable(badge)`).
  //
  // Die frühere Query zaehlte organisationsweit und kannte weder Jahrgang
  // noch Fortschritt. Gezaehlt wird deshalb hier, wo beides bekannt ist.
  const zaehlbar = badges.filter(badge => badge.is_active && !badge.unreachable);

  return {
    available,
    earned,
    stats: {
      totalVisible: zaehlbar.filter(badge => !badge.is_hidden).length,
      totalSecret: zaehlbar.filter(badge => badge.is_hidden).length
    }
  };
}

module.exports = { getKonfiBadgeProgress };
