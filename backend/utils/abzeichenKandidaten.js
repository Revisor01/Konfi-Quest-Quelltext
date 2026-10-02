// backend/utils/abzeichenKandidaten.js
//
// DER GEDANKE: In einer Stunde ändert sich für die allermeisten Personen
// nichts. Wer sich nicht geändert hat, kann auch kein Abzeichen neu verdient
// haben — die teure Prüfung für ihn ist reine Heizung.
//
// WARUM DAS TRÄGT (und nicht bloß meistens stimmt): Kein einziges
// Vergabe-Kriterium kann allein durch das Vergehen von Zeit NEU erfüllt
// werden. Nachgeprüft an badges.js, Kriterium für Kriterium:
//
//   - Punkte, Anzahlen, Kombinationen (total_points, gottesdienst_points,
//     gemeinde_points, both_categories, activity_count, event_count,
//     mandatory_event_count, unique_activities, bonus_points,
//     specific_activity, activity_combination, category_activities,
//     category_combination) hängen ausschließlich an gespeicherten Daten.
//   - `streak` rechnet aus den ISO-Wochen der vorhandenen Einträge
//     (utils/streakCalculation.js). Ohne neuen Eintrag kann die Folge nur
//     abreißen, nie wachsen.
//   - `time_based` zählt Einträge mit `datum >= jetzt - tage`. Die Grenze
//     wandert mit der Zeit nach vorn, das Fenster kann also nur Einträge
//     VERLIEREN. Ein künftig datierter Eintrag liegt ohnehin schon im Fenster.
//   - `teamer_year` zählt Jahre, in denen Einträge liegen. Ohne neuen Eintrag
//     kommt kein Jahr dazu.
//
// Bleiben drei Wege, auf denen ein Abzeichen neu fällig wird: die Daten der
// Person ändern sich, der Abzeichen-Katalog ändert sich, oder die
// Jahrgangs-Konfiguration ändert sich. Den Katalog deckt bereits die
// Nachprüfung beim Speichern ab (badges.js, `pruefeAbzeichenNach`); die beiden
// anderen Wege deckt der Fingerabdruck hier.
//
// WARUM FINGERABDRUCK UND NICHT ZEITSTEMPEL: Naheliegend wäre, auf
// `created_at` der beteiligten Tabellen zu filtern. Das trägt nicht:
// `event_bookings.created_at` ist eine TEXT-Spalte, und vor allem ändert das
// Setzen der Anwesenheit sie gar nicht — genau dieser Schritt macht aber aus
// einer Buchung erst einen zählenden Eintrag. Die dafür gedachte Spalte
// `attendance_set_at` setzt der Check-in-Weg (routes/events/checkin.js) nicht
// mit. Ein Zeitstempel-Filter würde also ausgerechnet die häufigste Änderung
// übersehen und Abzeichen still verschlucken. Der Fingerabdruck fragt
// stattdessen direkt das ab, worauf es ankommt: die Zählwerte selbst.
//
// KOSTEN: sieben Abfragen für ALLE Personen zusammen, unabhängig von der
// Anzahl — derselbe Gedanke wie bei `appIconSummenFuerAlle`
// (utils/appIconBadge.js).

const { abfragenBuendeln } = require('./abfragenBuendeln');

/**
 * Fingerabdruck je Person: alles, woran ein Vergabe-Kriterium hängen kann,
 * zu einer Zeichenkette zusammengefasst. Ändert sie sich nicht, kann auch
 * kein Abzeichen neu fällig geworden sein.
 *
 * Die einzelnen Bestandteile sind bewusst grob (Anzahl, Summe, Höchstwert) —
 * es geht nicht darum, das Ergebnis der Prüfung vorwegzunehmen, sondern nur
 * darum, eine Änderung nicht zu übersehen. Lieber einmal zu viel geprüft als
 * einmal zu wenig.
 *
 * MEHRERE GEMEINDEN: Eine Person darf mehrfach in `personen`
 * stehen, einmal je Gemeinde, in der sie Konfi oder Teamer:in ist (der
 * Hintergrund-Lauf prueft jede Gemeinde fuer sich). Der Abdruck bleibt EINER
 * je Person; er enthaelt die Kataloge ALLER ihrer Gemeinden, nach
 * Gemeinde sortiert -- sonst uebersaehe ein geaenderter Katalog der weiteren
 * Gemeinde die Person. Mit einer Gemeinde ist der Abdruck derselbe wie zuvor.
 *
 * @param {object} db            Pool oder Client
 * @param {Array<{user_id:number, organization_id:number}>} personen
 * @returns {Promise<Map<number, string>>}  user_id -> Fingerabdruck
 */
async function abzeichenFingerabdruecke(db, personen) {
  const abdruecke = new Map();
  if (!personen || personen.length === 0) return abdruecke;

  const ids = [...new Set(personen.map(p => p.user_id))];
  const orgIds = [...new Set(personen.map(p => p.organization_id).filter(o => o != null))];

  // Je Baustein eine Abfrage über ALLE Personen — nicht je Person eine.
  const [
    { rows: aktivitaeten },
    { rows: buchungen },
    { rows: bonus },
    { rows: profile },
    { rows: abzeichen },
    { rows: katalog },
    { rows: teamerSeit }
  ] = await abfragenBuendeln(db, [
    // Aktivitäten: Anzahl und jüngstes Datum. Das jüngste Datum fängt den
    // Fall ab, dass ein Eintrag gelöscht und ein anderer angelegt wurde —
    // die Anzahl bliebe dann gleich.
    () => db.query(
      `SELECT user_id, COUNT(*)::int AS anzahl,
              COALESCE(MAX(completed_date)::text, '-') AS neuestes,
              COALESCE(MAX(id), 0)::text AS hoechste_id
       FROM user_activities WHERE user_id = ANY($1::int[]) GROUP BY user_id`,
      [ids]
    ),
    // Buchungen: nur die ANWESENDEN zählen für Abzeichen. Damit fängt der
    // Fingerabdruck auch das blosse Setzen der Anwesenheit ein, das keinen
    // Zeitstempel hinterlässt.
    () => db.query(
      `SELECT eb.user_id, COUNT(*)::int AS anzahl, COALESCE(MAX(eb.id), 0)::text AS hoechste_id
       FROM event_bookings eb
       WHERE eb.user_id = ANY($1::int[]) AND eb.attendance_status = 'present'
       GROUP BY eb.user_id`,
      [ids]
    ),
    () => db.query(
      `SELECT konfi_id AS user_id, COALESCE(SUM(points), 0)::text AS summe, COUNT(*)::int AS anzahl
       FROM bonus_points WHERE konfi_id = ANY($1::int[]) GROUP BY konfi_id`,
      [ids]
    ),
    // Punktestände und die Jahrgangs-Schalter, an denen total_points,
    // gottesdienst_points, gemeinde_points und both_categories hängen.
    () => db.query(
      `SELECT kp.user_id, kp.gottesdienst_points::text AS gd, kp.gemeinde_points::text AS gm,
              COALESCE(j.gottesdienst_enabled::text, '-') AS gd_an,
              COALESCE(j.gemeinde_enabled::text, '-') AS gm_an
       FROM konfi_profiles kp
       LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
       WHERE kp.user_id = ANY($1::int[])`,
      [ids]
    ),
    // Bereits vergebene Abzeichen: Nimmt jemand ein Abzeichen zurück, muss
    // es erneut vergeben werden können.
    () => db.query(
      `SELECT user_id, COUNT(*)::int AS anzahl FROM user_badges
       WHERE user_id = ANY($1::int[]) GROUP BY user_id`,
      [ids]
    ),
    // Der Abzeichen-Katalog je Organisation. Eine Änderung daran betrifft
    // ALLE Personen dieser Organisation auf einmal — deshalb hier je Org
    // und unten an jede Person dieser Org gehängt.
    //
    // `custom_badges` hat KEIN updated_at (nachgesehen am Produktions-Schema),
    // ein Zeitstempel scheidet also aus. Stattdessen die Inhalte selbst
    // zusammenfassen: Anzahl, Summe der Schwellen und eine Prüfsumme über
    // Typ und Zusatzbedingung. Wer ein Kriterium ändert, ändert damit den
    // Abdruck — auch wenn die Schwelle gleich bleibt.
    () => db.query(
      `SELECT organization_id, COUNT(*)::int AS anzahl,
              COALESCE(SUM(criteria_value), 0)::text AS summe,
              COALESCE(SUM(hashtext(
                COALESCE(criteria_type, '') || '#' ||
                COALESCE(criteria_extra, '') || '#' ||
                COALESCE(target_role, '')
              )::bigint), 0)::text AS pruefsumme
       FROM custom_badges
       WHERE organization_id = ANY($1::int[]) AND is_active = true
       GROUP BY organization_id`,
      [orgIds]
    ),
    // teamer_since bestimmt bei teamer_year das Startjahr.
    () => db.query(
      `SELECT id AS user_id, COALESCE(teamer_since::text, '-') AS seit
       FROM users WHERE id = ANY($1::int[])`,
      [ids]
    )
  ]);

  const nachId = (rows, bauer) => {
    const m = new Map();
    for (const r of rows) m.set(Number(r.user_id), bauer(r));
    return m;
  };

  const mAkt = nachId(aktivitaeten, r => `${r.anzahl}:${r.neuestes}:${r.hoechste_id}`);
  const mBuch = nachId(buchungen, r => `${r.anzahl}:${r.hoechste_id}`);
  const mBonus = nachId(bonus, r => `${r.summe}:${r.anzahl}`);
  const mProfil = nachId(profile, r => `${r.gd}:${r.gm}:${r.gd_an}:${r.gm_an}`);
  const mAbz = nachId(abzeichen, r => String(r.anzahl));
  const mSeit = nachId(teamerSeit, r => String(r.seit));

  const mKatalog = new Map();
  for (const r of katalog) {
    mKatalog.set(Number(r.organization_id), `${r.anzahl}:${r.summe}:${r.pruefsumme}`);
  }

  // Gemeinden je Person (siehe MEHRERE GEMEINDEN oben).
  const gemeindenJe = new Map();
  for (const p of personen) {
    if (!gemeindenJe.has(p.user_id)) gemeindenJe.set(p.user_id, new Set());
    gemeindenJe.get(p.user_id).add(p.organization_id);
  }

  for (const [id, gemeinden] of gemeindenJe) {
    const kataloge = [...gemeinden]
      .sort((a, b) => Number(a) - Number(b))
      .map(org => mKatalog.get(Number(org)) || '-')
      .join(',');
    abdruecke.set(id, [
      mAkt.get(id) || '-',
      mBuch.get(id) || '-',
      mBonus.get(id) || '-',
      mProfil.get(id) || '-',
      mAbz.get(id) || '-',
      mSeit.get(id) || '-',
      kataloge
    ].join('|'));
  }

  return abdruecke;
}

module.exports = { abzeichenFingerabdruecke };
