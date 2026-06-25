-- 107_users_bible_translation.sql
-- Bibeluebersetzungs-Praeferenz fuer Teamer (und perspektivisch alle Nicht-Konfis).
-- Konfis speichern ihre Praeferenz in konfi_profiles.bible_translation; Teamer
-- haben kein konfi_profile, daher eine rollenneutrale Spalte direkt an users.
-- Wird fuer die Tageslosungs-Sprache der Teamer genutzt (Default LUT = Luther).
ALTER TABLE users ADD COLUMN IF NOT EXISTS bible_translation VARCHAR(10) NOT NULL DEFAULT 'LUT';
