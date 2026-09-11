-- 146_challenge_freigabe_historie.sql
--
-- WER EINEN BEITRAG FREIGIBT, HINTERLAESST HEUTE KEINE SPUR.
--
-- challenge_submissions fuehrt hidden_by und hidden_at -- fuer das
-- AUSBLENDEN ist also festgehalten, wer es war und wann. Fuer die FREIGABE
-- fehlt beides: Der UPDATE-Zweig in routes/challenges.js setzt
-- moderation_status = 'approved' und raeumt die hidden-Spalten ab, mehr
-- nicht.
--
-- Damit ist die Moderationsarbeit im System unsichtbar. Genau sie ist aber
-- Arbeit: Jemand sieht sich jeden Beitrag an und gibt ihn frei, oft
-- abends, oft viele hintereinander. Der Jahresrueckblick soll sie sichtbar
-- machen ("Du hast X Beitraege freigegeben").
--
-- NUR DIE EIGENE LEISTUNG, NIE EINE ABLEHNUNGSQUOTE:
-- Gezaehlt wird, was jemand FREIGEGEBEN
-- hat. Eine Quote "x % abgelehnt" waere eine Bewertung der Moderation und
-- haette im Rueckblick nichts verloren. Deshalb wird hier auch bewusst nur
-- die Freigabe erfasst -- fuers Ausblenden gibt es hidden_by/hidden_at
-- schon, und daraus wird im Rueckblick nichts gerechnet.
--
-- NULLABLE, und NULL heisst UNBEKANNT:
-- Bestandszeilen mit moderation_status='approved' sind laengst freigegeben,
-- aber von wem, steht nirgends -- die Information existiert schlicht nicht
-- mehr. Ein Default waere geraten. Die Auswertung zaehlt deshalb nur
-- Zeilen mit ausdruecklichem approved_by; niemand bekommt fremde Arbeit
-- gutgeschrieben, und niemandem wird abgesprochen, sie geleistet zu haben.
--
-- Der Fremdschluessel spiegelt hidden_by: ON DELETE SET NULL. Wird die
-- moderierende Person geloescht, bleibt der Beitrag freigegeben -- nur die
-- Zuordnung entfaellt.
--
-- ALT-APP-VERTRAG: rein additiv. Keine Spalte entfaellt, keine aendert Typ
-- oder Bedeutung, keine Bestandszeile wird umgeschrieben.
ALTER TABLE challenge_submissions
  ADD COLUMN IF NOT EXISTS approved_by INTEGER,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'challenge_submissions_approved_by_fkey'
  ) THEN
    ALTER TABLE challenge_submissions
      ADD CONSTRAINT challenge_submissions_approved_by_fkey
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN challenge_submissions.approved_by IS
  'Wer den Beitrag freigegeben hat. NULL = unbekannt (Bestandszeilen vor Migration 146).';
