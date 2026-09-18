-- 149_notiz_urheber.sql
--
-- EIN URHEBER FUER ZWEI VORGAENGE -- DAS GEHT SCHIEF.
--
-- Heute steht in event_bookings genau EIN Paar attendance_set_by/_at
-- (Migration 148) fuer alles zusammen: Status, Abmeldegrund und Notiz.
-- Schreibt Person A die Abmeldung mit Grund und Person B spaeter nur die
-- Notiz, ueberschreibt B das Paar -- und die Zeile behauptet danach, B habe
-- auch den Grund eingetragen. Bei genau der Rueckfrage, fuer die die Angabe
-- da ist ("wer hat mit der Mutter telefoniert?"), fuehrt sie dann zur
-- falschen Person.
--
--   attendance_set_by / attendance_set_at  -- gilt ab jetzt fuer STATUS samt
--                                             Abmeldegrund (der Grund haengt
--                                             am Status, siehe Migration 147)
--   note_set_by       / note_set_at        -- gilt fuer die NOTIZ
--
-- WARUM NICHT EIN DRITTES PAAR FUER DEN GRUND: Der Grund ist kein eigener
-- Vorgang. Er gehoert zu 'excused' und wird beim Statuswechsel mit geleert
-- (Migration 147) -- wer den Status setzt, setzt den Grund. Ein eigenes Paar
-- waere eine Unterscheidung ohne Unterschied.
--
-- WARUM KEINE HISTORIE: wie bei Migration 148. Festgehalten wird der Stand,
-- der jetzt dasteht; wer ihn zuletzt angefasst hat, ist die Person, bei der
-- man nachfragt. Eine vollstaendige Historie waere eine eigene Tabelle und
-- loeste ein Problem, das niemand hat.
--
-- NULLABLE, UND NULL HEISST WEITERHIN UNBEKANNT, NICHT NIEMAND:
-- Jede Notiz, die vor dieser Migration geschrieben wurde, traegt keinen
-- eigenen Urheber -- die Information existiert schlicht nicht. Sie aus
-- attendance_set_by zu uebernehmen waere geraten: Das Paar kann laengst von
-- einer spaeteren Statusaenderung stammen, also von jemand anderem. Die
-- Anzeige laesst die Zeile deshalb weg, statt etwas zu behaupten. KEIN
-- Backfill.
--
-- Der Fremdschluessel spiegelt attendance_set_by aus Migration 148:
-- ON DELETE SET NULL. Wird die schreibende Person geloescht, bleibt die
-- Notiz stehen -- nur die Zuordnung entfaellt.

ALTER TABLE event_bookings
  ADD COLUMN IF NOT EXISTS note_set_by INTEGER,
  ADD COLUMN IF NOT EXISTS note_set_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'event_bookings_note_set_by_fkey'
  ) THEN
    ALTER TABLE event_bookings
      ADD CONSTRAINT event_bookings_note_set_by_fkey
      FOREIGN KEY (note_set_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN event_bookings.note_set_by IS
  'Wer die Notiz (attendance_note) zuletzt gesetzt hat. NULL = unbekannt: Notizen von vor Migration 149 und Buchungen ohne Notiz.';

COMMENT ON COLUMN event_bookings.note_set_at IS
  'Wann die Notiz zuletzt gesetzt wurde. NULL = unbekannt (siehe note_set_by).';

COMMENT ON COLUMN event_bookings.attendance_set_by IS
  'Wer den Anwesenheits-STATUS (samt excuse_reason) zuletzt gesetzt hat. Die Notiz hat seit Migration 149 einen eigenen Urheber (note_set_by). NULL = unbekannt: Bestandszeilen vor Migration 148 und Selbst-Check-ins per QR-Code.';

COMMENT ON COLUMN event_bookings.attendance_set_at IS
  'Wann der Anwesenheits-Status zuletzt gesetzt wurde. NULL = unbekannt (siehe attendance_set_by).';
