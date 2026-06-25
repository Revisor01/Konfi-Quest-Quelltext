-- 092_sync_schema_drift.sql
-- Schliesst eine vorbestehende Schema-Drift zwischen Prod und init-scripts/Test-DB.
-- Diese Objekte existieren in Prod (direkt angelegt, nie als Migration erfasst),
-- fehlten aber im init-Schema -> Test-DB hatte sie nicht. Aufgedeckt durch die
-- is_konfirmation-Tests (GET /events/:id selektiert events.cancelled_at).
--
-- Alle Schritte idempotent (IF NOT EXISTS): trifft Prod NICHT (schon vorhanden),
-- vervollstaendigt Test-DB und jede frische Installation.

-- events: Storno-Spalten (Prod: cancelled boolean default false, cancelled_at timestamptz)
ALTER TABLE events ADD COLUMN IF NOT EXISTS cancelled BOOLEAN DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- event_unregistrations: Abmelde-Protokoll (Prod-Struktur 1:1)
CREATE TABLE IF NOT EXISTS event_unregistrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    reason TEXT,
    unregistered_at TIMESTAMP DEFAULT now(),
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_event_unregistrations_event ON event_unregistrations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_unregistrations_org ON event_unregistrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_event_unregistrations_user ON event_unregistrations(user_id);
