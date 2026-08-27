-- Fehlendes DDL nachtragen
--
-- Beide Objekte existieren in Produktion, wurden dort aber von Hand angelegt:
-- im gesamten Repo gibt es kein DDL dafuer. Folgen:
--   1. Eine Neuinstallation aus dem Repo haette sie NICHT — Tageslosung und
--      Wrapped-Kategorien waeren dort kaputt.
--   2. Im Test-Schema fehlten sie ebenfalls. Der Tageslosungs-Cache und die
--      gesamte Wrapped-Snapshot-Generierung liefen deshalb bei jedem Testlauf
--      in einen Fehler, der von den Routen abgefangen wurde — die Suite blieb
--      gruen, obwohl beide Pfade ungeprueft waren.
--
-- In Produktion ist diese Migration ein No-Op (IF NOT EXISTS), sie stellt nur
-- sicher, dass Repo und Produktion wieder denselben Stand beschreiben.

-- Cache fuer die Tageslosung. Genutzt von services/losungService.js sowie den
-- Routen konfi.js und teamer.js. Das UNIQUE auf (date, translation) ist
-- zwingend: losungService schreibt per ON CONFLICT (date, translation).
CREATE TABLE IF NOT EXISTS daily_verses (
  id          SERIAL PRIMARY KEY,
  date        DATE NOT NULL,
  translation VARCHAR(10) NOT NULL,
  verse_data  JSONB NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT daily_verses_date_translation_key UNIQUE (date, translation)
);

CREATE INDEX IF NOT EXISTS idx_daily_verses_date_translation
  ON daily_verses (date, translation);

-- Kategorie einer Aktivitaet. Genutzt von routes/wrapped.js:63
-- (COALESCE(a.category, a.type)) fuer die Kategorie-Auswertung im Rueckblick.
ALTER TABLE activities ADD COLUMN IF NOT EXISTS category TEXT;
