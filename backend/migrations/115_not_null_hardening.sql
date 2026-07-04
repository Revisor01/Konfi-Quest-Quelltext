
DO $$ BEGIN
  ALTER TABLE chat_messages     ALTER COLUMN room_id  SET NOT NULL;
  ALTER TABLE chat_messages     ALTER COLUMN user_id  SET NOT NULL;
  ALTER TABLE chat_participants ALTER COLUMN room_id  SET NOT NULL;
  ALTER TABLE chat_participants ALTER COLUMN user_id  SET NOT NULL;
  ALTER TABLE push_tokens       ALTER COLUMN user_id  SET NOT NULL;
  ALTER TABLE push_tokens       ALTER COLUMN token    SET NOT NULL;
  ALTER TABLE users             ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE users             ALTER COLUMN role_id         SET NOT NULL;
  ALTER TABLE konfi_profiles    ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE chat_rooms        ALTER COLUMN organization_id SET NOT NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_badges_user_badge
  ON user_badges (user_id, badge_id);
