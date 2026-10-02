-- Einladung in eine zweite Gemeinde
--
-- WARUM EINE BESTAETIGUNG: Eine Mitgliedschaft aendert, was jemand sieht und
-- darf. Sie wird deshalb nicht ueber den Kopf der Person hinweg angelegt --
-- der Eingeladene entscheidet selbst. Bis dahin steht hier nur eine Absicht,
-- keine Zugehoerigkeit.
--
-- KONFI IST HIER NICHT MOEGLICH: Konfis gehoeren zu einem Jahrgang und kommen
-- ueber die Einladungscodes (invite_codes, Migration 079). Die Rollenhierarchie
-- allein sichert das NICHT ab -- canCreateRole('org_admin', 'konfi') liefert
-- true. Deshalb steht die Grenze im CHECK und zusaetzlich in der Route.
--
-- 14 TAGE wie die Einladungscodes fuer Konfis. expires_at
-- ist TIMESTAMPTZ, weil es in JavaScript verglichen wird -- genau der Fehler,
-- den Migration 139 bei invite_codes nachtraeglich reparieren musste.
--
-- ALT-APP-VERTRAG: rein additiv.

CREATE TABLE IF NOT EXISTS org_einladungen (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Die eingeladene Person. Loescht sie ihr Konto, faellt die Einladung mit.
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Die Rolle, die sie in DIESER Gemeinde bekommen soll. Gehoert zur
  -- einladenden Organisation (roles.organization_id) -- die Route prueft das.
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  -- Wer eingeladen hat. ON DELETE SET NULL, damit eine offene Einladung nicht
  -- verschwindet, nur weil die einladende Person die Gemeinde verlaesst.
  eingeladen_von INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'offen'
    CHECK (status IN ('offen', 'angenommen', 'abgelehnt', 'zurueckgezogen')),
  expires_at TIMESTAMPTZ NOT NULL,
  beantwortet_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Nur EINE offene Einladung je Person und Gemeinde. Der Teilindex laesst
-- beantwortete Einladungen mehrfach zu (Verlauf), verhindert aber, dass
-- jemand zweimal dieselbe offene Einladung bekommt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_einladungen_offen
  ON org_einladungen(organization_id, user_id)
  WHERE status = 'offen';

-- Die eigenen offenen Einladungen (Startseite, Postfach-Tap).
CREATE INDEX IF NOT EXISTS idx_org_einladungen_user
  ON org_einladungen(user_id, status);

-- Die Liste der Leitung je Gemeinde.
CREATE INDEX IF NOT EXISTS idx_org_einladungen_org
  ON org_einladungen(organization_id, status);

COMMENT ON TABLE org_einladungen IS
  'Einladung einer bestehenden Person in eine weitere Gemeinde. Erst die Annahme legt die Zeile in user_organizations an (26.09.2026).';
COMMENT ON COLUMN org_einladungen.expires_at IS
  'TIMESTAMPTZ, weil in JavaScript verglichen (vgl. Migration 139). 14 Tage ab Einladung.';
COMMENT ON COLUMN org_einladungen.role_id IS
  'Rolle in DIESER Gemeinde. Niemals die konfi-Rolle -- Konfis kommen ueber invite_codes.';
