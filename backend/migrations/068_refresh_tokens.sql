-- Migration 068: Refresh-Token-System
-- Erstellt refresh_tokens Tabelle und token_invalidated_at Spalte auf users

-- refresh_tokens Tabelle
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

-- token_invalidated_at Spalte auf users (fuer Soft-Revoke)
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_invalidated_at TIMESTAMP;
