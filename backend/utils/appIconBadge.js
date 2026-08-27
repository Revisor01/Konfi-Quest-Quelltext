// - Der Chat-Push setzte die CHAT-Unread-Zahl allein aufs Icon
//   (chat.js:1105, 1905) und ueberschrieb damit Antraege, Termine,
//   Challenge-Freigaben und Abzeichen.
// - Alle anderen Pushes fielen auf `badge: 1` zurueck (pushService.js:135,
//   265) -- egal, wie viel tatsaechlich offen war.
// - Nur der Client kannte die echte Summe (BadgeContext.totalBadgeCount),
//   konnte sie aber bei geschlossener App nicht setzen.
//
// Warum der Server rechnen muss und nicht einfach gar nichts setzt: Bei
// geschlossener App gibt es keinen Client. Genau dann ist das Icon aber das
// Einzige, was jemand sieht, bevor er die App oeffnet. Ohne Badge im Push
// bliebe es auf dem letzten Stand stehen.
//
// Diese Datei haelt die Summe an EINER Stelle. Sie muss mit
// BadgeContext.totalBadgeCount uebereinstimmen -- dieselbe Aufteilung je
// Rolle, dieselben Bestandteile. Aendert sich eine Seite, gehoert die andere
// nachgezogen; ein Test haelt die Zusammensetzung fest.

/**
 * Die fuenf Bausteine der Summe -- jeder als EINE Abfrage ueber viele
 * Personen (`= ANY($1)`), nicht als Abfrage pro Person.
 *
 * Jede Funktion liefert Zeilen `{ user_id, c }`; wer nicht vorkommt, hat 0.
 */

// Chat-Unread. Eigene Nachrichten zaehlen nicht mit -- dieselbe Bedingung
// wie in badge-counts.
//
// Die Zuordnung laeuft ueber (user_id, user_type): Ein und dieselbe id kann
// es in zwei Typen geben, deshalb reicht die id allein nicht als Schluessel.
async function chatZaehler(db, personen) {
  if (personen.length === 0) return [];
  return (await db.query(
    `SELECT p.user_id, p.user_type,
            COALESCE(SUM(
              (SELECT COUNT(*)
                 FROM chat_messages m
                WHERE m.room_id = r.id
                  AND m.deleted_at IS NULL
                  AND m.created_at > COALESCE(crs.last_read_at, '1970-01-01')
                  AND NOT (m.user_id = p.user_id AND m.user_type = p.user_type))
            ), 0)::int AS c
       FROM chat_participants p
       JOIN chat_rooms r ON r.id = p.room_id
       LEFT JOIN chat_read_status crs
              ON crs.room_id = r.id AND crs.user_id = p.user_id AND crs.user_type = p.user_type
       JOIN unnest($1::int[], $2::text[], $3::int[]) AS z(user_id, user_type, organization_id)
              ON z.user_id = p.user_id AND z.user_type = p.user_type
      WHERE r.organization_id = z.organization_id
      GROUP BY p.user_id, p.user_type`,
    spalten(personen)
  )).rows;
}

// Offene Antraege und unverarbeitete Termine haengen NICHT an der Person,
// sondern an der Organisation. Deshalb je Organisation einmal zaehlen und das
// Ergebnis auf alle Leitungen dieser Organisation verteilen -- bei 20
// Leitungen in einer Gemeinde ist das eine Abfrage statt 20.
async function antragZaehlerProOrg(db, orgIds) {
  if (orgIds.length === 0) return [];
  return (await db.query(
    `SELECT a.organization_id, COUNT(*)::int AS c
       FROM activity_requests ar
       JOIN activities a ON ar.activity_id = a.id
      WHERE a.organization_id = ANY($1::int[]) AND ar.status = 'pending'
      GROUP BY a.organization_id`,
    [orgIds]
  )).rows;
}

async function terminZaehlerProOrg(db, orgIds) {
  if (orgIds.length === 0) return [];
  return (await db.query(
    `SELECT e.organization_id, COUNT(*)::int AS c
       FROM events e
      WHERE e.organization_id = ANY($1::int[])
        AND e.event_date < NOW()
        AND EXISTS (
          SELECT 1 FROM event_bookings eb
           WHERE eb.event_id = e.id
             AND eb.status = 'confirmed'
             AND eb.attendance_status IS NULL
        )
      GROUP BY e.organization_id`,
    [orgIds]
  )).rows;
}

// Offene Challenge-Freigaben der Leitung: ebenfalls org-weit, nicht personen-
// gebunden.
async function freigabeZaehlerProOrg(db, orgIds) {
  if (orgIds.length === 0) return [];
  return (await db.query(
    `SELECT c.organization_id, COUNT(*)::int AS c
       FROM challenge_submissions cs
       JOIN challenges c ON cs.challenge_id = c.id
      WHERE c.organization_id = ANY($1::int[]) AND cs.moderation_status = 'pending'
      GROUP BY c.organization_id`,
    [orgIds]
  )).rows;
}

// Offene Freigaben fuer Teamer:innen. Hier haengt der Zaehler doch an der
// Person, weil jede:r andere Jahrgaenge sieht.
async function teamerFreigabeZaehler(db, teamer) {
  if (teamer.length === 0) return [];
  const jahrgangsListen = teamer.map((p) =>
    `{${(p.assigned_jahrgaenge || []).filter((j) => j.can_view).map((j) => j.id).join(',')}}`
  );
  return (await db.query(
    `SELECT z.user_id, z.user_type, COUNT(cs.id)::int AS c
       FROM unnest($1::int[], $2::text[], $3::int[], $4::text[])
              AS z(user_id, user_type, organization_id, jahrgaenge)
       LEFT JOIN challenges c
              ON c.organization_id = z.organization_id
       LEFT JOIN challenge_submissions cs
              ON cs.challenge_id = c.id
             AND cs.moderation_status = 'pending'
             AND (
               c.audience = 'nur_team'
               OR EXISTS (
                 SELECT 1 FROM challenge_jahrgang_assignments cja
                  WHERE cja.challenge_id = c.id
                    AND cja.jahrgang_id = ANY(z.jahrgaenge::int[])
               )
             )
      GROUP BY z.user_id, z.user_type`,
    [...spalten(teamer), jahrgangsListen]
  )).rows;
}

// Ungesehene Abzeichen. Die Leitung kann keine verdienen -> gar nicht erst
// abgefragt. `target_role` muss zum Typ passen, damit Teamer:innen keine
// Konfi-Abzeichen mitzaehlen.
async function abzeichenZaehler(db, personen) {
  if (personen.length === 0) return [];
  return (await db.query(
    `SELECT ub.user_id, z.user_type, COUNT(*)::int AS c
       FROM user_badges ub
       JOIN custom_badges cb ON ub.badge_id = cb.id
       JOIN unnest($1::int[], $2::text[], $3::int[]) AS z(user_id, user_type, organization_id)
              ON z.user_id = ub.user_id AND z.organization_id = ub.organization_id
      WHERE ub.seen = false
        AND COALESCE(cb.target_role, 'konfi') = z.user_type
      GROUP BY ub.user_id, z.user_type`,
    spalten(personen)
  )).rows;
}

/** Zerlegt die Empfaengerliste in die drei parallelen Arrays fuer `unnest`. */
function spalten(personen) {
  return [
    personen.map((p) => p.id),
    personen.map((p) => p.type),
    personen.map((p) => p.organization_id)
  ];
}

/** Schluessel der Zuordnung: id allein reicht nicht, der Typ gehoert dazu. */
function schluessel(userId, userType) {
  return `${userId}_${userType}`;
}

// Wie im Client: super_admin zaehlt NICHT als Admin-Typ (der Client schliesst
// sie ueber isAdmin ebenfalls aus) -- fuer sie gilt der Konfi-Zweig.
function istLeitung(empfaenger) {
  return empfaenger.type === 'admin' && empfaenger.role_name !== 'super_admin';
}

/**
 * Dieselbe Summe wie `berechneAppIconSumme`, aber fuer viele Personen in
 * wenigen Abfragen statt sieben pro Person.
 *
 * Warum es die Variante gibt: Der Hintergrund-Sync laeuft alle fuenf Minuten
 * ueber ALLE Nutzer:innen. Einzeln gerechnet waeren das bei 1000 Konfis rund
 * 7000 Abfragen je Takt. Hier sind es sechs -- unabhaengig von der Anzahl.
 *
 * Gemischte Rollen in einem Aufruf sind der Normalfall: Die rollenabhaengigen
 * Teile werden nach Rolle gruppiert abgefragt, wer nicht dazugehoert, taucht
 * in der jeweiligen Abfrage gar nicht erst auf.
 *
 * @param {object} db          Pool oder Client
 * @param {Array<object>} empfaenger  je { id, type, organization_id, role_name?, assigned_jahrgaenge? }
 * @returns {Promise<Map<string, number>>}  Schluessel `${id}_${type}`, Wert nie negativ
 */
async function appIconSummenFuerAlle(db, empfaenger) {
  const summen = new Map();
  if (!empfaenger || empfaenger.length === 0) return summen;

  for (const p of empfaenger) summen.set(schluessel(p.id, p.type), 0);

  const leitung = empfaenger.filter(istLeitung);
  const teamer = empfaenger.filter((p) => p.type === 'teamer');
  const mitAbzeichen = empfaenger.filter((p) => p.type === 'konfi' || p.type === 'teamer');
  const leitungsOrgs = [...new Set(leitung.map((p) => p.organization_id))];

  const [chat, antraege, termine, freigaben, teamerFreigaben, abzeichen] = await Promise.all([
    chatZaehler(db, empfaenger),
    antragZaehlerProOrg(db, leitungsOrgs),
    terminZaehlerProOrg(db, leitungsOrgs),
    freigabeZaehlerProOrg(db, leitungsOrgs),
    teamerFreigabeZaehler(db, teamer),
    abzeichenZaehler(db, mitAbzeichen)
  ]);

  const addiere = (userId, userType, wert) => {
    const k = schluessel(userId, userType);
    if (summen.has(k)) summen.set(k, summen.get(k) + (wert || 0));
  };

  for (const r of chat) addiere(r.user_id, r.user_type, r.c);
  for (const r of teamerFreigaben) addiere(r.user_id, r.user_type, r.c);
  for (const r of abzeichen) addiere(r.user_id, r.user_type, r.c);

  // Die org-weiten Zahlen auf jede Leitung dieser Organisation verteilen.
  const proOrg = new Map();
  for (const reihe of [antraege, termine, freigaben]) {
    for (const r of reihe) proOrg.set(r.organization_id, (proOrg.get(r.organization_id) || 0) + r.c);
  }
  for (const p of leitung) addiere(p.id, p.type, proOrg.get(p.organization_id) || 0);

  for (const [k, wert] of summen) summen.set(k, Math.max(0, wert));
  return summen;
}

/**
 * Zaehlt alles, was fuer eine Person offen ist -- exakt so, wie es der
 * Client im App-Icon anzeigt.
 *
 * Aufteilung je Rolle (identisch zu BadgeContext.totalBadgeCount):
 *   admin      Chat + offene Antraege + unverarbeitete Termine + Freigaben
 *   teamer     Chat + Freigaben + ungesehene Abzeichen
 *   konfi      Chat + ungesehene Abzeichen
 *
 * Fuer super_admin gilt der Konfi-Zweig (org-fremde Rolle, hat weder
 * Antraege noch Abzeichen) -- der Client schliesst sie ueber isAdmin
 * ebenfalls aus.
 *
 * Der Einzelfall ist bewusst nur ein Bulk-Aufruf mit einem Element: So kann
 * es keine zweite, abweichende Fassung der Regeln geben.
 *
 * @param {object} db          Pool oder Client
 * @param {object} empfaenger  { id, type, organization_id, role_name?, assigned_jahrgaenge? }
 * @returns {Promise<number>}  Summe, nie negativ
 */
async function berechneAppIconSumme(db, empfaenger) {
  const summen = await appIconSummenFuerAlle(db, [empfaenger]);
  return summen.get(schluessel(empfaenger.id, empfaenger.type)) || 0;
}

/**
 * Wie oben, aber fehlertolerant: Schlaegt die Zaehlung fehl, kommt null
 * zurueck statt eines Fehlers. Der Aufrufer laesst den Badge dann weg --
 * eine Push-Nachricht darf nicht daran scheitern, dass eine Zahl fehlt.
 */
async function appIconSummeOderNull(db, empfaenger) {
  try {
    return await berechneAppIconSumme(db, empfaenger);
  } catch (err) {
    console.error('App-Icon-Summe konnte nicht berechnet werden:', err);
    return null;
  }
}

module.exports = { berechneAppIconSumme, appIconSummeOderNull, appIconSummenFuerAlle };
