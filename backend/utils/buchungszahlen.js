// backend/utils/buchungszahlen.js
//
// Die Buchungszahlen EINES Termins als SQL, fuer die Terminlisten.
//
// WARUM:
// Die Listen (GET /events, GET /events/cancelled, GET /konfi/events, die
// Serienliste im Termindetail) lasen ihre Zahlen per LATERAL bzw. LEFT JOIN
// aus der Sicht event_booking_stats. Die Sicht gruppiert event_bookings ueber
// ALLE Buchungen ALLER Gemeinden; mit einer konstanten Termin-ID schiebt der
// Planer den Filter in die Gruppierung (0,1 ms), im Join gegen eine Terminliste
// aber nicht: Er berechnet die ganze Sicht (HashAggregate ueber 100.000
// Buchungen, Seq Scan auf event_bookings UND users) und prueft dann gegen die
// 50 Termine der Gemeinde. Gemessen auf kq_last (100.000 Buchungen, 20.000
// Nutzer:innen): 77 ms (LATERAL) bzw. 62 ms (LEFT JOIN) je Listenaufruf --
// dieselben Zahlen als Aggregat direkt auf event_bookings je Termin: 2,0 ms.
// Die Kosten der Liste hingen an der Summe aller Buchungen aller Gemeinden,
// nicht an der eigenen.
//
// WAS HIER STEHT: dieselbe Zaehlung wie die Sicht (Migration 154), Spalte fuer
// Spalte, Bedingung fuer Bedingung -- nur mit `WHERE eb.event_id = <Termin>`
// INNERHALB des Aggregats. Ohne GROUP BY liefert ein Aggregat immer genau
// eine Zeile; ein Termin ohne Buchung bekommt Nullen statt keiner Zeile. Die
// Routen COALESCEn aussen ohnehin auf 0, die Antwort bleibt gleich.
//
// DIE SICHT BLEIBT die verbindliche Definition (bookingUtils.js, Migration
// 154) und wird von den Einzelabrufen (GET /events/:id, GET
// /konfi/events/:id/status) weiter gelesen -- dort schiebt der Planer den
// Filter, gemessen 0,1-0,16 ms. Wer die Zaehlung aendert, aendert BEIDE
// Stellen; tests/routes/terminlistenBuchungszahlen.test.js verlangt, dass
// jede Zahl der Listen mit der Sicht uebereinstimmt.

/**
 * SQL fuer eine abgeleitete Tabelle mit den Spalten von event_booking_stats
 * (ohne event_id) fuer genau einen Termin. Zu verwenden als
 * `LEFT JOIN LATERAL ${buchungszahlenJeTerminSql('e.id')} ebs ON true`
 * oder als FROM-Quelle innerhalb eines LATERAL.
 *
 * @param {string} terminId - SQL-Ausdruck fuer die Termin-ID (Standard 'e.id')
 * @returns {string} geklammerte Unterabfrage, ohne Alias
 */
function buchungszahlenJeTerminSql(terminId = 'e.id') {
  return `(
          SELECT
            COUNT(*) FILTER (
              WHERE eb.status = 'confirmed' AND r.name = 'konfi'
            )::int AS konfi_confirmed,
            COUNT(*) FILTER (
              WHERE eb.status = 'waitlist' AND r.name = 'konfi'
            )::int AS konfi_waitlist,
            COUNT(*) FILTER (
              WHERE eb.status = 'opted_out' AND r.name = 'konfi'
            )::int AS konfi_opted_out,
            COUNT(*) FILTER (
              WHERE eb.status = 'confirmed' AND eb.attendance_status IS NULL
                AND r.name = 'konfi'
            )::int AS konfi_offen,
            COUNT(*) FILTER (
              WHERE eb.status = 'confirmed' AND COALESCE(r.name, '') <> 'konfi'
            )::int AS teamer_confirmed,
            COUNT(*) FILTER (
              WHERE eb.status = 'waitlist' AND COALESCE(r.name, '') <> 'konfi'
            )::int AS teamer_waitlist,
            COUNT(*) FILTER (
              WHERE eb.status = 'opted_out' AND COALESCE(r.name, '') <> 'konfi'
            )::int AS teamer_opted_out,
            COUNT(*) FILTER (
              WHERE eb.status = 'confirmed' AND eb.attendance_status IS NULL
                AND COALESCE(r.name, '') <> 'konfi'
            )::int AS teamer_offen,
            COUNT(*) FILTER (WHERE eb.status NOT IN ('opted_out', 'excused'))::int AS gebucht_gesamt,
            COUNT(*) FILTER (
              WHERE eb.status = 'excused' AND r.name = 'konfi'
            )::int AS konfi_excused,
            COUNT(*) FILTER (
              WHERE eb.status = 'excused' AND COALESCE(r.name, '') <> 'konfi'
            )::int AS teamer_excused
          FROM event_bookings eb
          -- INNER JOIN wie in der Sicht: Eine Buchung ohne lebendes Konto
          -- zaehlt nirgends mit; fehlt die Rollenzeile, faellt die Buchung
          -- auf die Team-Seite.
          JOIN users u ON eb.user_id = u.id AND u.deleted_at IS NULL
          LEFT JOIN roles r ON u.role_id = r.id
          WHERE eb.event_id = ${terminId}
        )`;
}

module.exports = { buchungszahlenJeTerminSql };
