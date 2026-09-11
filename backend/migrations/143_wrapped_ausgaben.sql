-- 143_wrapped_ausgaben.sql
--
-- WARUM: Bisher gab es genau EINE Freigabe pro Jahrgang -- die Spalte
-- jahrgaenge.wrapped_released_at. Ein Jahrgang, der über zwei Jahre läuft
-- (Start April 2025, Zwischenstand April 2026, Abschluss April 2027), konnte
-- deshalb nur EINEN Rückblick haben: Der zweite Lauf überschrieb den ersten,
-- ohne Fehlermeldung. Genau dieser Fall ist bei Konfi-Jahrgängen der Normalfall
-- und nicht die Ausnahme.
--
-- Dazu kam die Benennung: "Wrapped 2026" passt nicht, wenn das Konfi-Jahr im
-- April beginnt. Die Gemeinden sollen ihre Ausgaben selbst benennen dürfen
-- ("Dein erstes Jahr", "Zwischenstand", "Dein Abschluss") -- wir schreiben
-- ihnen weder die Anzahl noch den Rhythmus vor.
--
-- ALT-APP-VERTRAG (die wichtigste Zeile dieser Migration):
-- jahrgaenge.wrapped_released_at BLEIBT BESTEHEN und wird vom Backend
-- weitergepflegt. Ausgelieferte App-Versionen lesen diese Spalte über das
-- Konfi-Dashboard; verschwände sie, bräche der Rückblick auf den Geräten.
-- Die Spalte trägt ab hier die Freigabe der ZULETZT freigegebenen Ausgabe
-- eines Jahrgangs -- für eine alte App sieht damit alles aus wie bisher.
-- Entfernt wird sie erst, wenn keine App sie mehr liest (siehe ABRISS unten).
--
-- ADDITIV: Neue Tabelle, neue nullbare Spalte auf wrapped_snapshots. Nichts
-- Bestehendes ändert Typ oder Form. Der Backfill unten überführt die
-- vorhandenen Snapshots in Ausgaben, damit niemand seinen Rückblick verliert.
--
-- GEGEN PRODUKTION GEMESSEN:
--   wrapped_snapshots: 17 Zeilen (13 konfi, 4 teamer), alle year=2026
--   jahrgaenge mit wrapped_released_at: 1 (Jahrgang 15 "2026/27")
-- Der Backfill erzeugt daraus 2 Ausgaben (eine Konfi-Ausgabe für Jahrgang 15,
-- eine Teamer-Ausgabe 2026) und hängt die 17 Snapshots daran.

CREATE TABLE IF NOT EXISTS wrapped_ausgaben (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- 'konfi' -> gehört zu genau einem Jahrgang (jahrgang_id gesetzt)
  -- 'teamer' -> organisationsweit, ohne Jahrgang (jahrgang_id NULL)
  wrapped_type VARCHAR(10) NOT NULL CHECK (wrapped_type IN ('konfi', 'teamer')),
  jahrgang_id INTEGER REFERENCES jahrgaenge(id) ON DELETE CASCADE,

  -- Der Name, den die Gemeinde selbst vergibt. Erscheint in der App als
  -- Überschrift des Rückblicks und in der Liste der eigenen Rückblicke.
  titel VARCHAR(120) NOT NULL,

  -- Zeitraum, über den gerechnet wird. Bewusst frei wählbar statt aus dem
  -- Kalenderjahr abgeleitet: Ein Zwischenstand deckt oft nur die erste
  -- Hälfte ab, und Konfi-Jahre laufen nicht von Januar bis Dezember.
  zeitraum_start DATE NOT NULL,
  zeitraum_ende DATE NOT NULL,

  -- Freigabe: NULL = noch nicht freigegeben, dann sieht sie niemand außer
  -- der Leitung. Gesetzt = ab diesem Zeitpunkt sichtbar.
  freigegeben_at TIMESTAMPTZ,
  freigegeben_von INTEGER REFERENCES users(id) ON DELETE SET NULL,

  erstellt_von INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Eine Konfi-Ausgabe gehört immer zu einem Jahrgang, eine Teamer-Ausgabe nie.
  CONSTRAINT wrapped_ausgaben_jahrgang_passt CHECK (
    (wrapped_type = 'konfi'  AND jahrgang_id IS NOT NULL) OR
    (wrapped_type = 'teamer' AND jahrgang_id IS NULL)
  ),
  CONSTRAINT wrapped_ausgaben_zeitraum CHECK (zeitraum_ende >= zeitraum_start)
);

CREATE INDEX IF NOT EXISTS idx_wrapped_ausgaben_org
  ON wrapped_ausgaben(organization_id, wrapped_type);
CREATE INDEX IF NOT EXISTS idx_wrapped_ausgaben_jahrgang
  ON wrapped_ausgaben(jahrgang_id);

-- Der Snapshot hängt ab hier an der Ausgabe. Nullbar, weil Alt-Snapshots
-- kurzzeitig ohne Ausgabe existieren (der Backfill unten hängt sie an) und
-- weil ein Löschen der Ausgabe die Snapshots mitnimmt (CASCADE).
ALTER TABLE wrapped_snapshots
  ADD COLUMN IF NOT EXISTS ausgabe_id INTEGER
  REFERENCES wrapped_ausgaben(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_wrapped_snapshots_ausgabe
  ON wrapped_snapshots(ausgabe_id);

-- ---------------------------------------------------------------------------
-- Backfill: bestehende Snapshots in Ausgaben überführen
-- ---------------------------------------------------------------------------
-- Idempotent über NOT EXISTS -- die Migration lässt sich gefahrlos erneut
-- ausführen.

-- 1. Konfi-Ausgaben: eine je (Jahrgang, Jahr) mit vorhandenen Snapshots.
--    Titel aus dem Jahrgangsnamen, damit in der App etwas Sinnvolles steht.
INSERT INTO wrapped_ausgaben
  (organization_id, wrapped_type, jahrgang_id, titel,
   zeitraum_start, zeitraum_ende, freigegeben_at, created_at)
SELECT
  s.organization_id,
  'konfi',
  s.jahrgang_id,
  'Konfi-Jahr ' || COALESCE(j.name, s.year::text),
  MAKE_DATE(s.year, 1, 1),
  MAKE_DATE(s.year, 12, 31),
  -- Die bisherige Freigabe des Jahrgangs übernehmen: Was sichtbar war,
  -- bleibt sichtbar. Was nicht freigegeben war, bleibt es auch.
  j.wrapped_released_at,
  MIN(s.computed_at)
FROM wrapped_snapshots s
LEFT JOIN jahrgaenge j ON j.id = s.jahrgang_id
WHERE s.wrapped_type = 'konfi'
  AND s.jahrgang_id IS NOT NULL
  AND s.ausgabe_id IS NULL
GROUP BY s.organization_id, s.jahrgang_id, s.year, j.name, j.wrapped_released_at;

-- 2. Teamer-Ausgaben: eine je (Organisation, Jahr).
INSERT INTO wrapped_ausgaben
  (organization_id, wrapped_type, jahrgang_id, titel,
   zeitraum_start, zeitraum_ende, freigegeben_at, created_at)
SELECT
  s.organization_id,
  'teamer',
  NULL,
  'Teamer-Jahr ' || s.year::text,
  MAKE_DATE(s.year, 1, 1),
  MAKE_DATE(s.year, 12, 31),
  -- Teamer-Rückblicke kannten bisher keine Freigabe: einmal erzeugt, waren
  -- sie sichtbar. Damit sich für niemanden etwas ändert, gelten sie als
  -- freigegeben.
  MIN(s.computed_at),
  MIN(s.computed_at)
FROM wrapped_snapshots s
WHERE s.wrapped_type = 'teamer'
  AND s.ausgabe_id IS NULL
GROUP BY s.organization_id, s.year;

-- 3. Snapshots an ihre Ausgabe hängen.
UPDATE wrapped_snapshots s
SET ausgabe_id = a.id
FROM wrapped_ausgaben a
WHERE s.ausgabe_id IS NULL
  AND a.organization_id = s.organization_id
  AND a.wrapped_type = s.wrapped_type
  AND a.jahrgang_id IS NOT DISTINCT FROM s.jahrgang_id
  AND EXTRACT(YEAR FROM a.zeitraum_start)::int = s.year;

-- ---------------------------------------------------------------------------
-- Eindeutigkeit: eine Zeile je Person und Ausgabe
-- ---------------------------------------------------------------------------
-- Der alte Schlüssel (user_id, wrapped_type, year, COALESCE(jahrgang_id,0))
-- aus Migration 140 BLEIBT vorerst bestehen: Solange Code beider Stände
-- laufen kann (Rolling Deploy, zwei Backend-Replikas), muss auch das alte
-- ON CONFLICT weiter greifen. Der neue Schlüssel kommt additiv daneben.
CREATE UNIQUE INDEX IF NOT EXISTS wrapped_snapshots_user_ausgabe_key
  ON wrapped_snapshots (user_id, ausgabe_id)
  WHERE ausgabe_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ABRISS (geplant, NICHT in dieser Migration ausführen)
-- ---------------------------------------------------------------------------
-- Sobald keine App-Version im Store mehr die alten Wege liest, fallen weg:
--
--   1. jahrgaenge.wrapped_released_at
--      Gelesen von: routes/konfi.js (Dashboard has_wrapped), routes/wrapped.js
--      (Freigabe-Gate in GET /me). Ersatz: wrapped_ausgaben.freigegeben_at.
--      Frühestens entfernen, wenn Version 2.1.1 und älter aus dem Store sind.
--
--   2. wrapped_snapshots.year und der Index
--      wrapped_snapshots_user_type_year_jahrgang_key (Migration 140)
--      Ersatz: ausgabe_id + wrapped_snapshots_user_ausgabe_key.
--      Vorher: ausgabe_id auf NOT NULL setzen (geht erst, wenn kein alter
--      Code mehr Snapshots ohne Ausgabe schreibt).
--
--   3. POST /api/wrapped/generate/:jahrgangId und generate-teamer
--      Ersatz: POST /api/wrapped/ausgaben/:id/generieren.
--      Die alten Routen bleiben bis dahin bestehen und legen intern eine
--      Ausgabe an -- so bricht keine ausgelieferte Leitungsansicht.
--
-- Reihenfolge beim Abriss: erst Routen (3), dann Spalten (1, 2). Vorher
-- jeweils prüfen, welche App-Versionen noch aktiv sind.
