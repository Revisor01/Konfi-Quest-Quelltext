-- 105_apm_snapshots.sql
-- Persistente APM-Historie: der BackgroundService schreibt periodisch (alle 5 min)
-- einen Snapshot der kumulierten Zaehler. Da die In-Memory-Zaehler bei jedem Deploy/
-- Neustart auf 0 zuruecksetzen, speichern wir hier den ROH-Stand; das Dashboard
-- bildet Deltas zwischen aufeinanderfolgenden Snapshots (Reset = negativer Delta
-- wird als neuer Start behandelt). So bleibt der Verlauf ueber Deploys erhalten.
CREATE TABLE IF NOT EXISTS apm_snapshots (
  id             SERIAL PRIMARY KEY,
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_requests BIGINT      NOT NULL DEFAULT 0,
  total_errors   BIGINT      NOT NULL DEFAULT 0,
  max_in_flight  INTEGER     NOT NULL DEFAULT 0,
  worst_p95_ms   INTEGER     NOT NULL DEFAULT 0,
  worst_route    TEXT
);

CREATE INDEX IF NOT EXISTS idx_apm_snapshots_captured_at ON apm_snapshots (captured_at DESC);
