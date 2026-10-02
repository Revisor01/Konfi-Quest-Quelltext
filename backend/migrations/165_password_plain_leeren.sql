-- Klartext-Passwoerter aus der SQLite-Zeit leeren
--
-- IDEMPOTENT: Ein zweiter Lauf findet keine Zeile mehr.

-- Seit Migration 187 gibt es die Spalte nicht mehr. Ein
-- zweiter Lauf der Kette (Neuinstallation, migrationenIdempotent.test.js)
-- trifft dann nichts statt mit "column does not exist" abzubrechen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'konfi_profiles'
               AND column_name = 'password_plain') THEN
    UPDATE konfi_profiles
       SET password_plain = NULL
     WHERE password_plain IS NOT NULL;
  END IF;
END $$;
