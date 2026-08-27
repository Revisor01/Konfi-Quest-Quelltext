-- 130_material_tags_entfernen.sql
--
-- Vor dem Entfernen in Produktion nachgemessen:
--   material_tags:       1 Zeile ("Spiele", Organisation 1)
--   material_file_tags:  0 Zeilen
-- Also ein Test-Ueberbleibsel ohne jede Zuordnung -- es geht nichts
-- verloren, was jemand angelegt und benutzt haette.
--
-- Zuerst die Join-Tabelle, dann die Haupttabelle (Fremdschluessel-Reihenfolge).
DROP TABLE IF EXISTS material_file_tags;
DROP TABLE IF EXISTS material_tags;
