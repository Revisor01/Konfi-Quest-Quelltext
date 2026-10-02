
/**
 * ISO-Wochennummer im Format "YYYY-Www" für ein Datum.
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
 * Wird für den Jahresuebergang W1 -> W52/W53 des Vorjahres gebraucht.
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
 * Verhalten identisch zur früher duplizierten Inline-Logik:
 * - leere Liste -> 0
 * - mindestens eine aktive Woche -> Start bei 1
 * - Luecke bricht die Folge ab
 *
 * @param {Array<Date|string|number>} dates - Liste von Datumswerten (Aktivitäten/Events)
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

/**
 * computeCurrentStreak zaehlt ab der letzten aktiven Woche rueckwaerts, nicht
 * ab heute -- fuer die WERTUNG bleibt das so: Wer einmal vier Wochen am Stueck
 * aktiv war, hat die Bedingung erfuellt, auch wenn es ein Jahr her ist. Als
 * Fortschritt las sich derselbe Wert aber falsch: Am offenen Abzeichen stand
 * „3/4" fuer eine Serie, die seit Monaten gerissen war, und die naechste
 * aktive Woche zaehlte wieder bei 1.
 *
 * Deshalb hier 0, sobald die letzte aktive Woche AELTER ALS DIE VORWOCHE ist.
 * Ist sie die Vorwoche, lebt die Serie noch -- in dieser Woche kann sie
 * weiterlaufen. Eine kuenftig datierte Woche (ein schon verbuchtes Event der
 * naechsten Woche) zaehlt wie die laufende.
 *
 * Die Vorwoche wird nach KALENDERTAGEN bestimmt (Tag minus 7), nicht nach
 * 168 Stunden: In der Woche der Umstellung auf Sommerzeit laegen 168 Stunden
 * vor Montag 0:30 Uhr schon in der Woche davor.
 *
 * @param {Array<Date|string|number>} dates - dieselbe Liste wie fuer die Wertung
 * @param {Date} [jetzt] - Stichtag (fuer Tests)
 * @returns {number}
 */
function angezeigteSerie(dates, jetzt = new Date()) {
  const serie = computeCurrentStreak(dates);
  if (serie === 0) return 0;

  const neuesteWoche = (dates || [])
    .map(d => getYearWeek(new Date(d)))
    .filter(week => week && !week.includes('NaN'))
    .sort()
    .pop();
  const vorwoche = getYearWeek(new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() - 7));

  // "YYYY-Www" sortiert als Text wie die Wochen selbst.
  return neuesteWoche >= vorwoche ? serie : 0;
}

module.exports = { computeCurrentStreak, angezeigteSerie, getYearWeek, getISOWeeksInYear };
