-- 170_konfi_historie.sql
--
-- EINE DAUERHAFTE KOPIE DER KONFI-ZEIT.
--
-- Die Befoerderung zur Teamer:in loescht alle Buchungen der Person
-- (routes/konfi-management.js, promote-teamer) -- auch die vergangenen mit
-- verbuchter Anwesenheit. Was bis dahin als
-- "Konfi-Historie" stehen blieb (Punkte, Aktivitaeten, Bonuspunkte,
-- Event-Punkte, Abzeichen), haengt an lebenden Tabellen: Loescht die Leitung
-- spaeter den alten Jahrgang, gehen dessen Termine und mit ihnen die
-- Event-Punkte.
--
-- Name und Kennung des Jahrgangs stehen daneben, weil der Jahrgang spaeter
-- geloescht werden darf -- jahrgang_id wird dann NULL, der Name bleibt.
--
-- ALT-APP-VERTRAG: rein additiv. Keine bestehende Tabelle aendert sich.

CREATE TABLE IF NOT EXISTS konfi_historie (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  jahrgang_id INTEGER REFERENCES jahrgaenge(id) ON DELETE SET NULL,
  jahrgang_name TEXT,
  anlass VARCHAR(30) NOT NULL
    CHECK (anlass IN ('befoerderung', 'jahrgang_geloescht')),
  erstellt_von INTEGER REFERENCES users(id) ON DELETE SET NULL,
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  daten JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_konfi_historie_person
  ON konfi_historie(user_id, organization_id);

COMMENT ON TABLE konfi_historie IS
  'Dauerhafte Kopie der Konfi-Zeit einer befoerderten Person. Entsteht vor dem Loeschen der Buchungen bzw. des Jahrgangs.';
