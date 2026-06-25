// backend/utils/streakCalculation.js
// Gemeinsame Streak-Berechnung (Single Source of Truth).
// Wird von der Badge-Wertung (badges.js checkStreakCriteria) UND der
// Fortschritts-Anzeige (konfi.js streak-Progress-case) genutzt. Analog zu
// deleteKonfiCascade (Phase 114) und konfiLimit (Phase 115) wird die Logik
// EINMAL gebaut, damit Wertung und Progress nicht auseinanderlaufen (genau das
// Anti-Pattern, das bei mandatory_event_count gefixt wurde).

/**
 * ISO-Wochennummer im Format "YYYY-Www" fuer ein Datum.
 * @param {Date} date - Datumswert
 * @returns {string} z.B. "2026-W05"
 */
function getYearWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

/**
 * Anzahl der ISO-Wochen in einem Jahr (52 oder 53).
 * Wird fuer den Jahresuebergang W1 -> W52/W53 des Vorjahres gebraucht.
 * @param {number} year - Jahr
 * @returns {number} 52 oder 53
 */
function getISOWeeksInYear(year) {
  const dec28 = new Date(Date.UTC(year, 11, 28));
  const dayOfYear = Math.ceil((dec28 - new Date(Date.UTC(year, 0, 1))) / 86400000) + 1;
  return Math.ceil((dayOfYear - (dec28.getUTCDay() || 7) + 10) / 7);
}

/**
 * Berechnet den aktuellen Streak: Anzahl aufeinanderfolgender aktiver ISO-Wochen
 * bis zur neuesten aktiven Woche. Bricht bei der ersten Luecke ab (break).
 * Beruecksichtigt den Jahresuebergang (W1 -> letzte Woche des Vorjahres).
 *
 * Verhalten identisch zur frueher duplizierten Inline-Logik:
 * - leere Liste -> 0
 * - mindestens eine aktive Woche -> Start bei 1
 * - Luecke bricht die Folge ab
 *
 * @param {Array<Date|string|number>} dates - Liste von Datumswerten (Aktivitaeten/Events)
 * @returns {number} aktueller Streak (ganzzahlig)
 */
function computeCurrentStreak(dates) {
  const activityWeeks = new Set(
    (dates || [])
      .map(d => getYearWeek(new Date(d)))
      .filter(week => week && !week.includes('NaN'))
  );
  const sortedWeeks = Array.from(activityWeeks).sort().reverse();

  let currentStreak = 0;
  if (sortedWeeks.length > 0) {
    currentStreak = 1;
    for (let i = 0; i < sortedWeeks.length - 1; i++) {
      const thisWeek = sortedWeeks[i];
      const nextWeek = sortedWeeks[i + 1];
      const [year, week] = thisWeek.split('-W').map(Number);
      let expectedYear = year;
      let expectedWeek = week - 1;
      if (expectedWeek === 0) {
        expectedYear -= 1;
        expectedWeek = getISOWeeksInYear(expectedYear);
      }
      const expectedWeekStr = `${expectedYear}-W${expectedWeek.toString().padStart(2, '0')}`;
      if (nextWeek === expectedWeekStr) {
        currentStreak++;
      } else {
        break;
      }
    }
  }
  return currentStreak;
}

module.exports = { computeCurrentStreak, getYearWeek, getISOWeeksInYear };
