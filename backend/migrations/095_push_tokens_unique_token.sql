-- 095_push_tokens_unique_token.sql
-- Doppelte Push-Zustellung fixen: derselbe FCM-Token lag mehrfach in push_tokens
-- (gleicher User, unterschiedliche device_id nach App-Neuinstallation -> neue
-- identifierForVendor). getTokensForUser dedupliziert nur pro (device_id, platform),
-- daher ging jeder Push doppelt an dasselbe Geraet.
-- 1) Bestand bereinigen: pro Token nur die neueste Zeile (hoechste id) behalten.
DELETE FROM push_tokens pt
USING push_tokens newer
WHERE newer.token = pt.token
  AND newer.id > pt.id;

-- 2) Kuenftig erzwingen: ein FCM-Token existiert global genau einmal.
--    (Registrierung loescht abweichende Zeilen vor dem Upsert; der Index ist das Sicherheitsnetz.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_token_unique ON push_tokens (token);
