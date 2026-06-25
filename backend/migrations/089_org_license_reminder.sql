-- Migration 089: Doppel-Mail-Schutz fuer Lizenz-Ablauf-Erinnerung
-- Speichert, wann zuletzt eine Lizenz-Erinnerungsmail fuer eine Org verschickt
-- wurde. Verhindert, dass der taegliche Cron im 14-Tage-Fenster jeden Tag erneut
-- erinnert. Wird beim Setzen eines neuen trial_ends_at (Verlaengerung) wieder
-- auf NULL gesetzt, damit die naechste anstehende Erinnerung wieder greift.
-- Idempotent (IF NOT EXISTS), Migration-Runner backend/database.js.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS license_reminder_sent_at TIMESTAMP NULL;
