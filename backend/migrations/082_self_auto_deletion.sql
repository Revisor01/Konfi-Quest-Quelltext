-- Migration 082: Fundament Self-/Auto-Loeschung (DSGVO/DSG-EKD)
-- Fuegt Soft-Delete-Spalten auf users hinzu und macht
-- jahrgaenge.confirmation_date nach Backfill zum Pflichtfeld.
-- Alle Statements sind idempotent (IF NOT EXISTS / IF EXISTS), die Datei
-- wird vom Migration-Runner in einem einzigen pool.query ausgefuehrt.

-- 1. Soft-Delete-Spalten auf users
--    archived_at = Zeitpunkt der Soft-Loeschung (Tag 60, User wird unsichtbar)
--    deleted_at  = Marker fuer Unsichtbarkeit, wird ab Tag 60 gesetzt.
--    Beide Spalten erlauben dem Cron-Job die Unterscheidung von
--    Tag-60-Archivierung und Tag-120-Hard-Delete.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL;

-- 2. Partieller Index fuer Filter-Performance (nur aktive, nicht geloeschte User)
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users (deleted_at) WHERE deleted_at IS NULL;

-- 3. confirmation_date NOT NULL mit Backfill.
--    Bestehende Jahrgaenge ohne Datum bekommen created_at als Fallback,
--    damit der NOT NULL-Constraint nicht fehlschlaegt. created_at existiert
--    immer (DEFAULT CURRENT_TIMESTAMP), so bleibt die Auto-Loesch-Frist
--    konservativ und springt nie in die Vergangenheit.
UPDATE jahrgaenge SET confirmation_date = COALESCE(confirmation_date, created_at::date) WHERE confirmation_date IS NULL;
ALTER TABLE jahrgaenge ALTER COLUMN confirmation_date SET NOT NULL;
