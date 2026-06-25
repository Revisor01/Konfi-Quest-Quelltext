-- ====================================================================
-- Migration 064: Inline Schema-Statements aus Routes konsolidiert
--
-- Diese Datei fasst alle CREATE TABLE / ALTER TABLE Statements zusammen,
-- die zuvor bei jedem Server-Start inline in Route-Dateien ausgefuehrt wurden.
-- Alle Statements sind idempotent (IF NOT EXISTS / DO-Bloecke).
-- ====================================================================

-- ====================================================================
-- Aus backend/routes/material.js
-- ====================================================================

-- material_tags Tabelle
CREATE TABLE IF NOT EXISTS material_tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  organization_id INTEGER REFERENCES organizations(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

-- materials Tabelle
CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  jahrgang_id INTEGER REFERENCES jahrgaenge(id) ON DELETE SET NULL,
  organization_id INTEGER REFERENCES organizations(id),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- material_file_tags (Join-Tabelle Material <-> Tags)
CREATE TABLE IF NOT EXISTS material_file_tags (
  material_id INTEGER REFERENCES materials(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES material_tags(id) ON DELETE CASCADE,
  PRIMARY KEY(material_id, tag_id)
);

-- material_files Tabelle
CREATE TABLE IF NOT EXISTS material_files (
  id SERIAL PRIMARY KEY,
  material_id INTEGER REFERENCES materials(id) ON DELETE CASCADE,
  original_name VARCHAR(500) NOT NULL,
  stored_name VARCHAR(100) NOT NULL,
  mime_type VARCHAR(100),
  file_size INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- material_events Join-Tabelle (Many-to-Many: Material <-> Events)
CREATE TABLE IF NOT EXISTS material_events (
  material_id INTEGER REFERENCES materials(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  PRIMARY KEY(material_id, event_id)
);

-- Migration: bestehende event_id Daten in Join-Tabelle uebertragen
INSERT INTO material_events (material_id, event_id)
SELECT id, event_id FROM materials
WHERE event_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- material_jahrgaenge Join-Tabelle (Many-to-Many: Material <-> Jahrgaenge)
CREATE TABLE IF NOT EXISTS material_jahrgaenge (
  material_id INTEGER REFERENCES materials(id) ON DELETE CASCADE,
  jahrgang_id INTEGER REFERENCES jahrgaenge(id) ON DELETE CASCADE,
  PRIMARY KEY(material_id, jahrgang_id)
);

-- Migration: bestehende jahrgang_id Daten in Join-Tabelle uebertragen
INSERT INTO material_jahrgaenge (material_id, jahrgang_id)
SELECT id, jahrgang_id FROM materials
WHERE jahrgang_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ====================================================================
-- Aus backend/routes/teamer.js
-- ====================================================================

-- certificate_types Tabelle
CREATE TABLE IF NOT EXISTS certificate_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(50) DEFAULT 'ribbon',
  organization_id INTEGER REFERENCES organizations(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

-- user_certificates Tabelle
CREATE TABLE IF NOT EXISTS user_certificates (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  certificate_type_id INTEGER REFERENCES certificate_types(id),
  organization_id INTEGER REFERENCES organizations(id),
  issued_date DATE NOT NULL,
  expiry_date DATE,
  admin_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, certificate_type_id)
);

-- teamer_since Spalte auf users (fuer Teamer-Aktiv-seit)
ALTER TABLE users ADD COLUMN IF NOT EXISTS teamer_since DATE;

-- ====================================================================
-- Aus backend/routes/jahrgaenge.js
-- ====================================================================

-- Punkte-Typ-Spalten auf jahrgaenge-Tabelle
ALTER TABLE jahrgaenge ADD COLUMN IF NOT EXISTS gottesdienst_enabled BOOLEAN DEFAULT true;
ALTER TABLE jahrgaenge ADD COLUMN IF NOT EXISTS gemeinde_enabled BOOLEAN DEFAULT true;
ALTER TABLE jahrgaenge ADD COLUMN IF NOT EXISTS target_gottesdienst INTEGER DEFAULT 10;
ALTER TABLE jahrgaenge ADD COLUMN IF NOT EXISTS target_gemeinde INTEGER DEFAULT 10;

-- ====================================================================
-- Aus backend/routes/settings.js
-- ====================================================================

-- organization_id Spalte auf settings (idempotent via DO-Block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'settings' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE settings ADD COLUMN organization_id INTEGER REFERENCES organizations(id);

    -- Bestehende Settings der ersten Organisation zuweisen
    UPDATE settings SET organization_id = (SELECT id FROM organizations ORDER BY id LIMIT 1)
    WHERE organization_id IS NULL;

    -- UNIQUE constraint auf (organization_id, key) setzen
    ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_key;
    ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
    ALTER TABLE settings ADD CONSTRAINT settings_org_key_unique UNIQUE (organization_id, key);
  END IF;
END $$;

-- ====================================================================
-- Aus backend/routes/badges.js
-- ====================================================================

-- Tabellen-Renames und Spalten-Renames aus badges.js:
-- Siehe 076_badges_rename_migrations.sql
