// Bewahrte Stempel zu den lebenden dazunehmen.
//
// Loescht die Leitung einen Jahrgang, gehen die Challenges mit, die nur an
// ihm hingen. Die Stempel, die Teamer:innen und Leitung darin bekommen
// haben, legt der Server vorher ab (Tabelle bewahrte_stempel) und liefert sie
// ueber GET /challenges/bewahrte-stempel (eigene) bzw.
// GET /challenges/admin/bewahrte-stempel/:userId (Detailansicht der Leitung).
// Jeder Eintrag hat die Form eines erhaltenen Stempels (ChallengeMark).
//
// Hier werden sie an die aus den lebenden Challenges abgeleiteten angehaengt.
// Ein Stempel mit derselben Challenge-Kennung kommt nur einmal vor -- die
// lebende Fassung gewinnt. Alles, was keine Liste ist (aelterer Server,
// Fehler, noch nicht geladen), zaehlt als leer.
import type { ChallengeMark } from '../types/challenges';

export function mitBewahrtenStempeln(marks: ChallengeMark[], bewahrte: unknown): ChallengeMark[] {
  const lebende = Array.isArray(marks) ? marks : [];
  if (!Array.isArray(bewahrte) || bewahrte.length === 0) return lebende;
  const vorhanden = new Set(lebende.map((m) => m.challenge_id));
  const dazu = (bewahrte as ChallengeMark[]).filter(
    (s) => s && typeof s.challenge_id === 'number' && !vorhanden.has(s.challenge_id)
  );
  return [...lebende, ...dazu];
}
