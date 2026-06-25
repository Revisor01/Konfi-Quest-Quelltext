-- Migration 087: Zeitraum/Lizenz + Trial-Kennzeichnung pro Organisation
--
-- trial_ends_at (TIMESTAMP NULL): das "bis"-Datum des Nutzungszeitraums.
--   NULL          = unbegrenzt nutzbar (keine Sperre).
--   <timestamp>   = Zugang nur bis zu diesem Zeitpunkt; danach wird die Org
--                   automatisch gesperrt (gilt fuer Testphase UND bezahlte Lizenz).
--
-- is_trial (BOOLEAN, Default false): NUR Anzeige-Steuerung, KEINE Sperr-Logik.
--   true  = es handelt sich um eine kostenlose Testphase -> im Dashboard erscheint
--           ein Hinweis "Testphase laeuft noch X Tage".
--   false = bezahlte Lizenz oder unbegrenzt -> KEIN Dashboard-Hinweis. Bei
--           gesetztem trial_ends_at wird die Org nach Ablauf trotzdem gesperrt
--           (Lizenz-Ablauf), aber der zahlende Kunde sieht vorher keinen Trial-Banner.
--
-- Die Sperre haengt also AUSSCHLIESSLICH an trial_ends_at (Datum ueberschritten),
-- is_trial steuert nur, ob der Nutzungs-Hinweis im Dashboard angezeigt wird.
--
-- WICHTIG kein Backfill fuer bestehende Orgs: alle bleiben trial_ends_at NULL
-- (= unbegrenzt) und is_trial false. Nur neu erstellte Orgs bekommen im Backend
-- standardmaessig einen 30-Tage-Trial (trial_ends_at = now()+30d, is_trial = true).
-- Idempotent (IF NOT EXISTS), Migration-Runner backend/database.js.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT false;
