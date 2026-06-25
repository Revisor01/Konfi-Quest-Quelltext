-- Migration: Add invite_codes table for Konfi self-registration
-- Run this SQL on the production database

CREATE TABLE IF NOT EXISTS invite_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(10) NOT NULL UNIQUE,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    jahrgang_id INTEGER NOT NULL REFERENCES jahrgaenge(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast code lookup
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_codes_expires ON invite_codes(expires_at);
