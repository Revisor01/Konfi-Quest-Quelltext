-- 093_konfspruch.sql
-- Datenmodell fuer die Konfispruch-Auswahl (Phase 118).
--
-- Legt zwei Tabellen an:
--   * konfsprueche               - kuratierte Vers-REFERENZEN (organization_id NULL = global)
--   * konfspruch_uebersetzungen  - je 4 Uebersetzungen pro Vers (UNIQUE(spruch_id, translation))
-- und erweitert konfi_profiles um die Spalten konfspruch_id (Listen-Wahl),
-- konfspruch_freitext und konfspruch_freitext_referenz (eigener Spruch + Pflicht-Stellenangabe)
-- sowie um eine DEDIZIERTE Spalte konfspruch_translation fuer die gewaehlte
-- Konfispruch-Uebersetzung (eigene Wertewelt: luther2017/bigs/gute_nachricht/elberfelder).
-- Die Tageslosungs-Uebersetzungs-Spalte (Kuerzel-Wertewelt LUT/ELB/...) wird
-- BEWUSST NICHT wiederverwendet, damit sich die beiden Features nicht gegenseitig
-- ueberschreiben.
--
-- LIZENZ-HINWEIS (wichtig):
-- Es werden AUSSCHLIESSLICH Vers-Referenzen geseedet. Die Uebersetzungs-TEXTE
-- bleiben leere Platzhalter (text = '') und werden vom Betreiber (Kirche / ACK-Mitglied)
-- per UPDATE aus den lizenzierten Quellen (Luther 2017, Bibel in gerechter Sprache,
-- Gute Nachricht, Elberfelder) nachgetragen. Es werden KEINE Bibeltexte erfunden
-- oder aus einem Sprachmodell reproduziert.
--
-- Alle Schritte sind idempotent / wiederholungssicher (Tests wenden Migrationen erneut an).

-- Schritt 1: Tabelle konfsprueche (kuratierte Referenzen)
CREATE TABLE IF NOT EXISTS konfsprueche (
  id              SERIAL PRIMARY KEY,
  reference       VARCHAR(100) NOT NULL,
  book            VARCHAR(50)  NOT NULL,
  chapter         INTEGER      NOT NULL,
  verse           INTEGER      NOT NULL,
  organization_id INTEGER      NULL REFERENCES organizations(id) ON DELETE CASCADE,
  is_active       BOOLEAN      DEFAULT true,
  sort_order      INTEGER      DEFAULT 0,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_konfsprueche_org ON konfsprueche(organization_id);
CREATE INDEX IF NOT EXISTS idx_konfsprueche_active ON konfsprueche(is_active);

-- Schritt 2: Tabelle konfspruch_uebersetzungen (4 Uebersetzungen pro Vers)
CREATE TABLE IF NOT EXISTS konfspruch_uebersetzungen (
  id          SERIAL PRIMARY KEY,
  spruch_id   INTEGER     NOT NULL REFERENCES konfsprueche(id) ON DELETE CASCADE,
  translation VARCHAR(30) NOT NULL,
  text        TEXT        NOT NULL DEFAULT '',
  UNIQUE(spruch_id, translation)
);
CREATE INDEX IF NOT EXISTS idx_konfspruch_uebersetzungen_spruch ON konfspruch_uebersetzungen(spruch_id);

-- Schritt 3: konfi_profiles erweitern (idempotent)
-- konfspruch_translation ist eine EIGENE Spalte (NICHT die Tageslosungs-Uebersetzungs-Spalte),
-- damit sich Konfispruch-Uebersetzung und Tageslosungs-Praeferenz nicht ueberschreiben.
-- Keine DB-CHECK-Constraint fuer die Exklusivitaet Listen-Wahl vs. Freitext -
-- diese wird in der PATCH-Route erzwungen (Setzen einer Quelle NULLt die andere).
ALTER TABLE konfi_profiles ADD COLUMN IF NOT EXISTS konfspruch_id INTEGER NULL REFERENCES konfsprueche(id) ON DELETE SET NULL;
ALTER TABLE konfi_profiles ADD COLUMN IF NOT EXISTS konfspruch_freitext TEXT NULL;
ALTER TABLE konfi_profiles ADD COLUMN IF NOT EXISTS konfspruch_freitext_referenz VARCHAR(100) NULL;
ALTER TABLE konfi_profiles ADD COLUMN IF NOT EXISTS konfspruch_translation VARCHAR(30) NULL;

-- Schritt 4: Seed der globalen Referenzen (organization_id NULL).
-- Idempotenz: vorab die globalen Sprueche loeschen (CASCADE entfernt auch deren
-- Uebersetzungs-Platzhalter), danach frisch einfuegen.
DELETE FROM konfsprueche WHERE organization_id IS NULL;

INSERT INTO konfsprueche (reference, book, chapter, verse, organization_id, sort_order) VALUES
  ('Psalm 23,1',       'Psalm',         23,  1,   NULL, 1),
  ('Psalm 31,4',       'Psalm',         31,  4,   NULL, 2),
  ('Psalm 37,5',       'Psalm',         37,  5,   NULL, 3),
  ('Psalm 91,11',      'Psalm',         91,  11,  NULL, 4),
  ('Psalm 118,14',     'Psalm',         118, 14,  NULL, 5),
  ('Psalm 119,105',    'Psalm',         119, 105, NULL, 6),
  ('Psalm 121,1-2',    'Psalm',         121, 1,   NULL, 7),
  ('Psalm 139,5',      'Psalm',         139, 5,   NULL, 8),
  ('Psalm 139,14',     'Psalm',         139, 14,  NULL, 9),
  ('1. Mose 12,2',     '1. Mose',       12,  2,   NULL, 10),
  ('Josua 1,9',        'Josua',         1,   9,   NULL, 11),
  ('1. Samuel 16,7',   '1. Samuel',     16,  7,   NULL, 12),
  ('Jesaja 41,10',     'Jesaja',        41,  10,  NULL, 13),
  ('Jesaja 43,1',      'Jesaja',        43,  1,   NULL, 14),
  ('Jesaja 40,31',     'Jesaja',        40,  31,  NULL, 15),
  ('Jeremia 29,11',    'Jeremia',       29,  11,  NULL, 16),
  ('Micha 6,8',        'Micha',         6,   8,   NULL, 17),
  ('Matthäus 5,9',     'Matthäus',      5,   9,   NULL, 18),
  ('Matthäus 6,33',    'Matthäus',      6,   33,  NULL, 19),
  ('Matthäus 28,20',   'Matthäus',      28,  20,  NULL, 20),
  ('Johannes 3,16',    'Johannes',      3,   16,  NULL, 21),
  ('Johannes 8,12',    'Johannes',      8,   12,  NULL, 22),
  ('Johannes 13,34',   'Johannes',      13,  34,  NULL, 23),
  ('Johannes 15,5',    'Johannes',      15,  5,   NULL, 24),
  ('Römer 8,28',       'Römer',         8,   28,  NULL, 25),
  ('Römer 12,12',      'Römer',         12,  12,  NULL, 26),
  ('1. Korinther 13,13', '1. Korinther', 13, 13,  NULL, 27),
  ('1. Korinther 16,14', '1. Korinther', 16, 14,  NULL, 28),
  ('Galater 5,22',     'Galater',       5,   22,  NULL, 29),
  ('Philipper 4,13',   'Philipper',     4,   13,  NULL, 30),
  ('1. Johannes 4,16', '1. Johannes',   4,   16,  NULL, 31),
  ('1. Johannes 4,19', '1. Johannes',   4,   19,  NULL, 32);

-- Fuer JEDEN geseedeten Spruch genau 4 Uebersetzungs-Zeilen mit leerem text
-- (Platzhalter). Der Betreiber befuellt nur noch die text-Spalte per UPDATE.
INSERT INTO konfspruch_uebersetzungen (spruch_id, translation, text)
SELECT k.id, t.translation, ''
FROM konfsprueche k
CROSS JOIN (VALUES ('luther2017'), ('bigs'), ('gute_nachricht'), ('elberfelder')) AS t(translation)
WHERE k.organization_id IS NULL;
