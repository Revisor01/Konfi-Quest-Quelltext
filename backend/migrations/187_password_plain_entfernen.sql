-- konfi_profiles.password_plain entfaellt
--
-- SPERRE: DROP COLUMN aendert nur den Katalog (ACCESS EXCLUSIVE fuer
-- Millisekunden), die Zeilen werden nicht umgeschrieben. Der CHECK aus 176
-- haengt an der Spalte und geht mit.
--
-- IDEMPOTENT: IF EXISTS.

ALTER TABLE konfi_profiles DROP COLUMN IF EXISTS password_plain;
