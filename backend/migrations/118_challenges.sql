-- 118_challenges.sql
-- Challenges 2.0: der erste NICHT-quantitative Baustein der App. Konfis
-- produzieren eigene Deutungen (Foto, Text, Audio, Video, Link) statt
-- Teilnahme zu zaehlen. Bewusst OHNE Punkte, OHNE Eintrag ins Badge-System
-- (custom_badges) und OHNE Zaehler/Ranglisten.
--
-- Status ist ABGELEITET (keine Spalte):
--   draft (is_draft) -> scheduled (starts_at > NOW()) -> active -> ended (ends_at < NOW())
-- Archiv = ended.
--
-- Abzeichen sind ebenfalls abgeleitet: ein Konfi hat das Abzeichen einer
-- Challenge, wenn mindestens eine eigene Submission existiert. badge_icon /
-- badge_name haengen an der Challenge, nicht am Konfi.

CREATE TABLE IF NOT EXISTS challenges (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  -- inkl. Freitext-Rueckkanal ("Was passiert mit euren Beitraegen")
  description TEXT NOT NULL,
  -- 'wahrnehmung' | 'beitrag' | 'praxis' | 'frei' — nur Label/Filter, kein Verhalten
  challenge_type VARCHAR(20) NOT NULL DEFAULT 'frei',
  -- 'public' | 'konfi_choice' | 'private' — nach Start unveraenderbar (Konsens-Integritaet)
  visibility VARCHAR(20) NOT NULL DEFAULT 'konfi_choice',
  moderated BOOLEAN NOT NULL DEFAULT true,
  -- Teilmenge von text | photo | audio | video | link
  allowed_media JSONB NOT NULL DEFAULT '["text","photo"]'::jsonb,
  allow_multiple BOOLEAN NOT NULL DEFAULT true,
  badge_icon VARCHAR(50) NOT NULL DEFAULT 'flag',  -- ionicons-Name (KEINE Emojis)
  badge_name VARCHAR(100) NOT NULL,
  -- Urheber: entweder ein User der Org ODER ein Freitext ("Der Kirchenvorstand")
  author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_freetext VARCHAR(200),
  created_by INTEGER NOT NULL REFERENCES users(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  is_draft BOOLEAN NOT NULL DEFAULT true,
  -- Idempotenz-Flag fuer den Start-Push-Cron (backgroundService)
  start_push_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS challenge_jahrgang_assignments (
  id SERIAL PRIMARY KEY,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  jahrgang_id INTEGER NOT NULL REFERENCES jahrgaenge(id) ON DELETE CASCADE,
  UNIQUE(challenge_id, jahrgang_id)
);

CREATE TABLE IF NOT EXISTS challenge_submissions (
  id SERIAL PRIMARY KEY,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- 'text' | 'photo' | 'audio' | 'video' | 'link'
  media_type VARCHAR(10) NOT NULL,
  -- bei text Pflicht, bei link/Medien optionaler Begleittext
  text_content TEXT,
  -- Hex-Dateiname in uploads/challenges/ (verschluesselt abgelegt)
  file_path VARCHAR(100),
  file_name VARCHAR(255),   -- Originalname (fuer Content-Type-Mapping)
  link_url TEXT,
  -- 'publish' | 'private' | 'anonymous'; NUR bei visibility='konfi_choice'.
  -- Kein SQL-DEFAULT: bei visibility 'public'/'private' bleibt die Spalte NULL,
  -- damit die zentrale Sichtbarkeitslogik eindeutig bleibt. Der Fallback
  -- 'publish' (fehlende Angabe bei konfi_choice) wird in der Route gesetzt.
  konfi_consent VARCHAR(20),
  -- 'pending' | 'approved' | 'hidden'; bei moderated=false direkt 'approved'
  moderation_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  hidden_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  hidden_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenge_submissions_challenge ON challenge_submissions(challenge_id);
CREATE INDEX IF NOT EXISTS idx_challenge_submissions_user ON challenge_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_challenges_org ON challenges(organization_id);
CREATE INDEX IF NOT EXISTS idx_challenge_jahrgang_assignments_jahrgang ON challenge_jahrgang_assignments(jahrgang_id);
