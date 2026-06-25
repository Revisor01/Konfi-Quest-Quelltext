-- 104_team_chat.sql
-- Automatischer Team-Chat (analog Jahrgangs-Chat): ein Chat pro Organisation mit
-- allen Admins/Org-Admins/Teamern. Wird ueber das Flag is_team_chat eindeutig
-- identifiziert (type bleibt 'admin' -> faerbt pink + landet im Team-Tab).
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS is_team_chat BOOLEAN DEFAULT false;

-- Pro Organisation darf es nur EINEN Auto-Team-Chat geben (Idempotenz der Sync-Logik).
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_rooms_one_team_chat_per_org
  ON chat_rooms (organization_id)
  WHERE is_team_chat = true;
