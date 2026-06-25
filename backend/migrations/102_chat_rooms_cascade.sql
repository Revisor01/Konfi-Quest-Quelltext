-- 102_chat_rooms_cascade.sql
-- Bug: Beim Loeschen eines chat_rooms blieben chat_messages und
-- chat_participants als WAISEN zurueck, weil ihre room_id KEINEN Foreign Key
-- auf chat_rooms hatte (chat_read_status hatte bereits ON DELETE CASCADE).
-- Folge: 139 verwaiste Nachrichten + 6 Teilnehmer nach einem Org-Cleanup.
--
-- Diese Migration zieht eine durchgaengige ON DELETE CASCADE-Kette nach, sodass
-- ein DELETE FROM chat_rooms automatisch Nachrichten, Teilnehmer, Polls,
-- Poll-Votes, Reaktionen und Read-Status mitnimmt. reply_to (Selbstreferenz auf
-- chat_messages) wird auf SET NULL gestellt, damit das Loeschen einer Nachricht
-- nicht an einer Antwort-Verkettung haengen bleibt.
--
-- Idempotent: bestehende FK-Constraints werden (per gefundenem Namen) gedroppt
-- und mit der gewuenschten Regel neu angelegt. Constraint-Namen koennen je nach
-- Instanz abweichen, daher werden sie dynamisch aus dem Katalog ermittelt.

DO $$
DECLARE
  cname text;
BEGIN
  -- Hilfsfunktion-Ersatz inline: pro (Tabelle, Spalte) den vorhandenen FK droppen
  -- und mit der Zielregel neu setzen.

  -- 1. chat_messages.room_id -> chat_rooms ON DELETE CASCADE (FEHLTE komplett)
  FOR cname IN
    SELECT tc.constraint_name FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name='chat_messages' AND kcu.column_name='room_id'
  LOOP
    EXECUTE format('ALTER TABLE chat_messages DROP CONSTRAINT %I', cname);
  END LOOP;
  ALTER TABLE chat_messages
    ADD CONSTRAINT chat_messages_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE;

  -- 2. chat_participants.room_id -> chat_rooms ON DELETE CASCADE (FEHLTE komplett)
  FOR cname IN
    SELECT tc.constraint_name FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name='chat_participants' AND kcu.column_name='room_id'
  LOOP
    EXECUTE format('ALTER TABLE chat_participants DROP CONSTRAINT %I', cname);
  END LOOP;
  ALTER TABLE chat_participants
    ADD CONSTRAINT chat_participants_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE;

  -- 3. chat_messages.reply_to -> chat_messages ON DELETE SET NULL (war NO ACTION)
  FOR cname IN
    SELECT tc.constraint_name FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name='chat_messages' AND kcu.column_name='reply_to'
  LOOP
    EXECUTE format('ALTER TABLE chat_messages DROP CONSTRAINT %I', cname);
  END LOOP;
  ALTER TABLE chat_messages
    ADD CONSTRAINT chat_messages_reply_to_fkey
    FOREIGN KEY (reply_to) REFERENCES chat_messages(id) ON DELETE SET NULL;

  -- 4. chat_polls.message_id -> chat_messages ON DELETE CASCADE (war NO ACTION)
  FOR cname IN
    SELECT tc.constraint_name FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name='chat_polls' AND kcu.column_name='message_id'
  LOOP
    EXECUTE format('ALTER TABLE chat_polls DROP CONSTRAINT %I', cname);
  END LOOP;
  ALTER TABLE chat_polls
    ADD CONSTRAINT chat_polls_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE;

  -- 5. chat_poll_votes.poll_id: doppelter FK (CASCADE + NO ACTION) -> auf EINEN
  --    CASCADE-FK normalisieren.
  FOR cname IN
    SELECT tc.constraint_name FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name='chat_poll_votes' AND kcu.column_name='poll_id'
  LOOP
    EXECUTE format('ALTER TABLE chat_poll_votes DROP CONSTRAINT %I', cname);
  END LOOP;
  ALTER TABLE chat_poll_votes
    ADD CONSTRAINT chat_poll_votes_poll_id_fkey
    FOREIGN KEY (poll_id) REFERENCES chat_polls(id) ON DELETE CASCADE;

  -- chat_message_reactions.message_id und chat_read_status.room_id sind bereits
  -- ON DELETE CASCADE -> unveraendert.
END $$;
