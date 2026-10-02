// Neuigkeiten-Zaehler fuer Challenges (Konfi-Sicht) -- das Gegenstueck zum
// Ungelesen-Zaehler des Chats.
//
//   1. Die Challenge selbst, wenn sie noch nie geoeffnet wurde
//      (Pendant zum Push "Neue Challenge gestartet").
//   2. Fremde Beitraege, die seit dem letzten Oeffnen in der Galerie
//      erschienen sind (Pendant zum Feed-Push). Erschienen heisst
//      freigegeben: approved_at, bei unmoderierten Challenges created_at,
//      weil dort approved_at bewusst NULL bleibt (routes/challenges.js).
//      Gezaehlt wird NUR, was die Person auch sehen darf --
//      PUBLIC_SUBMISSION_SQL, dieselbe Bedingung wie die Galerie. Ein
//      Beitrag "nur fuer die Leitung" erzeugt bei anderen keine Zahl.
//   3. Eigene Beitraege, die seit dem letzten Oeffnen von JEMAND ANDEREM
//      freigegeben oder ausgeblendet wurden (Pendant zu Stempel- und
//      Ausgeblendet-Push). Die eigene Einreichung zaehlt nicht -- wie im
//      Chat die eigene Nachricht.
//
// NUR LAUFENDE CHALLENGES. Nach dem Ende gibt es nichts mehr zu tun, und
// die Zahl staende an einem ausgegrauten Archiv-Eintrag, den man nur durch
// Oeffnen loswuerde. Dieselbe Ueberlegung wie bei abgesagten Terminen im
// Verbuchen-Zaehler: keine Zahl vor einer Liste, in der man nicht handeln
// kann.
//
// SICHTBARKEIT. Ein Konfi sieht Challenges seines Jahrgangs, nie 'nur_team',
// nie Entwuerfe, nie ungestartete -- exakt der Scope von GET /challenges/konfi.
// Wer die Challenge nicht oeffnen darf, bekommt auch keine Zahl dafuer.
const { PUBLIC_SUBMISSION_SQL } = require('./challengeSichtbarkeit');
const { leitungSiehtChallengeSql, teamMachtMitSql } = require('./challengeLeitungSicht');

/**
 * Neuigkeiten je Challenge fuer viele Konfis in EINER Abfrage.
 *
 * @param {object} db  Pool oder Client
 * @param {Array<{id:number,type:string,organization_id:number}>} konfis
 *        Nur Personen vom Typ 'konfi' werden gezaehlt; andere liefern keine Zeilen.
 * @returns {Promise<Array<{user_id:number,user_type:string,challenge_id:number,c:number}>>}
 *          Nur Challenges mit c > 0.
 */
async function challengeNeuigkeitenJeChallenge(db, konfis) {
  const nurKonfis = (konfis || []).filter((p) => p.type === 'konfi');
  if (nurKonfis.length === 0) return [];

  const { rows } = await db.query(
    `WITH z AS (
       SELECT * FROM unnest($1::int[], $2::text[], $3::int[])
         AS z(user_id, user_type, organization_id)
     ),
     sichtbar AS (
       -- Laufende Challenges des eigenen Jahrgangs, nie 'nur_team'
       -- (derselbe Scope wie GET /challenges/konfi fuer Konfis).
       SELECT z.user_id, z.user_type, c.id AS challenge_id,
              COALESCE(crs.last_read_at, '1970-01-01'::timestamptz) AS gelesen_bis,
              (crs.challenge_id IS NULL) AS nie_geoeffnet
         FROM z
         JOIN konfi_profiles kp ON kp.user_id = z.user_id
         JOIN challenge_jahrgang_assignments cja ON cja.jahrgang_id = kp.jahrgang_id
         JOIN challenges c
           ON c.id = cja.challenge_id
          AND c.organization_id = z.organization_id
          AND c.audience <> 'nur_team'
          AND c.is_draft = false
          AND c.starts_at <= NOW()
          AND c.ends_at >= NOW()
         LEFT JOIN challenge_read_status crs
           ON crs.challenge_id = c.id
          AND crs.user_id = z.user_id
          AND crs.user_type = z.user_type
     )
     SELECT s.user_id, s.user_type, s.challenge_id,
            (
              -- 1. Die Challenge selbst, wenn nie geoeffnet
              CASE WHEN s.nie_geoeffnet THEN 1 ELSE 0 END
              -- 2. Fremde Beitraege, seit dem letzten Oeffnen in der Galerie erschienen
              + (SELECT COUNT(*)
                   FROM challenge_submissions cs
                   JOIN challenges c ON c.id = cs.challenge_id
                  WHERE cs.challenge_id = s.challenge_id
                    AND cs.user_id <> s.user_id
                    AND ${PUBLIC_SUBMISSION_SQL}
                    AND COALESCE(cs.approved_at, cs.created_at) > s.gelesen_bis
                    AND COALESCE(cs.approved_at, cs.created_at) <= NOW())
              -- 3. Eigene Beitraege, seit dem letzten Oeffnen von anderen moderiert
              + (SELECT COUNT(*)
                   FROM challenge_submissions cs
                  WHERE cs.challenge_id = s.challenge_id
                    AND cs.user_id = s.user_id
                    AND (
                      (cs.moderation_status = 'approved'
                       AND cs.approved_by IS NOT NULL
                       AND cs.approved_by <> s.user_id
                       AND cs.approved_at > s.gelesen_bis
                       AND cs.approved_at <= NOW())
                      OR
                      (cs.moderation_status = 'hidden'
                       AND cs.hidden_by IS DISTINCT FROM s.user_id
                       AND cs.hidden_at > s.gelesen_bis
                       AND cs.hidden_at <= NOW())
                    ))
            )::int AS c
       FROM sichtbar s`,
    [
      nurKonfis.map((p) => p.id),
      nurKonfis.map((p) => p.type),
      nurKonfis.map((p) => p.organization_id)
    ]
  );
  return rows.filter((r) => r.c > 0);
}

/**
 * Neuigkeiten je Challenge fuer Leitung und Team.
 *
 * Wartende Beitraege zaehlen in `c` nicht -- sie stehen als Freigabe am
 * Reiter (badge-counts.pendingChallenges). Ausgeblendete auch nicht: Die hat
 * schon jemand gesehen und entschieden.
 *
 * Spalte `neu` ist dieselbe Rechnung, nur zaehlen die
 * WARTENDEN fremden Beitraege seit dem letzten Oeffnen mit: `neu` = `c` +
 * `neu_wartend`. Sie speist die rote Kugel am Challenge-Eintrag
 * (badge-counts.challengeNeueBeitraege); `neu_wartend` nennt, wie viele
 * davon noch auf Freigabe warten (fuer den Vorlesetext). Ausgeblendete
 * zaehlen auch hier nicht. `c` bleibt unveraendert -- Reiter, App-Symbol und
 * Gemeinde-Umschalter rechnen weiter damit.
 *
 * "Nie geoeffnet" heisst: keine Zeile in challenge_read_status. Migration 168
 * hat fuer die damalige Leitung jede bestehende Challenge als gesehen
 * eingetragen; neu ist, was danach startet.
 *
 * @param {object} db
 * @param {Array<{id:number,type:string,organization_id:number,role_name?:string,assigned_jahrgaenge?:Array}>} personen
 *        Nur Typ 'admin' und 'teamer' (ohne super_admin) werden gezaehlt.
 * @returns {Promise<Array<{user_id:number,user_type:string,organization_id:number,challenge_id:number,c:number,neu:number,neu_wartend:number}>>}
 *          Nur Challenges, bei denen `c` ODER `neu` groesser 0 ist. Wer die
 *          alten Felder speist, filtert selbst auf `c > 0` (eine Zeile mit
 *          nur wartenden neuen Beitraegen hat `c = 0`).
 */
async function challengeNeuigkeitenLeitungJeChallenge(db, personen) {
  const leitung = (personen || []).filter((p) =>
    (p.type === 'admin' || p.type === 'teamer') && p.role_name !== 'super_admin');
  if (leitung.length === 0) return [];

  const { rows } = await db.query(
    `WITH z AS (
       SELECT * FROM unnest($1::int[], $2::text[], $3::int[], $4::text[], $5::text[])
         AS z(user_id, user_type, organization_id, rolle, jahrgaenge)
     )
     SELECT z.user_id, z.user_type, z.organization_id, c.id AS challenge_id,
            (n.nie_geoeffnet + b.freigegeben)::int AS c,
            -- Rote Kugel am Eintrag: dazu die neuen wartenden.
            (n.nie_geoeffnet + b.freigegeben + b.wartend)::int AS neu,
            b.wartend::int AS neu_wartend
       FROM z
       JOIN challenges c
         ON c.organization_id = z.organization_id
        AND c.is_draft = false
        AND c.starts_at <= NOW()
        AND c.ends_at >= NOW()
        AND ${leitungSiehtChallengeSql({ rolle: 'z.rolle', jahrgaenge: 'z.jahrgaenge::int[]' })}
       LEFT JOIN challenge_read_status crs
         ON crs.challenge_id = c.id
        AND crs.user_id = z.user_id
        AND crs.user_type = z.user_type
       -- 1. Die Challenge selbst: nie geoeffnet, das Team macht mit,
       --    nicht selbst angelegt
       CROSS JOIN LATERAL (
         SELECT CASE WHEN crs.challenge_id IS NULL
                          AND c.created_by IS DISTINCT FROM z.user_id
                          AND ${teamMachtMitSql({ rolle: 'z.rolle', jahrgaenge: 'z.jahrgaenge::int[]' })}
                     THEN 1 ELSE 0 END AS nie_geoeffnet
       ) n
       -- 2. Fremde Beitraege seit dem letzten Oeffnen, nichts aus der
       --    Zukunft -- getrennt nach freigegeben und wartend. Ausgeblendete
       --    ('hidden') zaehlen in keiner Spalte.
       CROSS JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE cs.moderation_status = 'approved') AS freigegeben,
                COUNT(*) FILTER (WHERE cs.moderation_status = 'pending') AS wartend
           FROM challenge_submissions cs
          WHERE cs.challenge_id = c.id
            AND cs.user_id <> z.user_id
            AND cs.created_at > COALESCE(crs.last_read_at, '1970-01-01'::timestamptz)
            AND cs.created_at <= NOW()
       ) b`,
    [
      leitung.map((p) => p.id),
      leitung.map((p) => p.type),
      leitung.map((p) => p.organization_id),
      leitung.map((p) => p.role_name || (p.type === 'teamer' ? 'teamer' : 'admin')),
      leitung.map((p) => `{${(p.assigned_jahrgaenge || []).filter((j) => j.can_view).map((j) => j.id).join(',')}}`)
    ]
  );
  // `neu` ist nie kleiner als `c` (dieselbe Rechnung plus die wartenden);
  // beide Bedingungen stehen trotzdem da, damit keine Zeile verloren geht,
  // falls sich eine Spalte einmal aendert.
  return rows.filter((r) => r.c > 0 || r.neu > 0);
}

module.exports = { challengeNeuigkeitenJeChallenge, challengeNeuigkeitenLeitungJeChallenge };
