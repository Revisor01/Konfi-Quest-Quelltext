-- 154_event_booking_stats_abmeldung.sql
--
-- DIE ZAEHL-SICHT LERNT DIE ABMELDUNG (Fortsetzung von Migration 153).
--
-- Seit 153 traegt eine von der Leitung abgemeldete Buchung status = 'excused'.
-- event_booking_stats (Migration 136) kennt diesen Wert noch nicht. Sechs der
-- neun Zaehlungen kommen damit von selbst zurecht, drei nicht -- und eine
-- Spalte fehlt ganz.
--
-- ALLE NEUN, EINZELN GEPRUEFT:
--
--   konfi_confirmed / teamer_confirmed   (status = 'confirmed')
--     Richtig OHNE Aenderung -- und genau hier liegt der eigentliche Fix:
--     Eine abgemeldete Buchung steht nicht mehr auf 'confirmed' und faellt
--     damit aus der Kapazitaet heraus. Der Platz wird frei, wie bei
--     'opted_out'. Das ist der Zweck der ganzen Uebung, nicht ein
--     Nebeneffekt.
--
--   konfi_waitlist / teamer_waitlist     (status = 'waitlist')
--     Richtig ohne Aenderung, gleiche Begruendung.
--
--   konfi_offen / teamer_offen           (confirmed UND attendance_status IS NULL)
--     Richtig ohne Aenderung, doppelt abgesichert sogar: Eine Abmeldung steht
--     weder auf 'confirmed' noch auf attendance_status NULL. "Offen" heisst
--     "muss noch verbucht werden" -- eine abgemeldete Person ist verbucht.
--
--   konfi_opted_out / teamer_opted_out   (status = 'opted_out')
--     BLEIBT, WIE ES IST -- bewusst. 'opted_out' ist die SELBSTabmeldung
--     (Konfi-Opt-out vom Pflichttermin, Teamer-Absage). 'excused' ist die
--     Abmeldung DURCH die Leitung. Zwei verschiedene Vorgaenge von zwei
--     verschiedenen Personen; sie in einen Zaehler zu werfen hiesse, die
--     Unterscheidung wieder aufzugeben, die Migration 147 eingefuehrt hat.
--     Stattdessen bekommt 'excused' eigene Zaehler (siehe unten).
--
--   gebucht_gesamt                       (status <> 'opted_out')
--     MUSS MIT -- der einzige echte Fehler in der bestehenden Sicht. Die
--     Spalte meint "wie viele Buchungen belegen hier etwas". Ohne die
--     Ergaenzung zaehlte sie eine abgemeldete Person weiter mit, obwohl ihr
--     Platz frei ist. Aus `<> 'opted_out'` wird `NOT IN ('opted_out',
--     'excused')`: dieselbe Regel, zwei Werte.
--
-- ZWEI NEUE SPALTEN, rein additiv:
--
--   konfi_excused / teamer_excused
--
-- Sie sind kein Beiwerk: routes/events/lesen.js rechnet total_participants
-- als `gebucht_gesamt + konfi_opted_out + teamer_opted_out` -- "alle
-- Buchungen, auch die abgemeldeten". Nimmt gebucht_gesamt die 'excused'
-- heraus und gibt es keine Spalte, die sie wieder hereinholt, faellt diese
-- Zahl still. Mit den beiden neuen Spalten bleibt sie vollstaendig.
--
-- KEINE SPALTE ENTFAELLT, KEINE AENDERT IHRE BEDEUTUNG. Ein Aufrufer, der
-- die neuen Spalten nicht kennt, sieht dieselben Zahlen wie vorher -- mit
-- der einen gewollten Ausnahme von gebucht_gesamt, die der Punkt der
-- Aenderung ist.
--
-- REINE SICHTDEFINITION: Es werden keine Buchungen veraendert. Die Daten
-- wandern in Migration 153; hier lernt nur die Zaehlung sie zu lesen.

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
  -- Eine Abmeldung durch die Leitung gibt den Platz frei, genau wie eine
  -- Selbstabmeldung. Deshalb hier heraus.
  COUNT(*) FILTER (WHERE eb.status NOT IN ('opted_out', 'excused'))::int AS gebucht_gesamt,
  -- NEU (Migration 154): die von der Leitung Abgemeldeten, getrennt nach
  -- Kontingent-Seite und getrennt von den Selbstabmeldungen.
  COUNT(*) FILTER (
    WHERE eb.status = 'excused' AND r.name = 'konfi'
  )::int AS konfi_excused,
  COUNT(*) FILTER (
    WHERE eb.status = 'excused' AND COALESCE(r.name, '') <> 'konfi'
  )::int AS teamer_excused
FROM event_bookings eb
-- INNER JOIN wie bisher: Eine Buchung ohne lebendes Konto zaehlt nirgends
-- mit. Die Rolle ist danach nie NULL, ausser die Rollenzeile fehlt — dann
-- faellt die Buchung auf die Team-Seite und nicht stillschweigend zu den
-- Konfis (bei denen sie ein Kontingent belegen wuerde).
JOIN users u ON eb.user_id = u.id AND u.deleted_at IS NULL
LEFT JOIN roles r ON u.role_id = r.id
GROUP BY eb.event_id;
