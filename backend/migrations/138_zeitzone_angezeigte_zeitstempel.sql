-- 138_zeitzone_angezeigte_zeitstempel.sql
--
-- Drei Zeitstempel-Spalten, die Nutzer:innen ANGEZEIGT werden, bekommen eine
-- Zeitzone. Bisher sind sie `timestamp without time zone`, waehrend die
-- Spalten direkt daneben (z.B. event_bookings.booking_date) `timestamptz`
-- sind.
--
-- Der Fehler in der Oberflaeche: Node serialisiert einen Wert ohne Zone zu
-- einem ISO-String und haengt faelschlich ein `Z` an. Das Frontend liest das
-- als UTC und rechnet die Berliner Sommerzeit noch einmal obendrauf. Eine
-- Abmeldung um 12:34 Uhr steht dann als 14:34 Uhr in der Teilnehmerliste.
--
-- BESTANDSWERTE SIND BERLINER ZEIT und muessen als solche gelesen werden.
-- `AT TIME ZONE 'Europe/Berlin'` interpretiert den naiven Wert in Berliner
-- Zone und liefert den zugehoerigen absoluten Zeitpunkt -- die angezeigte
-- Wandzeit bleibt damit exakt dieselbe, nur ist sie jetzt eindeutig. Ein
-- blosses `USING spalte AT TIME ZONE 'UTC'` waere falsch und wuerde die
-- Werte um zwei Stunden verschieben.
--
-- Warum genau diese drei und nicht alle 29 Spalten ohne Zone: Die uebrigen 26
-- dienen ausschliesslich internen Vergleichen (refresh_tokens.expires_at,
-- users.deleted_at, event_reminders.sent_at ...). Sie werden mit NOW() aus
-- derselben Datenbank geschrieben und in SQL gegen NOW() geprueft --
-- derselbe Massstab auf beiden Seiten, also folgenlos. Nur was jemand liest,
-- wird hier angefasst.

ALTER TABLE event_unregistrations
  ALTER COLUMN unregistered_at TYPE timestamptz
  USING unregistered_at AT TIME ZONE 'Europe/Berlin';

ALTER TABLE organizations
  ALTER COLUMN trial_ends_at TYPE timestamptz
  USING trial_ends_at AT TIME ZONE 'Europe/Berlin';

ALTER TABLE wrapped_snapshots
  ALTER COLUMN computed_at TYPE timestamptz
  USING computed_at AT TIME ZONE 'Europe/Berlin';
