-- 156_push_tokens_app_version.sql
--
-- WELCHE APP-FASSUNG HAT DEN TOKEN GESCHICKT?
--
-- Jede Vermutung darueber war unpruefbar: "Fix greift nicht" und "Fix ist noch
-- nicht auf dem Geraet" sehen serverseitig identisch aus. Genau diese
-- Unterscheidung entscheidet aber, ob man weitersucht oder wartet.
--
-- Deshalb schreibt die App ihre Fassung ab jetzt bei jeder Registrierung mit.
--
-- app_version   die Marketing-Version, z.B. '2.3.0'
-- app_build     die Build-Nummer als Text, z.B. '117' (Android versionCode)
--               oder '211' (iOS). Text, weil die beiden Plattformen
--               unterschiedlich zaehlen und ein INTEGER hier nichts gewinnt.

ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS app_version TEXT;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS app_build TEXT;

COMMENT ON COLUMN push_tokens.app_version IS
  'Marketing-Version der App, die diesen Token geschickt hat (z.B. 2.3.0). NULL = Fassung vor 23.09.2026.';
COMMENT ON COLUMN push_tokens.app_build IS
  'Build-Nummer der App als Text (Android versionCode bzw. iOS CFBundleVersion). NULL = Fassung vor 23.09.2026.';
