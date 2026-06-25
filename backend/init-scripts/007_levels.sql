-- Level-System für Konfi-Punkte

-- Tabelle für Level-Definitionen
CREATE TABLE IF NOT EXISTS levels (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  points_required INTEGER NOT NULL CHECK (points_required >= 0),
  icon VARCHAR(50) DEFAULT 'trophy',
  color VARCHAR(7) DEFAULT '#3880ff',
  reward_type VARCHAR(50), -- 'badge', 'points', 'special', etc.
  reward_value TEXT, -- JSON mit Belohnungsdetails
  is_active BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(organization_id, name),
  UNIQUE(organization_id, points_required)
);

-- Index für bessere Performance
CREATE INDEX IF NOT EXISTS idx_levels_organization_points ON levels(organization_id, points_required);
CREATE INDEX IF NOT EXISTS idx_levels_active ON levels(organization_id, is_active);

-- Erweitere konfi_profiles um current_level_id
ALTER TABLE konfi_profiles 
ADD COLUMN IF NOT EXISTS current_level_id INTEGER REFERENCES levels(id);

-- Index für Level-Zuordnung
CREATE INDEX IF NOT EXISTS idx_konfi_profiles_current_level ON konfi_profiles(current_level_id);

-- Neue Permission für Level-Management
INSERT INTO permissions (name, description, category)
VALUES ('manage_levels', 'Level-System verwalten', 'levels')
ON CONFLICT (name) DO NOTHING;

-- Standard-Level für bestehende Organisationen erstellen
INSERT INTO levels (organization_id, name, title, description, points_required, icon, color, created_at)
SELECT 
  o.id as organization_id,
  'novize' as name,
  'Novize' as title,
  'Der erste Schritt auf deiner Konfi-Reise' as description,
  0 as points_required,
  'leaf' as icon,
  '#10b981' as color,
  CURRENT_TIMESTAMP as created_at
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM levels l WHERE l.organization_id = o.id AND l.points_required = 0
);

INSERT INTO levels (organization_id, name, title, description, points_required, icon, color, created_at)
SELECT 
  o.id as organization_id,
  'lehrling' as name,
  'Lehrling' as title,
  'Du sammelst erste Erfahrungen' as description,
  5 as points_required,
  'book' as icon,
  '#3b82f6' as color,
  CURRENT_TIMESTAMP as created_at
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM levels l WHERE l.organization_id = o.id AND l.points_required = 5
);

INSERT INTO levels (organization_id, name, title, description, points_required, icon, color, created_at)
SELECT 
  o.id as organization_id,
  'gehilfe' as name,
  'Gehilfe' as title,
  'Du hilfst bereits anderen' as description,
  10 as points_required,
  'people' as icon,
  '#8b5cf6' as color,
  CURRENT_TIMESTAMP as created_at
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM levels l WHERE l.organization_id = o.id AND l.points_required = 10
);

INSERT INTO levels (organization_id, name, title, description, points_required, icon, color, created_at)
SELECT 
  o.id as organization_id,
  'experte' as name,
  'Experte' as title,
  'Du kennst dich richtig gut aus' as description,
  15 as points_required,
  'star' as icon,
  '#f59e0b' as color,
  CURRENT_TIMESTAMP as created_at
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM levels l WHERE l.organization_id = o.id AND l.points_required = 15
);

INSERT INTO levels (organization_id, name, title, description, points_required, icon, color, created_at)
SELECT 
  o.id as organization_id,
  'meister' as name,
  'Meister' as title,
  'Du bist ein wahrer Könner' as description,
  20 as points_required,
  'trophy' as icon,
  '#ef4444' as color,
  CURRENT_TIMESTAMP as created_at
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM levels l WHERE l.organization_id = o.id AND l.points_required = 20
);

INSERT INTO levels (organization_id, name, title, description, points_required, icon, color, created_at)
SELECT 
  o.id as organization_id,
  'legende' as name,
  'Legende' as title,
  'Du hast legendären Status erreicht!' as description,
  30 as points_required,
  'medal' as icon,
  '#7c3aed' as color,
  CURRENT_TIMESTAMP as created_at
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM levels l WHERE l.organization_id = o.id AND l.points_required = 30
);

-- Update aktuelle Level für alle Konfis basierend auf ihren Punkten
UPDATE konfi_profiles 
SET current_level_id = (
  SELECT l.id 
  FROM levels l
  JOIN users u ON u.organization_id = l.organization_id
  WHERE u.id = konfi_profiles.user_id 
    AND l.points_required <= (konfi_profiles.gottesdienst_points + konfi_profiles.gemeinde_points)
    AND l.is_active = true
  ORDER BY l.points_required DESC
  LIMIT 1
)
WHERE current_level_id IS NULL;