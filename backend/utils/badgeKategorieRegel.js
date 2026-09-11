// backend/utils/badgeKategorieRegel.js
// EINE Quelle fuer die Frage "aus welchen Kategorien war jemand dabei?".
//
// WARUM DIESE DATEI EXISTIERT:
// Das Kriterium `category_combination` fragt nach VERSCHIEDENEN Kategorien --
// dreimal dieselbe Konfifahrt ist eben nicht "drei Freizeiten". Diese Frage
// wird an vier Stellen gestellt: in der Wertung (routes/badges.js, Konfi- und
// Teamer-Zweig) und im Fortschritt (utils/konfiBadgeProgress.js,
// utils/teamerBadgeProgress.js).
//
// Stuenden dort vier abgeschriebene Queries, waere der Konsistenz-Vertrag aus
// utils/badgeProgress.js (Wertung und Fortschritt muessen deckungsgleich
// zaehlen, sonst zeigt die App 3/3 ohne Vergabe) nur eine Absichtserklaerung.
// Hier steht der Query-Text EINMAL; die vier Aufrufer setzen ihn ein.

const { KONFI_BADGE_EVENT_CONDITION } = require('./badgeEventRule');

/**
 * Kategorienamen, aus denen ein KONFI mindestens einen Eintrag hat.
 *
 * Platzhalter: $1 = user_id, $2 = organization_id.
 * Spalte: `name` (Kategoriename), je Kategorie genau eine Zeile.
 */
const KONFI_KATEGORIE_NAMEN_SQL = `
  SELECT DISTINCT c.name FROM (
    SELECT ac.category_id FROM user_activities ka
    JOIN activities a ON ka.activity_id = a.id
    JOIN activity_categories ac ON a.id = ac.activity_id
    WHERE ka.user_id = $1 AND a.organization_id = $2

    UNION ALL

    SELECT ec.category_id FROM event_bookings eb
    JOIN events e ON eb.event_id = e.id
    JOIN event_categories ec ON eb.event_id = ec.event_id
    WHERE eb.user_id = $1 AND ${KONFI_BADGE_EVENT_CONDITION} AND eb.organization_id = $2
  ) src
  JOIN categories c ON src.category_id = c.id AND c.organization_id = $2
`;

/**
 * Kategorienamen, aus denen eine TEAMER:IN mindestens einen Eintrag hat.
 *
 * Platzhalter: $1 = user_id, $2 = organization_id.
 * Spalte: `name` (Kategoriename), je Kategorie genau eine Zeile.
 */
const TEAMER_KATEGORIE_NAMEN_SQL = `
  SELECT DISTINCT c.name FROM (
    SELECT ac.category_id FROM user_activities ua
    JOIN activities a ON ua.activity_id = a.id
    JOIN activity_categories ac ON a.id = ac.activity_id
    WHERE ua.user_id = $1 AND a.organization_id = $2 AND a.target_role = 'teamer'

    UNION ALL

    SELECT ec.category_id FROM event_bookings eb
    JOIN event_categories ec ON eb.event_id = ec.event_id
    WHERE eb.user_id = $1 AND eb.attendance_status = 'present' AND eb.organization_id = $2
  ) src
  JOIN categories c ON src.category_id = c.id AND c.organization_id = $2
`;

/**
 * Wie viele der geforderten Kategorien sind abgedeckt?
 *
 * Bewusst hier und nicht bei den Aufrufern: Wertung und Fortschritt muessen
 * dieselbe Antwort geben, und "dieselbe Antwort" heisst dieselbe Funktion.
 *
 * @param {string[]|unknown} geforderteKategorien  aus criteria_extra.required_categories
 * @param {Set<string>} abgedeckteKategorien  Namen aus einer der beiden Queries
 * @returns {number} Anzahl abgedeckter Kategorien (jede zaehlt hoechstens einmal)
 */
function zaehleAbgedeckteKategorien(geforderteKategorien, abgedeckteKategorien) {
  if (!Array.isArray(geforderteKategorien)) return 0;
  if (!abgedeckteKategorien || typeof abgedeckteKategorien.has !== 'function') return 0;
  // Set ueber die Forderung: Steht eine Kategorie versehentlich doppelt in
  // criteria_extra, darf sie den Fortschritt nicht doppelt hochtreiben --
  // sonst waere "3 verschiedene" mit zweimal derselben Kategorie erfuellbar.
  return [...new Set(geforderteKategorien)]
    .filter((name) => abgedeckteKategorien.has(name)).length;
}

module.exports = {
  KONFI_KATEGORIE_NAMEN_SQL,
  TEAMER_KATEGORIE_NAMEN_SQL,
  zaehleAbgedeckteKategorien
};
