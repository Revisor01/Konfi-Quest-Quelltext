-- Migration 083: Konfi-Limit pro Organisation (Tarif-Durchsetzung)
-- Fuegt die nullbare Spalte organizations.max_konfis hinzu.
--   max_konfis IS NULL  = unbegrenzt, Limit-Durchsetzung wird komplett uebersprungen.
--   max_konfis = <int>   = harte Tarif-Grenze (super_admin setzt sie manuell pro Tarif).
-- Es gibt KEINEN Backfill und KEINEN DEFAULT: bestehende UND neue Orgs starten auf NULL,
-- damit keine aktive Gemeinde durch die Migration ploetzlich blockiert wird.
-- Das Limit wird ausschliesslich vom super_admin ueber einen eigenen Endpunkt gesetzt;
-- die normale Org-PUT-Route (org_admin fuer eigene Org) fasst max_konfis nie an.
-- Das Statement ist idempotent (IF NOT EXISTS) und wird vom Migration-Runner
-- (backend/database.js, alphabetisch sortiert) in einem einzigen pool.query ausgefuehrt.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_konfis INTEGER NULL;
