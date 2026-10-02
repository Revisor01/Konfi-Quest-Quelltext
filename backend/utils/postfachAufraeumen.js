// Mitteilungen im Postfach, deren Gegenstand verschwindet.
//
// WAS GEHT UND WAS BLEIBT -- die Unterscheidung:
//
//   Eine Mitteilung, die einen ZUSTAND meldet ("eingereicht und wird
//   geprueft", "neuer Antrag wartet auf dich"), ist tot, sobald der Antrag
//   weg ist: Der Zustand existiert nicht mehr, das Ziel des Antippens auch
//   nicht. Sie geht.
//
//   Eine Mitteilung, die eine ENTSCHEIDUNG festhaelt ("Antrag genehmigt",
//   "Antrag abgelehnt"), ist Verlauf. Sie bleibt wahr, auch wenn der
//   abgelehnte Antrag spaeter aufgeraeumt wird -- der Text traegt den Namen
//   der Aktivitaet, das Ziel ist die Antragsliste der Rolle, die es weiter
//   gibt. Sie bleibt.
//
//   Ein Abzeichen, das die Leitung loescht, verschwindet samt aller
//   Exemplare aus den Profilen (badges.js). "Neues Badge erhalten" zeigt dann
//   auf etwas, das niemand mehr hat. Sie geht.
//
// ZUORDNUNG ueber die Spalte data (jsonb): Die Schreibstellen legen dort
// request_id bzw. badge_id ab -- je nach Stelle als Zahl (newRequest.id) oder
// als Text (req.params.id). `->>` liefert beides als Text, deshalb wird
// ueber Text verglichen und nie gecastet: Ein unerwarteter Wert trifft
// nichts, statt die ganze Loeschung mit einem Cast-Fehler zu kippen. data
// NULL oder ein blosser JSON-String (doppelt serialisiert) ergeben bei `->>`
// NULL und treffen ebenfalls nichts.
//
//   Ein TERMIN, der geloescht wird, nimmt ALLE seine Mitteilungen mit --
//   Anmeldung, Abmeldung, Nachruecken, Absage, Aenderung, Reaktivierung,
//   Teilnahme, Team-Buchungen, Opt-out/-in, Konfi-Abmeldung bei der Leitung.
//   Auch "Teilnahme bestaetigt, +2 Punkte" geht: Der Termin ist das Ziel
//   des Antippens, und das gibt es nicht mehr; die Punkte selbst stehen im
//   Profil. Anders als beim Antrag bleibt hier nichts als Verlauf, weil jede
//   dieser Mitteilungen auf den Termin zeigt (event_id bzw. eventId).
//
//   Eine CHALLENGE nimmt Stempel, "Beitrag ausgeblendet" und "Neuer
//   Beitrag" mit -- mit ihr verschwinden auch alle Beitraege (FK).
//
//   Ein JAHRGANG nimmt die Loeschwarnung mit -- eine Warnung vor etwas, das
//   passiert ist, waere Rauschen. "Neue Registrierung" bleibt: Sie zeigt
//   auf die Konfi-Liste, die es weiter gibt.
//
//   Punkte (bonus_points, activity_assigned) und Level-Aufstiege haben
//   keinen loeschbaren Gegenstand mit Kennung im Text; sie bleiben als
//   Verlauf, wie die Antragsentscheidung.
//
//   Die Kennung der Person liegt je Art unter `konfi_id` (Konfi-Vorgaenge;
//   new_activity_request traegt sie seit jeher auch bei Teamer-Antraegen)
//   oder `user_id` (Vorgaenge jeder Rolle: Challenge-Beitrag, Teamer-Zu-/
//   Absage, Einladung beantwortet). Beide werden verglichen -- wie event_id
//   und eventId beim Termin.
//
// Alle Funktionen nehmen db ODER einen Transaktions-Client: Sie fuehren
// kein BEGIN/COMMIT aus, der Aufrufer bestimmt die Transaktion.

/** Die Arten, die einen Zustand des Antrags melden -- nicht die Entscheidung. */
const ZUSTANDS_ARTEN_ANTRAG = ['new_activity_request', 'activity_request_submitted'];

/**
 * Entfernt die Zustands-Mitteilungen zu geloeschten Antraegen.
 *
 * @param {{query: Function}} db  Pool oder Client
 * @param {Array<number|string>} requestIds  Kennungen der geloeschten Antraege
 * @returns {Promise<number>} Anzahl entfernter Mitteilungen
 */
async function loescheMitteilungenZuAntraegen(db, requestIds) {
  const ids = [...new Set((requestIds || []).map((id) => String(id)).filter((id) => id !== '' && id !== 'null' && id !== 'undefined'))];
  if (ids.length === 0) return 0;
  const { rowCount } = await db.query(
    `DELETE FROM notifications
      WHERE type = ANY($1::text[])
        AND data->>'request_id' = ANY($2::text[])`,
    [ZUSTANDS_ARTEN_ANTRAG, ids]
  );
  return rowCount;
}

/**
 * Entfernt "Neues Badge erhalten" zu einem geloeschten Abzeichen.
 *
 * @param {{query: Function}} db  Pool oder Client
 * @param {number|string} badgeId  Kennung des geloeschten Abzeichens
 * @returns {Promise<number>} Anzahl entfernter Mitteilungen
 */
async function loescheMitteilungenZuAbzeichen(db, badgeId) {
  if (badgeId === null || badgeId === undefined || String(badgeId) === '') return 0;
  const { rowCount } = await db.query(
    `DELETE FROM notifications
      WHERE type = 'badge_earned'
        AND data->>'badge_id' = $1::text`,
    [String(badgeId)]
  );
  return rowCount;
}

/**
 * Die Arten, die auf einen Termin zeigen. Die Kennung liegt je Art unter
 * `event_id` (Konfi-Meldungen) oder `eventId` (Team-Buchungen, Pflichttermin)
 * -- beide werden verglichen, wie es auch frontend/utils/pushNavigation tut.
 */
const ARTEN_AM_TERMIN = [
  'event_registered', 'event_unregistered', 'waitlist_promotion', 'event_attendance',
  'event_removed', 'event_waitlisted',
  'event_cancelled', 'event_changed', 'event_reactivated', 'event_reminder',
  'event_unregistration', 'teamer_event_booking', 'teamer_event_cancellation',
  'event_opt_out', 'event_opt_in', 'new_event', 'mandatory_event_created'
];

/** Die Arten, die auf eine Challenge zeigen (Kennung: challengeId). */
const ARTEN_AN_CHALLENGE = ['challenge_badge_earned', 'challenge_submission_hidden', 'challenge_submission', 'challenge_started'];

/** Die Arten, die auf einen Jahrgang zeigen und mit ihm sterben (Kennung: jahrgang_id). */
const ARTEN_AM_JAHRGANG = ['jahrgang_deletion_warning'];

/**
 * Entfernt alle Mitteilungen zu einem geloeschten Termin.
 *
 * @param {{query: Function}} db  Pool oder Client
 * @param {number|string} eventId
 * @returns {Promise<number>} Anzahl entfernter Mitteilungen
 */
async function loescheMitteilungenZuTermin(db, eventId) {
  if (eventId === null || eventId === undefined || String(eventId) === '') return 0;
  const { rowCount } = await db.query(
    `DELETE FROM notifications
      WHERE type = ANY($1::text[])
        AND (data->>'event_id' = $2::text OR data->>'eventId' = $2::text)`,
    [ARTEN_AM_TERMIN, String(eventId)]
  );
  return rowCount;
}

/**
 * Entfernt alle Mitteilungen zu einer geloeschten Challenge.
 *
 * @param {{query: Function}} db  Pool oder Client
 * @param {number|string} challengeId
 * @returns {Promise<number>} Anzahl entfernter Mitteilungen
 */
async function loescheMitteilungenZuChallenge(db, challengeId) {
  if (challengeId === null || challengeId === undefined || String(challengeId) === '') return 0;
  const { rowCount } = await db.query(
    `DELETE FROM notifications
      WHERE type = ANY($1::text[])
        AND (data->>'challengeId' = $2::text OR data->>'challenge_id' = $2::text)`,
    [ARTEN_AN_CHALLENGE, String(challengeId)]
  );
  return rowCount;
}

/**
 * Entfernt die Loeschwarnung zu einem Jahrgang, der geloescht wurde.
 *
 * @param {{query: Function}} db  Pool oder Client
 * @param {number|string} jahrgangId
 * @returns {Promise<number>} Anzahl entfernter Mitteilungen
 */
async function loescheMitteilungenZuJahrgang(db, jahrgangId) {
  if (jahrgangId === null || jahrgangId === undefined || String(jahrgangId) === '') return 0;
  const { rowCount } = await db.query(
    `DELETE FROM notifications
      WHERE type = ANY($1::text[])
        AND data->>'jahrgang_id' = $2::text`,
    [ARTEN_AM_JAHRGANG, String(jahrgangId)]
  );
  return rowCount;
}

/**
 * Die Arten, die der Leitung UEBER eine Person berichten und mit ihrem Konto
 * gehen. Kennung: konfi_id oder user_id (siehe Kopf).
 */
const ARTEN_UEBER_PERSON = [
  'new_activity_request',           // konfi_id (auch bei Teamer-Antraegen)
  'new_konfi_registration',         // konfi_id
  'event_unregistration',           // konfi_id
  'event_opt_out',                  // konfi_id
  'event_opt_in',                   // konfi_id
  'challenge_submission',           // user_id (Konfi oder Team)
  'teamer_event_booking',           // user_id
  'teamer_event_cancellation',      // user_id
  'gemeinde_einladung_beantwortet'  // user_id (die eingeladene Person)
];

/**
 * Entfernt die Leitungs-Mitteilungen ueber eine Person, deren Konto
 * geloescht wird. In der Loesch-Transaktion des Aufrufers laufen lassen.
 */
async function loescheMitteilungenUeberPerson(db, userId) {
  const ids = (Array.isArray(userId) ? userId : [userId])
    .filter((id) => id !== null && id !== undefined && String(id) !== '')
    .map(String);
  if (ids.length === 0) return 0;
  const { rowCount } = await db.query(
    `DELETE FROM notifications
      WHERE type = ANY($1::text[])
        AND (data->>'konfi_id' = ANY($2::text[]) OR data->>'user_id' = ANY($2::text[]))`,
    [ARTEN_UEBER_PERSON, ids]
  );
  return rowCount;
}

/**
 * Die Arten, die eine offene Einladung melden und mit ihrem Zurueckziehen
 * gehen (Kennung: einladung_id, als Text -- pushService schreibt sie mit
 * toString()).
 */
const ARTEN_AN_EINLADUNG = ['gemeinde_einladung'];

/**
 * Entfernt "Einladung in eine Gemeinde" zu einer zurueckgezogenen Einladung.
 *
 * @param {{query: Function}} db  Pool oder Client
 * @param {number|string} einladungId
 * @returns {Promise<number>} Anzahl entfernter Mitteilungen
 */
async function loescheMitteilungenZuEinladung(db, einladungId) {
  if (einladungId === null || einladungId === undefined || String(einladungId) === '') return 0;
  const { rowCount } = await db.query(
    `DELETE FROM notifications
      WHERE type = ANY($1::text[])
        AND data->>'einladung_id' = $2::text`,
    [ARTEN_AN_EINLADUNG, String(einladungId)]
  );
  return rowCount;
}

/**
 * Entfernt "Einladung in eine Gemeinde" zu jeder Einladung, die nicht mehr
 * auf eine Antwort wartet: beantwortet, zurueckgezogen, abgelaufen oder
 * verschwunden.
 *
 * Eintraege ohne Kennung werden nicht geraten -- sie bleiben (wie bei
 * loescheMitteilungenZuEinladung).
 *
 * @param {{query: Function}} db  Pool oder Client
 * @returns {Promise<number>} Anzahl entfernter Mitteilungen
 */
async function loescheMitteilungenZuErledigtenEinladungen(db) {
  const { rowCount } = await db.query(
    `DELETE FROM notifications n
      WHERE n.type = ANY($1::text[])
        AND COALESCE(n.data->>'einladung_id', '') <> ''
        AND NOT EXISTS (
          SELECT 1 FROM org_einladungen e
           WHERE e.id::text = n.data->>'einladung_id'
             AND e.status = 'offen'
             AND e.expires_at > NOW()
        )`,
    [ARTEN_AN_EINLADUNG]
  );
  return rowCount;
}

module.exports = {
  loescheMitteilungenZuAntraegen,
  loescheMitteilungenZuAbzeichen,
  loescheMitteilungenZuTermin,
  loescheMitteilungenZuChallenge,
  loescheMitteilungenZuJahrgang,
  loescheMitteilungenUeberPerson,
  loescheMitteilungenZuEinladung,
  loescheMitteilungenZuErledigtenEinladungen,
  ZUSTANDS_ARTEN_ANTRAG,
  ARTEN_AM_TERMIN,
  ARTEN_AN_CHALLENGE,
  ARTEN_AM_JAHRGANG,
  ARTEN_UEBER_PERSON,
  ARTEN_AN_EINLADUNG
};
