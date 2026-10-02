-- EINE Quelle für alle Buchungszahlen eines Termins.
--
-- Ab hier lesen alle Endpunkte aus dieser View. Wer eine Zahl braucht, nimmt
-- sie von hier — dann kann keine Stelle mehr eine eigene Bedeutung erfinden.
--
-- BEDEUTUNG DER SPALTEN (verbindlich):
--   konfi_*  zählt AUSSCHLIESSLICH Nicht-Teamer. Teamer haben seit
--            Migration 120 ein eigenes Kontingent und belegen keine
--            Konfi-Plätze.
--   teamer_* zählt AUSSCHLIESSLICH Teamer.
--   *_confirmed  = zugesagt und dabei
--   *_waitlist   = auf der Warteliste
--   *_opted_out  = ausdrücklich abgesagt. KEIN offener Fall: Das ist eine
--                  abgeschlossene Rückmeldung und gehört nicht in die Zahl
--                  der Teilnehmenden.
--   *_offen      = zugesagt, aber Anwesenheit noch nicht erfasst.
--                  Getrennt nach Rolle, weil "Alle bestätigen" nur Konfis
--                  verbucht — sonst klemmt ein Team-Termin dauerhaft im
--                  Verbuchen-Tab.
--   gebucht_gesamt = alles ausser Abgemeldeten. Für "gibt es hier überhaupt
--                    Buchungen".
--
-- Gelöschte Konten (users.deleted_at) zählen nirgends mit.
--
-- IDEMPOTENZ: Die View entsteht hier nur,
-- wenn es sie noch nicht gibt. Vorher scheiterte ein zweiter Lauf auf dem
-- heutigen Stand ("cannot drop columns from view", Migration 154 hat Spalten
-- ergaenzt) -- und auf dem Stand von 136 haette er die Zaehlung still auf
-- die alte Trennung Teamer/Nicht-Teamer zurueckgedreht. Vermerkte Staende
-- betrifft das nicht (der Migrationslauf vergleicht nur den Namen).
-- Waechter: tests/schema/migrationenIdempotent.test.js.
DO $migration$ BEGIN
  IF to_regclass('public.event_booking_stats') IS NULL THEN
    EXECUTE $view$
CREATE VIEW event_booking_stats AS
SELECT
  eb.event_id,
  COUNT(*) FILTER (
    WHERE eb.status = 'confirmed' AND COALESCE(r.name, '') <> 'teamer'
  )::int AS konfi_confirmed,
  COUNT(*) FILTER (
    WHERE eb.status = 'waitlist' AND COALESCE(r.name, '') <> 'teamer'
  )::int AS konfi_waitlist,
  COUNT(*) FILTER (
    WHERE eb.status = 'opted_out' AND COALESCE(r.name, '') <> 'teamer'
  )::int AS konfi_opted_out,
  COUNT(*) FILTER (
    WHERE eb.status = 'confirmed' AND eb.attendance_status IS NULL
      AND COALESCE(r.name, '') <> 'teamer'
  )::int AS konfi_offen,
  COUNT(*) FILTER (
    WHERE eb.status = 'confirmed' AND r.name = 'teamer'
  )::int AS teamer_confirmed,
  COUNT(*) FILTER (
    WHERE eb.status = 'waitlist' AND r.name = 'teamer'
  )::int AS teamer_waitlist,
  COUNT(*) FILTER (
    WHERE eb.status = 'opted_out' AND r.name = 'teamer'
  )::int AS teamer_opted_out,
  COUNT(*) FILTER (
    WHERE eb.status = 'confirmed' AND eb.attendance_status IS NULL
      AND r.name = 'teamer'
  )::int AS teamer_offen,
  COUNT(*) FILTER (WHERE eb.status <> 'opted_out')::int AS gebucht_gesamt
FROM event_bookings eb
-- INNER JOIN, nicht LEFT: Eine Buchung ohne lebendes Konto darf NICHT
-- mitzaehlen. Mit LEFT JOIN blieb die Zeile erhalten, die Rolle war NULL —
-- und COALESCE(r.name,'') <> 'teamer' ist fuer NULL wahr, die Buchung eines
-- geloeschten Kontos waere also als Konfi gezaehlt worden.
JOIN users u ON eb.user_id = u.id AND u.deleted_at IS NULL
LEFT JOIN roles r ON u.role_id = r.id
GROUP BY eb.event_id
$view$;
  END IF;
END $migration$;

-- Ohne diesen Index läuft die View bei jedem Aufruf über die ganze Tabelle.
CREATE INDEX IF NOT EXISTS idx_event_bookings_event_status
  ON event_bookings (event_id, status);
