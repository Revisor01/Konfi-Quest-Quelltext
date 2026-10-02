-- 172_konfi_historie_anlass_abzeichen.sql
--
-- DIE KOPIE DER KONFI-ZEIT ENTSTEHT AUCH VOR DEM LOESCHEN ODER AENDERN EINES
-- BADGES.
--
-- ALT-APP-VERTRAG: rein additiv. Der CHECK wird nur erweitert; die
-- bisherigen Werte bleiben gueltig, keine Zeile aendert sich. Die Kopie liest
-- keine ausgelieferte App (GET /teamer/konfi-zeit kam nach 2.3.0-Tag).

ALTER TABLE konfi_historie DROP CONSTRAINT IF EXISTS konfi_historie_anlass_check;

ALTER TABLE konfi_historie
  ADD CONSTRAINT konfi_historie_anlass_check
  CHECK (anlass IN ('befoerderung', 'jahrgang_geloescht', 'abzeichen_geloescht', 'abzeichen_geaendert'));
