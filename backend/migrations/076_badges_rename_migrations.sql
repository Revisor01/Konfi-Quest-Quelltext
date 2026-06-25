-- ====================================================================
-- Migration 076: Badges/Activities Tabellen- und Spalten-Renames
-- aus backend/routes/badges.js runMigrations() ausgelagert
--
-- Alle Statements sind idempotent (DO-Bloecke mit Existenz-Checks).
-- ====================================================================

-- 1. konfi_badges -> user_badges (nur wenn alte Tabelle noch existiert und neue nicht)
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables WHERE table_name = 'konfi_badges'
  ) AND NOT EXISTS (
    SELECT FROM information_schema.tables WHERE table_name = 'user_badges'
  ) THEN
    ALTER TABLE konfi_badges RENAME TO user_badges;
    RAISE NOTICE 'Migration: konfi_badges -> user_badges';
  END IF;
END $$;

-- 2. konfi_activities -> user_activities (nur wenn alte Tabelle noch existiert und neue nicht)
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables WHERE table_name = 'konfi_activities'
  ) AND NOT EXISTS (
    SELECT FROM information_schema.tables WHERE table_name = 'user_activities'
  ) THEN
    ALTER TABLE konfi_activities RENAME TO user_activities;
    RAISE NOTICE 'Migration: konfi_activities -> user_activities';
  END IF;
END $$;

-- 3. user_badges: konfi_id -> user_id (nur wenn Spalte noch konfi_id heisst)
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_name = 'user_badges' AND column_name = 'konfi_id'
  ) THEN
    ALTER TABLE user_badges RENAME COLUMN konfi_id TO user_id;
    RAISE NOTICE 'Migration: user_badges.konfi_id -> user_id';
  END IF;
END $$;

-- 4. user_activities: konfi_id -> user_id (nur wenn Spalte noch konfi_id heisst)
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_name = 'user_activities' AND column_name = 'konfi_id'
  ) THEN
    ALTER TABLE user_activities RENAME COLUMN konfi_id TO user_id;
    RAISE NOTICE 'Migration: user_activities.konfi_id -> user_id';
  END IF;
END $$;

-- 5. user_badges: earned_at -> awarded_date (nur wenn Spalte noch earned_at heisst)
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_name = 'user_badges' AND column_name = 'earned_at'
  ) THEN
    ALTER TABLE user_badges RENAME COLUMN earned_at TO awarded_date;
    RAISE NOTICE 'Migration: user_badges.earned_at -> awarded_date';
  END IF;
END $$;

-- 6. activities: target_role Spalte hinzufuegen (idempotent)
ALTER TABLE activities ADD COLUMN IF NOT EXISTS target_role VARCHAR(10) DEFAULT 'konfi';

-- 7. custom_badges: target_role Spalte hinzufuegen (idempotent)
ALTER TABLE custom_badges ADD COLUMN IF NOT EXISTS target_role VARCHAR(10) DEFAULT 'konfi';

-- 8. UNIQUE Constraint auf user_activities entfernen (idempotent via DO-Block)
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN (
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_name = 'user_activities' AND constraint_type = 'UNIQUE'
  ) LOOP
    EXECUTE 'ALTER TABLE user_activities DROP CONSTRAINT IF EXISTS "' || c.constraint_name || '"';
    RAISE NOTICE 'Migration: Dropped UNIQUE constraint % from user_activities', c.constraint_name;
  END LOOP;
END $$;
