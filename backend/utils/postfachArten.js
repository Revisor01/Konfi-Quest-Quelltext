// Welche Push-Arten ins Postfach geschrieben werden -- und welche nicht.
//
// EIN WEG STATT ACHTZEHN KOPIEN: Jeder Push laeuft durch
// PushService.sendToUser bzw. sendToMultipleUsers. Genau dort wird der
// Postfach-Eintrag mitgeschrieben -- VOR der Token-Pruefung, damit auch
// jemand ohne Push-Geraet (kein Token, Push abgeschaltet) die Mitteilung im
// Postfach findet. Welche Art schreibt, entscheidet ausschliesslich die
// Positivliste POSTFACH_ARTEN hier. Eine Art, die dort nicht steht, wird
// nicht geschrieben -- ohne Ausnahme und ohne Umweg. Neue Push-Arten sind
// damit standardmaessig NICHT im Postfach, bis jemand sie hier eintraegt.
//
// DIE VIER ALTEN ARTEN bleiben, wo sie sind: badges.js, konfi.js, teamer.js
// und activities.js schreiben sie weiterhin selbst, mit ihren eigenen Texten
// und Kennungen. Ihre Push-Gegenstuecke (badge_earned, new_activity_request,
// activity_request_status) stehen deshalb NICHT in der Positivliste -- sonst
// laege jede davon doppelt im Postfach.

const POSTFACH_ARTEN = new Set([
  // ---- Konfis (und Teamer:innen, wo sie dieselben Wege gehen) ----
  'event_attendance',            // Punkte aus einem Termin verbucht
  'bonus_points',                // Bonuspunkte
  'activity_assigned',           // Aktivitaet direkt zugewiesen
  'level_up',                    // Level-Aufstieg
  'challenge_badge_earned',      // Stempel aus einer Challenge
  'waitlist_promotion',          // von der Warteliste nachgerueckt
  'event_cancelled',             // Termin abgesagt
  'event_changed',               // Termin geaendert
  'event_reactivated',           // Termin findet doch statt
  'event_registered',            // Anmeldung bestaetigt / auf Warteliste
  'event_unregistered',          // Abmeldung bestaetigt
  'event_removed',
  'event_waitlisted',
  'challenge_submission_hidden', // eigener Beitrag ausgeblendet
  // ---- Leitung und Team ----
  'event_unregistration',        // Konfi hat sich abgemeldet
  'teamer_event_booking',        // Teamer:in hat gebucht
  'teamer_event_cancellation',   // Teamer:in hat abgesagt
  'events_pending_approval',     // Termine warten auf Verbuchung
  'new_konfi_registration',      // neue Registrierung
  'challenge_submission',        // Beitrag wartet auf Freigabe
  'jahrgang_deletion_warning',
  'gemeinde_einladung',   // in eine weitere Gemeinde eingeladen   // Warnung vor der Jahrgangs-Loeschung
  'event_opt_out',               // Konfi hat sich von einem Pflichttermin abgemeldet
  'event_opt_in',                // ... und wieder angemeldet
  'gemeinde_einladung_beantwortet',
  'wrapped',                     // Jahresrueckblick freigegeben (Konfi und Team)
  'certificate'                  // Zertifikat fuer Teamer:innen
]);

const NICHT_IM_POSTFACH = Object.freeze({
  event_reminder: 'kurzlebig ("morgen", "gleich"), veraltet sofort',
  new_event: 'steht in der Terminliste',
  mandatory_event_created: 'steht in der Terminliste (Pflichttermin)',
  challenge_started: 'die Challenge-Liste hat eigene Zaehler',
  chat: 'der Chat hat eigene Zaehler',
  badge_update: 'stiller Push ohne Text, nur die Zahl am App-Symbol',
  // Die drei Push-Gegenstuecke der alten Schreibstellen (siehe Kopf):
  badge_earned: 'schreibt badges.js selbst (mit badge_icon in data)',
  new_activity_request: 'schreiben konfi.js und teamer.js selbst',
  activity_request_status: 'schreibt activities.js selbst, als activity_request_decision'
});

/**
 * Arten, bei denen eine neue Mitteilung die noch UNGELESENEN aelteren
 * derselben Art, derselben Person und derselben Gemeinde ersetzt.
 *
 * "Events warten auf Verbuchung" kommt aus einem taeglichen Lauf (09:00,
 * backgroundService.checkPendingEvents), solange irgendetwas unverbucht
 * ist. Ohne diese Regel stuende nach zwei Wochen vierzehnmal derselbe Satz
 * im Postfach, mit jeweils anderer Zahl. Was gelesen ist, bleibt als
 * Verlauf stehen -- ersetzt wird nur, was noch niemand gesehen hat.
 */
const ERSETZENDE_ARTEN = new Set(['events_pending_approval']);

/**
 * FRUEHER: WARUM JEDE UNGELESENE MITTEILUNG AM APP-SYMBOL ZAEHLTE
 *
 * Gemessen am Geraet (Leitung, Konto 41): Postfach 23 ungelesen, Challenges 9,
 * Chat 3 -- das Symbol zeigte 12. Die 23 fehlten ganz. Nach dieser Aenderung
 * steht dort 35: Das Symbol ist die Summe dessen, was in der App als Zahl zu
 * sehen ist -- die Reiter UND die Glocke.
 *
 * Die naheliegende Sorge: Manche Arten melden etwas, das die Rolle schon
 * ueber einen Reiter zaehlt. Je Art geprueft gegen utils/appIconBadge.js:
 *
 *   Leitung   new_activity_request      <-> pendingRequests (offene Antraege)
 *             events_pending_approval   <-> pendingEvents (unverbuchte Termine)
 *             challenge_submission      <-> pendingChallenges (offene Freigaben)
 *   Teamer    badge_earned              <-> newBadges (user_badges.seen = false)
 *             challenge_submission      <-> pendingChallenges
 *   Konfi     badge_earned              <-> newBadges
 *             challenge_submission_hidden, challenge_badge_earned (moderiert)
 *                                       <-> challengeUpdates
 *   Alle uebrigen Arten (Punkte, Level, Termin-Meldungen, Registrierungen,
 *   Team-Buchungen, Opt-out/-in, Loeschwarnung, eigene Antraege) haben KEINEN
 *   anderen Zaehler.
 */

/** organization_id aus dem Push-Payload (dort String) als Zahl, sonst null. */
function organisationAlsZahl(wert) {
  if (wert === null || wert === undefined || wert === '') return null;
  const zahl = Number(wert);
  return Number.isInteger(zahl) && zahl > 0 ? zahl : null;
}

/**
 * Schreibt den Postfach-Eintrag zu einem Push -- fuer alle Empfaenger in
 * EINER Abfrage. Tut nichts, wenn die Art nicht in POSTFACH_ARTEN steht.
 *
 * Gespeichert wird, was auch der Push traegt: Titel, Text, Art und der
 * data-Teil mit den Kennungen fuers Antippen (event_id, challengeId, ...);
 * das Postfach navigiert ueber dieselbe Funktion wie ein Push-Tap
 * (frontend utils/pushNavigation.buildPushTargetUrl). organization_id ist
 * die Organisation des INHALTS aus data; fehlt sie, die Stamm-Organisation
 * der Person -- dieselbe Regel wie der Org-Rueckfall in sendToUser.
 *
 * Geloeschte Konten bekommen keinen Eintrag (u.deleted_at IS NULL).
 * Abgeschaltetes Push ist dagegen KEIN Grund: Das Postfach ist der Weg fuer
 * genau die, die keinen Push bekommen.
 *
 * Wirft nie: Ein fehlgeschlagener Eintrag darf den Push nicht kippen, und
 * umgekehrt ist der Push nicht Voraussetzung fuer den Eintrag.
 *
 * @param {{query: Function}} db  Pool oder Client
 * @param {Array<number|string>} userIds
 * @param {{title: string, body?: string, data?: object}} notification
 * @returns {Promise<number>} Anzahl geschriebener Eintraege
 */
async function schreibePostfach(db, userIds, notification) {
  const data = (notification && notification.data) || {};
  const art = data.type;
  if (!POSTFACH_ARTEN.has(art)) return 0;

  const ids = [...new Set((userIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return 0;

  const orgId = organisationAlsZahl(data.organization_id);

  try {
    if (ERSETZENDE_ARTEN.has(art)) {
      await db.query(
        `DELETE FROM notifications
          WHERE user_id = ANY($1::int[])
            AND type = $2
            AND read_at IS NULL
            AND ($3::int IS NULL OR organization_id = $3::int)`,
        [ids, art, orgId]
      );
    }

    const { rowCount } = await db.query(
      `INSERT INTO notifications (user_id, title, message, type, data, organization_id)
       SELECT u.id, LEFT($2, 255), $3, $4, $5::jsonb, COALESCE($6::int, u.organization_id)
         FROM users u
        WHERE u.id = ANY($1::int[])
          AND u.deleted_at IS NULL`,
      [ids, notification.title || '', notification.body || null, art, JSON.stringify(data), orgId]
    );
    return rowCount;
  } catch (err) {
    console.error(`Postfach-Eintrag (${art}) konnte nicht geschrieben werden:`, err.message);
    return 0;
  }
}

module.exports = {
  POSTFACH_ARTEN,
  NICHT_IM_POSTFACH,
  ERSETZENDE_ARTEN,
  schreibePostfach
};
