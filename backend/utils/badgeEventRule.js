// backend/utils/badgeEventRule.js
// Single Source of Truth fuer die Frage "welche Events zaehlen fuer Badges".
//
// REGEL:
// - KONFIS: Pflicht-Events (events.mandatory) und Konfirmationen
//   (events.is_konfirmation) zaehlen NIE fuer Badges. Nur freiwillig besuchte,
//   bestaetigte Events.
// - TEAMER: ALLE bestaetigten Events zaehlen (sie arbeiten bei Pflicht/
//   Konfirmation mit -> legitime Zaehlung).
//
// Diese Bedingung MUSS in der Wertung (badges.js) UND der Fortschrittsanzeige
// (konfi.js) identisch verwendet werden, sonst laufen Wertung und Progress
// auseinander. Voraussetzung im SQL: event_bookings als "eb", events als "e".

const KONFI_BADGE_EVENT_CONDITION =
  "eb.attendance_status = 'present' AND e.mandatory = false AND e.is_konfirmation = false";

const TEAMER_BADGE_EVENT_CONDITION =
  "eb.attendance_status = 'present'";

module.exports = { KONFI_BADGE_EVENT_CONDITION, TEAMER_BADGE_EVENT_CONDITION };
