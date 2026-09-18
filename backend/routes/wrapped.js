const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { darfJahrgang, darfKonfi } = require('../utils/jahrgangsZugriff');
const { waehleKacheln, waehleTeamerKacheln, teamerJahrIstLeer } = require('../utils/wrappedKacheln');
const { waehleSegen } = require('../utils/wrappedSegen');
const { seiteFuerKategorie, datumsFenster, orgHatSommerfreizeit, STAVANGER_VON, STAVANGER_BIS } = require('../utils/wrappedKategorien');

module.exports = (db, rbacVerifier, roleHelpers) => {
  const { requireAdmin, requireOrgAdmin } = roleHelpers;
  const PushService = require('../services/pushService');

  // Schema-Migrationen: siehe backend/migrations/075_wrapped.sql

  // Deutsche Monatsnamen
  // Wochentage, indiziert wie EXTRACT(DOW): 0 = Sonntag.
  const WOCHENTAG_NAMEN = [
    'Sonntag', 'Montag', 'Dienstag', 'Mittwoch',
    'Donnerstag', 'Freitag', 'Samstag'
  ];

  const MONAT_NAMEN = [
    '', 'Januar', 'Februar', 'M\u00e4rz', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
  ];

  // ====================================================================
  // HILFSFUNKTIONEN
  // ====================================================================

  /**
   * Der Zeitraum eines Rueckblicks als Datumsfenster [start, ende] (beide
   * inklusive).
   *
   * Daraus:
   *   KONFI  -> Beginn der Konfi-Zeit bis HEUTE. Kein 1.9.-Fenster, kein
   *             Kalenderjahr, und der Konfirmationstermin schneidet NICHT
   *             mehr ab.
   *   TEAMER -> lueckenlose Kette: vom Ende der vorigen Teamer-Ausgabe
   *             derselben Organisation (beim ersten Mal: seit wann jemand im
   *             Team ist) bis HEUTE.
   *
   * Der Konfirmationstermin bleibt als ANGABE erhalten (die Konfirmations-
   * Seite und die Teilen-Karte zeigen ihn ueber `zeitraum.konfirmation`), er
   * bestimmt nur den Zeitraum nicht mehr.
   *
   * Die Funktion bleibt bewusst SYNCHRON und ohne Datenbank: Woher der Beginn
   * kommt, weiss der Aufrufer (Konfi-Profil, vorige Ausgabe, teamer_since) --
   * hier wird nur noch gerechnet. Das macht sie einzeln pruefbar.
   *
   * Datumsstrings werden mit padStart gebaut, NICHT ueber
   * new Date(y, 8, 1).toISOString() -- letzteres rechnet Ortszeit nach UTC und
   * machte in Sommerzeit aus dem 1.9. den 31.8.
   */
  /**
   * Liest eine Zahl, die auf einer Spalte aus einer NEUEN Migration beruht.
   *
   * Dass die Migrationen beim Start automatisch laufen, rettet das NICHT:
   * runMigrations faengt Fehler ab und laesst den Server WEITERLAUFEN
   * (database.js, "Server laeuft weiter"). Schlaegt eine Migration aus
   * irgendeinem Grund fehl, startet das Backend trotzdem -- und ohne diese
   * Absicherung faellt der komplette Rueckblick still aus, wegen einer
   * einzigen Seite.
   *
   * Nur die beiden Codes fuer "Spalte fehlt" (42703) und "Tabelle fehlt"
   * (42P01) werden geschluckt. Alles andere -- ein Tippfehler im SQL, ein
   * Timeout -- fliegt weiter: Ein echter Fehler darf sich nicht als
   * harmlose Null tarnen.
   *
   * @returns {Promise<number>} der gelesene Wert, oder 0 wenn die Spalte fehlt
   */
  /**
   * Fuehrt `fn` so aus, dass ein Fehler darin die umgebende Transaktion NICHT
   * mitreisst: SAVEPOINT davor, RELEASE danach, ROLLBACK TO SAVEPOINT im
   * Fehlerfall. Der Fehler selbst fliegt weiter -- wer ihn schlucken will,
   * faengt ihn beim Aufrufer.
   *
   * DAS IST DER KERN DER SACHE (siehe den Kommentar an zahlAusNeuerSpalte):
   * In PostgreSQL bricht EIN fehlgeschlagenes Statement die ganze Transaktion
   * ab. Ein blosses try/catch schluckt zwar den Fehler, aber jede weitere
   * Query scheitert danach mit "current transaction is aborted" -- und die
   * Schleife darueber zaehlt fuer JEDE folgende Person einen Fehler.
   *
   * DER SAVEPOINT DARF NUR IN EINER TRANSAKTION GESETZT WERDEN.
   *
   * Deshalb wird der SAVEPOINT versucht und sein Scheitern hingenommen. Im
   * Autocommit braucht es ihn nicht: Dort reisst ein fehlgeschlagenes
   * Statement nichts mit sich, es gibt keine Transaktion zum Abbrechen.
   *
   * @param {object} client  Datenbank-Client
   * @param {string} name    Name des SAVEPOINTs (muss ein Bezeichner sein,
   *   kein Nutzereingabe-Wert -- er geht unparametrisiert ins SQL)
   * @param {Function} fn    was abgesichert laufen soll
   * @returns {Promise<*>} was `fn` liefert
   */
  async function mitSavepoint(client, name, fn) {
    let gesetzt = false;
    try {
      await client.query(`SAVEPOINT ${name}`);
      gesetzt = true;
    } catch {
      // Kein Transaktionsblock -- dann eben ohne.
    }

    try {
      const ergebnis = await fn();
      if (gesetzt) await client.query(`RELEASE SAVEPOINT ${name}`);
      return ergebnis;
    } catch (err) {
      if (gesetzt) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => {});
      }
      throw err;
    }
  }

  async function zahlAusNeuerSpalte(client, sql, params, was) {
    try {
      return await mitSavepoint(client, 'neue_spalte', async () => {
        const { rows: [row] } = await client.query(sql, params);
        return row ? (row.anzahl || 0) : 0;
      });
    } catch (err) {
      if (err.code !== '42703' && err.code !== '42P01') throw err;
      // Alt-Deployment ohne die Migration. Der Rueckfall ist 0, und die
      // zugehoerige Seite faellt damit ueber ihre Bedingung in
      // wrappedKacheln.js einfach weg -- das richtige Verhalten: Ohne die
      // Spalte WEISS niemand etwas, eine Seite auf Verdacht waere schlimmer
      // als keine.
      console.warn(`Wrapped: ${was} nicht verfuegbar (${err.code}), Seite entfaellt:`, err.message);
      return 0;
    }
  }

  function berechneZeitraum(konfirmationTermin, year, vorgabe = null, beginn = null, jetzt = new Date()) {
    const iso = (d) => {
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      const dt = (d instanceof Date) ? d : new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };
    const konfirmation = konfirmationTermin ? iso(konfirmationTermin) : null;

    if (vorgabe && vorgabe.start && vorgabe.ende) {
      return { start: iso(vorgabe.start), ende: iso(vorgabe.ende), konfirmation };
    }

    // Ohne Vorgabe: vom Beginn bis JETZT. "Jetzt" ist der Tag der Erzeugung
    // und wird im Snapshot festgeschrieben -- ein einmal erzeugter Rueckblick
    // aendert sich nie wieder.
    const ende = iso(jetzt);

    if (beginn) {
      const start = iso(beginn);
      // Ein Beginn NACH dem heutigen Tag (verschobene Uhr, Datenfehler) gaebe
      // ein Fenster, das nichts zaehlen kann. Dann lieber der Tag selbst.
      return { start: start > ende ? ende : start, ende, konfirmation };
    }

    // Kein Beginn ermittelbar (Altdaten ohne created_at, Teamer ohne
    // teamer_since und ohne Aktivitaet): das laufende Konfi-Jahr wie bisher.
    return { start: `${year - 1}-09-01`, ende, konfirmation };
  }

  /**
   * Der Zeitraum eines TEAM-Rueckblicks: immer ein volles Kalenderjahr.
   *
   * WAS DAMIT WEGFAELLT: die lueckenlose Kette (jede Ausgabe begann am Ende
   * der vorigen) und die frei setzbaren Datumsfelder. Beides war korrekt
   * gerechnet, aber niemand konnte einer Ausgabe ansehen, welchen Abschnitt
   * sie abdeckt -- der Anfang hing daran, wann die vorige erzeugt worden war.
   * Ein Kalenderjahr erklaert sich von selbst: "Dein Teamerjahr 2026".
   *
   * @param {number} jahr das Kalenderjahr
   * @returns {{start: string, ende: string}} 1.1. bis 31.12. dieses Jahres
   */
  function teamerJahresZeitraum(jahr) {
    return { start: `${jahr}-01-01`, ende: `${jahr}-12-31` };
  }

  /**
   * War diese Person bei der Sommerfreizeit 2026 nach Stavanger dabei?
   *
   * GEPRUEFT WIRD DIE KATEGORIE, nicht ein Aktivitaets- oder Terminname.
   * Beide Quellen zaehlen -- Aktivitaeten UND Termine -- weil die Fahrt je
   * nach Gemeinde als das eine oder das andere gefuehrt wird (dieselbe
   * Ueberlegung wie bei der Kategorie-Verteilung weiter unten).
   *
   * Vorher hing die Seite nur an der Kategorie. Dass sie anderswo nicht
   * erschien, war Zufall -- keine andere Gemeinde hatte eine Kategorie dieses
   * Namens. Legte jemand eine an, bekaeme seine Gemeinde eine Seite ueber
   * eine Fahrt, an der sie nie teilgenommen hat.
   *
   * Eine fehlende Tabelle oder Spalte darf den ganzen Rueckblick nicht
   * verhindern: Im Fehlerfall gilt "nicht dabei" (siehe zaehleWennMoeglich
   * weiter oben -- dieselbe Regel, hier auf einen Wahrheitswert bezogen).
   */
  async function warBeiStavanger(client, userId, orgId, zeitraumStart, zeitraumEnde) {
    // DIE ORG-BINDUNG ZUERST -- vor jeder Abfrage. Gehoert die Gemeinde nicht
    // dazu, gibt es die Seite nicht, ganz gleich wie ihre Kategorien heissen.
    if (!orgHatSommerfreizeit(orgId)) return false;

    // Der Schnitt der beiden Fenster. Liegt der Rueckblick ganz vor oder
    // ganz nach der Fahrt, ist er leer und wir fragen gar nicht erst.
    const von = zeitraumStart > STAVANGER_VON ? zeitraumStart : STAVANGER_VON;
    const bis = zeitraumEnde < STAVANGER_BIS ? zeitraumEnde : STAVANGER_BIS;
    if (von > bis) return false;

    try {
      const { rows: [row] } = await client.query(
        `SELECT EXISTS (
           SELECT 1
             FROM user_activities ua
             JOIN activity_categories ac ON ac.activity_id = ua.activity_id
             JOIN categories c ON c.id = ac.category_id
            WHERE ua.user_id = $1 AND ua.organization_id = $2
              AND LOWER(BTRIM(c.name)) = 'sommerfreizeit'
              AND ua.completed_date >= $3::date
              AND ua.completed_date < ($4::date + INTERVAL '1 day')
           UNION ALL
           SELECT 1
             FROM event_bookings eb
             JOIN events e ON eb.event_id = e.id
             JOIN event_categories ec ON ec.event_id = e.id
             JOIN categories c ON c.id = ec.category_id
            WHERE eb.user_id = $1 AND eb.organization_id = $2
              AND LOWER(BTRIM(c.name)) = 'sommerfreizeit'
              AND e.event_date >= $3::date
              AND e.event_date < ($4::date + INTERVAL '1 day')
         ) AS dabei`,
        [userId, orgId, von, bis]
      );
      return Boolean(row && row.dabei);
    } catch (err) {
      console.warn('Wrapped: Sommerfreizeit-Pruefung nicht moeglich, Seite entfaellt:', err.message);
      return false;
    }
  }

  async function generateKonfiSnapshot(client, userId, orgId, jahrgangId, year, zeitraumVorgabe = null) {
    // Konfirmationstermin je Jahrgang aus dem is_konfirmation-Event ableiten
    // (frueheste nicht-cancelled Konfirmation, org-gescopt) -- ersetzt die alte
    // Jahrgang-Stichtag-Spalte.
    const { rows: [konfirmationRow] } = await client.query(
      `SELECT MIN(e.event_date) AS termin
         FROM events e
         JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
        WHERE eja.jahrgang_id = $1
          AND e.is_konfirmation = true
          AND e.organization_id = $2
          AND (e.cancelled IS NULL OR e.cancelled = false)`,
      [jahrgangId, orgId]
    );
    const konfirmationTermin = konfirmationRow && konfirmationRow.termin ? konfirmationRow.termin : null;

    // QUELLE: konfi_profiles.created_at des Profils IN DIESEM Jahrgang.
    // Das ist der Tag, an dem die Person diesem Jahrgang zugeordnet wurde --
    // also der Beginn genau der Konfi-Zeit, die dieser Rueckblick erzaehlt.
    //
    // WARUM NICHT jahrgaenge.created_at: Das ist der Tag, an dem die LEITUNG
    // den Jahrgang anlegte, nicht der Tag, an dem diese Person dazukam. Wer
    // spaeter nachrueckt oder aus einem anderen Jahrgang wechselt, bekaeme
    // einen Zeitraum, der vor der eigenen Konfi-Zeit beginnt. Umgekehrt
    // liegt konfi_profiles.created_at bei einem nachtraeglich angelegten
    // Jahrgang nie VOR dem Jahrgang selbst.
    //
    // WARUM NICHT users.created_at: Ein Konto kann aelter sein als die
    // Konfi-Zeit (zweiter Jahrgang, Teamer, der spaeter Konfi wird) -- dann
    // zaehlte der Rueckblick eine fremde Zeit mit.
    //
    // Fehlt created_at (Altdaten), faellt berechneZeitraum auf das laufende
    // Konfi-Jahr zurueck.
    const { rows: [beginnRow] } = await client.query(
      `SELECT kp.created_at FROM konfi_profiles kp
        WHERE kp.user_id = $1 AND kp.jahrgang_id = $2`,
      [userId, jahrgangId]
    );
    const konfiBeginn = beginnRow && beginnRow.created_at ? beginnRow.created_at : null;

    const zeitraum = berechneZeitraum(konfirmationTermin, year, zeitraumVorgabe, konfiBeginn);
    const zeitraumStart = zeitraum.start;
    const zeitraumEnde = zeitraum.ende;

    // Punkte aus konfi_profiles.
    //
    // BEWUSST OHNE ZEITFILTER: Das sind laufende STAENDE, keine Ereignisse --
    // konfi_profiles fuehrt zwei Summenspalten und kein Datum, an dem sich
    // filtern liesse. Der Endspurt weiter unten vergleicht sie mit dem Ziel
    // des Jahrgangs; beides ist der aktuelle Stand und muss zueinander
    // passen.
    const { rows: [profile] } = await client.query(
      `SELECT kp.gottesdienst_points, kp.gemeinde_points
       FROM konfi_profiles kp
       WHERE kp.user_id = $1 AND kp.jahrgang_id = $2`,
      [userId, jahrgangId]
    );
    const gottesdienst = profile ? profile.gottesdienst_points : 0;
    const gemeinde = profile ? profile.gemeinde_points : 0;

    // Bonus-Punkte im Zeitraum.
    const { rows: [bonusRow] } = await client.query(
      `SELECT COALESCE(SUM(points), 0) as total FROM bonus_points
        WHERE konfi_id = $1 AND organization_id = $2
          AND completed_date >= $3::date
          AND completed_date < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const bonus = parseInt(bonusRow.total, 10) || 0;

    // Termine: DIESELBE Zaehlregel wie das Konfi-Dashboard
    // (routes/konfi.js, eventCountSql) -- jede Buchung der Konfi, kein
    // Anwesenheits- und kein Jahrgangsfilter, nur zusaetzlich auf den
    // Wrapped-Zeitraum eingegrenzt.
    const { rows: [eventCount] } = await client.query(
      `SELECT COUNT(*) as count FROM event_bookings eb
       JOIN events e ON eb.event_id = e.id
       WHERE eb.user_id = $1 AND eb.organization_id = $2
         AND e.event_date >= $3::date
         AND e.event_date < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const totalAttended = parseInt(eventCount.count, 10) || 0;

    // Gottesdienst-Count (Events mit point_type = 'gottesdienst')
    // Dieselbe Zaehlregel wie oben (frueher zaehlte diese Query in DERSELBEN
    // Funktion nach einer dritten Regel: present, aber ohne Jahrgangs-JOIN).
    const { rows: [gdCountRow] } = await client.query(
      `SELECT COUNT(*) as count FROM event_bookings eb
       JOIN events e ON eb.event_id = e.id
       WHERE eb.user_id = $1 AND eb.organization_id = $2
         AND e.point_type = 'gottesdienst'
         AND e.event_date >= $3::date
         AND e.event_date < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const gottesdienstCount = parseInt(gdCountRow.count, 10) || 0;

    // Kategorie-Verteilung (Aktivitaeten nach Kategorie)
    //
    // Die echten Zuordnungen stehen in der Junction-Tabelle
    // activity_categories (35 Zuordnungen in Produktion), die ueber
    // categories.name die frei vergebenen Namen der Gemeinde traegt
    // ("Sonntag", "Kasualien", "Gottesdienst an Weihnachten", ...).
    //
    // FALLBACK BLEIBT: Eine Aktivitaet ohne jede Zuordnung faellt weiterhin
    // auf a.type zurueck. Sonst verloeren Gemeinden, die ihre Kategorien nie
    // gepflegt haben, ihre Schwerpunkt-Seite ersatzlos -- der Rueckblick
    // wuerde fuer sie aermer statt richtiger.
    //
    // MEHRFACHZUORDNUNG: Eine Aktivitaet darf in mehreren Kategorien liegen.
    // Sie zaehlt dann in jeder -- das ist gewollt: Wer bei einem Termin war,
    // der Kasualie UND Gottesdienst ist, war in beiden Bereichen unterwegs.
    //
    // event_categories ist gebaut wie activity_categories (event_id,
    // category_id) und zeigt auf dieselbe categories-Tabelle -- die
    // Erkennungsliste in utils/wrappedKategorien.js gilt deshalb fuer beide
    // Quellen unveraendert.
    //
    // GETRENNT GEZAEHLT: 'aus_terminen' und 'aus_aktivitaeten' bleiben
    // einzeln erhalten, damit die Seite "du warst bei 4 Terminen" sagen kann
    // statt einer aufgeblaehten Gesamtsumme. 'count' ist die Summe fuer die
    // Sortierung und bleibt formgleich zu frueher (Alt-App-Vertrag: das Feld
    // existierte schon und behaelt Name und Typ).
    //
    // JEDER TERMIN ZAEHLT NUR EINMAL.
    //
    // WARUM DIE AUFTEILUNG IN JS UND NICHT IN SQL: Welches Datum in welches
    // Fenster faellt, entscheidet datumsFenster() -- mit der Gaussschen
    // Osterformel darin. Die gehoert an EINE Stelle. Sie in SQL
    // nachzubauen hiesse, sie zweimal zu pflegen, und die zweite Fassung
    // liefe beim ersten Schaltjahr auseinander.
    //
    // Die Termine kommen deshalb EINZELN (Datum + Kategorie) und werden
    // unten in JS zugeordnet. Die Aktivitaeten bleiben in SQL gruppiert:
    // Sie haben kein Datum, das ein Fenster treffen koennte -- sie tragen
    // nur ein completed_date, das sagt, wann jemand sie eingetragen hat,
    // nicht wann das Ereignis war.
    const { rows: aktivitaetenVerteilung } = await client.query(
      `SELECT COALESCE(c.name, a.type) AS kategorie, COUNT(*)::int AS anzahl
         FROM user_activities ua
         JOIN activities a ON ua.activity_id = a.id
         LEFT JOIN activity_categories ac ON ac.activity_id = a.id
         LEFT JOIN categories c ON c.id = ac.category_id
        WHERE ua.user_id = $1 AND ua.organization_id = $2
          AND ua.completed_date >= $3::date
          AND ua.completed_date < ($4::date + INTERVAL '1 day')
          AND COALESCE(c.name, a.type) IS NOT NULL
        GROUP BY COALESCE(c.name, a.type)`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );

    // Die Termine EINZELN, mit Datum und Kategorie.
    //
    // Dieselbe Zaehlregel wie die Termin-Zahl weiter oben: jede Buchung der
    // Person, kein Anwesenheitsfilter (attendance_status ist in Produktion
    // ueberwiegend NULL und waere ein Mass dafuer, ob jemand die Liste
    // gepflegt hat, nicht dafuer, ob die Konfi da war).
    //
    // LEFT JOIN auf die Kategorien: Ein Termin OHNE Kategorie soll trotzdem
    // in den Datums-Fenstern zaehlen. Mit dem frueheren INNER JOIN fehlte
    // er dort -- die Datums-Seiten lasen ihre Zahl aus einer eigenen
    // Abfrage, die keine Kategorie verlangte, und beide liefen darum schon
    // vorher auseinander.
    const { rows: terminRows } = await client.query(
      `SELECT e.id AS event_id, e.event_date, c.name AS kategorie
         FROM event_bookings eb
         JOIN events e ON eb.event_id = e.id
         LEFT JOIN event_categories ec ON ec.event_id = e.id
         LEFT JOIN categories c ON c.id = ec.category_id
        WHERE eb.user_id = $1 AND eb.organization_id = $2
          AND e.event_date >= $3::date
          AND e.event_date < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );

    // Jetzt die Vorrang-Regel, Termin fuer Termin.
    //
    // Ein Termin mit MEHREREN Kategorien erscheint hier mehrfach (eine
    // Zeile je Kategorie). Er ist trotzdem EIN Termin: Faellt er in ein
    // Datums-Fenster, zaehlt er dort einmal und bei KEINER seiner
    // Kategorien. Faellt er in keins, zaehlt er bei seinen Kategorien --
    // dort dann bei jeder, wie bisher auch.
    const terminNachId = new Map();
    for (const r of terminRows) {
      const eintrag = terminNachId.get(r.event_id) || { datum: r.event_date, kategorien: [] };
      if (r.kategorie) eintrag.kategorien.push(r.kategorie);
      terminNachId.set(r.event_id, eintrag);
    }

    const datumsFensterZaehler = {};
    const kategorieAusTerminen = new Map();
    for (const { datum, kategorien } of terminNachId.values()) {
      const fenster = datumsFenster(datum);
      if (fenster) {
        // DATUM GEWINNT: Der Termin zaehlt hier -- und nirgends sonst.
        datumsFensterZaehler[fenster] = (datumsFensterZaehler[fenster] || 0) + 1;
        continue;
      }
      for (const k of kategorien) {
        kategorieAusTerminen.set(k, (kategorieAusTerminen.get(k) || 0) + 1);
      }
    }

    // Aktivitaeten und (bereinigte) Termine zu einer Verteilung
    // zusammenfuehren. Form und Feldnamen bleiben unveraendert -- alte
    // Apps lesen 'kategorie', 'count', 'aus_terminen' und
    // 'aus_aktivitaeten' genau wie bisher.
    const verteilungNachName = new Map();
    for (const r of aktivitaetenVerteilung) {
      verteilungNachName.set(r.kategorie, {
        kategorie: r.kategorie,
        aus_aktivitaeten: parseInt(r.anzahl, 10) || 0,
        aus_terminen: 0
      });
    }
    for (const [name, anzahl] of kategorieAusTerminen) {
      const vorhanden = verteilungNachName.get(name)
        || { kategorie: name, aus_aktivitaeten: 0, aus_terminen: 0 };
      vorhanden.aus_terminen += anzahl;
      verteilungNachName.set(name, vorhanden);
    }
    const kategorieVerteilung = [...verteilungNachName.values()]
      .map(v => ({ ...v, count: v.aus_aktivitaeten + v.aus_terminen }))
      // Kategorien, die NUR ueber Datums-Termine kamen, stehen jetzt bei
      // null -- sie fallen heraus statt als leere Seite zu erscheinen.
      .filter(v => v.count > 0)
      .sort((a, b) => b.count - a.count || String(a.kategorie).localeCompare(String(b.kategorie)));

    // Die DATEN der besuchten Termine -- Grundlage der Datums-Seiten
    // (Advent, Weihnachten, Ostern ...).
    const termineDaten = [...terminNachId.values()].map(t => t.datum);

    // Die Sonderseite zur Sommerfreizeit 2026 (Stavanger). Ein reiner
    // Wahrheitswert -- die "14 Tage" auf der Seite sind fester Text, keine
    // gerechnete Zahl (siehe warBeiStavanger und wrappedKacheln.js).
    const stavanger2026 = await warBeiStavanger(client, userId, orgId, zeitraumStart, zeitraumEnde);

    // Gesamt-Events verfuegbar für diesen Jahrgang.
    // BEWUSST OHNE ZEITFILTER: die Bezugsgroesse "wie viele Termine gab es
    // ueberhaupt", nicht eine Zahl aus dem Zeitraum.
    const { rows: [totalEventsRow] } = await client.query(
      `SELECT COUNT(DISTINCT e.id) as count FROM events e
       JOIN event_jahrgang_assignments eja ON e.id = eja.event_id AND eja.jahrgang_id = $2
       WHERE e.organization_id = $1`,
      [orgId, jahrgangId]
    );
    const totalAvailable = parseInt(totalEventsRow.count, 10) || 0;

    // Lieblings-Event (letztes besuchtes)
    const { rows: favoriteRows } = await client.query(
      `SELECT e.name, e.event_date FROM event_bookings eb
       JOIN events e ON eb.event_id = e.id
       WHERE eb.user_id = $1 AND eb.organization_id = $2
         AND e.event_date >= $3::date
         AND e.event_date < ($4::date + INTERVAL '1 day')
       ORDER BY e.event_date DESC LIMIT 1`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const lieblingsEvent = favoriteRows.length > 0
      ? { name: favoriteRows[0].name, date: favoriteRows[0].event_date }
      : null;

    // Abzeichen -- BEWUSST OHNE ZEITFILTER, wie die Punkte weiter oben:
    // Das sind laufende STAENDE, keine Ereignisse. Ein Abzeichen bleibt,
    // wenn es einmal verliehen ist; awarded_date sagt nur, WANN es dazukam.
    //
    // Der Filter war ausserdem in sich widerspruechlich: Die Seite zeigt
    // "x von y", und y (total_available) war noch nie gefiltert. Ein
    // gefilterter Zaehler ueber einem ungefilterten Nenner kann nur
    // schieflaufen.
    //
    // NICHT BETROFFEN ist "Das erste Abzeichen" im Teamer-Zweig: Die Seite
    // will ausdruecklich das FRUEHESTE des Zeitraums, nicht den Bestand,
    // und hat dafuer eine eigene Abfrage mit eigenem Zeitfilter.
    const { rows: badgeRows } = await client.query(
      `SELECT cb.name, cb.icon, cb.color FROM user_badges ub
       JOIN custom_badges cb ON ub.badge_id = cb.id
       WHERE ub.user_id = $1 AND ub.organization_id = $2
       ORDER BY ub.awarded_date DESC`,
      [userId, orgId]
    );
    // BEWUSST OHNE ZEITFILTER: wie viele Abzeichen es in der Gemeinde gibt.
    // Eine Konfiguration der Gemeinde, kein Ereignis im Zeitraum.
    //
    // is_hidden bleibt BEWUSST ungefiltert: Versteckte Abzeichen sind
    // erreichbar, sie werden nur nicht vorab angezeigt.
    const { rows: [totalBadgesRow] } = await client.query(
      `SELECT COUNT(*) as count FROM custom_badges
        WHERE organization_id = $1
          AND is_active = true
          AND target_role = 'konfi'`,
      [orgId]
    );
    const totalBadgesAvailable = parseInt(totalBadgesRow.count, 10) || 0;

    // Warum das eine besondere Seite ist: Es ist die einzige Stelle im
    // Rueckblick, die etwas ueber die SELTENHEIT einer Leistung sagt. Alle
    // anderen Zahlen sind absolut ("8 Termine") -- diese hier setzt sie ins
    // Verhaeltnis und macht sie damit teilenswert.
    //
    // Gezaehlt wird gegen die Konfis der ganzen Organisation, nicht des
    // Jahrgangs: Bei 13 Konfis im Jahrgang waeren die Prozente grob
    // gerastert (jede Person = 7,7 Punkte) und wenig aussagekraeftig.
    const { rows: [seltenstes] } = await client.query(
      `WITH konfis_gesamt AS (
         SELECT COUNT(*)::int AS n
           FROM users u
           JOIN roles r ON r.id = u.role_id
          WHERE r.name = 'konfi' AND u.organization_id = $2
            AND u.deleted_at IS NULL
       )
       SELECT cb.name, cb.icon, cb.color,
              COUNT(DISTINCT alle.user_id)::int AS haben_es,
              (SELECT n FROM konfis_gesamt) AS konfis
         FROM user_badges meins
         JOIN custom_badges cb ON cb.id = meins.badge_id
         LEFT JOIN user_badges alle ON alle.badge_id = cb.id
        WHERE meins.user_id = $1
          AND meins.organization_id = $2
          AND meins.awarded_date >= $3::date
          AND meins.awarded_date < ($4::date + INTERVAL '1 day')
        GROUP BY cb.id, cb.name, cb.icon, cb.color
        -- Das seltenste zuerst; bei Gleichstand das zuletzt verliehene,
        -- damit die Seite nicht bei jedem Lauf ein anderes zeigt.
        ORDER BY haben_es ASC, cb.id ASC
        LIMIT 1`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );

    // Prozent nur, wenn es ueberhaupt Konfis gibt und die Zahl etwas
    // bedeutet. Bei 2 Konfis waere "50 %" eine Zahl ohne Aussage.
    const seltenstesAbzeichen = (seltenstes && seltenstes.konfis >= 5)
      ? {
          name: seltenstes.name,
          icon: seltenstes.icon,
          color: seltenstes.color,
          haben_es: seltenstes.haben_es,
          konfis: seltenstes.konfis,
          prozent: Math.max(1, Math.round((seltenstes.haben_es / seltenstes.konfis) * 100))
        }
      : null;

    // Pflicht-Events
    const { rows: [pflichtRow] } = await client.query(
      `SELECT
        COUNT(*) FILTER (WHERE eb.attendance_status = 'present') as besucht,
        COUNT(*) as gesamt
       FROM events e
       JOIN event_jahrgang_assignments eja ON e.id = eja.event_id AND eja.jahrgang_id = $3
       LEFT JOIN event_bookings eb ON eb.event_id = e.id AND eb.user_id = $1
       WHERE e.organization_id = $2 AND e.mandatory = true AND e.cancelled IS NOT TRUE
         AND e.event_date >= $4::date
         AND e.event_date < ($5::date + INTERVAL '1 day')`,
      [userId, orgId, jahrgangId, zeitraumStart, zeitraumEnde]
    );
    const pflichtBesucht = parseInt(pflichtRow?.besucht || '0', 10);
    const pflichtGesamt = parseInt(pflichtRow?.gesamt || '0', 10);

    const { rows: [cancelRow] } = await client.query(
      `SELECT COUNT(*) as count FROM event_bookings eb
       JOIN events e ON eb.event_id = e.id
       WHERE eb.user_id = $1 AND eb.organization_id = $2 AND eb.status = 'cancelled'
         AND e.event_date >= $3::date
         AND e.event_date < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const eventAbgesagt = parseInt(cancelRow.count, 10) || 0;

    const { rows: monatRows } = await client.query(
      `SELECT monat, COUNT(*) as count FROM (
         SELECT EXTRACT(MONTH FROM completed_date)::int as monat
         FROM user_activities
         WHERE user_id = $1 AND organization_id = $2
           AND completed_date >= $3::date
           AND completed_date < ($4::date + INTERVAL '1 day')
         UNION ALL
         SELECT EXTRACT(MONTH FROM e.event_date)::int as monat
         FROM event_bookings eb
         JOIN events e ON eb.event_id = e.id
         WHERE eb.user_id = $1 AND eb.organization_id = $2
           AND e.event_date >= $3::date
           AND e.event_date < ($4::date + INTERVAL '1 day')
       ) combined
       GROUP BY monat
       ORDER BY count DESC
       LIMIT 1`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const aktivsterMonat = monatRows.length > 0
      ? { monat: monatRows[0].monat, monat_name: MONAT_NAMEN[monatRows[0].monat] || '', aktivitaeten: parseInt(monatRows[0].count, 10) }
      : { monat: 0, monat_name: '', aktivitaeten: 0 };

    // WARTELISTE-HELD:IN -- wie oft jemand nachgerueckt ist.
    //
    // Die Spalte war_auf_warteliste setzt promoteFromWaitlist im Moment des
    // Nachrueckens (Migration 145). NULL heisst UNBEKANNT (Bestandszeilen
    // von vor der Migration), nicht "nein" -- deshalb wird hier auf
    // ausdrueckliches true geprueft und nicht auf "nicht false".
    //
    // Der Rueckfall ist 0, und damit faellt die Seite ueber ihre Bedingung
    // in wrappedKacheln.js (nachgerueckt > 0) einfach weg. Das ist das
    // richtige Verhalten: Ohne die Spalte WEISS niemand, wer gewartet hat --
    // eine Seite auf Verdacht waere schlimmer als keine.
    //
    // Dasselbe Muster steht weiter unten bei den Challenge-Freigaben
    // (approved_by, Migration 146).
    const nachgerueckt = await zahlAusNeuerSpalte(
      client,
      `SELECT COUNT(*)::int AS anzahl FROM event_bookings eb
         JOIN events e ON eb.event_id = e.id
        WHERE eb.user_id = $1 AND eb.organization_id = $2
          AND eb.war_auf_warteliste IS TRUE
          AND e.event_date >= $3::date
          AND e.event_date < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde],
      'Warteliste (Migration 145)'
    );

    // DER LANGE ATEM -- die Spanne zwischen erstem und letztem Termin.
    //
    // Die Aussage ist "du warst ueber das ganze Jahr hinweg dabei", nicht
    // "du hast viele Termine". Deshalb zaehlt hier die SPANNE, nicht die
    // Menge -- und deshalb braucht die Seite eine Mindestzahl an Terminen
    // (siehe Bedingung in wrappedKacheln.js): Bei zwei Terminen im September
    // und im Mai waeren es rechnerisch auch 240 Tage, aber die Zahl erzaehlte
    // dann das Gegenteil von dem, was sie behauptet.
    //
    // Gerechnet in Berliner Zeit: event_date ist ein Zeitstempel mit Zone,
    // und ein Termin am Sonntagabend um 20 Uhr gehoert zum Sonntag, nicht
    // zum Montag in UTC.
    const { rows: [spanneRow] } = await client.query(
      `SELECT
         MIN((e.event_date AT TIME ZONE 'Europe/Berlin')::date) AS erster,
         MAX((e.event_date AT TIME ZONE 'Europe/Berlin')::date) AS letzter,
         COUNT(*)::int AS anzahl
       FROM event_bookings eb
       JOIN events e ON eb.event_id = e.id
       WHERE eb.user_id = $1 AND eb.organization_id = $2
         AND e.event_date >= $3::date
         AND e.event_date < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    // Die Spalten kommen als DATE zurueck. Sie in einen ISO-String zu
    // giessen, darf NICHT ueber toISOString() laufen -- das rechnet nach UTC
    // und schoebe das Datum um einen Tag (derselbe Fehler, den
    // berechneZeitraum() schon einmal hatte).
    const alsDatum = (d) => {
      const dt = (d instanceof Date) ? d : new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };
    const langerAtem = (spanneRow && spanneRow.erster && spanneRow.letzter)
      ? {
          erster: alsDatum(spanneRow.erster),
          letzter: alsDatum(spanneRow.letzter),
          tage: Math.round(
            (new Date(spanneRow.letzter).getTime() - new Date(spanneRow.erster).getTime())
            / (24 * 60 * 60 * 1000)
          ),
          termine: spanneRow.anzahl
        }
      : null;

    // DEIN WOCHENTAG -- an welchem Tag die Termine ueberwiegend lagen.
    //
    // ZEITZONE (der eigentliche Fallstrick): EXTRACT(DOW ...) rechnet ohne
    // AT TIME ZONE in UTC. Ein Gottesdienst am Sonntag um 20 Uhr Berliner
    // Zeit ist in UTC noch Sonntag 18 Uhr -- aber im Winter ein Termin um
    // 00:30 waere schon Montag. Dieselbe Fehlerklasse wie der Datumsversatz
    // in berechneZeitraum(). Deshalb wird konsequent nach Europe/Berlin
    // umgerechnet, bevor der Wochentag bestimmt wird.
    const { rows: wochentagRows } = await client.query(
      `SELECT EXTRACT(DOW FROM (e.event_date AT TIME ZONE 'Europe/Berlin'))::int AS tag,
              COUNT(*)::int AS anzahl
         FROM event_bookings eb
         JOIN events e ON eb.event_id = e.id
        WHERE eb.user_id = $1 AND eb.organization_id = $2
          AND e.event_date >= $3::date
          AND e.event_date < ($4::date + INTERVAL '1 day')
        GROUP BY tag
        ORDER BY anzahl DESC, tag ASC
        LIMIT 1`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const gesamtTermine = spanneRow ? spanneRow.anzahl : 0;
    const wochentag = wochentagRows.length > 0
      ? {
          tag: wochentagRows[0].tag,
          name: WOCHENTAG_NAMEN[wochentagRows[0].tag] || '',
          anzahl: wochentagRows[0].anzahl,
          gesamt: gesamtTermine,
          anteil: gesamtTermine > 0
            ? Math.round((wochentagRows[0].anzahl / gesamtTermine) * 100)
            : 0
        }
      : null;

    // DER VIELSEITIGE -- mit wie vielen Medienarten jemand geantwortet hat.
    //
    // BEWUSST "2 VON 3" STATT "ALLE DREI": challenges.allowed_media steht per
    // Default auf ["text","photo"] -- Audio ist in vielen Challenges gar
    // nicht erlaubt. Eine Seite, die alle drei verlangt, traefe fast nie zu
    // und waere damit keine Seite, sondern eine Fussnote. Gezaehlt werden
    // deshalb die verschiedenen Arten, und ab zwei ist es eine Geschichte.
    let medienarten = [];
    try {
      const { rows: medienRows } = await client.query(
        `SELECT DISTINCT cs.media_type
           FROM challenge_submissions cs
          WHERE cs.user_id = $1 AND cs.organization_id = $2
            AND cs.moderation_status <> 'hidden'
            AND cs.created_at >= $3::date
            AND cs.created_at < ($4::date + INTERVAL '1 day')
            AND cs.media_type IS NOT NULL`,
        [userId, orgId, zeitraumStart, zeitraumEnde]
      );
      medienarten = medienRows.map(r => r.media_type).sort();
    } catch (medienErr) {
      // Alt-Deployment ohne Challenge-Tabellen: die Seite entfaellt.
      console.warn('Wrapped: Medienarten konnten nicht geladen werden:', medienErr.message);
    }

    // Endspurt: Vergleich mit Zielwerten aus jahrgaenge.
    // BEWUSST OHNE ZEITFILTER: die Zielvorgabe des Jahrgangs ist eine
    // Einstellung, kein Ereignis.
    const { rows: [jahrgang] } = await client.query(
      `SELECT target_gottesdienst, target_gemeinde, gottesdienst_enabled, gemeinde_enabled
       FROM jahrgaenge WHERE id = $1`,
      [jahrgangId]
    );

    let zielTotal = 0;
    let aktuellTotal = gottesdienst + gemeinde;
    if (jahrgang) {
      if (jahrgang.gottesdienst_enabled) zielTotal += (jahrgang.target_gottesdienst || 0);
      if (jahrgang.gemeinde_enabled) zielTotal += (jahrgang.target_gemeinde || 0);
    }
    const fehlendePunkte = Math.max(0, zielTotal - aktuellTotal);
    const endspurtAktiv = aktuellTotal < zielTotal;


    // Chat: gesendete Nachrichten (geloeschte zaehlen nicht -- was der Konfi
    // selbst zurueckgenommen hat, soll ihm der Rueckblick nicht vorrechnen).
    // Org-Grenze ueber den Raum, nicht ueber die Nachricht (chat_messages
    // traegt keine organization_id).
    const { rows: [chatRow] } = await client.query(
      `SELECT COUNT(*) as count FROM chat_messages cm
       JOIN chat_rooms cr ON cm.room_id = cr.id
       WHERE cm.user_id = $1 AND cr.organization_id = $2
         AND cm.deleted_at IS NULL
         AND cm.created_at >= $3::date
         AND cm.created_at < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const chatNachrichten = parseInt(chatRow.count, 10) || 0;

    // Reaktionen BEKOMMEN (von anderen, auf eigene Nachrichten).
    // Entscheidung: Als Highlight zaehlt die Zustimmung, die jemand BEKOMMEN
    // hat, nicht die vergebenen Likes -- "deine Nachrichten kamen an" ist
    // eine Aussage ueber die Person und ihr Ankommen in der Gruppe,
    // "du hast viel geliked" nur eine ueber ihr Tippverhalten. Eigene
    // Reaktionen auf eigene Nachrichten zaehlen nicht mit.
    const { rows: [reaktionenBekommenRow] } = await client.query(
      `SELECT COUNT(*) as count FROM chat_message_reactions r
       JOIN chat_messages cm ON r.message_id = cm.id
       JOIN chat_rooms cr ON cm.room_id = cr.id
       WHERE cm.user_id = $1 AND r.user_id <> $1
         AND cr.organization_id = $2
         AND cm.deleted_at IS NULL
         AND r.created_at >= $3::date
         AND r.created_at < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const reaktionenBekommen = parseInt(reaktionenBekommenRow.count, 10) || 0;

    // Reaktionen GEGEBEN -- nur als Zahl im Snapshot, kein eigenes Highlight
    // (siehe Begruendung oben).
    const { rows: [reaktionenGegebenRow] } = await client.query(
      `SELECT COUNT(*) as count FROM chat_message_reactions r
       JOIN chat_messages cm ON r.message_id = cm.id
       JOIN chat_rooms cr ON cm.room_id = cr.id
       WHERE r.user_id = $1 AND cr.organization_id = $2
         AND r.created_at >= $3::date
         AND r.created_at < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const reaktionenGegeben = parseInt(reaktionenGegebenRow.count, 10) || 0;

    // Challenges: Gesamtzahl der Beitraege (challengeMomente ist auf 12
    // gedeckelt, fuer die Auswahl zaehlt die echte Zahl) plus die Challenge,
    // bei der die Person am aktivsten war. Defensiv wie die Momente selbst:
    // Alt-Deployments ohne Challenge-Tabellen liefern 0 / null.
    let challengeBeitraege = 0;
    let topChallenge = null;
    try {
      const { rows: [beitragRow] } = await client.query(
        `SELECT COUNT(*) as count FROM challenge_submissions cs
         WHERE cs.user_id = $1 AND cs.organization_id = $2
           AND cs.moderation_status <> 'hidden'
           AND cs.created_at >= $3::date
           AND cs.created_at < ($4::date + INTERVAL '1 day')`,
        [userId, orgId, zeitraumStart, zeitraumEnde]
      );
      challengeBeitraege = parseInt(beitragRow.count, 10) || 0;

      const { rows: topRows } = await client.query(
        `SELECT c.title, c.badge_icon, COUNT(*) as count
         FROM challenge_submissions cs
         JOIN challenges c ON cs.challenge_id = c.id
         WHERE cs.user_id = $1 AND cs.organization_id = $2
           AND cs.moderation_status <> 'hidden'
           AND cs.created_at >= $3::date
           AND cs.created_at < ($4::date + INTERVAL '1 day')
         GROUP BY c.id, c.title, c.badge_icon
         ORDER BY count DESC, c.title
         LIMIT 1`,
        [userId, orgId, zeitraumStart, zeitraumEnde]
      );
      if (topRows.length > 0) {
        topChallenge = {
          title: topRows[0].title,
          badge_icon: topRows[0].badge_icon,
          count: parseInt(topRows[0].count, 10)
        };
      }
    } catch (challengeErr) {
      console.warn('Wrapped: Challenge-Zahlen konnten nicht geladen werden:', challengeErr.message);
    }

    // Verlaesslichkeit: Selbst-Abmeldungen aus event_unregistrations.
    // Das ist die Handlung "Konfi meldet sich ab" (die Buchung wird dabei
    // GELOESCHT, routes/konfi.js) -- events.abgesagt oben zaehlt dagegen
    // stehen gebliebene 'cancelled'-Buchungen, das sind zwei verschiedene
    // Dinge. Zeitanker ist unregistered_at (die Handlung im Konfi-Jahr),
    // nicht das Eventdatum: Die Absage bleibt auch zaehlbar, wenn der Termin
    // spaeter verschoben oder geloescht wird.
    const { rows: [abmeldungRow] } = await client.query(
      `SELECT COUNT(*) as count FROM event_unregistrations eu
       WHERE eu.user_id = $1 AND eu.organization_id = $2
         AND eu.unregistered_at >= $3::date
         AND eu.unregistered_at < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const abmeldungen = parseInt(abmeldungRow.count, 10) || 0;
    // "Nie abgesagt" ist erst ab 5 Buchungen eine Aussage -- wer nur zweimal
    // gebucht hat, hatte kaum Gelegenheit abzusagen.
    const nieAbgesagt = abmeldungen === 0 && totalAttended >= 5;

    // ================================================================
    // Jahrgangsvergleich: Was ist an DIESER Person besonders?
    // ================================================================
    // Frueher gewann der groesste Rohwert -- 15 Termine schlugen immer
    // 8 Abzeichen, und weil fast alle am meisten Termine haben, sah der
    // Rueckblick fuer fast alle gleich aus. Jetzt zaehlt, worin jemand
    // im Vergleich zum eigenen Jahrgang heraussticht: Der Durchschnitt
    // des Jahrgangs je Metrik ist die Messlatte, das beste Verhaeltnis
    // eigener Wert / Jahrgangsschnitt gewinnt. Der Vergleich bleibt anonym
    // (nur der Schnitt, nie andere Namen) und landet nur dann im Text,
    // wenn er freundlich ist (Frontend zeigt ihn nur oberhalb des Schnitts).
    let jahrgangsSchnitt = null;
    try {
      const { rows: [avgRow] } = await client.query(
        `WITH jahrgang_konfis AS (
           SELECT kp.user_id FROM konfi_profiles kp
           JOIN users u ON kp.user_id = u.id
           JOIN roles r ON u.role_id = r.id
           WHERE kp.jahrgang_id = $1 AND r.name = 'konfi' AND u.deleted_at IS NULL
         )
         SELECT
           (SELECT COUNT(*) FROM jahrgang_konfis) AS anzahl,
           (SELECT COUNT(*) FROM event_bookings eb
             JOIN events e ON eb.event_id = e.id
             WHERE eb.user_id IN (SELECT user_id FROM jahrgang_konfis)
               AND eb.organization_id = $2
               AND e.event_date >= $3::date
               AND e.event_date < ($4::date + INTERVAL '1 day')) AS events_gesamt,
           (SELECT COUNT(*) FROM event_bookings eb
             JOIN events e ON eb.event_id = e.id
             WHERE eb.user_id IN (SELECT user_id FROM jahrgang_konfis)
               AND eb.organization_id = $2
               AND e.point_type = 'gottesdienst'
               AND e.event_date >= $3::date
               AND e.event_date < ($4::date + INTERVAL '1 day')) AS gottesdienste_gesamt,
           (SELECT COUNT(*) FROM user_badges ub
             WHERE ub.user_id IN (SELECT user_id FROM jahrgang_konfis)
               AND ub.organization_id = $2
               AND ub.awarded_date >= $3::date
               AND ub.awarded_date < ($4::date + INTERVAL '1 day')) AS badges_gesamt,
           (SELECT COALESCE(SUM(kp2.gemeinde_points), 0) FROM konfi_profiles kp2
             WHERE kp2.user_id IN (SELECT user_id FROM jahrgang_konfis)
               AND kp2.jahrgang_id = $1) AS gemeinde_gesamt,
           (SELECT COUNT(*) FROM chat_messages cm
             JOIN chat_rooms cr ON cm.room_id = cr.id
             WHERE cm.user_id IN (SELECT user_id FROM jahrgang_konfis)
               AND cr.organization_id = $2
               AND cm.deleted_at IS NULL
               AND cm.created_at >= $3::date
               AND cm.created_at < ($4::date + INTERVAL '1 day')) AS chat_gesamt,
           (SELECT COUNT(*) FROM chat_message_reactions r
             JOIN chat_messages cm ON r.message_id = cm.id
             JOIN chat_rooms cr ON cm.room_id = cr.id
             WHERE cm.user_id IN (SELECT user_id FROM jahrgang_konfis)
               AND r.user_id <> cm.user_id
               AND cr.organization_id = $2
               AND cm.deleted_at IS NULL
               AND r.created_at >= $3::date
               AND r.created_at < ($4::date + INTERVAL '1 day')) AS reaktionen_gesamt,
           (SELECT COUNT(*) FROM challenge_submissions cs
             WHERE cs.user_id IN (SELECT user_id FROM jahrgang_konfis)
               AND cs.organization_id = $2
               AND cs.moderation_status <> 'hidden'
               AND cs.created_at >= $3::date
               AND cs.created_at < ($4::date + INTERVAL '1 day')) AS challenges_gesamt`,
        [jahrgangId, orgId, zeitraumStart, zeitraumEnde]
      );
      const anzahl = parseInt(avgRow.anzahl, 10) || 0;
      if (anzahl > 0) {
        jahrgangsSchnitt = {
          events: parseInt(avgRow.events_gesamt, 10) / anzahl,
          gottesdienste: parseInt(avgRow.gottesdienste_gesamt, 10) / anzahl,
          badges: parseInt(avgRow.badges_gesamt, 10) / anzahl,
          gemeinde: parseInt(avgRow.gemeinde_gesamt, 10) / anzahl,
          chat: parseInt(avgRow.chat_gesamt, 10) / anzahl,
          reaktionen: parseInt(avgRow.reaktionen_gesamt, 10) / anzahl,
          challenges: parseInt(avgRow.challenges_gesamt, 10) / anzahl
        };
      }
    } catch (avgErr) {
      // Alt-Deployment ohne Challenge-Tabellen o.ae.: ohne Schnitt faellt
      // die Auswahl unten auf die Rohwert-Logik zurueck.
      console.warn('Wrapped: Jahrgangsschnitt konnte nicht berechnet werden:', avgErr.message);
    }

    // ================================================================
    // WIE SELTEN IST JEDE SEITE?
    // ================================================================
    //
    // Gezaehlt wird, wie viele Konfis DESSELBEN JAHRGANGS die Voraussetzung
    // je Seite erfuellen -- das ist die Gruppe, mit der man sich vergleicht,
    // und dieselbe Bezugsgroesse wie beim Jahrgangsschnitt oben.
    //
    // WARUM JAHRGANG UND NICHT ORGANISATION (anders als beim seltensten
    // Abzeichen): Abzeichen sind Bestaende, die ueber Jahre wachsen -- da
    // ist die ganze Gemeinde die richtige Bezugsgroesse. Diese Seiten
    // haengen dagegen an dem, was IN DIESEM ZEITRAUM passiert ist, und der
    // ist je Jahrgang ein anderer. Ein Advent-Termin des Jahrgangs 2024/25
    // sagt nichts darueber, wie besonders er fuer den Jahrgang 2026/27 ist.
    //
    // ERST AB 5 KONFIS. Bei zweien waere jeder Anteil entweder 50 % oder
    // 100 % -- eine Zahl ohne Aussage. Dieselbe Schwelle wie beim
    // seltensten Abzeichen und aus demselben Grund. Darunter bleibt das
    // Feld leer und wrappedKacheln.js rechnet mit den geschaetzten
    // Grundhaeufigkeiten.
    //
    // NUR DIE SEITEN, DIE SICH GUENSTIG ZAEHLEN LASSEN: Termine, Punkte,
    // Abzeichen, Warteliste und der Wochentag. Fuer die uebrigen (Chat,
    // Challenges, Medienarten) braeuchte es je eine weitere Abfrage ueber
    // den ganzen Jahrgang; sie behalten ihre Schaetzung. Lieber fuenf
    // gemessene Werte als zwoelf, die den Rueckblick langsam machen.
    let seitenHaeufigkeit = null;
    try {
      const { rows: [hRow] } = await client.query(
        `WITH jahrgang_konfis AS (
           SELECT kp.user_id FROM konfi_profiles kp
           JOIN users u ON kp.user_id = u.id
           JOIN roles r ON u.role_id = r.id
           WHERE kp.jahrgang_id = $1 AND r.name = 'konfi' AND u.deleted_at IS NULL
         ),
         termine AS (
           SELECT eb.user_id, e.event_date, e.id AS event_id
             FROM event_bookings eb
             JOIN events e ON eb.event_id = e.id
            WHERE eb.user_id IN (SELECT user_id FROM jahrgang_konfis)
              AND eb.organization_id = $2
              AND e.event_date >= $3::date
              AND e.event_date < ($4::date + INTERVAL '1 day')
         )
         SELECT
           (SELECT COUNT(*) FROM jahrgang_konfis) AS konfis,
           (SELECT COUNT(DISTINCT user_id) FROM termine) AS mit_terminen,
           (SELECT COUNT(DISTINCT ub.user_id) FROM user_badges ub
             WHERE ub.user_id IN (SELECT user_id FROM jahrgang_konfis)
               AND ub.organization_id = $2) AS mit_abzeichen,
           (SELECT COUNT(*) FROM konfi_profiles kp
             WHERE kp.user_id IN (SELECT user_id FROM jahrgang_konfis)
               AND kp.jahrgang_id = $1
               AND (COALESCE(kp.gottesdienst_points, 0) + COALESCE(kp.gemeinde_points, 0)) > 0
           ) AS mit_punkten,
           -- DIE WARTELISTE FEHLT HIER BEWUSST: Ihre Spalte
           -- (war_auf_warteliste, Migration 145) existiert in Produktion
           -- nicht zuverlaessig -- genau deshalb liest die Seite selbst sie
           -- ueber zahlAusNeuerSpalte(). Haenge ich sie hier in dieselbe
           -- Abfrage wie die vier anderen, reisst ihr Fehlen ALLE
           -- Seltenheitswerte mit; die Auswahl fiele dann auch fuer
           -- Termine, Punkte und Abzeichen auf die Schaetzung zurueck.
           -- Sie behaelt ihren Schaetzwert (20 %), der ohnehin nah an der
           -- Wirklichkeit liegt.
           -- Der Wochentag: mindestens 4 Termine an EINEM Tag und die
           -- Haelfte aller Termine -- dieselbe Bedingung wie in
           -- wrappedKacheln.js. Waere sie hier anders, maesse die
           -- Seltenheit etwas anderes, als die Auswahl benutzt.
           (SELECT COUNT(*) FROM (
              SELECT user_id
                FROM termine
               GROUP BY user_id, EXTRACT(DOW FROM event_date)
              HAVING COUNT(*) >= 4
                 AND COUNT(*) * 2 >= (SELECT COUNT(*) FROM termine t2 WHERE t2.user_id = termine.user_id)
            ) w) AS mit_wochentag`,
        [jahrgangId, orgId, zeitraumStart, zeitraumEnde]
      );
      const konfisImJahrgang = parseInt(hRow?.konfis || '0', 10);
      if (konfisImJahrgang >= 5) {
        // Anteil in Prozent, mindestens 1 -- eine 0 hiesse "niemand hat
        // das", und die Person, die den Rueckblick liest, hat es ja.
        const anteil = (n) => Math.min(100, Math.max(1,
          Math.round((parseInt(n || '0', 10) / konfisImJahrgang) * 100)));
        seitenHaeufigkeit = {
          events: anteil(hRow.mit_terminen),
          badges: anteil(hRow.mit_abzeichen),
          punkte: anteil(hRow.mit_punkten),
          wochentag: anteil(hRow.mit_wochentag)
        };
      }
    } catch (haeufigkeitErr) {
      // Fehlt eine Spalte (Alt-Deployment vor Migration 145), bleibt das
      // Feld leer und die Auswahl rechnet mit den Schaetzwerten. Ein
      // fehlender Seltenheitswert darf nie den Rueckblick verhindern.
      console.warn('Wrapped: Seitenhaeufigkeit konnte nicht berechnet werden:', haeufigkeitErr.message);
    }

    // Deterministischer Formulierung-Seed (vor der Auswahl gebraucht: er
    // entscheidet auch den Gleichstand zwischen zwei Highlight-Kandidaten).
    const formulierungSeed = (userId * 31 + year * 17) % 97;

    // ================================================================
    // Highlight-Auswahl
    // ================================================================
    // ueber_das_ziel behaelt die hoechste Prioritaet (erreichtes Ziel ist
    // immer die Nachricht des Jahres). Danach: Kandidaten mit Mindestwert
    // (damit niemand fuer 2 Chat-Nachrichten zum "Chat-Star" wird), Score =
    // eigener Wert / Jahrgangsschnitt. 'verlaesslich' hat keinen Zaehlwert-
    // Vergleich und tritt mit festem Score 1.2 an: Es gewinnt, wenn sonst
    // niemand deutlich ueber dem Schnitt liegt -- ein echter Ausreisser
    // schlaegt es.
    //
    // BEWUSST WEGGELASSEN: ein Highlight "am oeftesten abgesagt". Der
    // Rueckblick geht an 12- bis 14-Jaehrige; Absagen haben oft Gruende
    // ausserhalb ihrer Kontrolle (Familie, Krankheit, Fahrdienste). Einem
    // Kind als Jahresbotschaft "du hast am meisten abgesagt" zu zeigen,
    // beschaemt und erzieht nicht -- der Gegenpol ist deshalb nur positiv
    // gewendet (verlaesslich = nie abgesagt bei genug Buchungen), die
    // Absagen-Zahl selbst steht neutral im Snapshot und wird nicht
    // hervorgehoben. Fachliche Entscheidung, siehe Handbuch 95-wrapped.
    let highlightType = 'events_held';
    let highlightWert = totalAttended;
    let highlightSchnitt = null;
    if (aktuellTotal >= zielTotal && zielTotal > 0) {
      highlightType = 'ueber_das_ziel';
      highlightWert = aktuellTotal - zielTotal;
    } else {
      const candidates = [
        { type: 'events_held', value: totalAttended, avg: jahrgangsSchnitt ? jahrgangsSchnitt.events : null, min: 3 },
        { type: 'badge_collector', value: badgeRows.length, avg: jahrgangsSchnitt ? jahrgangsSchnitt.badges : null, min: 2 },
        { type: 'gottesdienst_treue', value: gottesdienstCount, avg: jahrgangsSchnitt ? jahrgangsSchnitt.gottesdienste : null, min: 3 },
        { type: 'gemeinde_aktiv', value: gemeinde, avg: jahrgangsSchnitt ? jahrgangsSchnitt.gemeinde : null, min: 3 },
        { type: 'chat_star', value: chatNachrichten, avg: jahrgangsSchnitt ? jahrgangsSchnitt.chat : null, min: 20 },
        { type: 'reaktions_magnet', value: reaktionenBekommen, avg: jahrgangsSchnitt ? jahrgangsSchnitt.reaktionen : null, min: 5 },
        { type: 'challenge_fan', value: challengeBeitraege, avg: jahrgangsSchnitt ? jahrgangsSchnitt.challenges : null, min: 2 }
      ];

      if (jahrgangsSchnitt) {
        // Score-Auswahl: Verhaeltnis zum Jahrgangsschnitt, Nenner mindestens
        // 1, damit ein Schnitt nahe 0 keine absurden Scores erzeugt.
        const scored = candidates
          .filter(c => c.value >= c.min)
          .map(c => ({ ...c, score: c.value / Math.max(c.avg, 1) }));
        if (nieAbgesagt) {
          scored.push({ type: 'verlaesslich', value: totalAttended, avg: null, score: 1.2 });
        }
        if (scored.length > 0) {
          scored.sort((a, b) => b.score - a.score);
          // Gleichstand (praktisch identischer Score): der Seed entscheidet,
          // damit zwei aehnliche Konfis nicht dieselbe Seite sehen.
          const beste = scored.filter(c => scored[0].score - c.score < 0.001);
          const gewinner = beste[formulierungSeed % beste.length];
          highlightType = gewinner.type;
          highlightWert = gewinner.value;
          highlightSchnitt = (gewinner.avg !== null && gewinner.avg !== undefined)
            ? Math.round(gewinner.avg * 10) / 10
            : null;
        }
        // Kein Kandidat ueber Mindestwert: events_held bleibt als Default
        // stehen (wie bisher).
      } else {
        // Fallback ohne Jahrgangsschnitt: bisherige Rohwert-Logik ueber die
        // klassischen vier Kandidaten (unveraendertes Verhalten).
        let maxVal = -1;
        for (const c of candidates.slice(0, 4)) {
          if (c.value > maxVal) {
            maxVal = c.value;
            highlightType = c.type;
            highlightWert = c.value;
          }
        }
      }
    }

    // Challenge-Momente: eigene Beitraege im Wrapped-Zeitraum (max 12, neueste zuerst).
    // Defensiv: Auf Alt-Deployments ohne Challenge-Tabellen liefern wir ein leeres Array
    // statt die gesamte Snapshot-Generierung scheitern zu lassen.
    let challengeMomente = [];
    try {
      const { rows: submissionRows } = await client.query(
        `SELECT c.title AS challenge_title,
                c.badge_icon,
                cs.media_type,
                cs.file_path,
                cs.file_name,
                cs.text_content,
                cs.link_url,
                cs.link_title,
                cs.link_author,
                cs.created_at
           FROM challenge_submissions cs
           JOIN challenges c ON cs.challenge_id = c.id
          WHERE cs.user_id = $1
            AND cs.organization_id = $2
            AND cs.moderation_status <> 'hidden'
            AND cs.created_at >= $3::date
            AND cs.created_at < ($4::date + INTERVAL '1 day')
          ORDER BY cs.created_at DESC
          LIMIT 12`,
        [userId, orgId, zeitraumStart, zeitraumEnde]
      );
      challengeMomente = submissionRows.map(s => ({
        challenge_title: s.challenge_title,
        badge_icon: s.badge_icon,
        media_type: s.media_type,
        file_path: s.file_path,
        file_name: s.file_name,
        text_content: s.text_content
          ? (s.text_content.length > 200 ? `${s.text_content.slice(0, 200)}...` : s.text_content)
          : null,
        link_url: s.link_url,
        link_title: s.link_title,
        link_author: s.link_author,
        created_at: s.created_at
      }));
    } catch (challengeErr) {
      console.warn('Wrapped: Challenge-Momente konnten nicht geladen werden:', challengeErr.message);
      challengeMomente = [];
    }

    // WARUM IM SNAPSHOT UND NICHT AUS DEM ANGEMELDETEN KONTO: Ein
    // Rueckblick wird geteilt und spaeter noch einmal geoeffnet -- auch von
    // der Leitung, die ihn in der Detailansicht ansieht. Er muss jedes Mal
    // dieselbe Gemeinde nennen, naemlich die, in der die Konfi-Zeit lief,
    // nicht die gerade aktive Organisation des Betrachters.
    //
    // COALESCE(display_name, name): Dasselbe Muster wie in auth.js. `name`
    // ist der interne Bezeichner, `display_name` der Anzeigename der
    // Gemeinde -- der gehoert auf ein Bild, das jemand weitergibt.
    const { rows: [orgRow] } = await client.query(
      `SELECT COALESCE(NULLIF(TRIM(o.display_name), ''), o.name) AS gemeinde
         FROM organizations o WHERE o.id = $1`,
      [orgId]
    );
    const gemeindeName = orgRow && orgRow.gemeinde ? orgRow.gemeinde : null;

    // ---------------------------------------------------------------
    // Bis hier die Zahlen. Ab hier die AUSWAHL DER SEITEN -- der Punkt, an
    // dem utils/wrappedKacheln.js an seinem Aufrufer haengt.
    //
    // Die Auswahl wird IM Snapshot gespeichert statt bei jedem Ansehen neu
    // gerechnet: Ein Rueckblick wird geteilt und mehrfach geoeffnet -- er
    // muss jedes Mal gleich aussehen.
    // ---------------------------------------------------------------
    const schnappschuss = {
      // Version 3: persoenliche Highlights + Chat-/Challenge-/
      // Verlaesslichkeits-Zahlen. Rein ADDITIV zu Version 2 -- kein Feld
      // wurde entfernt, umbenannt oder umtypisiert. Ausgelieferte Apps
      // rendern jeden Snapshot mit version >= 2 ueber die feste
      // Slide-Reihenfolge und ignorieren unbekannte Felder.
      version: 3,
      highlight_type: highlightType,
      formulierung_seed: formulierungSeed,
      slides: {
        challenge_momente: challengeMomente,
        // Das gewaehlte Highlight samt Zahl und (anonymem) Jahrgangsschnitt.
        // Neu ab Version 3; alte Clients kennen das Feld nicht und rendern
        // wie bisher.
        highlight: {
          type: highlightType,
          wert: highlightWert,
          jahrgangsschnitt: highlightSchnitt
        },
        // 'chat' gab es schon in Version-1-Snapshots als Objekt mit
        // nachrichten_gesendet -- derselbe Name, derselbe Typ, nur zwei
        // Felder mehr (Vertragstreue gegenueber alten Lesern).
        chat: {
          nachrichten_gesendet: chatNachrichten,
          reaktionen_gegeben: reaktionenGegeben,
          reaktionen_bekommen: reaktionenBekommen
        },
        challenges: {
          beitraege: challengeBeitraege,
          top_challenge: topChallenge
        },
        verlaesslichkeit: {
          abmeldungen,
          nie_abgesagt: nieAbgesagt
        },
        punkte: {
          gottesdienst,
          gemeinde,
          total: gottesdienst + gemeinde,
          bonus
        },
        events: {
          total_attended: totalAttended,
          total_available: totalAvailable,
          lieblings_event: lieblingsEvent,
          abgesagt: eventAbgesagt
        },
        badges: {
          total_earned: badgeRows.length,
          total_available: totalBadgesAvailable,
          badges: badgeRows.map(b => ({ name: b.name, icon: b.icon, color: b.color })),
          seltenstes: seltenstesAbzeichen
        },
        pflicht: {
          besucht: pflichtBesucht,
          gesamt: pflichtGesamt
        },
        aktivster_monat: aktivsterMonat,
        warteliste: {
          nachgerueckt
        },
        langer_atem: langerAtem,
        wochentag: wochentag,
        medienarten: medienarten,
        endspurt: {
          aktiv: endspurtAktiv,
          fehlende_punkte: fehlendePunkte,
          ziel_total: zielTotal,
          aktuell_total: aktuellTotal
        },
        // Additiv: Der Name der Kirchengemeinde. Alte
        // App-Versionen kennen das Feld nicht und ignorieren es; die
        // Abschluss-Seite und die Teilen-Karte zeigen es, wenn es da ist,
        // und lassen die Zeile sonst weg (Alt-Snapshots).
        gemeinde: gemeindeName,
        zeitraum: {
          start: zeitraumStart,
          ende: zeitraumEnde,
          // Neues Feld (additiv, alte Apps ignorieren es): der ECHTE
          // Konfirmationstermin, null wenn der Jahrgang keinen hat.
          // Das Frontend rendert bisher `ende` als "Deine Konfirmation am ..."
          // -- fuer die drei von fuenf Jahrgaengen ohne Konfirmations-Termin
          // war das eine frei erfundene Zahl (das Fallback-Ende).
          konfirmation: zeitraum.konfirmation
        },
        gottesdienst: {
          count: gottesdienstCount
        },
        kategorie: {
          verteilung: kategorieVerteilung.map(k => ({
            kategorie: k.kategorie,
            // Auf welche Seite zeigt dieser Name? Das Backend entscheidet
            // das ohnehin schon fuer die Seitenauswahl -- es hier
            // mitzuliefern erspart dem Frontend, dieselbe Zuordnung ein
            // zweites Mal (und irgendwann abweichend) zu bauen.
            // null = eigener Name der Gemeinde, faellt auf die allgemeine
            // Schwerpunkt-Seite.
            seite: (() => {
              const s = seiteFuerKategorie(k.kategorie);
              return s ? `kategorie:${s}` : null;
            })(),
            count: parseInt(k.count, 10),
            // Getrennt, damit eine Seite "bei 4 Terminen" sagen kann statt
            // einer aufgeblaehten Gesamtsumme.
            aus_terminen: parseInt(k.aus_terminen, 10) || 0,
            aus_aktivitaeten: parseInt(k.aus_aktivitaeten, 10) || 0
          })),
          top_kategorie: kategorieVerteilung.length > 0 ? kategorieVerteilung[0].kategorie : null
        },
        // Additiv: War die Person bei der Sommerfreizeit 2026
        // nach Stavanger dabei? Alte Apps kennen das Feld nicht und
        // ignorieren es -- und die Seite selbst traegt bewusst einen
        // Schluessel OHNE 'kategorie:'-Praefix, damit sie dort spurlos
        // durchfaellt statt eine leere Seite zu erzeugen.
        stavanger_2026: stavanger2026,
        // Additiv: Wie viel Prozent des Jahrgangs bekommen
        // diese Seite auch? Kleiner = seltener = wertvoller. Grundlage der
        // Seitenauswahl (utils/wrappedKacheln.js, haeufigkeitFuer).
        // null bei weniger als 5 Konfis -- dort waere jeder Anteil eine
        // Zahl ohne Aussage. Alte Apps kennen das Feld nicht.
        seiten_haeufigkeit: seitenHaeufigkeit,
        // Rohdaten fuer die Datums-Seiten. Bewusst nur die Daten, keine
        // Namen -- die Seite sagt "du warst bei drei Advents-Terminen", nicht
        // welche das waren.
        termine_daten: termineDaten,
        // Wie viele Termine je Zeitfenster. Das Frontend braucht die Zahl
        // fuer die Datums-Seiten und soll die Fenster nicht selbst
        // ausrechnen -- die Osterformel gehoert an EINE Stelle.
        // Dieselbe Zaehlung, die oben ueber den Vorrang entschieden hat --
        // nicht ein zweites Mal gerechnet. Waeren es zwei Rechnungen, koennte
        // die Seite eine andere Zahl zeigen als die Auswahl benutzt hat.
        datums_fenster: datumsFensterZaehler
      }
    };

    // Additives Feld: Alte App-Versionen kennen `kacheln` nicht und rendern
    // weiter ueber ihre eigene feste Reihenfolge. Der Vertrag bleibt gewahrt.
    schnappschuss.kacheln = waehleKacheln(schnappschuss.slides, jahrgangsSchnitt);
    return schnappschuss;
  }

  /**
   * Teamer-Rueckblick eines Jahres.
   *
   * WAS AUF DEN ZEITRAUM GEFILTERT WIRD -- und was bewusst nicht:
   *
   *   gefiltert: Termine, der Termin mit den meisten Teilnehmenden, Abzeichen
   *     und Zertifikate. Das sind EREIGNISSE mit Datum. Ein Abzeichen aus dem
   *     Vorjahr gehoert nicht in diesen Jahresrueckblick -- es war die
   *     Nachricht des VORIGEN Jahres und wuerde sie hier ein zweites Mal
   *     erzaehlen.
   *
   *   NICHT gefiltert: "Konfis betreut". Das ist ein ZUSTAND, kein Ereignis --
   *     user_jahrgang_assignments traegt kein Datum, an dem man filtern
   *     koennte, und die Aussage "du begleitest 13 Konfis" ist ohnehin als
   *     Gegenwart gemeint, nicht als Jahressumme.
   *
   *   NICHT gefiltert: teamer_since / jahre_aktiv. Das IST der Lebenszeitwert
   *     und genau die Aussage der Seite ("seit 4 Jahren dabei"). Auf ein Jahr
   *     eingegrenzt kaeme dort immer 1 heraus und die Seite verloere ihren
   *     Sinn. Gerechnet wird sie aber jetzt gegen das ZEITRAUM-ENDE statt
   *     gegen Date.now(): Ein Rueckblick auf 2024, im Jahr 2026 nochmals
   *     geoeffnet, sagte sonst "6 Jahre" -- eine Zahl, die zum Rueckblick
   *     nicht passt und sich mit jedem Aufruf aendert.
   */
  async function generateTeamerSnapshot(client, userId, orgId, year, zeitraumVorgabe = null, vorigesEnde = null) {
    // BEGINN DES TEAMER-ZEITRAUMS.
    //
    // Der Rueckfall unten bleibt fuer den Fall OHNE Vorgabe stehen (Tests,
    // kuenftige Aufrufer): seit wann die Person im Team ist -- users.
    // teamer_since, sonst (nullable, Altdaten) die aelteste
    // Teamer-Aktivitaet. Dieselbe Kette wie im Abzeichen-Zweig
    // (routes/badges.js, 'teamer_year'). Er ist bewusst PERSONENBEZOGEN:
    // Wer erst seit einem halben Jahr dabei ist, bekommt sein halbes Jahr
    // und nicht die Historie der Gemeinde.
    let teamerBeginn = vorigesEnde || null;
    if (!teamerBeginn) {
      const { rows: [seitRow] } = await client.query(
        `SELECT teamer_since FROM users WHERE id = $1`,
        [userId]
      );
      if (seitRow && seitRow.teamer_since) {
        teamerBeginn = seitRow.teamer_since;
      } else {
        const { rows: [ersteAkt] } = await client.query(
          `SELECT MIN(ua.completed_date) AS min_date FROM user_activities ua
             JOIN activities a ON ua.activity_id = a.id
            WHERE ua.user_id = $1 AND a.target_role = 'teamer'`,
          [userId]
        );
        if (ersteAkt && ersteAkt.min_date) teamerBeginn = ersteAkt.min_date;
      }
    }

    // Dieselbe Funktion wie beim Konfi -- eine Regel, eine Stelle. Der
    // Teamer-Zweig kennt keinen Konfirmationstermin, daher null.
    const zeitraum = berechneZeitraum(null, year, zeitraumVorgabe, teamerBeginn);
    const zeitraumStart = zeitraum.start;
    const zeitraumEnde = zeitraum.ende;

    // Events geleitet (Teamer war als Teilnehmer gebucht)
    const { rows: [eventsGeleitetRow] } = await client.query(
      `SELECT COUNT(*) as count FROM event_bookings eb
       JOIN events e ON eb.event_id = e.id
       WHERE eb.user_id = $1 AND eb.status = 'confirmed' AND eb.attendance_status = 'present'
         AND e.organization_id = $2
         AND e.event_date >= $3::date
         AND e.event_date < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const eventsGeleitet = parseInt(eventsGeleitetRow.count, 10) || 0;

    // Event mit meisten Teilnehmern
    const { rows: topEventRows } = await client.query(
      `SELECT e.name, COUNT(eb2.id) as teilnehmer
       FROM event_bookings eb
       JOIN events e ON eb.event_id = e.id
       LEFT JOIN event_bookings eb2 ON e.id = eb2.event_id AND eb2.status = 'confirmed' AND eb2.attendance_status = 'present'
       WHERE eb.user_id = $1 AND eb.status = 'confirmed' AND eb.attendance_status = 'present'
         AND e.organization_id = $2
         AND e.event_date >= $3::date
         AND e.event_date < ($4::date + INTERVAL '1 day')
       GROUP BY e.id, e.name
       ORDER BY teilnehmer DESC
       LIMIT 1`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const meisteTeilnehmerEvent = topEventRows.length > 0
      ? { name: topEventRows[0].name, count: parseInt(topEventRows[0].teilnehmer, 10) }
      : null;

    // Konfis betreut (über zugewiesene Jahrgänge).
    // BEWUSST OHNE ZEITFILTER: ein Zustand, kein Ereignis (siehe oben).
    const { rows: konfiRows } = await client.query(
      `SELECT COUNT(DISTINCT kp.user_id) as total,
              ARRAY_AGG(DISTINCT j.name) as jahrgaenge
       FROM user_jahrgang_assignments uja
       JOIN jahrgaenge j ON uja.jahrgang_id = j.id
       JOIN konfi_profiles kp ON kp.jahrgang_id = j.id
       WHERE uja.user_id = $1 AND j.organization_id = $2`,
      [userId, orgId]
    );
    const totalKonfis = konfiRows.length > 0 ? parseInt(konfiRows[0].total, 10) || 0 : 0;
    const jahrgaengeNamen = konfiRows.length > 0 && konfiRows[0].jahrgaenge
      ? konfiRows[0].jahrgaenge.filter(Boolean)
      : [];

    // Abzeichen -- BEWUSST OHNE ZEITFILTER, dieselbe Begruendung wie im
    // Konfi-Zweig: laufende STAENDE, keine Ereignisse. Ein Abzeichen bleibt,
    // wenn es einmal verliehen ist.
    //
    // "Das erste Abzeichen" weiter unten ist davon unberuehrt -- die Seite
    // will das FRUEHESTE des Zeitraums und hat ihren eigenen Zeitfilter.
    const { rows: teamerBadges } = await client.query(
      `SELECT cb.name, cb.icon, cb.color FROM user_badges ub
       JOIN custom_badges cb ON ub.badge_id = cb.id
       WHERE ub.user_id = $1 AND ub.organization_id = $2
       ORDER BY ub.awarded_date DESC`,
      [userId, orgId]
    );
    // Wie viele Abzeichen es fuer Teamer:innen ueberhaupt gibt -- mit
    // denselben Grenzen wie die Abzeichen-Ansicht der App: nur aktive, nur
    // die der eigenen Rolle. is_hidden bleibt bewusst ungefiltert
    // (versteckte Abzeichen sind erreichbar, nur nicht vorab sichtbar).
    const { rows: [teamerBadgesGesamtRow] } = await client.query(
      `SELECT COUNT(*) as count FROM custom_badges
        WHERE organization_id = $1
          AND is_active = true
          AND target_role = 'teamer'`,
      [orgId]
    );
    const teamerBadgesGesamt = parseInt(teamerBadgesGesamtRow.count, 10) || 0;

    // Zertifikate -- ebenfalls nur die im Zeitraum ausgestellten.
    const { rows: certRows } = await client.query(
      `SELECT ct.name, uc.issued_date FROM user_certificates uc
       JOIN certificate_types ct ON uc.certificate_type_id = ct.id
       WHERE uc.user_id = $1 AND uc.organization_id = $2
         AND uc.issued_date >= $3::date
         AND uc.issued_date < ($4::date + INTERVAL '1 day')
       ORDER BY uc.issued_date DESC`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );

    // DER ANFANG -- der erste Termin des Jahres.
    //
    // Die Termin-Seite zaehlt, wie VIELE es waren; diese hier erinnert an
    // den EINEN, mit dem es losging. Ein Datum und ein Name, mehr braucht
    // die Erinnerung nicht.
    const { rows: [ersterTermin] } = await client.query(
      `SELECT e.name, e.event_date FROM event_bookings eb
         JOIN events e ON eb.event_id = e.id
        WHERE eb.user_id = $1 AND eb.status = 'confirmed' AND eb.attendance_status = 'present'
          AND e.organization_id = $2
          AND e.event_date >= $3::date
          AND e.event_date < ($4::date + INTERVAL '1 day')
        ORDER BY e.event_date ASC
        LIMIT 1`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );

    // DAS ERSTE ABZEICHEN des Jahres -- dieselbe Idee wie beim ersten
    // Termin: nicht wie viele, sondern welches zuerst.
    const { rows: [erstesAbzeichen] } = await client.query(
      `SELECT cb.name, cb.icon, cb.color, ub.awarded_date FROM user_badges ub
         JOIN custom_badges cb ON ub.badge_id = cb.id
        WHERE ub.user_id = $1 AND ub.organization_id = $2
          AND ub.awarded_date >= $3::date
          AND ub.awarded_date < ($4::date + INTERVAL '1 day')
        ORDER BY ub.awarded_date ASC
        LIMIT 1`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );

    // DER ANTWORTENDE -- wie oft jemand im Chat auf andere geantwortet hat.
    //
    // Warum gerade ANTWORTEN und nicht Nachrichten: Eine Antwort ist die
    // Zuwendung, die den Unterschied macht. Wer im Team viel schreibt, redet
    // vielleicht viel; wer viel ANTWORTET, hat auf andere reagiert -- genau
    // das ist die Arbeit, die im Team selten jemand sieht. chat_messages
    // traegt dafuer reply_to (Fremdschluessel auf die beantwortete
    // Nachricht), es braucht keine neue Spalte.
    //
    // Org-Grenze ueber den Raum, nicht ueber die Nachricht (chat_messages
    // traegt keine organization_id) -- dieselbe Regel wie im Konfi-Zweig.
    // Geloeschte Antworten zaehlen nicht: Was jemand zurueckgenommen hat,
    // soll ihm der Rueckblick nicht vorrechnen.
    const { rows: [antwortenRow] } = await client.query(
      `SELECT COUNT(*) as count FROM chat_messages cm
         JOIN chat_rooms cr ON cm.room_id = cr.id
        WHERE cm.user_id = $1 AND cr.organization_id = $2
          AND cm.reply_to IS NOT NULL
          AND cm.deleted_at IS NULL
          AND cm.created_at >= $3::date
          AND cm.created_at < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde]
    );
    const antworten = parseInt(antwortenRow.count, 10) || 0;

    // DIE CHALLENGE-BEGLEITERIN -- wie viele Beitraege jemand freigegeben hat.
    //
    // approved_by ist NULL bei Bestandszeilen (vor Migration 146) UND bei
    // unmoderierten Challenges, die automatisch auf 'approved' stehen. In
    // beiden Faellen hat niemand hingesehen -- niemand bekommt sie
    // gutgeschrieben.
    const freigegebeneBeitraege = await zahlAusNeuerSpalte(
      client,
      `SELECT COUNT(*)::int AS anzahl FROM challenge_submissions cs
        WHERE cs.approved_by = $1
          AND cs.organization_id = $2
          AND cs.approved_at >= $3::date
          AND cs.approved_at < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde],
      'Challenge-Freigaben (Migration 146)'
    );

    // EIGENE CHALLENGE-BEITRAEGE -- dieselbe Seite wie bei den Konfis.
    //
    // Bewusst DIESELBE Abfrage und DIESELBE Komponente wie im Konfi-Zweig:
    // Es ist dieselbe Sache -- jemand hat mitgemacht. Eine zweite, leicht
    // abweichende Fassung waere die alte Kopie mit einem `if` davor.
    //
    // MIT SAVEPOINT, nicht mit blossem try/catch: Beide Abfragen
    // stehen im Teamer-Zweig in einer Transaktion. Ohne SAVEPOINT liess ein
    // Fehler hier den Rest der Transaktion abgebrochen zurueck -- die
    // Schleife darueber zaehlte danach fuer JEDE weitere Person einen Fehler
    // ("current transaction is aborted"), und der ganze Team-Rueckblick fiel
    // aus, waehrend die Route trotzdem 200 meldete und pushte.
    let teamerChallengeBeitraege = 0;
    let teamerTopChallenge = null;
    try {
      await mitSavepoint(client, 'teamer_challenges', async () => {
        const { rows: [beitragRow] } = await client.query(
          `SELECT COUNT(*) as count FROM challenge_submissions cs
           WHERE cs.user_id = $1 AND cs.organization_id = $2
             AND cs.moderation_status <> 'hidden'
             AND cs.created_at >= $3::date
             AND cs.created_at < ($4::date + INTERVAL '1 day')`,
          [userId, orgId, zeitraumStart, zeitraumEnde]
        );
        teamerChallengeBeitraege = parseInt(beitragRow.count, 10) || 0;

        const { rows: topRows } = await client.query(
          `SELECT c.title, c.badge_icon, COUNT(*) as count
           FROM challenge_submissions cs
           JOIN challenges c ON cs.challenge_id = c.id
           WHERE cs.user_id = $1 AND cs.organization_id = $2
             AND cs.moderation_status <> 'hidden'
             AND cs.created_at >= $3::date
             AND cs.created_at < ($4::date + INTERVAL '1 day')
           GROUP BY c.id, c.title, c.badge_icon
           ORDER BY count DESC, c.title
           LIMIT 1`,
          [userId, orgId, zeitraumStart, zeitraumEnde]
        );
        if (topRows.length > 0) {
          teamerTopChallenge = {
            title: topRows[0].title,
            badge_icon: topRows[0].badge_icon,
            count: parseInt(topRows[0].count, 10)
          };
        }
      });
    } catch (challengeErr) {
      // Ein Teilerfolg waere eine Luege: Scheitert die zweite Abfrage, ist
      // die erste per ROLLBACK TO SAVEPOINT ohnehin zurueckgenommen. Beide
      // Werte gehen deshalb gemeinsam auf den Rueckfall.
      teamerChallengeBeitraege = 0;
      teamerTopChallenge = null;
      console.warn('Wrapped: Teamer-Challenge-Zahlen konnten nicht geladen werden:', challengeErr.message);
    }

    // GESTELLTE CHALLENGES -- was diese Person dem Jahrgang aufgegeben hat.
    //
    // Die Moderations-Zahl daneben zaehlt FREIGABEN, also die Arbeit an
    // fremden Beitraegen. Eine Challenge zu stellen ist etwas anderes: Sie
    // gibt dem Jahrgang etwas zu tun. Entwuerfe zaehlen nicht -- sie hat
    // niemand gesehen.
    const gestellteChallenges = await zahlAusNeuerSpalte(
      client,
      `SELECT COUNT(*)::int AS anzahl FROM challenges c
        WHERE c.created_by = $1
          AND c.organization_id = $2
          AND c.is_draft = false
          AND c.created_at >= $3::date
          AND c.created_at < ($4::date + INTERVAL '1 day')`,
      [userId, orgId, zeitraumStart, zeitraumEnde],
      'gestellte Challenges'
    );

    let gestellteTitel = [];
    if (gestellteChallenges > 0) {
      // SAVEPOINT wie oben -- sonst nimmt ein Fehler hier die ganze
      // Transaktion und damit jeden weiteren Teamer-Rueckblick mit.
      try {
        gestellteTitel = await mitSavepoint(client, 'gestellte_titel', async () => {
          const { rows } = await client.query(
            `SELECT c.title FROM challenges c
              WHERE c.created_by = $1
                AND c.organization_id = $2
                AND c.is_draft = false
                AND c.created_at >= $3::date
                AND c.created_at < ($4::date + INTERVAL '1 day')
              ORDER BY c.created_at DESC
              LIMIT 3`,
            [userId, orgId, zeitraumStart, zeitraumEnde]
          );
          return rows.map(r => r.title);
        });
      } catch (titelErr) {
        gestellteTitel = [];
        console.warn('Wrapped: Titel gestellter Challenges nicht ladbar:', titelErr.message);
      }
    }

    // DEIN TEAM -- mit wie vielen anderen zusammen die Jahrgaenge betreut
    // wurden.
    //
    // Self-Join ueber user_jahrgang_assignments: alle, die auf denselben
    // Jahrgaengen stehen wie diese Person. NUR TEAMER:INNEN -- ohne den
    // Rollenfilter zaehlten Admins und die Leitung mit, und die Zahl waere
    // keine Aussage ueber das Team, sondern ueber die Zugriffsrechte.
    // Die Person selbst ist ausgenommen (sie ist nicht ihr eigenes Team).
    const { rows: [teamRow] } = await client.query(
      `SELECT COUNT(DISTINCT andere.user_id)::int AS mitstreitende
         FROM user_jahrgang_assignments meine
         JOIN user_jahrgang_assignments andere
           ON andere.jahrgang_id = meine.jahrgang_id
          AND andere.user_id <> meine.user_id
         JOIN jahrgaenge j ON j.id = meine.jahrgang_id
         JOIN users u ON u.id = andere.user_id
         JOIN roles r ON r.id = u.role_id
        WHERE meine.user_id = $1
          AND j.organization_id = $2
          AND u.organization_id = $2
          AND r.name = 'teamer'
          AND u.deleted_at IS NULL`,
      [userId, orgId]
    );
    const teamGroesse = teamRow ? teamRow.mitstreitende : 0;

    // VOM KONFI ZUR TEAMER:IN -- die eigene Geschichte in der Gemeinde.
    //
    // Wer heute im Team ist und frueher selbst Konfi war, hat eine
    // Konfi-Zeit in derselben Gemeinde hinter sich. Das ist die schoenste
    // Nachricht, die ein Teamer-Rueckblick tragen kann, und sie steht
    // laengst in der Datenbank: konfi_profiles bleibt beim Rollenwechsel
    // stehen (geloescht wird die Zeile nur, wenn der ganze Mensch geloescht
    // wird -- routes/users.js, purgeHistory).
    //
    // Die Seite erscheint nur, wenn wir wirklich etwas wissen: eine
    // Konfi-Zeit in DIESER Organisation. Ein Profil aus einer fremden
    // Gemeinde erzaehlt nicht die Geschichte dieser Gemeinde.
    const { rows: [konfiZeit] } = await client.query(
      `SELECT j.name AS jahrgang, kp.created_at
         FROM konfi_profiles kp
         LEFT JOIN jahrgaenge j ON j.id = kp.jahrgang_id
        WHERE kp.user_id = $1 AND kp.organization_id = $2
        ORDER BY kp.created_at ASC NULLS LAST
        LIMIT 1`,
      [userId, orgId]
    );
    const warSelbstKonfi = Boolean(konfiZeit);

    // Jahre aktiv (teamer_since). BEWUSST EIN LEBENSZEITWERT -- aber gegen
    // das Zeitraum-Ende gerechnet, nicht gegen "jetzt" (siehe oben).
    const { rows: [userRow] } = await client.query(
      `SELECT teamer_since FROM users WHERE id = $1`,
      [userId]
    );
    const teamerSeit = userRow && userRow.teamer_since ? userRow.teamer_since : null;
    const stichtag = new Date(`${zeitraumEnde}T00:00:00`).getTime();
    const jahreAktiv = teamerSeit
      ? Math.max(1, Math.floor((stichtag - new Date(teamerSeit).getTime()) / (365.25 * 24 * 60 * 60 * 1000)))
      : 0;

    // NEU DABEI -- das erste Jahr im Team.
    //
    // Fallback-Kette wie im Abzeichen-Zweig (routes/badges.js, 'teamer_year'):
    // erst users.teamer_since, sonst die aelteste Teamer-Aktivitaet. Ohne
    // beides bleibt es unbekannt -- und "unbekannt" ist NICHT "neu": Wer
    // seit Jahren dabei ist, aber kein Eintrittsdatum hinterlegt hat, darf
    // nicht als Neuling begruesst werden.
    let teamerStartJahr = null;
    if (teamerSeit) {
      teamerStartJahr = new Date(teamerSeit).getFullYear();
    } else {
      // SAVEPOINT wie oben -- der Rueckfall ist "unbekannt", und der darf
      // nicht die Transaktion kosten.
      try {
        teamerStartJahr = await mitSavepoint(client, 'teamer_startjahr', async () => {
          const { rows: [ersteAkt] } = await client.query(
            `SELECT MIN(ua.completed_date) AS min_date FROM user_activities ua
               JOIN activities a ON ua.activity_id = a.id
              WHERE ua.user_id = $1 AND a.target_role = 'teamer'`,
            [userId]
          );
          return (ersteAkt && ersteAkt.min_date)
            ? new Date(ersteAkt.min_date).getFullYear()
            : null;
        });
      } catch (startErr) {
        teamerStartJahr = null;
        console.warn('Wrapped: Teamer-Startjahr nicht ermittelbar:', startErr.message);
      }
    }
    // Erstes Jahr = das Startjahr liegt IM Rueckblicksjahr.
    const erstesJahr = teamerStartJahr !== null && teamerStartJahr === year;

    const stavanger2026 = await warBeiStavanger(client, userId, orgId, zeitraumStart, zeitraumEnde);


    const schnappschuss = {
      // Version 3, in zwei Schritten gewachsen:
      //   2: alle Ereignis-Zahlen sind auf den Zeitraum eingegrenzt
      //      (`zeitraum` bekam start/ende dazu).
      //   3: der Rueckblick waehlt seine Seiten nach Inhalt statt sieben
      //      feste zu zeigen (`kacheln`, unten gesetzt).
      //
      // Beide Schritte rein ADDITIV -- kein Feld entfernt, umbenannt oder
      // umtypisiert. Ausgelieferte Apps kennen `kacheln` nicht, ignorieren
      // das Feld und rendern weiter ueber ihre feste Siebener-Reihenfolge.
      // Bereits erzeugte Snapshots liegen unveraendert in der Datenbank und
      // werden nie neu gerechnet -- der alte Rueckblick bleibt der alte.
      version: 3,
      slides: {
        events_geleitet: {
          total: eventsGeleitet,
          meiste_teilnehmer_event: meisteTeilnehmerEvent
        },
        konfis_betreut: {
          total_konfis: totalKonfis,
          jahrgaenge: jahrgaengeNamen
        },
        badges: {
          total_earned: teamerBadges.length,
          total_available: teamerBadgesGesamt,
          badges: teamerBadges.map(b => ({ name: b.name, icon: b.icon, color: b.color }))
        },
        zertifikate: {
          total: certRows.length,
          zertifikate: certRows.map(c => ({ name: c.name, issued_date: c.issued_date }))
        },
        engagement: {
          teamer_seit: teamerSeit,
          jahre_aktiv: jahreAktiv
        },
        // Additiv (ab Version 3): alte Apps kennen die Felder nicht und
        // ignorieren sie.
        chat: {
          antworten
        },
        team: {
          mitstreitende: teamGroesse
        },
        // Additiv: dieselbe Form wie im Konfi-Snapshot, damit
        // beide Rueckblicke dieselbe Komponente benutzen koennen.
        challenges: {
          beitraege: teamerChallengeBeitraege,
          top_challenge: teamerTopChallenge
        },
        // Additiv: Wer Challenges stellt, bekommt eine Seite
        // dafuer. Alte Apps kennen das Feld nicht und ignorieren es.
        challenges_gestellt: {
          total: gestellteChallenges,
          // Additiv: die drei neuesten Titel. Aeltere Apps ignorieren sie.
          titel: gestellteTitel
        },
        moderation: {
          freigegeben: freigegebeneBeitraege
        },
        neu_dabei: {
          erstes_jahr: erstesJahr,
          start_jahr: teamerStartJahr
        },
        anfang: ersterTermin
          ? { name: ersterTermin.name, datum: ersterTermin.event_date }
          : null,
        erstes_abzeichen: erstesAbzeichen
          ? {
              name: erstesAbzeichen.name,
              icon: erstesAbzeichen.icon,
              color: erstesAbzeichen.color,
              datum: erstesAbzeichen.awarded_date
            }
          : null,
        konfi_zeit: warSelbstKonfi
          ? { jahrgang: konfiZeit.jahrgang || null }
          : null,
        // Additiv: die Sommerfreizeit-Sonderseite. Alte Apps
        // kennen das Feld nicht und ignorieren es.
        stavanger_2026: stavanger2026,
        zeitraum: {
          year,
          // Additiv (ab Version 2): alte Apps ignorieren die Felder, neue
          // koennen den Zeitraum benennen, statt ihn aus `year` zu raten.
          start: zeitraumStart,
          ende: zeitraumEnde
        }
      }
    };

    // Die Seitenauswahl -- wie beim Konfi-Rueckblick IM Snapshot gespeichert
    // statt bei jedem Ansehen neu gerechnet: Ein Rueckblick wird geteilt und
    // mehrfach geoeffnet und muss jedes Mal gleich aussehen.
    //
    // Additiv: Alte App-Versionen kennen `kacheln` nicht und rendern weiter
    // ueber ihre feste Siebener-Reihenfolge. Der Vertrag bleibt gewahrt.
    schnappschuss.kacheln = waehleTeamerKacheln(schnappschuss.slides);

    // DER ZUSPRUCH statt eines leeren Rueckblicks.
    // Kam fuer diese Person nichts zusammen, traegt `kacheln` die drei
    // Segens-Seiten -- dann braucht die App auch den Text dazu.
    //
    // Additiv: `segen` steht nur in diesem Fall im Snapshot. Alte
    // App-Versionen kennen weder die Kachel-Schluessel noch das Feld und
    // zeigen weiter ihre feste Reihenfolge -- der Vertrag bleibt gewahrt.
    if (teamerJahrIstLeer(schnappschuss.slides)) {
      const segen = waehleSegen(userId, year);
      schnappschuss.slides.segen = { text: segen.text, quelle: segen.quelle };
    }

    return schnappschuss;
  }

  /**
   * Parallele Hilfsfunktion: Generiert und speichert einen Konfi-Snapshot.
   * Holt eigenen DB-Client aus dem Pool (kein geteilter Client für parallele Queries).
   */
  async function generateAndSaveKonfiSnapshot(dbRef, userId, orgId, jahrgangId, year, ausgabeId = null, zeitraumVorgabe = null) {
    const konfiClient = await dbRef.getClient();
    try {
      const snapshot = await generateKonfiSnapshot(konfiClient, userId, orgId, jahrgangId, year, zeitraumVorgabe);
      // Der Schluessel schliesst seit Migration 144 die AUSGABE ein: Je
      // Ausgabe ein Snapshot pro Person. Innerhalb einer Ausgabe bleibt der
      // Lauf idempotent (Korrektur ueberschreibt), zwei Ausgaben stehen
      // nebeneinander -- vorher ueberschrieb "Dein Abschluss" still "Dein
      // erstes Jahr".
      await konfiClient.query(
        `INSERT INTO wrapped_snapshots (user_id, organization_id, wrapped_type, jahrgang_id, year, ausgabe_id, data, computed_at)
         VALUES ($1, $2, 'konfi', $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id, wrapped_type, year, COALESCE(jahrgang_id, 0), COALESCE(ausgabe_id, 0))
         DO UPDATE SET data = EXCLUDED.data, computed_at = NOW(), organization_id = EXCLUDED.organization_id`,
        [userId, orgId, jahrgangId, year, ausgabeId, JSON.stringify(snapshot)]
      );
      return { userId, ok: true };
    } catch (err) {
      console.error(`Wrapped generation error for konfi ${userId}:`, err.message);
      return { userId, ok: false, err };
    } finally {
      konfiClient.release();
    }
  }

  // ====================================================================
  // ENDPOINTS
  // ====================================================================

  // GET /me - Eigenen Wrapped-Snapshot abrufen
  router.get('/me', rbacVerifier, async (req, res) => {
    try {
      const roleName = req.user.role_name;
      const wrappedType = (roleName === 'teamer') ? 'teamer' : 'konfi';
      const currentYear = new Date().getFullYear();

      // Alt-Snapshots haben keine ausgabe_id -- fuer sie bleibt titel null
      // und die App zeigt wie bisher ihre eigene Ueberschrift.
      const { rows } = await db.query(
        `SELECT s.data, s.computed_at, s.year,
                a.id AS ausgabe_id, a.titel, a.freigegeben_at
           FROM wrapped_snapshots s
           LEFT JOIN wrapped_ausgaben a ON a.id = s.ausgabe_id
          WHERE s.user_id = $1 AND s.wrapped_type = $2
            AND (a.id IS NULL OR a.freigegeben_at IS NOT NULL)
          ORDER BY COALESCE(a.freigegeben_at, s.computed_at) DESC, s.year DESC
          LIMIT 1`,
        [req.user.id, wrappedType]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Kein Wrapped-Snapshot vorhanden' });
      }

      if (roleName === 'konfi') {
        const { rows: [gate] } = await db.query(
          `SELECT EXISTS(
             SELECT 1 FROM jahrgaenge j
             JOIN konfi_profiles kp ON kp.jahrgang_id = j.id
             WHERE kp.user_id = $1
               AND j.wrapped_released_at IS NOT NULL
               AND j.wrapped_released_at <= NOW()
           ) AS released`,
          [req.user.id]
        );
        if (!gate || !gate.released) {
          return res.status(403).json({ error: 'Wrapped ist noch nicht freigegeben' });
        }
      }

      res.json({
        data: rows[0].data,
        computed_at: rows[0].computed_at,
        year: rows[0].year,
        wrapped_type: wrappedType,
        // Additiv -- alte Apps ignorieren die Felder und zeigen wie bisher.
        ausgabe_id: rows[0].ausgabe_id || null,
        titel: rows[0].titel || null
      });
    } catch (err) {
      console.error('Error loading wrapped snapshot:', err);
      res.status(500).json({ error: 'Fehler beim Laden des Wrapped-Snapshots' });
    }
  });

  // POST /generate/:jahrgangId - Konfi-Snapshots für alle Konfis eines Jahrgangs generieren
  // Erzeugt (und gibt frei) den Rueckblick eines Jahrgangs.
  //
  // BEWUSST KEINE ZWEITE ROUTE: Das Anlegen einer Ausgabe ist derselbe
  // Vorgang wie das Erzeugen des Rueckblicks -- eine eigene Route waere ein
  // zweiter Weg zum selben Ziel und liefe irgendwann auseinander.
  //
  // Der Titel ist optional. Ohne ihn entsteht ein Vorschlag aus dem
  // Jahrgangsnamen, damit niemand etwas eingeben MUSS.
  router.post('/generate/:jahrgangId',
    rbacVerifier,
    requireAdmin,
    param('jahrgangId').isInt({ min: 1 }),
    // KEIN Zeitraum aus dem Formular: Der
    // Konfi-Rueckblick geht immer vom Beginn der Konfi-Zeit bis heute.
    // Ein optionaler `titel` wird dagegen entgegengenommen und gespeichert
    // (siehe unten) -- er beschriftet nur, er rechnet nichts.
    // Aeltere App-Versionen schicken den Zeitraum moeglicherweise noch mit
    // -- er wird ohne Fehler ignoriert, statt die Anfrage abzulehnen
    // (ALT-APP-VERTRAG).
    //
    // DER TITEL WIRD GEPRUEFT. Vorher stand hier nichts, und
    // `trim().slice(0, 40)` weiter unten trug alles still weg. Gemessen:
    //   `titel: 42`      -> landete im Platzhalter, ohne Fehler. Wer sich
    //                       vertippt, bekommt "Konfi-Rueckblick 2026" und
    //                       sucht den Grund bei sich.
    //   200 Zeichen      -> still auf 40 geschnitten, ohne Hinweis.
    //   Steuerzeichen    -> ungeprueft bis auf die Folie.
    //   Emoji an Stelle 40 -> slice() trennte es mitten im Zeichen, die
    //                       Folie zeigte ein Ersatzquadrat.
    //
    // KEIN BRUCH FUER AUSGELIEFERTE APPS: Die Oberflaeche kuerzt selbst auf
    // 40 (AdminWrappedPage.tsx) und schickt nie mehr. Die Grenze trifft
    // also nur direkte Aufrufe. Nur-Leerzeichen bleibt bewusst erlaubt --
    // ein leeres Feld ist eine Nicht-Angabe, kein Vertipper, und faellt
    // unten auf den Platzhalter zurueck.
    body('titel')
      .optional({ nullable: true })
      .isString().withMessage('Der Name muss Text sein')
      .bail()
      .trim()
      .isLength({ max: 40 }).withMessage('Der Name darf hoechstens 40 Zeichen lang sein')
      // Steuerzeichen (auch Zeilenumbrueche) haben in einer Ueberschrift
      // nichts zu suchen. Emoji und Umlaute bleiben ausdruecklich erlaubt.
      .matches(/^[^\p{Cc}\p{Cf}]*$/u).withMessage('Der Name enthaelt unerlaubte Zeichen'),
    handleValidationErrors,
    async (req, res) => {
      const client = await db.getClient();
      try {
        const jahrgangId = parseInt(req.params.jahrgangId, 10);

        // Jahrgang validieren: gehört zur Org des Admins
        const { rows: [jahrgang] } = await client.query(
          `SELECT id, name, wrapped_released_at FROM jahrgaenge WHERE id = $1 AND organization_id = $2`,
          [jahrgangId, req.user.organization_id]
        );
        if (!jahrgang) {
          return res.status(404).json({ error: 'Jahrgang nicht gefunden' });
        }

        if (!darfJahrgang(req, jahrgangId, { edit: true })) {
          return res.status(403).json({ error: 'Kein Zugriff auf diesen Jahrgang' });
        }

        const currentYear = new Date().getFullYear();

        // Die Transaktion umschliesst NUR das Setzen der Freigabe unten, nicht
        // die Snapshots: Die laufen bewusst parallel ueber eigene Pool-Clients
        // (generateAndSaveKonfiSnapshot) und liegen damit ausserhalb. Bei einem
        // ROLLBACK bleiben bereits geschriebene Snapshots stehen.
        //
        // Das ist gewollt und harmlos: Der Insert ist idempotent (ON CONFLICT
        // DO UPDATE), ein erneuter Lauf erzeugt denselben Stand. Ohne die
        // Freigabe sieht sie ohnehin niemand -- GET /me gibt fuer Konfis 403,
        // solange wrapped_released_at nicht gesetzt ist.
        //
        // Alles in EINE Transaktion zu ziehen hiesse, die parallele
        // Generierung aufzugeben (ein Client, seriell) -- teurer Umbau fuer
        // einen Fall, der keine falschen Daten erzeugt.
        // Die AUSGABE zuerst und AUSSERHALB der Transaktion.
        //
        // Zwei Gruende, beide gemessen:
        // 1. Die Snapshots brauchen ihre id als Teil des Schluessels
        //    (Migration 144) -- ohne sie ueberschreibt der zweite Lauf den
        //    ersten still.
        // 2. Die Snapshot-Generierung laeuft ueber EIGENE Pool-Clients
        //    (generateAndSaveKonfiSnapshot, parallel). Steckte die Ausgabe
        //    in dieser Transaktion, saehen die anderen Verbindungen sie
        //    nicht -- der Fremdschluessel schlug fehl:
        //    "violates foreign key constraint wrapped_snapshots_ausgabe_id_fkey".
        //
        // Am 07.09. war er entfallen, zusammen mit dem frei setzbaren
        // ZEITRAUM. Der Zeitraum bleibt entfallen -- er liess sich falsch
        // stellen und ergab Zahlen, die niemand nachvollziehen konnte. Ein
        // Name kann das nicht: Er beschriftet nur, er rechnet nichts.
        const eingegeben = typeof req.body?.titel === 'string' ? req.body.titel.trim() : '';
        const titel = eingegeben || `Konfi-Rückblick ${jahrgang.name || currentYear}`;

        const zeitraumVorgabe = null;
        const heuteIso = (() => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })();
        // Der Zeitraum, der in der AUSGABE steht, ist die Spanne, die sie
        // insgesamt abdeckt: vom fruehesten Beginn im Jahrgang bis heute.
        const { rows: [fruehest] } = await client.query(
          `SELECT MIN(kp.created_at)::date AS beginn FROM konfi_profiles kp
             JOIN users u ON kp.user_id = u.id
             JOIN roles r ON u.role_id = r.id
            WHERE kp.jahrgang_id = $1 AND r.name = 'konfi' AND u.deleted_at IS NULL`,
          [jahrgangId]
        );
        const anzeigeStart = fruehest && fruehest.beginn
          ? new Date(fruehest.beginn).toISOString().slice(0, 10)
          : `${currentYear - 1}-09-01`;
        const { rows: [ausgabe] } = await client.query(
          `INSERT INTO wrapped_ausgaben
             (organization_id, wrapped_type, jahrgang_id, titel,
              zeitraum_start, zeitraum_ende, freigegeben_at, freigegeben_von,
              erstellt_von)
           VALUES ($1, 'konfi', $2, $3, $4::date, $5::date, NOW(), $6, $6)
           RETURNING id, titel`,
          [req.user.organization_id, jahrgangId, titel,
           anzeigeStart,
           heuteIso,
           req.user.id]
        );

        await client.query('BEGIN');

        // Alle Konfis des Jahrgangs laden
        const { rows: konfis } = await client.query(
          `SELECT kp.user_id FROM konfi_profiles kp
           JOIN users u ON kp.user_id = u.id
           JOIN roles r ON u.role_id = r.id
           WHERE kp.jahrgang_id = $1 AND r.name = 'konfi' AND u.deleted_at IS NULL`,
          [jahrgangId]
        );

        // Parallele Snapshot-Generierung (jeder Konfi holt eigenen DB-Client)
        const results = await Promise.allSettled(
          konfis.map(konfi => generateAndSaveKonfiSnapshot(db, konfi.user_id, req.user.organization_id, jahrgangId, currentYear, ausgabe.id, zeitraumVorgabe))
        );
        const generated = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
        const errors = results.length - generated;

        // ALT-APP-VERTRAG: wrapped_released_at bleibt gesetzt. Ausgelieferte
        // App-Versionen lesen diese Spalte ueber das Konfi-Dashboard --
        // verschwaende sie, braeche der Rueckblick auf den Geraeten.
        await client.query(
          `UPDATE jahrgaenge SET wrapped_released_at = NOW() WHERE id = $1`,
          [jahrgangId]
        );

        await client.query('COMMIT');

        // Push-Notification an alle Konfis -- bei JEDER neuen Ausgabe.
        //
        // Seit Migration 144 (03.09.) legt jeder Lauf eine EIGENE Ausgabe an,
        // die neben der alten stehen bleibt und in der Liste der Konfis
        // auftaucht ("Zwischenstand" und "Abschluss" sollen beide bleiben).
        // Damit IST etwas Neues da, und das Schweigen liess niemanden davon
        // erfahren.
        try {
          const konfiIds = konfis.map(k => k.user_id);
          await PushService.sendWrappedReleased(db, konfiIds, 'konfi', req.user.organization_id);
        } catch (pushErr) {
          console.error('Push-Notification für Konfi-Wrapped fehlgeschlagen:', pushErr);
        }

        res.json({
          message: `Wrapped f\u00fcr ${generated} Konfis generiert`,
          generated,
          errors,
          jahrgang: jahrgang.name,
          year: currentYear,
          benachrichtigt: true
        });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error generating konfi wrapped:', err);
        res.status(500).json({ error: 'Fehler beim Generieren der Konfi-Wrapped-Snapshots' });
      } finally {
        client.release();
      }
    }
  );

  // POST /generate-teamer - Teamer-Snapshots für alle Teamer der Organisation generieren
  // Erzeugt und GIBT FREI: die Teamer-Ausgabe.
  router.post('/generate-teamer',
    rbacVerifier,
    requireOrgAdmin,
    // Die Untergrenze 2000 ist reine Tippfehler-Abwehr; die Obergrenze
    // prueft der Rumpf, weil sie vom heutigen Tag abhaengt (nur
    // ABGESCHLOSSENE Jahre).
    body('jahr').optional({ nullable: true }).isInt({ min: 2000, max: 2999 }),
    handleValidationErrors,
    async (req, res) => {
      const client = await db.getClient();
      try {
        const currentYear = new Date().getFullYear();

        // Ohne Angabe: das zuletzt abgeschlossene Jahr -- derselbe Wert, den
        // der Cron am 6.1. nimmt.
        const jahr = req.body?.jahr ? parseInt(req.body.jahr, 10) : (currentYear - 1);
        if (jahr >= currentYear) {
          return res.status(400).json({
            error: `Das Jahr ${jahr} ist noch nicht abgeschlossen. Verfügbar ab 1.1.${jahr + 1}.`
          });
        }

        // Der Zeitraum ist das Kalenderjahr -- fuer die Ausgabe wie fuer die
        // Rechnung darunter. Beide muessen dieselben Daten benutzen, sonst
        // steht in der Ausgabe eine Spanne, die zu den Zahlen nicht passt.
        const zeitraum = teamerJahresZeitraum(jahr);
        const zeitraumVorgabe = zeitraum;

        // SCHON DA? Dann nichts tun -- kein zweiter Datensatz, kein zweiter
        // Push.
        //
        // ANDERS ALS BEIM KONFI-RUECKBLICK, und das mit Absicht: Dort ergibt
        // jeder Lauf eine weitere Ausgabe (Zwischenstand, Abschluss), und
        // jede meldet sich. Ein KALENDERJAHR dagegen gibt es nur einmal --
        // ein zweiter "Team-Rueckblick 2026" waere kein Zwischenstand,
        // sondern ein Duplikat. Erkennungsmerkmal ist der Zeitraum, denn er
        // IST hier die Sache selbst.
        //
        // Ohne diese Pruefung legte jeder weitere Klick eine zusaetzliche
        // Ausgabe an und schickte dem ganzen Team erneut "Dein Teamer-Jahr
        // ist da!". Der Cron am 6.1. hatte die Pruefung
        // (generateAllTeamerWrapped), dessen Kommentar behauptete sogar, sie
        // gelte "auch fuer den manuellen Weg" -- der lief aber nie durch
        // jene Funktion.
        //
        // VOR der Transaktion, damit ein uebersprungener Lauf gar nichts
        // anfasst.
        const { rows: [schonDa] } = await client.query(
          `SELECT id, titel FROM wrapped_ausgaben
            WHERE organization_id = $1 AND wrapped_type = 'teamer'
              AND zeitraum_start = $2::date AND zeitraum_ende = $3::date
            LIMIT 1`,
          [req.user.organization_id, zeitraum.start, zeitraum.ende]
        );
        if (schonDa) {
          return res.json({
            message: `Der Team-R\u00fcckblick ${jahr} besteht bereits`,
            generated: 0,
            errors: 0,
            year: jahr,
            // Additiv (ausgelieferte Apps lesen die Antwort): dieselben
            // Felder wie im Normalfall, damit die Oberflaeche nichts
            // Sonderbares behandeln muss.
            ausgabe_id: schonDa.id,
            titel: schonDa.titel,
            benachrichtigt: false
          });
        }

        await client.query('BEGIN');

        // Alle Teamer der Organisation laden
        const { rows: teamers } = await client.query(
          `SELECT u.id as user_id FROM users u
           JOIN roles r ON u.role_id = r.id
           WHERE r.name = 'teamer' AND u.organization_id = $1`,
          [req.user.organization_id]
        );

        // Die Ausgabe zuerst -- ihre id gehoert seit Migration 144 zum
        // Schluessel der Snapshots. Sonst ueberschreibt jeder Lauf den
        // vorigen (derselbe Fehler wie bei den Konfis).
        const teamerTitel = `Team-Rückblick ${jahr}`;
        const { rows: [teamerAusgabe] } = await client.query(
          `INSERT INTO wrapped_ausgaben
             (organization_id, wrapped_type, jahrgang_id, titel,
              zeitraum_start, zeitraum_ende, freigegeben_at, freigegeben_von,
              erstellt_von)
           VALUES ($1, 'teamer', NULL, $2, $3::date, $4::date, NOW(), $5, $5)
           RETURNING id, titel`,
          [req.user.organization_id, teamerTitel,
           zeitraum.start, zeitraum.ende, req.user.id]
        );

        let generated = 0;
        let errors = 0;

        // ZWEITE VERTEIDIGUNGSLINIE: ein SAVEPOINT je Person.
        //
        // Die einzelnen Abfragen im Snapshot sind abgesichert, aber jede
        // kuenftige, die es nicht ist, wuerde sonst wieder ALLES mitreissen:
        // Ein Fehler bei Person 1 laesst die Transaktion abgebrochen zurueck,
        // und Person 2 bis n scheitern nur noch an "current transaction is
        // aborted". Der SAVEPOINT hier begrenzt jeden Fehler auf die Person,
        // bei der er auftritt -- die anderen bekommen ihren Rueckblick.
        for (const teamer of teamers) {
          try {
            await mitSavepoint(client, 'teamer_snapshot', async () => {
              const snapshot = await generateTeamerSnapshot(client, teamer.user_id, req.user.organization_id, jahr, zeitraumVorgabe, null);

              await client.query(
                `INSERT INTO wrapped_snapshots (user_id, organization_id, wrapped_type, year, ausgabe_id, data, computed_at)
                 VALUES ($1, $2, 'teamer', $3, $4, $5, NOW())
                 ON CONFLICT (user_id, wrapped_type, year, COALESCE(jahrgang_id, 0), COALESCE(ausgabe_id, 0))
                 DO UPDATE SET data = EXCLUDED.data, computed_at = NOW(), organization_id = EXCLUDED.organization_id`,
                [teamer.user_id, req.user.organization_id, jahr, teamerAusgabe.id, JSON.stringify(snapshot)]
              );
            });
            generated++;
          } catch (err) {
            console.error(`Wrapped generation error for teamer ${teamer.user_id}:`, err.message);
            errors++;
          }
        }

        // TOTALAUSFALL WIRD NICHT ALS ERFOLG GEMELDET.
        //
        // Bis hierher lief der Code bei generated=0 geradeaus weiter: COMMIT
        // auf einer abgebrochenen Transaktion wirkt wie ROLLBACK und wirft
        // NICHT -- die Route meldete 200 mit benachrichtigt:true und einer
        // ausgabe_id, die es in der Datenbank gar nicht mehr gab. Das ganze
        // Team bekam "Dein Teamerjahr ist da!" fuer einen Rueckblick, den es
        // nicht gibt, und weil keine Ausgabe geschrieben wurde, griff beim
        // naechsten Versuch auch die Idempotenz-Sperre nicht: der zweite
        // Klick pushte erneut.
        //
        // Kein Push, kein 200, keine halbe Ausgabe: zurueckrollen und sagen,
        // dass es schiefging.
        if (teamers.length > 0 && generated === 0) {
          await client.query('ROLLBACK').catch(() => {});
          console.error(`Teamer-Wrapped ${jahr}: kein einziger Snapshot erzeugt (${errors} Fehler), Ausgabe zurückgenommen`);
          return res.status(500).json({ error: 'Fehler beim Generieren der Teamer-Wrapped-Snapshots' });
        }

        await client.query('COMMIT');

        // Push-Notification an alle Teamer:innen
        try {
          const teamerIds = teamers.map(t => t.user_id);
          await PushService.sendWrappedReleased(db, teamerIds, 'teamer', req.user.organization_id);
        } catch (pushErr) {
          console.error('Push-Notification für Teamer-Wrapped fehlgeschlagen:', pushErr);
        }

        res.json({
          message: `Wrapped f\u00fcr ${generated} Personen im Team generiert`,
          generated,
          errors,
          year: jahr,
          // Additiv: alte Clients ignorieren die Felder.
          ausgabe_id: teamerAusgabe.id,
          titel: teamerAusgabe.titel,
          benachrichtigt: true
        });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error generating teamer wrapped:', err);
        res.status(500).json({ error: 'Fehler beim Generieren der Teamer-Wrapped-Snapshots' });
      } finally {
        client.release();
      }
    }
  );

  // GET /meine - alle eigenen Rueckblicke, mit Titel.
  //
  // Zeigt ausschliesslich FREIGEGEBENE Ausgaben: Was die Leitung noch nicht
  // freigegeben hat, bleibt unsichtbar.
  router.get('/meine', rbacVerifier, async (req, res) => {
    try {
      const wrappedType = (req.user.role_name === 'teamer') ? 'teamer' : 'konfi';
      const { rows } = await db.query(
        `SELECT s.id, s.year, s.computed_at,
                a.id AS ausgabe_id, a.titel, a.freigegeben_at,
                a.zeitraum_start, a.zeitraum_ende
           FROM wrapped_snapshots s
           LEFT JOIN wrapped_ausgaben a ON a.id = s.ausgabe_id
          WHERE s.user_id = $1 AND s.wrapped_type = $2
            AND (a.id IS NULL OR a.freigegeben_at IS NOT NULL)
          ORDER BY COALESCE(a.freigegeben_at, s.computed_at) DESC`,
        [req.user.id, wrappedType]
      );
      res.json(rows.map(r => ({
        snapshot_id: r.id,
        ausgabe_id: r.ausgabe_id,
        titel: r.titel || `Dein Rückblick ${r.year}`,
        year: r.year,
        zeitraum_start: r.zeitraum_start,
        zeitraum_ende: r.zeitraum_ende,
        computed_at: r.computed_at
      })));
    } catch (err) {
      console.error('Error loading own wrapped list:', err);
      res.status(500).json({ error: 'Fehler beim Laden der Rückblicke' });
    }
  });

  // DELETE /ausgabe/:id - eine EINZELNE Ausgabe samt ihrer Snapshots.
  //
  // Die Snapshots haengen per ON DELETE CASCADE an der Ausgabe (Migration
  // 143) und verschwinden mit.
  router.delete('/ausgabe/:id',
    rbacVerifier,
    requireAdmin,
    param('id').isInt({ min: 1 }),
    handleValidationErrors,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const istOrgAdmin = ['org_admin', 'super_admin'].includes(req.user.role_name);

        const { rows: [ausgabe] } = await db.query(
          `SELECT id, wrapped_type, jahrgang_id FROM wrapped_ausgaben
            WHERE id = $1 AND organization_id = $2`,
          [id, req.user.organization_id]
        );
        if (!ausgabe) {
          return res.status(404).json({ error: 'Ausgabe nicht gefunden' });
        }

        // Dieselbe Rechte-Grenze wie beim Anlegen und Anzeigen:
        // Teamer-Ausgaben nur org_admin, Konfi-Ausgaben nur eigene Jahrgaenge.
        if (ausgabe.wrapped_type === 'teamer' && !istOrgAdmin) {
          return res.status(403).json({ error: 'Nur die Leitung darf Teamer-Ausgaben loeschen' });
        }
        if (ausgabe.wrapped_type === 'konfi' && !istOrgAdmin) {
          const { rows: [zugriff] } = await db.query(
            `SELECT 1 FROM user_jahrgang_assignments
              WHERE user_id = $1 AND jahrgang_id = $2`,
            [req.user.id, ausgabe.jahrgang_id]
          );
          if (!zugriff) {
            return res.status(403).json({ error: 'Kein Zugriff auf diesen Jahrgang' });
          }
        }

        const { rows: [{ anzahl }] } = await db.query(
          `SELECT COUNT(*)::int AS anzahl FROM wrapped_snapshots WHERE ausgabe_id = $1`,
          [id]
        );
        await db.query(`DELETE FROM wrapped_ausgaben WHERE id = $1`, [id]);

        // Die Alt-Marke am Jahrgang nachziehen: Bleibt keine freigegebene
        // Konfi-Ausgabe uebrig, darf auch wrapped_released_at nicht stehen
        // bleiben -- sonst zeigte das Dashboard alter App-Versionen weiter
        // einen Rueckblick an, den es nicht mehr gibt.
        if (ausgabe.wrapped_type === 'konfi' && ausgabe.jahrgang_id) {
          await db.query(
            `UPDATE jahrgaenge SET wrapped_released_at = NULL
              WHERE id = $1 AND NOT EXISTS (
                SELECT 1 FROM wrapped_ausgaben
                 WHERE jahrgang_id = $1 AND freigegeben_at IS NOT NULL)`,
            [ausgabe.jahrgang_id]
          );
        }

        res.json({ message: `Ausgabe gelöscht (${anzahl} Rückblicke)`, deleted: anzahl });
      } catch (err) {
        console.error('Error deleting wrapped ausgabe:', err);
        res.status(500).json({ error: 'Fehler beim Loeschen der Ausgabe' });
      }
    }
  );

  // GET /ausgaben - die Rueckblick-Ausgaben der Organisation.
  /**
   * Welche Team-Jahre lassen sich ueberhaupt zurueckblicken?
   *
   * Ein Jahr gilt als lieferbar, wenn darin einer TEAMER:IN etwas passiert
   * ist, das im Rueckblick vorkommt: ein Termin mit Anwesenheit, eine
   * Teamer-Aktivitaet, ein verliehenes Abzeichen oder ein Zertifikat. Dazu
   * kommen Jahre, fuer die schon eine Ausgabe besteht -- die soll nicht aus
   * der Liste verschwinden.
   *
   * Das laufende Jahr wird mitgeliefert, aber als gesperrt: Es ist noch nicht
   * vorbei, und wer es nicht sieht, haelt sein Fehlen fuer einen Fehler.
   */
  router.get('/team-jahre',
    rbacVerifier,
    requireOrgAdmin,
    async (req, res) => {
      try {
        const orgId = req.user.organization_id;
        const laufend = new Date().getFullYear();

        const { rows } = await db.query(
          `SELECT DISTINCT jahr FROM (
             -- Termine: nur, wo ein Teamer auch WAR. Die blosse Existenz
             -- eines Termins sagt nichts -- ein reiner Konfi-Termin
             -- erzeugt keine einzige Zeile im Teamer-Rueckblick.
             SELECT EXTRACT(YEAR FROM e.event_date)::int AS jahr
               FROM event_bookings eb
               JOIN events e ON eb.event_id = e.id
               JOIN users u ON eb.user_id = u.id
               JOIN roles r ON u.role_id = r.id
              WHERE e.organization_id = $1 AND r.name = 'teamer'
                AND eb.status = 'confirmed' AND eb.attendance_status = 'present'
             UNION ALL
             -- Aktivitaeten: nur Teamer-Aktivitaeten von Teamer:innen,
             -- dieselbe Grenze wie im Rueckblick selbst (target_role).
             SELECT EXTRACT(YEAR FROM ua.completed_date)::int
               FROM user_activities ua
               JOIN activities a ON ua.activity_id = a.id
               JOIN users u ON ua.user_id = u.id
               JOIN roles r ON u.role_id = r.id
              WHERE ua.organization_id = $1 AND r.name = 'teamer'
                AND a.target_role = 'teamer'
             UNION ALL
             SELECT EXTRACT(YEAR FROM ub.awarded_date)::int
               FROM user_badges ub
               JOIN users u ON ub.user_id = u.id
               JOIN roles r ON u.role_id = r.id
              WHERE ub.organization_id = $1 AND r.name = 'teamer'
             UNION ALL
             -- Zertifikate: sie haben im Teamer-Rueckblick eine eigene
             -- Seite, gehoeren also zu den Quellen.
             SELECT EXTRACT(YEAR FROM uc.issued_date)::int
               FROM user_certificates uc
               JOIN users u ON uc.user_id = u.id
               JOIN roles r ON u.role_id = r.id
              WHERE uc.organization_id = $1 AND r.name = 'teamer'
             UNION ALL
             SELECT EXTRACT(YEAR FROM a.zeitraum_start)::int
               FROM wrapped_ausgaben a
              WHERE a.organization_id = $1 AND a.wrapped_type = 'teamer'
           ) q
           WHERE jahr IS NOT NULL AND jahr <= $2
           ORDER BY jahr DESC`,
          [orgId, laufend]
        );

        const jahre = rows.map(r => ({ jahr: r.jahr, gesperrt: r.jahr >= laufend }));
        // Das laufende Jahr immer zeigen, auch wenn darin noch nichts liegt --
        // sonst fehlt der Hinweis "verfuegbar ab 1.1.<Folgejahr>" genau dann,
        // wenn jemand danach sucht.
        if (!jahre.some(j => j.jahr === laufend)) {
          jahre.unshift({ jahr: laufend, gesperrt: true });
        }

        res.json(jahre);
      } catch (err) {
        console.error('Database error in GET /wrapped/team-jahre:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    }
  );

  router.get('/ausgaben',
    rbacVerifier,
    requireAdmin,
    query('typ').optional().isIn(['konfi', 'teamer']),
    handleValidationErrors,
    async (req, res) => {
      try {
        const istOrgAdmin = ['org_admin', 'super_admin'].includes(req.user.role_name);
        const typ = req.query.typ || null;

        const { rows } = await db.query(
          `SELECT a.id, a.wrapped_type, a.jahrgang_id, j.name AS jahrgang_name,
                  a.titel, a.zeitraum_start, a.zeitraum_ende,
                  a.freigegeben_at, a.created_at,
                  COUNT(s.id)::int AS snapshots
             FROM wrapped_ausgaben a
             LEFT JOIN jahrgaenge j ON j.id = a.jahrgang_id
             LEFT JOIN wrapped_snapshots s ON s.ausgabe_id = a.id
            WHERE a.organization_id = $1
              AND ($2::text IS NULL OR a.wrapped_type = $2::text)
              AND (
                -- Teamer-Ausgaben nur fuer org_admin.
                (a.wrapped_type = 'teamer' AND $3::boolean)
                -- Konfi-Ausgaben: org_admin alle, Admin nur eigene Jahrgaenge.
                OR (a.wrapped_type = 'konfi' AND ($3::boolean OR EXISTS (
                      SELECT 1 FROM user_jahrgang_assignments uja
                       WHERE uja.user_id = $4 AND uja.jahrgang_id = a.jahrgang_id)))
              )
            GROUP BY a.id, j.name
            ORDER BY a.created_at DESC`,
          [req.user.organization_id, typ, istOrgAdmin, req.user.id]
        );

        // Als HEADER gemeldet, damit die Antwortform ein Array bleibt --
        // dasselbe Muster wie GET /admin/konfis, /events, /material und
        // /challenges (ALT-APP-VERTRAG).
        if (!istOrgAdmin) {
          const { rows: [zuweisung] } = await db.query(
            `SELECT 1 FROM user_jahrgang_assignments WHERE user_id = $1 LIMIT 1`,
            [req.user.id]
          );
          if (!zuweisung) res.set('X-Kein-Jahrgang-Zugewiesen', 'true');
        }

        res.json(rows.map(r => ({
          id: r.id,
          typ: r.wrapped_type,
          jahrgang_id: r.jahrgang_id,
          jahrgang_name: r.jahrgang_name,
          titel: r.titel,
          zeitraum_start: r.zeitraum_start,
          zeitraum_ende: r.zeitraum_ende,
          freigegeben: r.freigegeben_at !== null,
          freigegeben_at: r.freigegeben_at,
          snapshots: r.snapshots,
          created_at: r.created_at
        })));
      } catch (err) {
        console.error('Error listing wrapped ausgaben:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Rückblick-Ausgaben' });
      }
    }
  );

  // DELETE /teamer - Teamer-Wrapped-Snapshots der Organisation loeschen
  //
  // Der Loeschweg fuer Konfis haengt am Jahrgang (DELETE /:jahrgangId, unten).
  // Teamer-Snapshots werden ohne Jahrgang gespeichert (jahrgang_id IS NULL)
  // und waren damit ueber KEINE Route erreichbar: einmal erzeugt, blieben sie
  // fuer immer stehen -- auch wenn der Lauf fehlerhafte Zahlen erzeugt hatte.
  // Erneutes Generieren ueberschreibt zwar, hilft aber nicht bei Teamer:innen,
  // die inzwischen keine mehr sind.
  //
  // Eigene Route statt Erweiterung von DELETE /:jahrgangId: Dort ist der
  // Jahrgang die Bezugsgroesse, hier die Organisation. Das mit einem
  // Sonderwert im selben Pfad zu mischen, machte beide Wege unklar.
  //
  // OHNE `year` bleibt es beim bisherigen Verhalten (alle Jahre): Die
  // ausgelieferte Leitungsansicht ruft die Route ohne Parameter auf, und ein
  // stillschweigend geänderter Umfang wäre genau die Art Bruch, die man
  // erst bemerkt, wenn die Daten weg sind.
  router.delete('/teamer',
    rbacVerifier,
    requireOrgAdmin,
    query('year').optional().isInt({ min: 2000, max: 2100 }),
    handleValidationErrors,
    async (req, res) => {
      try {
        const jahr = req.query.year ? parseInt(req.query.year, 10) : null;
        const { rowCount } = await db.query(
          `DELETE FROM wrapped_snapshots
           WHERE wrapped_type = 'teamer' AND organization_id = $1
             AND ($2::int IS NULL OR year = $2::int)`,
          [req.user.organization_id, jahr]
        );
        res.json({ message: `${rowCount} Wrapped-Snapshots gel\u00f6scht`, deleted: rowCount });
      } catch (err) {
        console.error('Error deleting teamer wrapped snapshots:', err);
        res.status(500).json({ error: 'Fehler beim L\u00f6schen der Wrapped-Snapshots' });
      }
    }
  );

  // DELETE /:jahrgangId - Wrapped-Snapshots für einen Jahrgang löschen
  router.delete('/:jahrgangId',
    rbacVerifier,
    requireOrgAdmin,
    param('jahrgangId').isInt({ min: 1 }),
    handleValidationErrors,
    async (req, res) => {
      const client = await db.getClient();
      try {
        const jahrgangId = parseInt(req.params.jahrgangId, 10);

        // Jahrgang validieren
        const { rows: [jahrgang] } = await client.query(
          `SELECT id FROM jahrgaenge WHERE id = $1 AND organization_id = $2`,
          [jahrgangId, req.user.organization_id]
        );
        if (!jahrgang) {
          return res.status(404).json({ error: 'Jahrgang nicht gefunden' });
        }

        await client.query('BEGIN');

        const { rowCount } = await client.query(
          `DELETE FROM wrapped_snapshots
           WHERE jahrgang_id = $1 AND organization_id = $2 AND wrapped_type = 'konfi'`,
          [jahrgangId, req.user.organization_id]
        );

        await client.query(
          `UPDATE jahrgaenge SET wrapped_released_at = NULL WHERE id = $1`,
          [jahrgangId]
        );

        await client.query('COMMIT');
        res.json({ message: `${rowCount} Wrapped-Snapshots gel\u00f6scht`, deleted: rowCount });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error deleting wrapped snapshots:', err);
        res.status(500).json({ error: 'Fehler beim L\u00f6schen der Wrapped-Snapshots' });
      } finally {
        client.release();
      }
    }
  );

  // GET /history/:userId - Alle Wrapped-Snapshots eines Users
  router.get('/history/:userId',
    rbacVerifier,
    param('userId').isInt({ min: 1 }),
    handleValidationErrors,
    async (req, res) => {
      try {
        const targetUserId = parseInt(req.params.userId, 10);
        // Sicherheitspruefung: Nur eigene Daten ODER Admin der gleichen Org
        const roleName = req.user.role_name;
        if (req.user.id !== targetUserId) {
          if (roleName !== 'admin' && roleName !== 'org_admin') {
            return res.status(403).json({ error: 'Keine Berechtigung' });
          }
          // Admin: Pruefen ob User zur gleichen Org gehört
          const { rows: [targetUser] } = await db.query(
            `SELECT u.organization_id, r.name AS role_name
             FROM users u LEFT JOIN roles r ON u.role_id = r.id
             WHERE u.id = $1`, [targetUserId]
          );
          if (!targetUser || targetUser.organization_id !== req.user.organization_id) {
            return res.status(403).json({ error: 'Keine Berechtigung' });
          }

          if (targetUser.role_name === 'konfi') {
            const zugriff = await darfKonfi(db, req, targetUserId);
            if (!zugriff.erlaubt) {
              return res.status(403).json({ error: 'Keine Berechtigung' });
            }
          }
        }

        // Die Route liefert schon immer ALLE Snapshots einer Person -- mit
        // mehreren Ausgaben je Jahrgang waren die aber nicht mehr
        // auseinanderzuhalten: "2026" stand dann dreimal da. Der Titel macht
        // sie unterscheidbar ("Dein erstes Jahr", "Zwischenstand").
        //
        // Die Leitung sieht hier bewusst AUCH nicht freigegebene Ausgaben --
        // sie muss vor dem Freigeben hineinsehen koennen. Fuer die Person
        // selbst filtert GET /meine auf freigegeben.
        //
        // Rechte bleiben unveraendert (Pruefung oben): Admin nur eigene
        // Jahrgaenge, Teamer:innen frei, org_admin alles.
        const { rows } = await db.query(
          `SELECT s.id, s.wrapped_type, s.year, s.data, s.computed_at,
                  a.id AS ausgabe_id,
                  COALESCE(a.titel, 'Rückblick ' || s.year::text) AS titel,
                  a.freigegeben_at
             FROM wrapped_snapshots s
             LEFT JOIN wrapped_ausgaben a ON a.id = s.ausgabe_id
            WHERE s.user_id = $1
            ORDER BY COALESCE(a.freigegeben_at, s.computed_at) DESC,
                     s.year DESC, s.wrapped_type`,
          [targetUserId]
        );

        res.json(rows);
      } catch (err) {
        console.error('Error loading wrapped history:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Wrapped-Historie' });
      }
    }
  );

  // ====================================================================
  // BATCH-GENERIERUNG (für backgroundService Cron)
  // ====================================================================

  // Sie war toter Code: Im ganzen Repo gab es genau eine Fundstelle, ihre
  // eigene Definition -- kein Aufrufer, kein Test. Ihr Kommentar behauptete
  // "Wird vom Cron oder Admin-Endpoint aufgerufen"; der Cron
  // (backgroundService.js) ruft ausschliesslich generateAllTeamerWrapped, und
  // die Leitung geht ueber POST /wrapped/generate/:jahrgangId.
  //
  // Wer die Sache braucht: POST /wrapped/generate/:jahrgangId weiter oben
  // macht dasselbe richtig -- mit einer eigenen Ausgabe je Lauf
  // (Migration 144), die jedes Mal benachrichtigt.

  /**
   * Erzeugt den TEAM-Rueckblick eines abgeschlossenen Kalenderjahres fuer
   * alle Teamer:innen einer Organisation. Aufgerufen vom Cron am 6. Januar
   * (backgroundService) -- derselbe Vorgang, den die Leitung ueber
   * POST /generate-teamer von Hand ausloest.
   *
   * IDEMPOTENT: Gibt es fuer diese Organisation schon eine Team-Ausgabe
   * ueber genau dieses Kalenderjahr, passiert NICHTS -- kein zweiter
   * Datensatz, kein zweiter Push. Das ist die entscheidende Eigenschaft:
   * Der Cron kann nach einem Neustart am selben Tag erneut feuern, und die
   * Leitung kann den Rueckblick vorher schon von Hand erzeugt haben.
   * Erkannt wird das am ZEITRAUM der Ausgabe, nicht an einem Zaehler --
   * der Zeitraum ist die Sache selbst.
   *
   * @param {object} dbRef  Datenbank-Pool
   * @param {number} orgId  Organisation
   * @param {number} jahr   das abgeschlossene Kalenderjahr
   * @returns {Promise<{generated: number, errors: number, uebersprungen?: boolean}>}
   */
  router.generateAllTeamerWrapped = async (dbRef, orgId, jahr) => {
    const zeitraum = teamerJahresZeitraum(jahr);
    const client = await dbRef.getClient();
    try {
      // Doppelte Anlage verhindern -- VOR der Transaktion, damit ein
      // uebersprungener Lauf gar nichts anfasst.
      const { rows: [schonDa] } = await client.query(
        `SELECT id FROM wrapped_ausgaben
          WHERE organization_id = $1 AND wrapped_type = 'teamer'
            AND zeitraum_start = $2::date AND zeitraum_ende = $3::date
          LIMIT 1`,
        [orgId, zeitraum.start, zeitraum.ende]
      );
      if (schonDa) {
        return { generated: 0, errors: 0, uebersprungen: true };
      }

      await client.query('BEGIN');

      const { rows: teamers } = await client.query(
        `SELECT u.id as user_id FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name = 'teamer' AND u.organization_id = $1`,
        [orgId]
      );

      // Die Ausgabe zuerst -- ihre id gehoert seit Migration 144 zum
      // Schluessel der Snapshots.
      //
      // FREIGEGEBEN AB DEM ERSTEN MOMENT: Der automatische Lauf hat niemanden,
      // der ihn nachtraeglich freischaltet. Waere er es nicht, saehe ihn
      // niemand -- und der ganze Zweck der Automatik waere dahin.
      const { rows: [ausgabe] } = await client.query(
        `INSERT INTO wrapped_ausgaben
           (organization_id, wrapped_type, jahrgang_id, titel,
            zeitraum_start, zeitraum_ende, freigegeben_at)
         VALUES ($1, 'teamer', NULL, $2, $3::date, $4::date, NOW())
         RETURNING id`,
        [orgId, `Team-Rückblick ${jahr}`, zeitraum.start, zeitraum.ende]
      );

      let generated = 0;
      let errors = 0;

      // Ein SAVEPOINT je Person -- dieselbe zweite Verteidigungslinie wie im
      // manuellen Weg (POST /generate-teamer). Ohne ihn reisst ein Fehler bei
      // der ersten Person alle folgenden mit.
      for (const teamer of teamers) {
        try {
          await mitSavepoint(client, 'teamer_snapshot', async () => {
            const snapshot = await generateTeamerSnapshot(client, teamer.user_id, orgId, jahr, zeitraum, null);
            await client.query(
              `INSERT INTO wrapped_snapshots (user_id, organization_id, wrapped_type, year, ausgabe_id, data, computed_at)
               VALUES ($1, $2, 'teamer', $3, $4, $5, NOW())
               ON CONFLICT (user_id, wrapped_type, year, COALESCE(jahrgang_id, 0), COALESCE(ausgabe_id, 0))
               DO UPDATE SET data = EXCLUDED.data, computed_at = NOW(), organization_id = EXCLUDED.organization_id`,
              [teamer.user_id, orgId, jahr, ausgabe.id, JSON.stringify(snapshot)]
            );
          });
          generated++;
        } catch (err) {
          console.error(`Wrapped-Cron: Teamer ${teamer.user_id} Fehler:`, err.message);
          errors++;
        }
      }

      // Kein Snapshot, kein Rueckblick: zurueckrollen statt eine leere
      // Ausgabe festzuschreiben und das ganze Team zu benachrichtigen. Der
      // Cron hat kein res -- er wirft, damit der Aufrufer (backgroundService)
      // den Fehlschlag protokolliert, statt ihn als Erfolg zu buchen. Und
      // weil nichts geschrieben wurde, kann der naechste Lauf es erneut
      // versuchen.
      if (teamers.length > 0 && generated === 0) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Team-Rückblick ${jahr} (Organisation ${orgId}): kein einziger Snapshot erzeugt, ${errors} Fehler`);
      }

      await client.query('COMMIT');

      // Push (fire-and-forget)
      try {
        const teamerIds = teamers.map(t => t.user_id);
        await PushService.sendWrappedReleased(dbRef, teamerIds, 'teamer', orgId);
      } catch (pushErr) {
        console.error('Wrapped-Cron Push fehlgeschlagen:', pushErr);
      }

      return { generated, errors };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  return router;
};
