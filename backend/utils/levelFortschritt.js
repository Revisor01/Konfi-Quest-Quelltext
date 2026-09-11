// backend/utils/levelFortschritt.js
// Bestimmt aus einem Punktestand und der Level-Liste einer Organisation das
// erreichte Level, das naechste Level und den Fortschritt dorthin.
//
// Erwartet eine nach points_required AUFSTEIGEND sortierte Level-Liste.

/**
 * Ermittelt Level-Stand und Fortschritt.
 *
 * @param {number} totalPoints - Gesamtpunkte des Users
 * @param {object[]} levels - Level der Organisation, aufsteigend nach points_required
 * @returns {{currentLevel: object|null, nextLevel: object|null, levelIndex: number,
 *            levelProgress: number, pointsToNextLevel: number}}
 *   currentLevel      hoechstes erreichtes Level (null, wenn noch keines erreicht)
 *   nextLevel         naechstes noch nicht erreichtes Level (null bei Maximum)
 *   levelIndex        1-basierter Rang des erreichten Levels (0 = keines) — Sterne-Anzeige
 *   levelProgress     0..100 Prozent bis zum naechsten Level (100 bei Maximum)
 *   pointsToNextLevel fehlende Punkte bis zum naechsten Level (0 bei Maximum)
 */
function berechneLevelFortschritt(totalPoints, levels) {
  const punkte = Number(totalPoints) || 0;
  let currentLevel = null;
  let nextLevel = null;
  let levelIndex = 0;

  for (let i = 0; i < levels.length; i++) {
    if (punkte >= levels[i].points_required) {
      currentLevel = levels[i];
      levelIndex = i + 1; // 1-basiert für die Sterne-Anzeige
    } else {
      nextLevel = levels[i];
      break;
    }
  }

  let levelProgress = 100;
  let pointsToNextLevel = 0;

  if (nextLevel) {
    // Ohne erreichtes Level zaehlt ab 0 — sonst ab der Schwelle des aktuellen.
    const currentLevelPoints = currentLevel ? currentLevel.points_required : 0;
    const pointsNeeded = nextLevel.points_required - currentLevelPoints;
    const pointsAchieved = punkte - currentLevelPoints;
    // pointsNeeded ist normalerweise > 0. Wird es 0 (zwei Level mit derselben
    // Schwelle), waere die Division NaN — dann gilt der Fortschritt als voll.
    // Der Clamp faengt auch negative Punktestaende ab (Punktabzug per
    // Bonuspunkten): Fortschritt 0, nicht negativ.
    levelProgress = pointsNeeded > 0
      ? Math.max(0, Math.min(100, (pointsAchieved / pointsNeeded) * 100))
      : (pointsAchieved >= 0 ? 100 : 0);
    pointsToNextLevel = nextLevel.points_required - punkte;
  }

  return { currentLevel, nextLevel, levelIndex, levelProgress, pointsToNextLevel };
}

module.exports = { berechneLevelFortschritt };
