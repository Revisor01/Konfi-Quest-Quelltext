-- settings bekommt einen Primaerschluessel
--
-- WELCHER WERT GEWINNT: Der Code liest settings ausschliesslich je Gemeinde
-- (WHERE organization_id = $1 in routes/settings.js, routes/konfi.js,
-- routes/teamer.js, services/losungService.js) und schreibt ebenso
-- (ON CONFLICT (organization_id, key), organization_id aus dem Konto --
-- users.organization_id ist NOT NULL). Eine Zeile ohne Gemeinde liest also
-- keine Stelle: Sie gewinnt nie. Die Migration entfernt sie; fuer die
-- Gemeinden aendert sich kein gelesener Wert. Doppelungen MIT Gemeinde
-- verhinderte das bestehende UNIQUE schon immer.
--
-- ALTE SERVER-FASSUNGEN (rollender Deploy, backend-test): Sie schreiben mit
-- ON CONFLICT (organization_id, key); der Primaerschluessel ist genau dieser
-- eindeutige Index, das Speichern geht weiter. Keine Antwortform aendert
-- sich.
--
-- SPERRE: settings hat je Gemeinde eine Handvoll Zeilen (Lastbestand mit 200
-- Gemeinden: 1.000 Zeilen, Migration 23-50 ms in drei Laeufen); ACCESS
-- EXCLUSIVE fuer diese Dauer.
--
-- IDEMPOTENT: DELETE findet beim zweiten Lauf nichts, SET NOT NULL ist ohne
-- Wirkung, der Primaerschluessel wird nur angelegt, wenn es keinen gibt.

DELETE FROM settings WHERE organization_id IS NULL;

ALTER TABLE settings ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.settings'::regclass AND contype = 'p') THEN
    IF to_regclass('public.uq_settings_org_key') IS NOT NULL THEN
      -- Den vorhandenen eindeutigen Index uebernehmen statt einen dritten
      -- anzulegen; er heisst danach settings_pkey.
      ALTER TABLE settings ADD CONSTRAINT settings_pkey PRIMARY KEY USING INDEX uq_settings_org_key;
    ELSE
      ALTER TABLE settings ADD CONSTRAINT settings_pkey PRIMARY KEY (organization_id, key);
    END IF;
  END IF;
END $$;

-- Der zweite, gleiche UNIQUE (064) ist neben dem Primaerschluessel ueberfluessig.
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_org_key_unique;
DROP INDEX IF EXISTS uq_settings_org_key;
