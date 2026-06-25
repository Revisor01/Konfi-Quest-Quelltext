-- 091_event_is_konfirmation.sql
-- Neues Boolean-Flag `events.is_konfirmation` ersetzt die fragile
-- String-basierte Kategorie-Erkennung fuer Konfirmations-Events.
--
-- Idempotent und Test-DB-sicher: Bei leerer DB oder ohne passende
-- Kategorie treffen die datengetriebenen UPDATE/DELETE einfach 0 Zeilen.
-- Reihenfolge strikt: erst Flag setzen (Match-Info nutzen), dann
-- Verknuepfungen loesen, zuletzt die Kategorie loeschen. Sonst gingen
-- die Match-Informationen vor dem UPDATE verloren.
-- KEIN Datenverlust an Events: nur Kategorie-Verknuepfungen und die
-- Kategorie selbst werden entfernt, das Event bleibt mit gesetztem
-- Flag bestehen. KEIN Unique-Constraint (mehrere Events duerfen
-- gleichzeitig is_konfirmation=true tragen).

-- Schritt 1: Spalte hinzufuegen (idempotent)
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_konfirmation BOOLEAN DEFAULT false;

-- Schritt 2: Bestehende Konfirmation-Events (per Kategorie erkannt) auf das Flag ueberfuehren
UPDATE events e
SET is_konfirmation = true
FROM event_categories ec
JOIN categories c ON ec.category_id = c.id
WHERE ec.event_id = e.id
  AND c.name ILIKE '%konfirmation%';

-- Schritt 3: Verknuepfungen zur Konfirmation-Kategorie loesen (FK vor Kategorie-Loeschung)
DELETE FROM event_categories ec
USING categories c
WHERE ec.category_id = c.id
  AND c.name ILIKE '%konfirmation%';

-- Schritt 4: Konfirmation-Kategorie(n) entfernen, damit sie nicht mehr waehlbar/anlegbar sind
DELETE FROM categories
WHERE name ILIKE '%konfirmation%';
