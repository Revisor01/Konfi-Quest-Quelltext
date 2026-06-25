-- 097_fix_sqlite_global_unique_to_per_org.sql
-- SQLite-Migrations-Altlast: drei Unique-Indizes liegen global auf einer Spalte,
-- muessen aber PRO ORGANISATION gelten. Folge auf Prod: eine zweite Organisation
-- konnte keinen Jahrgang "2026/27" anlegen, weil der Name systemweit schon
-- existierte ("Jahrgang existiert bereits" trotz fremder Org). Gleiches Problem
-- bei categories.name und (kritisch) settings.key — verschiedene Orgs teilten
-- sich Setting-Keys.
--
-- Die init-scripts haben die korrekten (name, organization_id)-Constraints, aber
-- nur fuer frische DBs; die migrierte Prod-DB behielt die alten sqlite_autoindex_*.

-- jahrgaenge: global (name) -> pro Org (name, organization_id)
DROP INDEX IF EXISTS idx_24927_sqlite_autoindex_jahrgaenge_1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jahrgaenge_name_org ON jahrgaenge (name, organization_id);

-- categories: global (name) -> pro Org (name, organization_id)
DROP INDEX IF EXISTS idx_24991_sqlite_autoindex_categories_1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_name_org ON categories (name, organization_id);

-- settings: global (key) -> pro Org (organization_id, key)
-- ACHTUNG: idx_24935_sqlite_autoindex_settings_1 ist ein CONSTRAINT (nicht nur
-- ein Index) -> per DROP CONSTRAINT entfernen, DROP INDEX scheitert mit 2BP01.
ALTER TABLE settings DROP CONSTRAINT IF EXISTS idx_24935_sqlite_autoindex_settings_1;
DROP INDEX IF EXISTS idx_24935_sqlite_autoindex_settings_1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_settings_org_key ON settings (organization_id, key);
