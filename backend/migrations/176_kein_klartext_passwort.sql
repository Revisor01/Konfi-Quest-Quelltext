-- In konfi_profiles.password_plain kann kein Klartext mehr landen
--
-- Ab hier laesst ein CHECK nur NULL zu, und keine Code-Stelle nennt die
-- Spalte mehr (die letzte, ein Leeren in regenerate-password, ist mit
-- diesem Stand entfernt). Keine API-Antwort gab die Spalte seit Maerz 2026
-- zurueck; die Store-App 2.2.0 liest sie nicht.
--
-- SPERRE: ADD CONSTRAINT prueft jede Zeile unter ACCESS EXCLUSIVE.
-- Lastbestand (16.000 Profile): 9-24 ms in drei Laeufen.
--
-- IDEMPOTENT: UPDATE findet beim zweiten Lauf nichts, der CHECK wird nur
-- angelegt, wenn es ihn nicht gibt.

-- Seit Migration 187 gibt es die Spalte nicht mehr; ein zweiter
-- Lauf der Kette trifft dann nichts (migrationenIdempotent.test.js).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'konfi_profiles'
               AND column_name = 'password_plain') THEN
    UPDATE konfi_profiles SET password_plain = NULL WHERE password_plain IS NOT NULL;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.konfi_profiles'::regclass
                     AND conname = 'konfi_profiles_password_plain_leer') THEN
      ALTER TABLE konfi_profiles
        ADD CONSTRAINT konfi_profiles_password_plain_leer CHECK (password_plain IS NULL);
    END IF;
  END IF;
END $$;
