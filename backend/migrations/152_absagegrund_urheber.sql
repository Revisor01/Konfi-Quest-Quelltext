-- 152_absagegrund_urheber.sql
--
-- DER ABSAGEGRUND LAESST SICH NACHTRAGEN -- DAMIT STIMMT DIE ANNAHME AUS
-- MIGRATION 150 NICHT MEHR.
--
-- Migration 150 hat genau hier eine Annahme getroffen, die jetzt faellt:
--
--     "KEIN EIGENES PAAR FUER DEN GRUND: Der Grund gehoert zur Absage, und
--      die Absage passiert genau einmal -- cancelled ist nicht
--      zurueckzunehmen, also kann auch niemand spaeter nur den Grund aendern.
--      Ein Termin, ein Absagevorgang, ein Urheber."
--
-- Der zweite Halbsatz stimmt weiterhin (cancelled bleibt cancelled), der
-- dritte nicht mehr: Mit PUT /events/:id/absagegrund kann sehr wohl jemand
-- spaeter nur den Grund aendern. Damit tritt genau der Fall ein, den
-- Migration 149 fuer Status und Notiz schon einmal aufgeloest hat --
--
--     "Schreibt Person A die Abmeldung mit Grund und Person B spaeter nur die
--      Notiz, ueberschreibt B das Paar -- und die Zeile behauptet danach, B
--      habe auch den Grund eingetragen."
--
-- ZWEI SPALTEN, nach dem Muster von note_set_by/note_set_at (Migration 149):
--
--   cancelled_reason_set_by  -- wer den GRUND zuletzt gesetzt hat
--   cancelled_reason_set_at  -- wann
--
-- cancelled_by/cancelled_at BLEIBEN, WAS SIE SIND: wer den Termin abgesagt
-- hat, und wann. Sie werden beim Aendern des Grundes NICHT angefasst. Die
-- Absage ist der Vorgang, der die Konfis betroffen hat -- sie bekamen den
-- Push, ihre Buchungen haengen daran. Eine spaetere Korrektur am Begleittext
-- aendert daran nichts und darf den Urheber der Absage nicht ueberschreiben.
--
-- NULL HEISST WIE IMMER UNBEKANNT, NICHT NIEMAND: Jeder Termin, der vor
-- dieser Migration abgesagt wurde, hat keinen eigenen Grund-Urheber. KEIN
-- Backfill aus cancelled_by -- das waere zwar meistens richtig (wer absagt,
-- schreibt den Grund), aber "meistens richtig" ist bei einer Angabe, die
-- Verantwortung zuweist, zu wenig. Die Anzeige faellt stattdessen auf die
-- Absage-Zeile zurueck: Solange niemand nachtraeglich geaendert hat, steht
-- dort ohnehin "Abgesagt von ...", und das ist die richtige Auskunft.
--
-- WANN DIE ZEILE ERSCHEINT: Nur, wenn der Grund-Urheber ein ANDERER ist als
-- der Absagende, oder wenn kein Absagender bekannt ist. Steht beides auf
-- derselben Person -- der Normalfall, weil beim Absagen beide Paare zugleich
-- gesetzt werden --, waere eine zweite Zeile mit demselben Namen nur Laerm.
-- Entschieden wird das in der Anzeige (absagegrundUrheberZeile), nicht hier:
-- Die Datenbank haelt fest, was passiert ist, die Oberflaeche entscheidet,
-- was davon erzaehlenswert ist.
--
-- Der Fremdschluessel spiegelt cancelled_by aus Migration 150:
-- ON DELETE SET NULL. Wird die aendernde Person geloescht, bleibt der Grund
-- stehen -- nur die Zuordnung entfaellt.
--
-- ALT-APP-VERTRAG: rein additiv. Keine Spalte entfaellt, keine aendert Typ
-- oder Bedeutung, keine Bestandszeile wird umgeschrieben. cancelled_by
-- behaelt Name, Typ, Nullbarkeit UND Bedeutung ("wer hat abgesagt") --
-- es verengt sich nichts, es kommt nur etwas daneben. Ausgelieferte
-- App-Fassungen sehen zwei Felder mehr am Termin und ignorieren sie.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cancelled_reason_set_by INTEGER,
  ADD COLUMN IF NOT EXISTS cancelled_reason_set_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'events_cancelled_reason_set_by_fkey'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_cancelled_reason_set_by_fkey
      FOREIGN KEY (cancelled_reason_set_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN events.cancelled_reason_set_by IS
  'Wer den Absagegrund zuletzt gesetzt hat -- beim Absagen selbst oder spaeter ueber PUT /events/:id/absagegrund. NULL = unbekannt: Termine, die vor Migration 152 abgesagt wurden. Kein Backfill.';

COMMENT ON COLUMN events.cancelled_reason_set_at IS
  'Wann der Absagegrund zuletzt gesetzt wurde. NULL = unbekannt (siehe cancelled_reason_set_by).';

COMMENT ON COLUMN events.cancelled_by IS
  'Wer den Termin ABGESAGT hat. Wird von einer spaeteren Aenderung des Grundes NICHT ueberschrieben -- dafuer gibt es seit Migration 152 cancelled_reason_set_by. NULL = unbekannt: Termine, die vor Migration 150 abgesagt wurden. Kein Backfill.';
