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

-- organization_id-Index: Migration 064 legt ihn eigentlich an, kommt aber
-- VOR dieser Datei — auf einer frischen Datenbank existiert die Tabelle dort
-- noch nicht und der Index entfaellt. Hier nachziehen,
-- damit er auf jedem Weg entsteht. In Produktion ein No-Op.
CREATE INDEX IF NOT EXISTS idx_invite_codes_organization_id ON invite_codes(organization_id);
