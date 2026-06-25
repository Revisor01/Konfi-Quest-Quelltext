-- Migration: Wrapped Feature (Konfi + Teamer Wrapped Snapshots)

CREATE TABLE IF NOT EXISTS wrapped_snapshots (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  wrapped_type VARCHAR(10) NOT NULL CHECK (wrapped_type IN ('konfi', 'teamer')),
  jahrgang_id INTEGER REFERENCES jahrgaenge(id) ON DELETE SET NULL,
  year INTEGER NOT NULL,
  data JSONB NOT NULL,
  computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, wrapped_type, year)
);

CREATE INDEX IF NOT EXISTS idx_wrapped_snapshots_org_year
  ON wrapped_snapshots(organization_id, year);
CREATE INDEX IF NOT EXISTS idx_wrapped_snapshots_user
  ON wrapped_snapshots(user_id, wrapped_type);

ALTER TABLE jahrgaenge ADD COLUMN IF NOT EXISTS wrapped_released_at TIMESTAMP;
