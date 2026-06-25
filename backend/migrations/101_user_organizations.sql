-- 101_user_organizations.sql
-- Multi-Org-Support: Ein User-Account kann Mitglied in mehreren Organisationen
-- sein (z.B. Pastor:innen die mehrere Gemeinden betreuen, oder Super-Admin).
--
-- Bisher: users.organization_id + users.role_id = GENAU EINE Org/Rolle pro User.
-- Diese bleiben als PRIMAER-/Default-Org erhalten (kein Drop -> rueckwaertskompatibel).
-- Neu: M:N-Mapping user_organizations(user_id, organization_id, role_id) haelt die
-- ZUSAETZLICHEN Mitgliedschaften. verifyTokenRBAC setzt bei aktivem Org-Header die
-- Org+Rolle aus diesem Mapping; ohne Header bleibt die Primaer-Org aus users.

CREATE TABLE IF NOT EXISTS user_organizations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Ein User kann pro Organisation nur EINE Mitgliedschaft/Rolle haben
    CONSTRAINT user_organizations_user_org_unique UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_user_organizations_user ON user_organizations (user_id);
CREATE INDEX IF NOT EXISTS idx_user_organizations_org ON user_organizations (organization_id);

-- Bestehende User in das Mapping uebernehmen: jeder kommt mit seiner aktuellen
-- Primaer-Org + Rolle rein. Super-Admins ohne Org (organization_id IS NULL)
-- werden uebersprungen (kein Org-Kontext zu mappen).
INSERT INTO user_organizations (user_id, organization_id, role_id)
SELECT u.id, u.organization_id, u.role_id
FROM users u
WHERE u.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_organizations uo
    WHERE uo.user_id = u.id AND uo.organization_id = u.organization_id
  );
