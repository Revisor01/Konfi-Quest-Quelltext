-- 144_wrapped_snapshot_pro_ausgabe.sql
--
-- Migration 143 hatte die Ausgaben-Tabelle also angelegt, aber der Schluessel
-- darunter liess mehrere Ausgaben gar nicht zu. Zwei Migrationen, die sich
-- widersprachen.
--
-- DIE LOESUNG: Die Ausgabe wird Teil des Schluessels. Je Ausgabe genau ein
-- Snapshot pro Person -- innerhalb einer Ausgabe bleibt ON CONFLICT damit
-- idempotent (ein erneuter Lauf korrigiert Zahlen, statt zu doppeln), aber
-- zwei Ausgaben stehen nebeneinander.
--
-- WARUM COALESCE(ausgabe_id, 0): Wie in 140 -- in einem UNIQUE-Index gelten
-- zwei NULL als verschieden. Alt-Snapshots ohne Ausgabe (der Backfill aus
-- 143 haengt fast alle an, aber Zeilen aus einem Zwischenstand koennten
-- offen sein) bekommen den gemeinsamen Platzhalter 0 und bleiben damit
-- eindeutig pro Person, Typ, Jahr und Jahrgang -- also genau so wie vorher.
--
-- ADDITIV UND OHNE DATENVERLUST: Der neue Index ist WEITER als der alte
-- (eine Spalte mehr). Jede Zeile, die unter dem alten Schluessel gueltig
-- war, ist es auch unter dem neuen. Es kann deshalb nicht passieren, dass
-- die Migration an bestehenden Daten scheitert.
--
-- ALT-APP-VERTRAG: Keine Spalte faellt weg, keine aendert Typ oder Form.
-- GET /wrapped/me liefert weiterhin genau EINEN Rueckblick (den zuletzt
-- freigegebenen) -- ausgelieferte App-Versionen sehen keinen Unterschied.

-- Der Schluessel aus Migration 140. Faellt weg, weil er genau die
-- Mehrfach-Ausgabe verhindert, die 143 einfuehren wollte.
DROP INDEX IF EXISTS wrapped_snapshots_user_type_year_jahrgang_key;

CREATE UNIQUE INDEX IF NOT EXISTS wrapped_snapshots_user_type_jahr_jahrgang_ausgabe_key
  ON wrapped_snapshots (
    user_id,
    wrapped_type,
    year,
    COALESCE(jahrgang_id, 0),
    COALESCE(ausgabe_id, 0)
  );
