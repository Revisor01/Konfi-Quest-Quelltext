-- 142_material_mehrere_links.sql
--
-- Bisher gab es genau EINE Spalte materials.link_url (Migration 135,
-- erst gestern) und die Oberflaeche erzwang ein Entweder-Oder zwischen
-- Dateien und Link. Beides faellt weg: Die neue Tabelle material_links
-- haelt beliebig viele Links pro Material, nach dem Muster von
-- material_files (eigene Zeile pro Anhang, ON DELETE CASCADE, Index auf
-- material_id). Eine Reihenfolge-Spalte braucht es nicht: Das Backend
-- schreibt die Links bei jeder Aenderung komplett neu (DELETE + INSERT,
-- wie material_jahrgaenge), die Eingabereihenfolge liegt damit in der id.
--
-- ALT-APP-VERTRAG: materials.link_url BLEIBT bestehen und wird vom
-- Backend als Spiegel des ERSTEN Links (kleinste id) weiter befuellt.
-- Ausgelieferte App-Versionen kennen nur link_url und sehen so weiterhin
-- einen Link, solange es welche gibt. Felder verschwinden nicht, die
-- Antwortform bleibt; das Array `links` kommt ADDITIV in die Antworten.
--
-- ADDITIV: Tabelle kommt dazu, nichts Bestehendes aendert Typ oder Form.
-- Der Backfill unten uebertraegt vorhandene link_url-Werte als ersten
-- Link in die neue Tabelle -- damit zeigt die neue Oberflaeche Bestand
-- sofort an. Er ist idempotent (NOT EXISTS), die Migration laesst sich
-- also gefahrlos erneut ausfuehren.
--
-- GEGEN PRODUKTION GEMESSEN:
--   materials gesamt: 1 (id 5 "Gebet", ist_global = true, link_url
--   gesetzt, 1 Jahrgangs-Zuordnung); material_files: 0 Zeilen.
-- Der Backfill erzeugt also genau 1 Zeile in material_links; link_url
-- der Bestandszeile bleibt unveraendert, ihre Sichtbarkeit auch (an der
-- Lese-Schranke aendert diese Migration nichts).

CREATE TABLE IF NOT EXISTS material_links (
  id SERIAL PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  -- Laengen- und Schema-Pruefung (nur http/https, max. 2000 Zeichen)
  -- liegt wie bei materials.link_url im Backend (routes/material.js,
  -- pruefeLink) -- eine Stelle, eine Fehlermeldung.
  url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Muster von 064_add_missing_indexes: material_links wird immer ueber
-- material_id gelesen (WHERE ml.material_id = ...).
CREATE INDEX IF NOT EXISTS idx_material_links_material_id ON material_links(material_id);

-- Backfill: Der bisherige Einzel-Link wird der erste Link der neuen
-- Tabelle. NOT EXISTS macht den Schritt idempotent.
INSERT INTO material_links (material_id, url, created_at)
SELECT m.id, m.link_url, COALESCE(m.created_at, NOW())
FROM materials m
WHERE m.link_url IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM material_links ml WHERE ml.material_id = m.id);
