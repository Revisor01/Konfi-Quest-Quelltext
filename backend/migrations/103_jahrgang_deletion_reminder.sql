-- 103_jahrgang_deletion_reminder.sql
-- "Letzte Chance"-Warnung vor der automatischen Jahrgang-Loeschung.
-- Der Auto-Deletion-Cron (backgroundService) entfernt Konfis eines Jahrgangs
-- ab Tag 60 nach dem Konfirmationstermin. 7 Tage vorher (Tag 53) bekommen die
-- Admins eine Mail + Push: "Jahrgang wird geloescht, letzte Chance zum
-- Befoerdern". Diese Spalte macht den Reminder idempotent (einmal pro Jahrgang).
--
-- Wird zurueckgesetzt, falls sich der Konfirmationstermin verschiebt (dann ist
-- ein neuer Reminder fuer den neuen Stichtag noetig) -- das uebernimmt die
-- Logik beim Setzen von confirmation_date / is_konfirmation-Events bzw. ein
-- erneuter Reminder, wenn der Marker NULL ist.

ALTER TABLE jahrgaenge ADD COLUMN IF NOT EXISTS deletion_reminder_sent_at TIMESTAMP NULL;
