-- Zaehlung der Buchungen: Leitung gehoert auf die TEAM-Seite.
--
-- Seit die Leitung sich einem Termin zuordnen kann (wie eine Teamer:in,
-- bewusst pro Termin, um in den Chat zum Termin zu kommen), stimmte die
-- Aufteilung dieser View nicht mehr: Sie trennte nach "ist Teamer" / "ist
-- kein Teamer" — eine zugeordnete Leitung landete damit in den konfi_*-
-- Spalten. Folge: Sie belegte einen Konfi-Platz, tauchte in der Konfi-Liste
-- auf und wurde als Kind gezaehlt.
--
-- Die Trennung laeuft ab hier nach "ist Konfi" / "ist kein Konfi". Die
-- Spaltennamen und ihre Bedeutung bleiben:
--   konfi_*  = ausschliesslich Konfis
--   teamer_* = das TEAM-Kontingent, also Teamer:innen UND zugeordnete Leitung
--
-- Reine Sichtdefinition: Es werden KEINE Buchungen und KEINE Chat-Teilnehmer
-- veraendert. Bestehende Termine zaehlen nur dann anders, wenn dort bereits
-- eine Leitung gebucht war — und dann zaehlen sie ab jetzt richtig.
CREATE OR REPLACE VIEW event_booking_stats AS
SELECT
  eb.event_id,
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
  COUNT(*) FILTER (WHERE eb.status <> 'opted_out')::int AS gebucht_gesamt
FROM event_bookings eb
-- INNER JOIN wie bisher: Eine Buchung ohne lebendes Konto zaehlt nirgends
-- mit. Die Rolle ist danach nie NULL, ausser die Rollenzeile fehlt — dann
-- faellt die Buchung auf die Team-Seite und nicht stillschweigend zu den
-- Konfis (bei denen sie ein Kontingent belegen wuerde).
JOIN users u ON eb.user_id = u.id AND u.deleted_at IS NULL
LEFT JOIN roles r ON u.role_id = r.id
GROUP BY eb.event_id;
