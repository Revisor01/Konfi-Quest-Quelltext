-- 099_chat_participants_allow_teamer.sql
-- Der CHECK-Constraint auf chat_participants.user_type erlaubte nur
-- ('admin','konfi') — 'teamer' fehlte. Da das System Teamer als user_type
-- 'teamer' fuehrt (Auto-Jahrgangschat), schlug das INSERT fehl.
-- Constraint (falls vorhanden) droppen und mit 'teamer' neu setzen. Gilt fuer
-- chat_participants UND chat_read_status (gleiches Muster im Schema).
ALTER TABLE chat_participants DROP CONSTRAINT IF EXISTS chat_participants_user_type_check;
ALTER TABLE chat_participants ADD CONSTRAINT chat_participants_user_type_check
  CHECK (user_type IN ('admin', 'teamer', 'konfi'));

ALTER TABLE chat_read_status DROP CONSTRAINT IF EXISTS chat_read_status_user_type_check;
ALTER TABLE chat_read_status ADD CONSTRAINT chat_read_status_user_type_check
  CHECK (user_type IN ('admin', 'teamer', 'konfi'));
