-- Migration 088: Ansprechpartner:in (Name) pro Organisation
-- Fuegt die nullbare Spalte organizations.contact_name hinzu.
--   contact_name IS NULL / '' = nicht angegeben (optional).
--   contact_name = <text>     = Name der Ansprechpartner:in (z.B. "Pastorin Müller").
-- Ergaenzt die bestehenden Kontaktfelder (contact_email, contact_phone, address).
-- Kein Backfill, kein DEFAULT. Idempotent (IF NOT EXISTS), Migration-Runner.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_name TEXT NULL;
