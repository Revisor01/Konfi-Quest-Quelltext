// backend/utils/badgeAntwortV2.js
// Die EINE Antwortform der Abzeichen-Generation v2 — fuer Konfi UND Teamer.
//
// WELCHE FELDER MITKOMMEN — und warum die anderen nicht
// custom_badges hat 14 Spalten. Die Ansichten lesen davon neun. Die
// restlichen fuenf sind reine Verwaltungsfelder, die nie auf einem Bildschirm
// landen und je Antwort rund 3,3 kB kosten (gemessen an Produktion:
// 27 Abzeichen = 13,4 kB):
//   created_at, created_by  — Verwaltungsspuren, nur in der Leitungs-Oberflaeche
//                             relevant, und die laedt ueber /admin/badges.
//   organization_id         — steht schon im Token des Aufrufers; die Route
//                             filtert ohnehin danach.
//   target_role             — die Route liefert je Rolle nur die eigene Sorte,
//                             der Wert ist also fuer alle Zeilen derselbe.

// Genau die Felder, die in der v2-Antwort landen. Alles andere aus
// custom_badges bleibt draussen (Begruendung siehe oben).
const V2_FELDER = [
  'id',
  'name',
  'description',
  'icon',
  'color',
  'criteria_type',
  'criteria_value',
  'criteria_extra',
  'is_hidden',
  'is_active',
  'sort_order',
  // Berechnet, nicht aus custom_badges:
  'earned',
  'earned_at',
  'seen',
  'unreachable',
  'progress'
];

// Ein Abzeichen auf die v2-Felder eindampfen.
function schlankesAbzeichen(badge) {
  const schlank = {};
  for (const feld of V2_FELDER) {
    if (badge[feld] !== undefined) schlank[feld] = badge[feld];
  }
  return schlank;
}

// Die gemeinsame v2-Huelle bauen.
//
// Erwartet das Ergebnis einer Rollen-Berechnung ({ available, earned, stats })
// — also genau das, was utils/konfiBadgeProgress.js und
// utils/teamerBadgeProgress.js liefern. Die Rollen rechnen unterschiedlich
// (Punktekonto vs. Teamer-Jahre), die HUELLE ist identisch.
function baueBadgeAntwortV2({ available, earned, stats }) {
  return {
    available: (available || []).map(schlankesAbzeichen),
    earned: (earned || []).map(schlankesAbzeichen),
    stats: {
      totalVisible: stats?.totalVisible ?? 0,
      totalSecret: stats?.totalSecret ?? 0
    }
  };
}

module.exports = { baueBadgeAntwortV2, schlankesAbzeichen, V2_FELDER };
