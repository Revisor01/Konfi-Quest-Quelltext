-- PostgreSQL Schema für Konfi Quest mit Constraints und Indexen
-- Basiert auf SQLite Schema, optimiert für PostgreSQL

-- Extensions für UUID und Crypto
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ====================================================================
-- ORGANIZATIONS (Multi-Tenant Support)
-- ====================================================================

CREATE TABLE organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint für Organization Namen
ALTER TABLE organizations ADD CONSTRAINT organizations_name_unique UNIQUE (name);

-- Index für Organization Lookups
CREATE INDEX idx_organizations_name ON organizations (name);

-- ====================================================================
-- ROLES & PERMISSIONS (RBAC System)
-- ====================================================================

CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(255),
    description TEXT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint: Ein Role-Name pro Organization
ALTER TABLE roles ADD CONSTRAINT roles_name_org_unique UNIQUE (name, organization_id);

-- Index für Role Lookups
CREATE INDEX idx_roles_name_org ON roles (name, organization_id);
CREATE INDEX idx_roles_org ON roles (organization_id);

CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255),
    description TEXT,
    category VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index für Permission Lookups
CREATE INDEX idx_permissions_name ON permissions (name);
CREATE INDEX idx_permissions_category ON permissions (category);

CREATE TABLE role_permissions (
    id SERIAL PRIMARY KEY,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint: Eine Permission pro Role
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_unique UNIQUE (role_id, permission_id);

-- Indexes für schnelle Permission Checks
CREATE INDEX idx_role_permissions_role ON role_permissions (role_id);
CREATE INDEX idx_role_permissions_permission ON role_permissions (permission_id);

-- ====================================================================
-- USERS (Admins + Konfis unified)
-- ====================================================================

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    display_name VARCHAR(255) NOT NULL,
    username VARCHAR(100),
    email VARCHAR(255),
    password_hash VARCHAR(255),
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraints
ALTER TABLE users ADD CONSTRAINT users_username_org_unique UNIQUE (username, organization_id);
ALTER TABLE users ADD CONSTRAINT users_email_org_unique UNIQUE (email, organization_id);

-- Indexes für User Lookups
CREATE INDEX idx_users_username_org ON users (username, organization_id);
CREATE INDEX idx_users_email_org ON users (email, organization_id);
CREATE INDEX idx_users_role ON users (role_id);
CREATE INDEX idx_users_org ON users (organization_id);
CREATE INDEX idx_users_active ON users (is_active);

-- ====================================================================
-- JAHRGAENGE (Confirmation Years)
-- ====================================================================

CREATE TABLE jahrgaenge (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint: Ein Jahrgang-Name pro Organization
ALTER TABLE jahrgaenge ADD CONSTRAINT jahrgaenge_name_org_unique UNIQUE (name, organization_id);

-- Index für Jahrgang Lookups
CREATE INDEX idx_jahrgaenge_name_org ON jahrgaenge (name, organization_id);
CREATE INDEX idx_jahrgaenge_org ON jahrgaenge (organization_id);

-- ====================================================================
-- KONFI PROFILES (Konfi-specific data)
-- ====================================================================

CREATE TABLE konfi_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    jahrgang_id INTEGER REFERENCES jahrgaenge(id) ON DELETE SET NULL,
    gottesdienst_points INTEGER DEFAULT 0 CHECK (gottesdienst_points >= 0),
    gemeinde_points INTEGER DEFAULT 0 CHECK (gemeinde_points >= 0),
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint: Ein Profil pro User
ALTER TABLE konfi_profiles ADD CONSTRAINT konfi_profiles_user_unique UNIQUE (user_id);

-- Indexes für Konfi Queries
CREATE INDEX idx_konfi_profiles_user ON konfi_profiles (user_id);
CREATE INDEX idx_konfi_profiles_jahrgang ON konfi_profiles (jahrgang_id);
CREATE INDEX idx_konfi_profiles_org ON konfi_profiles (organization_id);
CREATE INDEX idx_konfi_profiles_points ON konfi_profiles (gottesdienst_points, gemeinde_points);

-- ====================================================================
-- CATEGORIES (Activity/Event Categories)
-- ====================================================================

CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(20) DEFAULT 'both' CHECK (type IN ('activity', 'event', 'both')),
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint: Ein Category-Name pro Organization
ALTER TABLE categories ADD CONSTRAINT categories_name_org_unique UNIQUE (name, organization_id);

-- Indexes
CREATE INDEX idx_categories_name_org ON categories (name, organization_id);
CREATE INDEX idx_categories_type_org ON categories (type, organization_id);
CREATE INDEX idx_categories_org ON categories (organization_id);

-- ====================================================================
-- ACTIVITIES
-- ====================================================================

CREATE TABLE activities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    gottesdienst_points INTEGER DEFAULT 0 CHECK (gottesdienst_points >= 0),
    gemeinde_points INTEGER DEFAULT 0 CHECK (gemeinde_points >= 0),
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index für Activity Lookups
CREATE INDEX idx_activities_name_org ON activities (name, organization_id);
CREATE INDEX idx_activities_org ON activities (organization_id);
CREATE INDEX idx_activities_points ON activities (gottesdienst_points, gemeinde_points);

-- Activity-Category Relations
CREATE TABLE activity_categories (
    id SERIAL PRIMARY KEY,
    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE
);

-- Unique constraint
ALTER TABLE activity_categories ADD CONSTRAINT activity_categories_unique UNIQUE (activity_id, category_id);

-- Indexes
CREATE INDEX idx_activity_categories_activity ON activity_categories (activity_id);
CREATE INDEX idx_activity_categories_category ON activity_categories (category_id);

-- ====================================================================
-- KONFI ACTIVITIES (Completed Activities)
-- ====================================================================

CREATE TABLE konfi_activities (
    id SERIAL PRIMARY KEY,
    konfi_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    completed_date DATE NOT NULL DEFAULT CURRENT_DATE,
    admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    comment TEXT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint: Eine Activity pro Konfi
ALTER TABLE konfi_activities ADD CONSTRAINT konfi_activities_unique UNIQUE (konfi_id, activity_id);

-- Indexes für Activity Queries
CREATE INDEX idx_konfi_activities_konfi ON konfi_activities (konfi_id);
CREATE INDEX idx_konfi_activities_activity ON konfi_activities (activity_id);
CREATE INDEX idx_konfi_activities_date ON konfi_activities (completed_date);
CREATE INDEX idx_konfi_activities_admin ON konfi_activities (admin_id);
CREATE INDEX idx_konfi_activities_org ON konfi_activities (organization_id);

-- ====================================================================
-- BONUS POINTS
-- ====================================================================

CREATE TABLE bonus_points (
    id SERIAL PRIMARY KEY,
    konfi_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    points INTEGER NOT NULL CHECK (points != 0),
    type VARCHAR(20) NOT NULL CHECK (type IN ('gottesdienst', 'gemeinde')),
    description TEXT NOT NULL,
    admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes für Bonus Points
CREATE INDEX idx_bonus_points_konfi ON bonus_points (konfi_id);
CREATE INDEX idx_bonus_points_type ON bonus_points (type);
CREATE INDEX idx_bonus_points_admin ON bonus_points (admin_id);
CREATE INDEX idx_bonus_points_org ON bonus_points (organization_id);
CREATE INDEX idx_bonus_points_created ON bonus_points (created_at);

-- ====================================================================
-- BADGES
-- ====================================================================

CREATE TABLE badges (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(100),
    condition_type VARCHAR(50) NOT NULL,
    condition_value INTEGER,
    condition_data JSONB,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index für Badge Lookups
CREATE INDEX idx_badges_name_org ON badges (name, organization_id);
CREATE INDEX idx_badges_condition ON badges (condition_type);
CREATE INDEX idx_badges_org ON badges (organization_id);

-- Badge Assignments
CREATE TABLE konfi_badges (
    id SERIAL PRIMARY KEY,
    konfi_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    awarded_date DATE NOT NULL DEFAULT CURRENT_DATE,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint: Ein Badge pro Konfi
ALTER TABLE konfi_badges ADD CONSTRAINT konfi_badges_unique UNIQUE (konfi_id, badge_id);

-- Indexes
CREATE INDEX idx_konfi_badges_konfi ON konfi_badges (konfi_id);
CREATE INDEX idx_konfi_badges_badge ON konfi_badges (badge_id);
CREATE INDEX idx_konfi_badges_date ON konfi_badges (awarded_date);
CREATE INDEX idx_konfi_badges_org ON konfi_badges (organization_id);

-- ====================================================================
-- EVENTS
-- ====================================================================

CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    event_date TIMESTAMP NOT NULL,
    event_end_time TIMESTAMP,
    location VARCHAR(255),
    location_maps_url TEXT,
    points INTEGER DEFAULT 0 CHECK (points >= 0),
    point_type VARCHAR(20) DEFAULT 'gemeinde' CHECK (point_type IN ('gottesdienst', 'gemeinde')),
    type VARCHAR(50) DEFAULT 'event',
    max_participants INTEGER NOT NULL DEFAULT 0 CHECK (max_participants >= 0),
    mandatory BOOLEAN DEFAULT false,
    bring_items TEXT,
    qr_token TEXT DEFAULT NULL,
    checkin_window INTEGER DEFAULT 30,
    teamer_needed BOOLEAN DEFAULT false,
    teamer_only BOOLEAN DEFAULT false,
    registration_opens_at TIMESTAMP,
    registration_closes_at TIMESTAMP,
    has_timeslots BOOLEAN DEFAULT false,
    waitlist_enabled BOOLEAN DEFAULT true,
    max_waitlist_size INTEGER DEFAULT 10 CHECK (max_waitlist_size >= 0),
    is_series BOOLEAN DEFAULT false,
    -- series_id = ID des ersten Events der Serie (Prod ist BIGINT, NICHT UUID)
    series_id BIGINT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Constraints
ALTER TABLE events ADD CONSTRAINT events_registration_dates_check 
    CHECK (registration_opens_at IS NULL OR registration_closes_at IS NULL OR registration_opens_at < registration_closes_at);
ALTER TABLE events ADD CONSTRAINT events_event_dates_check
    CHECK (event_end_time IS NULL OR event_date < event_end_time);
ALTER TABLE events ADD CONSTRAINT events_teamer_exclusive
    CHECK (NOT (teamer_needed = true AND teamer_only = true));

-- Indexes für Event Queries
CREATE INDEX idx_events_date ON events (event_date);
CREATE INDEX idx_events_registration ON events (registration_opens_at, registration_closes_at);
CREATE INDEX idx_events_series ON events (series_id) WHERE series_id IS NOT NULL;
CREATE INDEX idx_events_org ON events (organization_id);
CREATE INDEX idx_events_created_by ON events (created_by);
CREATE INDEX idx_events_timeslots ON events (has_timeslots) WHERE has_timeslots = true;
CREATE INDEX idx_events_teamer ON events (teamer_needed, teamer_only) WHERE teamer_needed = true OR teamer_only = true;

-- Event-Category Relations
CREATE TABLE event_categories (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE
);

-- Unique constraint
ALTER TABLE event_categories ADD CONSTRAINT event_categories_unique UNIQUE (event_id, category_id);

-- Indexes
CREATE INDEX idx_event_categories_event ON event_categories (event_id);
CREATE INDEX idx_event_categories_category ON event_categories (category_id);

-- Event-Jahrgang Assignments
CREATE TABLE event_jahrgang_assignments (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    jahrgang_id INTEGER NOT NULL REFERENCES jahrgaenge(id) ON DELETE CASCADE
);

-- Unique constraint
ALTER TABLE event_jahrgang_assignments ADD CONSTRAINT event_jahrgang_assignments_unique UNIQUE (event_id, jahrgang_id);

-- Indexes
CREATE INDEX idx_event_jahrgang_assignments_event ON event_jahrgang_assignments (event_id);
CREATE INDEX idx_event_jahrgang_assignments_jahrgang ON event_jahrgang_assignments (jahrgang_id);

-- ====================================================================
-- EVENT TIMESLOTS
-- ====================================================================

CREATE TABLE event_timeslots (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    max_participants INTEGER NOT NULL CHECK (max_participants > 0),
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Constraints
ALTER TABLE event_timeslots ADD CONSTRAINT event_timeslots_time_check CHECK (start_time < end_time);

-- Indexes
CREATE INDEX idx_event_timeslots_event ON event_timeslots (event_id);
CREATE INDEX idx_event_timeslots_time ON event_timeslots (start_time, end_time);
CREATE INDEX idx_event_timeslots_org ON event_timeslots (organization_id);

-- ====================================================================
-- EVENT BOOKINGS
-- ====================================================================

CREATE TABLE event_bookings (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    timeslot_id INTEGER REFERENCES event_timeslots(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'pending', 'waitlist', 'cancelled', 'opted_out')),
    attendance_status VARCHAR(20) CHECK (attendance_status IN ('present', 'absent')),
    opt_out_reason TEXT,
    opt_out_date TIMESTAMP,
    booking_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraints
ALTER TABLE event_bookings ADD CONSTRAINT event_bookings_user_event_unique UNIQUE (user_id, event_id);

-- Indexes für Booking Queries
CREATE INDEX idx_event_bookings_event ON event_bookings (event_id);
CREATE INDEX idx_event_bookings_user ON event_bookings (user_id);
CREATE UNIQUE INDEX idx_event_bookings_user_event ON event_bookings (user_id, event_id);
CREATE INDEX idx_event_bookings_timeslot ON event_bookings (timeslot_id);
CREATE INDEX idx_event_bookings_status ON event_bookings (status);
CREATE INDEX idx_event_bookings_attendance ON event_bookings (attendance_status);
CREATE INDEX idx_event_bookings_org ON event_bookings (organization_id);
CREATE INDEX idx_event_bookings_date ON event_bookings (booking_date);

-- ====================================================================
-- EVENT POINTS (Separate from Bonus Points)
-- ====================================================================

CREATE TABLE event_points (
    id SERIAL PRIMARY KEY,
    konfi_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    points INTEGER NOT NULL CHECK (points > 0),
    point_type VARCHAR(20) NOT NULL CHECK (point_type IN ('gottesdienst', 'gemeinde')),
    admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    awarded_date DATE NOT NULL DEFAULT CURRENT_DATE,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint: Eine Event-Point-Vergabe pro Konfi pro Event
ALTER TABLE event_points ADD CONSTRAINT event_points_unique UNIQUE (konfi_id, event_id);

-- Indexes
CREATE INDEX idx_event_points_konfi ON event_points (konfi_id);
CREATE INDEX idx_event_points_event ON event_points (event_id);
CREATE INDEX idx_event_points_type ON event_points (point_type);
CREATE INDEX idx_event_points_admin ON event_points (admin_id);
CREATE INDEX idx_event_points_date ON event_points (awarded_date);
CREATE INDEX idx_event_points_org ON event_points (organization_id);

-- ====================================================================
-- CHAT SYSTEM
-- ====================================================================

CREATE TABLE chat_rooms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    -- 'admin' = automatischer Team-Chat (teamChat.js), 'admin_team' = manuell erstellte Team-Gruppen
    type VARCHAR(50) NOT NULL CHECK (type IN ('direct', 'group', 'jahrgang', 'admin', 'admin_team')),
    jahrgang_id INTEGER REFERENCES jahrgaenge(id) ON DELETE CASCADE,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_chat_rooms_type ON chat_rooms (type);
CREATE INDEX idx_chat_rooms_jahrgang ON chat_rooms (jahrgang_id);
CREATE INDEX idx_chat_rooms_event_id ON chat_rooms (event_id);
CREATE INDEX idx_chat_rooms_org ON chat_rooms (organization_id);

CREATE TABLE chat_participants (
    id SERIAL PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('admin', 'teamer', 'konfi')),
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint
ALTER TABLE chat_participants ADD CONSTRAINT chat_participants_unique UNIQUE (room_id, user_id);

-- Indexes
CREATE INDEX idx_chat_participants_room ON chat_participants (room_id);
CREATE INDEX idx_chat_participants_user ON chat_participants (user_id);

CREATE TABLE chat_messages (
    id SERIAL PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('admin', 'teamer', 'konfi')),
    content TEXT NOT NULL,
    file_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes für Message Queries
CREATE INDEX idx_chat_messages_room ON chat_messages (room_id);
CREATE INDEX idx_chat_messages_user ON chat_messages (user_id);
CREATE INDEX idx_chat_messages_created ON chat_messages (created_at);
CREATE INDEX idx_chat_messages_room_created ON chat_messages (room_id, created_at);

-- ====================================================================
-- SETTINGS
-- ====================================================================

CREATE TABLE settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) NOT NULL UNIQUE,
    value TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index für Settings Lookups
CREATE INDEX idx_settings_key ON settings (key);

-- ====================================================================
-- NOTIFICATIONS
-- ====================================================================

CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    type VARCHAR(50) DEFAULT 'info',
    read_at TIMESTAMP,
    data JSONB,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_notifications_user ON notifications (user_id);
CREATE INDEX idx_notifications_unread ON notifications (user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_type ON notifications (type);
CREATE INDEX idx_notifications_org ON notifications (organization_id);
CREATE INDEX idx_notifications_created ON notifications (created_at);

-- ====================================================================
-- PERFORMANCE OPTIMIZATIONS
-- ====================================================================

-- Composite indexes für häufige Queries
CREATE INDEX idx_users_role_org_active ON users (role_id, organization_id, is_active);
CREATE INDEX idx_events_org_date ON events (organization_id, event_date);
CREATE INDEX idx_konfi_activities_konfi_date ON konfi_activities (konfi_id, completed_date);
CREATE INDEX idx_event_bookings_event_status ON event_bookings (event_id, status);

-- Partial indexes für bessere Performance
CREATE INDEX idx_events_active ON events (id) WHERE event_date > CURRENT_TIMESTAMP;
CREATE INDEX idx_users_active_role ON users (role_id) WHERE is_active = true;

-- ====================================================================
-- TRIGGERS FÜR UPDATED_AT
-- ====================================================================

-- Funktion für updated_at Trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger für alle Tabellen mit updated_at
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_konfi_profiles_updated_at BEFORE UPDATE ON konfi_profiles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Migration v1.7 Phase 34 (auf Live-DB ausfuehren):
-- ALTER TABLE events ADD COLUMN IF NOT EXISTS mandatory BOOLEAN DEFAULT false;
-- ALTER TABLE events ADD COLUMN IF NOT EXISTS bring_items TEXT;
-- ALTER TABLE events ALTER COLUMN max_participants SET DEFAULT 0;
-- ALTER TABLE events DROP CONSTRAINT IF EXISTS events_max_participants_check;
-- ALTER TABLE events ADD CONSTRAINT events_max_participants_check CHECK (max_participants >= 0);
-- ALTER TABLE event_bookings DROP CONSTRAINT IF EXISTS event_bookings_status_check;
-- ALTER TABLE event_bookings ADD CONSTRAINT event_bookings_status_check CHECK (status IN ('confirmed', 'pending', 'waitlist', 'cancelled', 'opted_out'));

-- Migration v1.7 Phase 35 (auf Live-DB ausfuehren):
-- ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS opt_out_reason TEXT;
-- ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS opt_out_date TIMESTAMP;

-- Migration v1.7 Phase 36: QR-Code Check-in (auf Live-DB ausfuehren):
-- ALTER TABLE events ADD COLUMN IF NOT EXISTS qr_token TEXT DEFAULT NULL;
-- ALTER TABLE events ADD COLUMN IF NOT EXISTS checkin_window INTEGER DEFAULT 30;

-- Phase 39 Migration (auf Live-DB ausfuehren):
-- ALTER TABLE events ADD COLUMN IF NOT EXISTS teamer_needed BOOLEAN DEFAULT false;
-- ALTER TABLE events ADD COLUMN IF NOT EXISTS teamer_only BOOLEAN DEFAULT false;
-- ALTER TABLE events ADD CONSTRAINT events_teamer_exclusive CHECK (NOT (teamer_needed = true AND teamer_only = true));
-- CREATE INDEX IF NOT EXISTS idx_events_teamer ON events (teamer_needed, teamer_only) WHERE teamer_needed = true OR teamer_only = true;