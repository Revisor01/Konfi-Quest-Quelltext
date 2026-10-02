// Push-Gruppen: Welche Push-Art gehoert zu welcher abwaehlbaren Gruppe.
//
// JE ROLLE NUR, WAS ANKOMMT: Konfis bekommen nie eine Meldung aus
// "Anfragen und Freigaben" -- ein Schalter dafuer waere ein Schalter ins
// Leere. Teamer:innen und Leitung sehen alle vier.
//
// GESPEICHERT WIRD DIE ABWAHL (users.push_gruppen_stumm, Migration 158),
// nicht die Auswahl: Ein leeres Feld heisst "alles an", und eine spaeter
// dazukommende Gruppe ist fuer alle automatisch an, statt still zu fehlen.
//
// NICHT BETROFFEN: der stille badge_update (nur die Zahl am App-Symbol, kein
// Text) -- er laeuft ohne Art durch getTokensForUser und wird nie gefiltert.
// Der Postfach-Eintrag ebenso wenig: Wer eine Gruppe stummschaltet, findet
// die Mitteilung weiterhin unter der Glocke (utils/postfachArten.js).

const GRUPPE_CHAT = 'konfi_chat';
const GRUPPE_TERMINE = 'konfi_termine';
const GRUPPE_FORTSCHRITT = 'konfi_fortschritt';
const GRUPPE_VERWALTUNG = 'konfi_verwaltung';

// Rueckfall fuer eine Art, die unten (noch) nicht steht. Bewusst der
// Fortschritts-Topf und nicht "kein Topf": eine vergessene Art soll sich
// abwaehlen lassen und auf Android in einem benannten Kanal landen.
const GRUPPE_STANDARD = GRUPPE_FORTSCHRITT;

/**
 * Die vier Gruppen mit den Texten, die die App zeigt -- Wort fuer Wort
 * dieselben wie die Android-Kanaele (frontend/src/services/notifications.ts),
 * damit Systemeinstellung und In-App-Auswahl gleich heissen.
 * `rollen`: wer die Gruppe zur Auswahl bekommt (users.type).
 */
const GRUPPEN = Object.freeze([
  Object.freeze({
    id: GRUPPE_CHAT,
    name: 'Nachrichten',
    beschreibung: 'Neue Nachrichten in deinen Chats',
    rollen: Object.freeze(['konfi', 'teamer', 'admin'])
  }),
  Object.freeze({
    id: GRUPPE_TERMINE,
    name: 'Events',
    beschreibung: 'Anmeldungen, Änderungen, Absagen und Erinnerungen',
    rollen: Object.freeze(['konfi', 'teamer', 'admin'])
  }),
  Object.freeze({
    id: GRUPPE_FORTSCHRITT,
    name: 'Punkte und Badges',
    beschreibung: 'Punkte, Badges, Level, Challenges und der Rückblick',
    rollen: Object.freeze(['konfi', 'teamer', 'admin'])
  }),
  Object.freeze({
    id: GRUPPE_VERWALTUNG,
    name: 'Anfragen und Freigaben',
    beschreibung: 'Was auf deine Entscheidung wartet',
    rollen: Object.freeze(['teamer', 'admin'])
  })
]);

const GRUPPEN_IDS = Object.freeze(GRUPPEN.map((g) => g.id));

// Jeder `data.type` aus services/pushService.js gehoert genau einer Gruppe.
// Kommt dort eine Art dazu, gehoert sie hier eingetragen -- der Test
// tests/services/pushGruppenAuswahl.test.js prueft die Vollstaendigkeit.
const GRUPPE_JE_ART = Object.freeze({
  // Unterhaltungen
  chat: GRUPPE_CHAT,

  // Termine: Anmeldung, Absage, Aenderung, Erinnerung, Warteliste, Teilnahme
  event_registered: GRUPPE_TERMINE,
  event_unregistered: GRUPPE_TERMINE,
  // Von der Leitung ausgetragen / auf die Warteliste gesetzt
  event_removed: GRUPPE_TERMINE,
  event_waitlisted: GRUPPE_TERMINE,
  event_cancelled: GRUPPE_TERMINE,
  event_reactivated: GRUPPE_TERMINE,
  event_changed: GRUPPE_TERMINE,
  event_reminder: GRUPPE_TERMINE,
  event_attendance: GRUPPE_TERMINE,
  new_event: GRUPPE_TERMINE,
  mandatory_event_created: GRUPPE_TERMINE,
  waitlist_promotion: GRUPPE_TERMINE,

  // Eigener Fortschritt: Punkte, Abzeichen, Level, Challenges, Rueckblick
  activity_assigned: GRUPPE_FORTSCHRITT,
  activity_request_status: GRUPPE_FORTSCHRITT,
  bonus_points: GRUPPE_FORTSCHRITT,
  badge_earned: GRUPPE_FORTSCHRITT,
  level_up: GRUPPE_FORTSCHRITT,
  certificate: GRUPPE_FORTSCHRITT,
  challenge_started: GRUPPE_FORTSCHRITT,
  challenge_badge_earned: GRUPPE_FORTSCHRITT,
  challenge_submission_hidden: GRUPPE_FORTSCHRITT,
  wrapped: GRUPPE_FORTSCHRITT,

  // Meldungen an Leitung und Team: etwas wartet auf eine Entscheidung
  new_activity_request: GRUPPE_VERWALTUNG,
  new_konfi_registration: GRUPPE_VERWALTUNG,
  challenge_submission: GRUPPE_VERWALTUNG,
  events_pending_approval: GRUPPE_VERWALTUNG,
  event_unregistration: GRUPPE_VERWALTUNG,
  event_opt_in: GRUPPE_VERWALTUNG,
  event_opt_out: GRUPPE_VERWALTUNG,
  teamer_event_booking: GRUPPE_VERWALTUNG,
  teamer_event_cancellation: GRUPPE_VERWALTUNG,
  jahrgang_deletion_warning: GRUPPE_VERWALTUNG,
  // Eine Einladung wartet auf die Entscheidung des Empfaengers -- genau das
  // meint "Anfragen und Freigaben".
  gemeinde_einladung: GRUPPE_VERWALTUNG,
  // Die Antwort darauf an die einladende Leitung -- dieselbe
  // Gruppe wie die uebrigen Meldungen an Leitung und Team.
  gemeinde_einladung_beantwortet: GRUPPE_VERWALTUNG
});

/** Gruppe zu einer Push-Art; unbekannte Arten fallen auf GRUPPE_STANDARD. */
const gruppeFuerArt = (art) => GRUPPE_JE_ART[art] || GRUPPE_STANDARD;

/**
 * Die Gruppen, die eine Rolle zur Auswahl bekommt (users.type:
 * 'konfi' | 'teamer' | 'admin'). Unbekannte Rolle: alles ausser Verwaltung.
 */
const gruppenFuerRolle = (rolle) => GRUPPEN.filter((g) => g.rollen.includes(rolle || 'konfi'));

/**
 * Prueft eine eingehende Abwahl-Liste: nur bekannte Gruppen-Kennungen,
 * entdoppelt, in fester Reihenfolge. Unbekannte Werte -> null.
 */
function bereinigeStumm(liste) {
  if (!Array.isArray(liste)) return null;
  if (!liste.every((id) => typeof id === 'string' && GRUPPEN_IDS.includes(id))) return null;
  return GRUPPEN_IDS.filter((id) => liste.includes(id));
}

module.exports = {
  GRUPPE_CHAT,
  GRUPPE_TERMINE,
  GRUPPE_FORTSCHRITT,
  GRUPPE_VERWALTUNG,
  GRUPPE_STANDARD,
  GRUPPEN,
  GRUPPEN_IDS,
  GRUPPE_JE_ART,
  gruppeFuerArt,
  gruppenFuerRolle,
  bereinigeStumm
};
