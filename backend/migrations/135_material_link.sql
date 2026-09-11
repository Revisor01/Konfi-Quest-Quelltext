-- 135_material_link.sql
--
-- Anlass: Fuer das inhaltliche Programm entstehen eigene Seiten
-- (konfi-quest.de/gottesbilder). Solche Seiten sollen sich direkt am
-- Material verknuepfen lassen, statt sie in eine PDF zu giessen.
--
-- ADDITIV: Die Spalte kommt dazu, nichts Bestehendes aendert sich.
-- Bestehendes Material behaelt NULL und bleibt reines Datei-Material; alte
-- App-Versionen im Store lesen das Feld schlicht nicht und sehen dieselbe
-- Antwort wie bisher.
--
-- Vorbild ist challenge_submissions.link_url (Migration 118): eine TEXT-Spalte,
-- die Pruefung auf http/https liegt im Backend (routes/material.js), nicht in
-- einem CHECK -- so bleibt sie an einer Stelle formuliert und die Fehlermeldung
-- ist dieselbe wie bei den Challenge-Beitraegen.
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS link_url TEXT;
