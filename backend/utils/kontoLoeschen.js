// Ein Konto loeschen -- EINE Funktion fuer alle Wege.
//
// DIE WEGE, die hier zusammenlaufen:
//   - DELETE /admin/konfis/:id            (routes/konfi-management.js)
//   - POST /auth/delete-account           (routes/auth.js, jede Rolle)
//   - automatische Loeschung ab Tag 120 nach der Konfirmation
//                                         (services/backgroundService.js)
//   - DELETE /users/:id, dritter Fall     (routes/users.js)
// Bis hierher gab es zwei Kopien (utils/konfiDeletion.js und der Block in
// users.js), die auseinanderliefen: Die eine liess keine Warteliste
// nachruecken, die andere loeschte Dateien schon VOR dem COMMIT; beide
// liessen Zweiergespraeche mit dem Namen der Person stehen, loeschten die
// Einladungscodes der Gemeinde und hielten Dateien aus einer zweiten
// Gemeinde nicht fest (Bestandsaufnahme im Kopf von
// tests/utils/kontoLoeschen.test.js).
//
// GRENZFAELLE, entschieden nach "gehoert zur Person -> weg":
//   - Ihre Nachrichten in JEDEM Chat gehen, auch die der Leitung im
//     Jahrgangs-Chat und im Team-Chat; mit ihnen ihre Umfragen samt aller
//     Stimmen und die Reaktionen darauf. Antworten anderer bleiben, das
//     Zitat faellt weg (reply_to wird NULL).
//   - Zweiergespraeche gehen GANZ, mit den Nachrichten und Dateien der
//     anderen Seite: Das Gespraech war eines mit dieser Person, und der Raum
//     traegt ihren Anzeigenamen (chat_rooms.name, POST /chat/direct).
//   - Ihre Stimmen in Umfragen anderer gehen -- das Ergebnis aendert sich.
//   - Ihre Beitraege zu Challenges gehen, auch aus der Galerie.
//   - Offene Einladungen, die sie als Leitung an andere geschickt hat,
//     bleiben gueltig (eingeladen_von wird NULL); Einladungen AN sie gehen.
//   - Notizen, Kommentare und Absagegruende, die sie als Leitung an
//     Vorgaengen ANDERER hinterlassen hat (Anwesenheitsnotiz,
//     Antragskommentar, Moderationshinweis), bleiben -- sie gehoeren zum
//     Vorgang der anderen Person. Nur der Verweis "gesetzt von" faellt weg.
//   - Ihre Konfi-Zeit (konfi_historie) und ihre bewahrten Stempel gehen mit.
//
// ABLAUF: kontoDatenLoeschen laeuft in der Transaktion des Aufrufers und
// sammelt, was danach noch zu tun ist. Die Dateien loescht
// kontoDateienLoeschen erst NACH dem COMMIT -- ein ROLLBACK darf keine Datei
// kosten. meldeNachKontoLoeschung benachrichtigt danach die Nachgerueckten
// und die Gespraechspartner:innen der geloeschten Zweierraeume.
//
// DER WAECHTER (tests/utils/kontoLoeschen.test.js) liest alle
// Fremdschluessel-Spalten auf users aus information_schema. Kommt eine
// Spalte ohne Eintrag in LOESCHREGELN dazu, faellt er -- die Entscheidung
// "loeschen" oder "nullen" muss dann hier getroffen werden.

const fs = require('fs');
const path = require('path');
const { rueckeNach } = require('./bookingUtils');
const { loescheMitteilungenZuAntraegen, loescheMitteilungenUeberPerson } = require('./postfachAufraeumen');
const { kontoSperreAufheben } = require('./kontoSperre');
const { meldeNachrueckern } = require('./nachrueckMeldung');
const { REQUESTS_DIR, CHALLENGES_DIR, CHAT_DIR } = require('./photoStorage');
const liveUpdate = require('./liveUpdate');

/**
 * Jede Fremdschluessel-Spalte auf users und was mit ihren Zeilen geschieht.
 *
 *   'loeschen' -- die Zeile gehoert zur Person und geht.
 *   'nullen'   -- die Zeile gehoert der Gemeinde oder einer anderen Person
 *                 und bleibt; nur der Verweis wird NULL.
 *
 * Die Reihenfolge ist egal: Keine dieser Zeilen haengt an einer anderen
 * hier geloeschten (Kinder wie Reaktionen, Umfragen und Stimmen haengen per
 * ON DELETE CASCADE an ihrer Nachricht).
 */
const LOESCHREGELN = Object.freeze({
  // ---- was zur Person gehoert ----
  'activity_requests.user_id': 'loeschen',          // Antraege samt Nachweisfoto
  'bewahrte_stempel.user_id': 'loeschen',
  'bonus_points.konfi_id': 'loeschen',
  'challenge_read_status.user_id': 'loeschen',      // Lesestand
  'challenge_submissions.user_id': 'loeschen',      // Beitraege samt Datei
  'chat_message_reactions.user_id': 'loeschen',
  'chat_messages.user_id': 'loeschen',              // Nachrichten samt Datei
  'chat_participants.user_id': 'loeschen',
  'chat_poll_votes.user_id': 'loeschen',            // Umfrage-Stimmen
  'chat_read_status.user_id': 'loeschen',           // Lesestand
  'event_bookings.user_id': 'loeschen',             // Buchungen (vorher Nachruecken)
  'event_points.konfi_id': 'loeschen',
  'event_reminders.user_id': 'loeschen',
  'event_unregistrations.user_id': 'loeschen',      // Abmeldungen samt Grund
  'konfi_historie.user_id': 'loeschen',             // Kopie der Konfi-Zeit
  'konfi_profiles.user_id': 'loeschen',
  'notifications.user_id': 'loeschen',              // eigenes Postfach
  'org_einladungen.user_id': 'loeschen',            // Einladungen AN die Person
  'password_resets.user_id': 'loeschen',
  'push_tokens.user_id': 'loeschen',
  'refresh_tokens.user_id': 'loeschen',
  'user_activities.user_id': 'loeschen',
  'user_badges.user_id': 'loeschen',
  'user_certificates.user_id': 'loeschen',          // empfangene Zertifikate
  'user_jahrgang_assignments.user_id': 'loeschen',
  'user_organizations.user_id': 'loeschen',         // weitere Mitgliedschaften
  'wrapped_snapshots.user_id': 'loeschen',          // eigene Rueckblicke

  // ---- was der Gemeinde oder anderen gehoert: nur der Verweis faellt ----
  'activity_requests.approved_by': 'nullen',
  'bonus_points.admin_id': 'nullen',
  'challenge_submissions.approved_by': 'nullen',
  'challenge_submissions.hidden_by': 'nullen',
  'challenges.author_user_id': 'nullen',
  'challenges.created_by': 'nullen',
  'chat_rooms.created_by': 'nullen',                // Gruppen bleiben; Zweierraeume s. o.
  'custom_badges.created_by': 'nullen',
  'event_bookings.attendance_set_by': 'nullen',
  'event_bookings.note_set_by': 'nullen',
  'event_points.admin_id': 'nullen',
  'events.cancelled_by': 'nullen',
  'events.cancelled_reason_set_by': 'nullen',
  'events.created_by': 'nullen',
  'invite_codes.created_by': 'nullen',              // seit Migration 173 ohne NOT NULL
  'konfi_historie.erstellt_von': 'nullen',
  'levels.created_by': 'nullen',
  'materials.created_by': 'nullen',
  'org_einladungen.eingeladen_von': 'nullen',
  'user_activities.admin_id': 'nullen',
  'user_certificates.admin_id': 'nullen',
  'user_jahrgang_assignments.assigned_by': 'nullen',
  'wrapped_ausgaben.erstellt_von': 'nullen',
  'wrapped_ausgaben.freigegeben_von': 'nullen',
});

/**
 * Fremdschluessel-Spalten auf users, gelesen aus information_schema.
 * @param {{query: Function}} db
 * @returns {Promise<string[]>} 'tabelle.spalte', sortiert
 */
async function fremdschluesselAufUsers(db) {
  const { rows } = await db.query(`
    SELECT DISTINCT kcu.table_name AS tabelle, kcu.column_name AS spalte
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_schema = rc.constraint_schema
       AND kcu.constraint_name = rc.constraint_name
      JOIN information_schema.key_column_usage ziel
        ON ziel.constraint_schema = rc.unique_constraint_schema
       AND ziel.constraint_name = rc.unique_constraint_name
       AND ziel.ordinal_position = kcu.position_in_unique_constraint
     WHERE rc.constraint_schema = current_schema()
       AND ziel.table_name = 'users'
     ORDER BY 1, 2`);
  return rows.map((r) => `${r.tabelle}.${r.spalte}`);
}

/**
 * Vergleicht die Fremdschluessel mit LOESCHREGELN.
 *
 * fehlend:  Fremdschluessel-Spalten auf users ohne Regel -- dort bliebe nach
 *           der Loeschung ein Verweis stehen, oder das DELETE scheiterte.
 * veraltet: Regeln fuer Spalten, die es nicht mehr gibt -- kontoDatenLoeschen
 *           liefe dort auf "column does not exist" und jede Loeschung endete
 *           mit 500.
 * Eine Regel fuer eine Spalte, die noch da ist, aber keinen Fremdschluessel
 * mehr traegt, stoert nicht: UPDATE und DELETE ueber die Spalte wirken
 * weiter. (Die Suite baut so einen Zustand in tests/routes/wrapped.test.js
 * nach: approved_by wird gedroppt und ohne Fremdschluessel neu angelegt.)
 *
 * @returns {Promise<{fehlend: string[], veraltet: string[]}>}
 */
async function pruefeLoeschregeln(db) {
  const fremdschluessel = await fremdschluesselAufUsers(db);
  const { rows } = await db.query(
    `SELECT table_name || '.' || column_name AS spalte
       FROM information_schema.columns
      WHERE table_schema = current_schema()`
  );
  const vorhanden = new Set(rows.map((r) => r.spalte));
  const geregelt = Object.keys(LOESCHREGELN);
  return {
    fehlend: fremdschluessel.filter((s) => !geregelt.includes(s)),
    veraltet: geregelt.filter((s) => !vorhanden.has(s)).sort(),
  };
}

/**
 * Loescht ein Konto samt allem, was zur Person gehoert (Regel im Kopf).
 *
 * Fuehrt KEIN BEGIN/COMMIT aus: Der Aufrufer prueft seine Rechte in
 * derselben Transaktion und schreibt sie fest. Dateien werden hier nur
 * eingesammelt -- loeschen erst nach dem COMMIT (kontoDateienLoeschen).
 *
 * Geloescht wird die ganze Person, ueber alle Gemeinden. Ob der Aufrufer
 * das darf (Rolle, Gemeinde, weitere Mitgliedschaften), prueft er vorher.
 *
 * @param {import('pg').PoolClient} client  in einer Transaktion
 * @param {number|string} userId
 * @returns {Promise<null | {
 *   nachgerueckt: Array<{eventId: number, userId: number, seite: 'konfi'|'team', organizationId: number}>,
 *   dateien: {antragsfotos: string[], challenge: string[], chat: string[]},
 *   gespraechspartner: Array<{user_id: number, user_type: string}>
 * }>}  null, wenn es das Konto nicht gibt
 */
async function kontoDatenLoeschen(client, userId) {
  const { geloescht, ...ergebnis } = await kontenDatenLoeschen(client, [userId]);
  return geloescht.length === 0 ? null : ergebnis;
}

/**
 * Wie kontoDatenLoeschen, fuer mehrere Konten in EINEM Durchgang -- dieselbe
 * Regel, jede Abfrage einmal fuer alle statt einmal je Person.
 *
 * Kennungen, zu denen es kein Konto gibt, werden uebergangen.
 *
 * @param {import('pg').PoolClient} client  in einer Transaktion
 * @param {Array<number|string>} userIds
 * @returns {Promise<{
 *   geloescht: number[],
 *   nachgerueckt: Array<{eventId: number, userId: number, seite: 'konfi'|'team', organizationId: number}>,
 *   dateien: {antragsfotos: string[], challenge: string[], chat: string[]},
 *   gespraechspartner: Array<{user_id: number, user_type: string}>
 * }>}  geloescht: die Kennungen der tatsaechlich geloeschten Konten
 */
async function kontenDatenLoeschen(client, userIds) {
  const gewuenscht = [...new Set((userIds || []).map(Number).filter(Number.isInteger))];
  const leer = {
    geloescht: [],
    nachgerueckt: [],
    dateien: { antragsfotos: [], challenge: [], chat: [] },
    gespraechspartner: [],
  };
  if (gewuenscht.length === 0) return leer;

  // Zeilen sperren: Zwei Loeschwege gleichzeitig (Leitung und Selbstloeschung)
  // sollen nacheinander laufen, nicht ineinander.
  const { rows: konten } = await client.query(
    `SELECT u.id, COALESCE(r.name, '') <> 'konfi' AS ist_team
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = ANY($1::int[])
      ORDER BY u.id
      FOR UPDATE OF u`,
    [gewuenscht]
  );
  if (konten.length === 0) return leer;
  const ids = konten.map((k) => Number(k.id));
  const istTeam = new Map(konten.map((k) => [Number(k.id), k.ist_team]));

  const { rows: freiwerdend } = await client.query(
    `SELECT user_id, event_id, timeslot_id, organization_id
       FROM event_bookings
      WHERE user_id = ANY($1::int[]) AND status = 'confirmed'
      ORDER BY id`,
    [ids]
  );
  await client.query('DELETE FROM event_bookings WHERE user_id = ANY($1::int[])', [ids]);
  const nachgerueckt = [];
  for (const platz of freiwerdend) {
    const seite = istTeam.get(Number(platz.user_id)) ? 'team' : 'konfi';
    const [promoted] = await rueckeNach(client, {
      eventId: platz.event_id,
      timeslotId: seite === 'team' ? null : platz.timeslot_id,
      seite
    });
    if (promoted) {
      nachgerueckt.push({
        eventId: Number(platz.event_id),
        userId: Number(promoted),
        seite,
        organizationId: Number(platz.organization_id)
      });
    }
  }

  // 2. DATEIEN EINSAMMELN, solange die Zeilen noch stehen -- in allen
  //    Gemeinden (vorher je Weg nur in der Stamm-Gemeinde).
  const { rows: antraege } = await client.query(
    'SELECT id, photo_filename FROM activity_requests WHERE user_id = ANY($1::int[])',
    [ids]
  );
  const { rows: beitraege } = await client.query(
    'SELECT file_path FROM challenge_submissions WHERE user_id = ANY($1::int[]) AND file_path IS NOT NULL',
    [ids]
  );
  // Zweiergespraeche der Person: Raum, Teilnehmende (fuer die Chatliste der
  // anderen Seite) und ALLE Dateien darin.
  const { rows: zweierraeume } = await client.query(
    `SELECT DISTINCT r.id
       FROM chat_rooms r
       JOIN chat_participants p ON p.room_id = r.id
      WHERE r.type = 'direct' AND p.user_id = ANY($1::int[])`,
    [ids]
  );
  const raumIds = zweierraeume.map((r) => Number(r.id));
  const { rows: partner } = raumIds.length === 0 ? { rows: [] } : await client.query(
    `SELECT DISTINCT user_id, user_type
       FROM chat_participants
      WHERE room_id = ANY($1::bigint[]) AND user_id <> ALL($2::int[])`,
    [raumIds, ids]
  );
  const { rows: chatDateien } = await client.query(
    `SELECT DISTINCT file_path
       FROM chat_messages
      WHERE (user_id = ANY($1::int[]) OR room_id = ANY($2::bigint[]))
        AND file_path IS NOT NULL`,
    [ids, raumIds]
  );

  // 3. POSTFACH ANDERER: "Neuer Antrag eingegangen" zu ihren Antraegen und
  //    alle Leitungs-Mitteilungen UEBER die Person.
  await loescheMitteilungenZuAntraegen(client, antraege.map((a) => a.id));
  await loescheMitteilungenUeberPerson(client, ids);

  // 4. ANMELDESPERRE: Der Zaehler haengt am Benutzernamen (Hash), nicht an
  //    der Kennung -- deshalb vor dem Loeschen der Zeile.
  for (const id of ids) {
    await kontoSperreAufheben(client, id);
  }

  // 5. ZWEIERGESPRAECHE ganz: Nachrichten, Teilnehmende, Lesestaende,
  //    Umfragen und Reaktionen haengen per ON DELETE CASCADE am Raum.
  if (raumIds.length > 0) {
    await client.query('DELETE FROM chat_rooms WHERE id = ANY($1::bigint[])', [raumIds]);
  }

  // 6. JEDE FREMDSCHLUESSEL-SPALTE nach ihrer Regel.
  for (const [spalte, regel] of Object.entries(LOESCHREGELN)) {
    const [tabelle, feld] = spalte.split('.');
    if (regel === 'nullen') {
      await client.query(`UPDATE ${tabelle} SET ${feld} = NULL WHERE ${feld} = ANY($1::int[])`, [ids]);
    } else {
      await client.query(`DELETE FROM ${tabelle} WHERE ${feld} = ANY($1::int[])`, [ids]);
    }
  }

  // 7. Die Konten selbst.
  await client.query('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);

  return {
    geloescht: ids,
    nachgerueckt,
    dateien: {
      antragsfotos: antraege.map((a) => a.photo_filename).filter(Boolean),
      challenge: beitraege.map((b) => b.file_path),
      chat: chatDateien.map((c) => c.file_path),
    },
    gespraechspartner: partner.map((p) => ({ user_id: Number(p.user_id), user_type: p.user_type })),
  };
}

const VERZEICHNISSE = Object.freeze({
  antragsfotos: REQUESTS_DIR,
  challenge: CHALLENGES_DIR,
  chat: CHAT_DIR,
});

/**
 * Entfernt die eingesammelten Dateien. NUR NACH DEM COMMIT aufrufen.
 *
 * Wirft nie. Fehler landen gezaehlt im Protokoll -- ohne Dateinamen und
 * ohne Pfade: Auch ein zufaelliger Name verknuepft im Protokoll eine Datei
 * mit dem Zeitpunkt einer Loeschung.
 *
 * @param {{antragsfotos?: string[], challenge?: string[], chat?: string[]}} dateien
 * @returns {Promise<{entfernt: number, fehlten: number, fehler: number}>}
 */
async function kontoDateienLoeschen(dateien) {
  const summe = { entfernt: 0, fehlten: 0, fehler: 0 };
  if (!dateien) return summe;
  for (const [art, verzeichnis] of Object.entries(VERZEICHNISSE)) {
    const namen = Array.isArray(dateien[art]) ? dateien[art] : [];
    const fehlercodes = new Set();
    let fehlerHier = 0;
    for (const name of namen) {
      // Nur der reine Dateiname; alles andere gelangt nicht in einen Pfad.
      if (typeof name !== 'string' || name === '' || path.basename(name) !== name || name === '.' || name === '..') {
        fehlerHier++;
        fehlercodes.add('ungueltiger_name');
        continue;
      }
      try {
        await fs.promises.unlink(path.join(verzeichnis, name));
        summe.entfernt++;
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          summe.fehlten++;
        } else {
          fehlerHier++;
          fehlercodes.add((err && err.code) || 'unbekannt');
        }
      }
    }
    if (fehlerHier > 0) {
      summe.fehler += fehlerHier;
      console.error(`Konto löschen: ${fehlerHier} von ${namen.length} Dateien (${art}) nicht entfernt (${[...fehlercodes].join(', ')})`);
    }
  }
  return summe;
}

/**
 * Nach dem COMMIT: die Nachgerueckten benachrichtigen (je Gemeinde ihres
 * Events) und den Gespraechspartner:innen der geloeschten Zweierraeume die
 * Chatliste auffrischen. Wirft nie.
 *
 * @param {object} db  Pool (nicht der Transaktions-Client)
 * @param {Awaited<ReturnType<typeof kontoDatenLoeschen>>} ergebnis
 * @param {{melden?: boolean}} [opt]  melden=false: keine Push-Meldungen
 *   das Nachruecken selbst ist dann trotzdem
 *   geschehen.
 */
async function meldeNachKontoLoeschung(db, ergebnis, { melden = true } = {}) {
  if (!ergebnis) return;
  try {
    liveUpdate.raeumeGeaendert(ergebnis.gespraechspartner);
  } catch (err) {
    console.error('Konto löschen: Chatlisten nicht aufgefrischt:', err.message);
  }
  if (!melden) return;
  const jeGemeinde = new Map();
  for (const eintrag of ergebnis.nachgerueckt || []) {
    const liste = jeGemeinde.get(eintrag.organizationId) || [];
    liste.push(eintrag);
    jeGemeinde.set(eintrag.organizationId, liste);
  }
  for (const [organizationId, liste] of jeGemeinde) {
    try {
      await meldeNachrueckern(db, organizationId, liste);
    } catch (err) {
      console.error('Konto löschen: Nachrücken nicht gemeldet:', err.message);
    }
  }
}

module.exports = {
  LOESCHREGELN,
  fremdschluesselAufUsers,
  pruefeLoeschregeln,
  kontoDatenLoeschen,
  kontenDatenLoeschen,
  kontoDateienLoeschen,
  meldeNachKontoLoeschung,
};
