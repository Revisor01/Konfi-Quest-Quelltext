// backend/utils/punkteHistorie.js
// Punkte-Verlauf EINES Users (Aktivitaeten + Bonuspunkte + Event-Punkte) samt
// aufsummierter Gesamtstaende.
//
// MANDANTENGRENZE: Jede der vier Queries filtert auf organization_id. Die
// sicherere Fassung (Konfi-Pfad) gewinnt — im Teamer-Pfad ist das eine
// Verhaltensaenderung, siehe Test "Mandantengrenze".
//
// ANTWORTFORM-VERTRAG: { history: [...], totals: {gottesdienst, gemeinde, total} }.
// Jeder Eintrag in history: id, title, points, category, date, comment,
// source_type. Ausgelieferte Store-Apps lesen genau diese Felder — nichts
// darf wegfallen oder umbenannt werden.

// Aktivitaeten (Gottesdienst- & Gemeinde-Punkte)
const ACTIVITIES_QUERY = `
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

// Bonuspunkte
const BONUS_QUERY = `
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

// Event-Punkte
const EVENT_POINTS_QUERY = `
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

/**
 * Liefert Verlauf und Gesamtstaende der Punkte eines Users.
 *
 * @param {object} db - pg Pool
 * @param {number} userId - users.id
 * @param {number} organizationId - Mandant; filtert ALLE vier Queries
 * @returns {Promise<{history: object[], totals: {gottesdienst:number, gemeinde:number, total:number}}>}
 */
async function getPunkteHistorie(db, userId, organizationId) {
  const [
    { rows: activities },
    { rows: bonusPoints },
    { rows: eventPoints },
    { rows: [konfiProfile] }
  ] = await Promise.all([
    db.query(ACTIVITIES_QUERY, [userId, organizationId]),
    db.query(BONUS_QUERY, [userId, organizationId]),
    db.query(EVENT_POINTS_QUERY, [userId, organizationId]),
    db.query(
      'SELECT gottesdienst_points, gemeinde_points FROM konfi_profiles WHERE user_id = $1 AND organization_id = $2',
      [userId, organizationId]
    )
  ]);

  // Zusammenfuehren und nach Datum sortieren (neueste zuerst)
  const history = [...activities, ...bonusPoints, ...eventPoints].sort((a, b) => {
    const dateA = new Date(a.date || 0);
    const dateB = new Date(b.date || 0);
    return dateB - dateA;
  });

  const gdPoints = parseInt(konfiProfile?.gottesdienst_points, 10) || 0;
  const gmPoints = parseInt(konfiProfile?.gemeinde_points, 10) || 0;

  return {
    history,
    totals: {
      gottesdienst: gdPoints,
      gemeinde: gmPoints,
      total: gdPoints + gmPoints
    }
  };
}

module.exports = { getPunkteHistorie };
