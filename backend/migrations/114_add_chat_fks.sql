
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_chat_messages_user') THEN
    ALTER TABLE chat_messages ADD CONSTRAINT fk_chat_messages_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_chat_participants_user') THEN
    ALTER TABLE chat_participants ADD CONSTRAINT fk_chat_participants_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_chat_rooms_event') THEN
    ALTER TABLE chat_rooms ADD CONSTRAINT fk_chat_rooms_event
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
  END IF;
END $$;
