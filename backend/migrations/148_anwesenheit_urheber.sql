-- 148_anwesenheit_urheber.sql
--
-- WER HAT DIE ANWESENHEIT EINGETRAGEN? HEUTE STEHT DAS NIRGENDS.
--
-- Zwei Spalten im Stil von challenge_submissions.approved_by/approved_at
-- (Migration 146):
--
--   attendance_set_by  -- wer die Anwesenheit zuletzt gesetzt hat
--   attendance_set_at  -- wann
--
-- ZULETZT, nicht ZUERST: Die Anwesenheit ist aenderbar (abwesend -> doch
-- anwesend, Vermerk nachtragen). Festgehalten wird der Stand, der jetzt
-- dasteht -- eine vollstaendige Historie waere eine eigene Tabelle und loest
-- ein Problem, das niemand hat. Wer den Eintrag zuletzt angefasst hat, ist
-- die Person, bei der man nachfragt.
--
-- NULLABLE, und NULL heisst UNBEKANNT, nicht NIEMAND:
-- Jede Buchung, die vor dieser Migration verbucht wurde, traegt einen
-- attendance_status ohne Urheber -- die Information existiert schlicht nicht.
-- Ein Default waere geraten. Die Anzeige laesst die Zeile deshalb einfach
-- weg, statt "unbekannt" zu behaupten, und keine Auswertung zaehlt eine
-- fehlende Angabe als Null.
--
-- Der Fremdschluessel spiegelt approved_by aus Migration 146:
-- ON DELETE SET NULL. Wird die eintragende Person geloescht, bleibt die
-- Anwesenheit stehen -- nur die Zuordnung entfaellt.
--
-- ALT-APP-VERTRAG: rein additiv. Keine Spalte entfaellt, keine aendert Typ
-- oder Bedeutung, keine Bestandszeile wird umgeschrieben. Ausgelieferte
-- App-Fassungen sehen zwei Felder mehr in der Teilnehmerliste und
-- ignorieren sie.

ALTER TABLE event_bookings
  ADD COLUMN IF NOT EXISTS attendance_set_by INTEGER,
  ADD COLUMN IF NOT EXISTS attendance_set_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'event_bookings_attendance_set_by_fkey'
  ) THEN
    ALTER TABLE event_bookings
      ADD CONSTRAINT event_bookings_attendance_set_by_fkey
      FOREIGN KEY (attendance_set_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN event_bookings.attendance_set_by IS
  'Wer die Anwesenheit (Status, Grund, Vermerk) zuletzt gesetzt hat. NULL = unbekannt: Bestandszeilen vor Migration 148 und Selbst-Check-ins per QR-Code.';

COMMENT ON COLUMN event_bookings.attendance_set_at IS
  'Wann die Anwesenheit zuletzt gesetzt wurde. NULL = unbekannt (siehe attendance_set_by).';
