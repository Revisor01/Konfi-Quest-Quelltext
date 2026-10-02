-- 185_push_tokens_app_symbol_weg.sql
--
-- WIE KOMMT DIE ZAHL AUFS APP-SYMBOL DIESES ANDROID-GERAETS?
--
-- Auf dem iPhone setzt aps.badge die Zahl. Android hat keine Schnittstelle
-- dafuer; es haengt am Startbildschirm des Geraets. Die App bestimmt beim
-- Anmelden des Push-Tokens den passenden Weg und meldet ihn mit (Begruendung
-- und Werte in backend/utils/appSymbolWeg.js):
--
--   app_symbol_weg   'anbieter'     die App setzt die Zahl selbst (Sony,
--                                   Huawei) -> nach jeder Mitteilung ein
--                                   stilles badge_update
--                    'mitteilungen' der Startbildschirm rechnet aus den
--                                   Mitteilungen (Samsung, Xiaomi) -> fester
--                                   tag und notificationCount
--                    'punkt'        kein bekannter Weg (Pixel u. a.)
--   startbildschirm  Paketname des Startbildschirms, z.B.
--                    com.sonymobile.launcher -- zum Nachsehen, welche
--                    Geraete es gibt, und fuer die Fehlersuche.
--
-- ADDITIV, NULL-faehig, ohne Default: iOS, die Store-Apps 2.2.x und 2.3.0 bis
-- Build 128 schicken nichts; NULL heisst "ohne Angabe", und fuer sie bleibt
-- der Versand, wie er ist. Der Upsert in POST /notifications/device-token
-- ueberschreibt eine bekannte Angabe nicht mit NULL (COALESCE, wie bei
-- app_version aus Migration 156).
--
-- Kein Index: gelesen wird die Spalte nur an der schon gefundenen Token-Zeile.

ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS app_symbol_weg TEXT;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS startbildschirm TEXT;

-- Nur die bekannten Wege; die Route macht aus allem anderen NULL, bevor es
-- hier ankommt.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'push_tokens_app_symbol_weg_check'
  ) THEN
    ALTER TABLE push_tokens ADD CONSTRAINT push_tokens_app_symbol_weg_check
      CHECK (app_symbol_weg IS NULL OR app_symbol_weg IN ('anbieter', 'mitteilungen', 'punkt'));
  END IF;
END $$;

COMMENT ON COLUMN push_tokens.app_symbol_weg IS
  'Android: wie die Zahl ans App-Symbol kommt (anbieter, mitteilungen, punkt). NULL = ohne Angabe (iOS, Apps bis 2.3.0 Build 128), Versand wie bisher.';
COMMENT ON COLUMN push_tokens.startbildschirm IS
  'Android: Paketname des Startbildschirms, den die App beim Anmelden gefunden hat. NULL = ohne Angabe.';
