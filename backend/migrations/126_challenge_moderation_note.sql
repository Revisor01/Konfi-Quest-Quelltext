-- Beim Freigeben / Wieder-Einblenden wird die Notiz abgeraeumt — sie gehört
-- zum hidden-Zustand wie hidden_by/hidden_at.
ALTER TABLE challenge_submissions ADD COLUMN IF NOT EXISTS moderation_note TEXT;
