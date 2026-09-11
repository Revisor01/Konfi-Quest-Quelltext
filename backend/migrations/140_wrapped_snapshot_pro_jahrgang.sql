-- 140_wrapped_snapshot_pro_jahrgang.sql
--
-- Der Jahresrueckblick konnte pro Person und Jahr nur EINEN Snapshot halten.
-- Der Schluessel aus 075_wrapped.sql lautet UNIQUE(user_id, wrapped_type,
-- year) -- der Jahrgang fehlt darin, obwohl die Spalte existiert und beim
-- Konfi-Snapshot gefuellt wird.
--
-- Die Folge: Gehoert eine Konfi im selben Jahr zu zwei Jahrgaengen und wird
-- fuer beide ein Rueckblick erzeugt, greift das ON CONFLICT ... DO UPDATE in
-- routes/wrapped.js -- der zweite Lauf UEBERSCHREIBT den ersten still. Es
-- gibt keine Fehlermeldung, der Zaehler meldet trotzdem Erfolg, und der
-- erste Jahrgang verliert seinen Rueckblick.
--
-- Zusaetzlich haengt daran der Loeschweg: DELETE /wrapped/jahrgang/:id
-- filtert auf `jahrgang_id = $1`. Teamer-Snapshots werden ohne Jahrgang
-- gespeichert (NULL) und waren damit ueber keine Route loeschbar. Das
-- behebt die Route selbst (routes/wrapped.js), nicht diese Migration --
-- hier steht es, weil beide dieselbe Wurzel haben: der Jahrgang war im
-- Schluessel nicht vorgesehen.
--
-- GEGEN PRODUKTION GEMESSEN:
--   wrapped_snapshots: 0 Zeilen (gesamt, teamer, ohne Jahrgang je 0)
--   Konfis in mehr als einem Jahrgang: 0
-- Die Umstellung fasst also keine einzige vorhandene Zeile an. Nach dem
-- ersten Erzeugen in Produktion waere dieselbe Aenderung eine Umsortierung
-- echter Daten gewesen -- deshalb jetzt.
--
-- WARUM COALESCE STATT jahrgang_id DIREKT: In einem UNIQUE-Index gelten zwei
-- NULL-Werte als verschieden. Ein Index ueber (user_id, wrapped_type, year,
-- jahrgang_id) wuerde bei den Teamer-Snapshots (jahrgang_id IS NULL) also
-- gar nicht mehr greifen -- jeder Lauf legte eine neue Zeile an, statt die
-- vorhandene zu aktualisieren, und das ON CONFLICT liefe ins Leere. Mit
-- COALESCE(jahrgang_id, 0) bekommen sie einen gemeinsamen Platzhalter und
-- bleiben genau wie bisher eindeutig pro Person und Jahr.
--
-- 0 ist als Platzhalter sicher: jahrgaenge.id ist SERIAL und beginnt bei 1.

-- Alten Schluessel entfernen. Der Name kommt von PostgreSQL selbst
-- (Tabelle_Spalten_key), wie in 075 ohne CONSTRAINT-Namen angelegt.
ALTER TABLE wrapped_snapshots
  DROP CONSTRAINT IF EXISTS wrapped_snapshots_user_id_wrapped_type_year_key;

-- Neuer Schluessel MIT Jahrgang. Als Index statt als Constraint, weil ein
-- UNIQUE CONSTRAINT keine Ausdruecke erlaubt -- COALESCE ist einer.
-- Fuer ON CONFLICT ist das gleichwertig: der Ausdruck unten in
-- routes/wrapped.js nennt dieselben Spalten in derselben Reihenfolge.
CREATE UNIQUE INDEX IF NOT EXISTS wrapped_snapshots_user_type_year_jahrgang_key
  ON wrapped_snapshots (user_id, wrapped_type, year, COALESCE(jahrgang_id, 0));
