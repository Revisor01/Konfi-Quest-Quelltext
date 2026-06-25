-- Migration: Idempotency Keys (Phase 57)
-- Run this SQL on the production database

-- client_id fuer Chat-Nachrichten (Deduplizierung bei Retry/Queue)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS client_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_client_id ON chat_messages (client_id) WHERE client_id IS NOT NULL;

-- client_id fuer Aktivitaets-Antraege (Deduplizierung bei Retry/Queue)
ALTER TABLE activity_requests ADD COLUMN IF NOT EXISTS client_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_requests_client_id ON activity_requests (client_id) WHERE client_id IS NOT NULL;
