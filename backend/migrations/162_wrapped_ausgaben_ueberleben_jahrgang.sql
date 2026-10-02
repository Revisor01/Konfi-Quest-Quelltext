-- 162: Konfi-Rückblicke überleben das Löschen ihres Jahrgangs
--
-- Vor 143 hing der Snapshot selbst mit ON DELETE SET NULL am Jahrgang und
-- überlebte (wrapped_snapshots_jahrgang_id_fkey, unverändert). Dieselbe
-- Regel gilt jetzt für die Ausgabe.
--
-- ADDITIV: Kein Datenverlust, keine Spalte ändert Typ oder Form. Nur die
-- Löschregel des Fremdschlüssels und die CHECK-Bedingung ändern sich:
-- eine Konfi-Ausgabe DARF jahrgangslos werden (nach dem Löschen), eine
-- Teamer-Ausgabe bleibt jahrgangslos. Der Name des Fremdschlüssels wurde in
-- 143 nicht vergeben (Inline-REFERENCES), Postgres hat ihn selbst gewählt —
-- deshalb wird er hier nachgeschlagen statt geraten. Der Läufer führt jede
-- Datei in einer Transaktion aus (database.js), ALTER TABLE ist darin erlaubt.

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT c.conname INTO fk_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
   WHERE t.relname = 'wrapped_ausgaben'
     AND c.contype = 'f'
     AND a.attname = 'jahrgang_id'
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE wrapped_ausgaben DROP CONSTRAINT %I', fk_name);
  END IF;

  ALTER TABLE wrapped_ausgaben
    ADD CONSTRAINT wrapped_ausgaben_jahrgang_id_fkey
    FOREIGN KEY (jahrgang_id) REFERENCES jahrgaenge(id) ON DELETE SET NULL;
END $$;

ALTER TABLE wrapped_ausgaben DROP CONSTRAINT IF EXISTS wrapped_ausgaben_jahrgang_passt;

-- Konfi-Ausgabe: mit Jahrgang angelegt, darf ihn durch dessen Löschung
-- verlieren. Teamer-Ausgabe: nie an einem Jahrgang.
ALTER TABLE wrapped_ausgaben
  ADD CONSTRAINT wrapped_ausgaben_jahrgang_passt CHECK (
    wrapped_type = 'konfi' OR
    (wrapped_type = 'teamer' AND jahrgang_id IS NULL)
  );

COMMENT ON CONSTRAINT wrapped_ausgaben_jahrgang_passt ON wrapped_ausgaben IS
  'Konfi-Ausgaben entstehen mit Jahrgang und dürfen ihn durch Löschen des Jahrgangs verlieren (ON DELETE SET NULL, Migration 162); Teamer-Ausgaben sind organisationsweit und tragen keinen.';
