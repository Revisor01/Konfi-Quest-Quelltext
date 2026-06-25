-- Migration: Push Foundation (Phase 25)
-- Run this SQL on the production database

-- push_tokens Tabelle (vollstaendiges Schema fuer Erstinstallation)
CREATE TABLE IF NOT EXISTS push_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    user_type TEXT NOT NULL,
    token TEXT NOT NULL,
    platform TEXT NOT NULL,
    device_id TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    error_count INTEGER DEFAULT 0,
    last_error_at TIMESTAMPTZ,
    UNIQUE(user_id, platform, device_id)
);

-- Neue Spalten fuer bestehende Installationen hinzufuegen
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS error_count INTEGER DEFAULT 0;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;

-- event_reminders Tabelle (verhindert doppelte Erinnerungen)
CREATE TABLE IF NOT EXISTS event_reminders (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reminder_type VARCHAR(10) NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, user_id, reminder_type)
);

-- Index fuer schnelle Lookups
CREATE INDEX IF NOT EXISTS idx_event_reminders_event_user ON event_reminders(event_id, user_id);
