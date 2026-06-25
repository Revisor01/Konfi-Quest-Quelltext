-- 1. konfspruch_enabled: Pro Jahrgang steuerbare Konfispruch-Sichtbarkeit
--    (SPRUCH-07). DEFAULT true gewaehlt, damit bestehende Jahrgaenge
--    prod-konsistent zum 118-Stand bleiben: in Phase 118 war die Konfispruch-Card
--    ohne Gate immer sichtbar. Bestehende Konfis sehen die Card weiterhin,
--    Admins koennen sie ab jetzt pro Jahrgang gezielt ausblenden. Analog zum
--    bestehenden *_enabled-Muster aus Migration 064 (gottesdienst_enabled /
--    gemeinde_enabled).
--
-- 2. confirmation_date DROP NOT NULL: Migration 082 (082_self_auto_deletion.sql:24)
--    hat den Constraint ALTER COLUMN confirmation_date SET NOT NULL gesetzt. Ab
--    Phase 119 ist confirmation_date keine Pflicht-Eingabe mehr bei der
--    Jahrgang-Anlage (die Validierung in jahrgaenge.js entfaellt). Damit eine
--    Neuanlage ohne confirmation_date im Prod-Schema nicht mit einem
--    NOT-NULL-Violation fehlschlaegt, wird der Constraint hier wieder entfernt.
--    Die Spalte selbst bleibt physisch erhalten, wird aber von jahrgaenge.js nicht
--    mehr beschrieben/erzwungen. DROP NOT NULL ist in Postgres idempotent
--    (mehrfaches Ausfuehren ist kein Fehler, wenn die Spalte bereits nullable ist).

-- 1. konfspruch_enabled-Spalte
ALTER TABLE jahrgaenge ADD COLUMN IF NOT EXISTS konfspruch_enabled BOOLEAN NOT NULL DEFAULT true;

-- 2. NOT-NULL-Constraint auf confirmation_date entfernen
ALTER TABLE jahrgaenge ALTER COLUMN confirmation_date DROP NOT NULL;
