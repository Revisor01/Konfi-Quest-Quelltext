-- Dateinamen mit Umlauten reparieren
--
-- WIE: Der falsche Name ist der richtige, Byte fuer Byte als Latin-1
-- gelesen. Zurueck geht es mit convert_to(name, 'LATIN1') (die Zeichen wieder
-- als die urspruenglichen Bytes) und convert_from(..., 'UTF8'). Das prueft
-- sich selbst:
--   - Ein richtig gespeicherter Name mit Umlaut („Gebetswürfel") ergibt als
--     Latin-1 das Byte FC, und das ist kein gueltiges UTF-8 -> Fehler ->
--     bleibt, wie er ist.
--   - Ein Name mit Zeichen ausserhalb von Latin-1 („€", Emoji) laesst sich
--     nicht nach Latin-1 wandeln -> Fehler -> bleibt.
--   - Ein Name nur aus ASCII ergibt sich selbst -> keine Aenderung.
-- Jeder Fehler wird je Zeile abgefangen (eigener BEGIN/EXCEPTION-Block);
-- eine einzelne Zeile kann die Migration nicht abbrechen.
--
-- WELCHE ZEILEN: nur Namen mit einem Zeichen zwischen U+00C2 und U+00F4 --
-- so beginnt jede als Latin-1 gelesene UTF-8-Folge von zwei bis vier Bytes
-- (Â, Ã fuer Umlaute und ß, â fuer „ – € …). Alles andere wird gar nicht
-- angefasst.
--
-- SPALTEN: chat_messages.file_name, material_files.original_name,
-- challenge_submissions.file_name -- die drei Stellen, an denen ein
-- Originalname aus dem Upload gespeichert wird (routes/chat.js,
-- routes/material.js, routes/challenges.js). Antrags-Fotos tragen einen
-- erzeugten Namen.
--
-- IDEMPOTENT: Ein reparierter Name ist richtiges UTF-8 und faellt beim
-- zweiten Lauf unter den ersten Fall oben.
--
-- SPERRE: Zeilensperren je UPDATE, kein Tabellen-Lock. Betroffen sind nur
-- die Zeilen mit Umlaut im Dateinamen.

DO $$
DECLARE
  zeile RECORD;
  repariert TEXT;
BEGIN
  FOR zeile IN
    SELECT id, file_name AS name FROM chat_messages
     WHERE file_name ~ '[Â-ô]'
  LOOP
    BEGIN
      repariert := convert_from(convert_to(zeile.name, 'LATIN1'), 'UTF8');
      IF repariert <> zeile.name THEN
        UPDATE chat_messages SET file_name = repariert WHERE id = zeile.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  FOR zeile IN
    SELECT id, original_name AS name FROM material_files
     WHERE original_name ~ '[Â-ô]'
  LOOP
    BEGIN
      repariert := convert_from(convert_to(zeile.name, 'LATIN1'), 'UTF8');
      IF repariert <> zeile.name THEN
        UPDATE material_files SET original_name = repariert WHERE id = zeile.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  FOR zeile IN
    SELECT id, file_name AS name FROM challenge_submissions
     WHERE file_name ~ '[Â-ô]'
  LOOP
    BEGIN
      repariert := convert_from(convert_to(zeile.name, 'LATIN1'), 'UTF8');
      IF repariert <> zeile.name THEN
        UPDATE challenge_submissions SET file_name = repariert WHERE id = zeile.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;
