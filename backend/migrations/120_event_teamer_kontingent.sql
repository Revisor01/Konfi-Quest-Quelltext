-- 120_event_teamer_kontingent.sql
-- Teamer-Kontingent mit eigener Warteliste, strikt getrennt vom Konfi-Kontingent.
--
-- Bisher wurden Teamer-Anmeldungen immer hart als 'confirmed' eingetragen: keine
-- Kapazitaetsgrenze, keine Warteliste. Ab jetzt hat ein Event ein zweites,
-- unabhaengiges Kontingent nur fuer Teamer:innen. Konfi- und Teamer-Plaetze
-- beeinflussen sich NIE gegenseitig — insbesondere rueckt niemals ein Teamer
-- auf einen frei gewordenen Konfi-Platz nach (und umgekehrt).
--
-- Konvention wie bei max_participants: 0 = unbegrenzt. Der Default 0 sorgt
-- dafuer, dass sich alle Bestands-Events exakt wie bisher verhalten
-- (Teamer-Anmeldung immer confirmed).
--
-- Das Anmeldefenster (registration_opens_at/closes_at) gilt bewusst weiterhin
-- NICHT fuer Teamer:innen — die duerfen sich jederzeit anmelden.

ALTER TABLE events ADD COLUMN IF NOT EXISTS teamer_max_participants INTEGER NOT NULL DEFAULT 0 CHECK (teamer_max_participants >= 0);
ALTER TABLE events ADD COLUMN IF NOT EXISTS teamer_waitlist_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE events ADD COLUMN IF NOT EXISTS teamer_max_waitlist_size INTEGER NOT NULL DEFAULT 10 CHECK (teamer_max_waitlist_size >= 0);
