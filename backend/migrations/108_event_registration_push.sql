-- Flag: wurde fuer dieses Event bereits ein "Anmeldung moeglich"-Push gesendet,
-- waehrend der aktuelle Anmeldezeitraum offen ist/war?
--
-- Verhalten (Flankenerkennung "nicht anmeldbar" -> "anmeldbar"):
-- - Wird auf TRUE gesetzt, sobald das Event anmeldbar ist UND der Push raus ist.
-- - Wird auf FALSE zurueckgesetzt, sobald das Event wieder nicht-anmeldbar wird
--   (Anmeldung in die Zukunft verschoben / geschlossen / abgesagt).
-- -> Beim naechsten Uebergang nach "anmeldbar" feuert der Push erneut.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS registration_open_notified boolean NOT NULL DEFAULT false;

-- Bestehende, bereits laufende Events nicht rueckwirkend nachbenachrichtigen:
-- Alles was AKTUELL anmeldbar ist, gilt als "schon benachrichtigt".
UPDATE events
SET registration_open_notified = true
WHERE cancelled = false
  AND (teamer_only IS NULL OR teamer_only = false)
  AND (registration_opens_at IS NULL OR registration_opens_at <= NOW())
  AND (registration_closes_at IS NULL OR registration_closes_at >= NOW());
