-- ====================================================================
-- Migration 064: Fehlende Indizes ergaenzen
--
-- Alle Indizes basieren auf tatsaechlichen WHERE/JOIN-Klauseln in den
-- Backend-Routes. Idempotent durch IF NOT EXISTS.
-- ====================================================================

-- ====================================================================
-- users (auth.js, chat.js, organizations.js, users.js, events.js)
-- WHERE u.organization_id = $1, WHERE u.username = $1, JOIN ON u.role_id
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_org_role ON users(organization_id, role_id);

-- ====================================================================
-- konfi_profiles (konfi.js, konfi-managment.js, organizations.js, badges.js)
-- WHERE kp.user_id = $1, WHERE kp.jahrgang_id = $1, WHERE kp.organization_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_konfi_profiles_user_id ON konfi_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_konfi_profiles_organization_id ON konfi_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_konfi_profiles_jahrgang_id ON konfi_profiles(jahrgang_id);

-- ====================================================================
-- event_bookings (events.js, konfi.js, badges.js)
-- WHERE eb.event_id = $1, WHERE eb.user_id = $1, WHERE eb.organization_id = $1
-- WHERE eb.event_id = $1 AND eb.status = 'confirmed'
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_event_bookings_event_id ON event_bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_event_bookings_user_id ON event_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_event_bookings_organization_id ON event_bookings(organization_id);
CREATE INDEX IF NOT EXISTS idx_event_bookings_event_status ON event_bookings(event_id, status);

-- ====================================================================
-- events (events.js, konfi.js, organizations.js)
-- WHERE e.organization_id = $1, WHERE e.series_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_events_organization_id ON events(organization_id);
CREATE INDEX IF NOT EXISTS idx_events_series_id ON events(series_id);

-- ====================================================================
-- chat_rooms (chat.js)
-- WHERE cr.organization_id = $1, WHERE cr.type = 'jahrgang', WHERE cr.jahrgang_id = $1
-- WHERE cr.event_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_chat_rooms_organization_id ON chat_rooms(organization_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_jahrgang_id ON chat_rooms(jahrgang_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_event_id ON chat_rooms(event_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_type ON chat_rooms(type);

-- ====================================================================
-- chat_participants (chat.js)
-- WHERE cp.room_id = $1, WHERE cp.user_id = $1
-- WHERE cp.room_id = $1 AND cp.user_id = $2 AND cp.user_type = $3
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_chat_participants_room_id ON chat_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_user_id ON chat_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_room_user ON chat_participants(room_id, user_id, user_type);

-- ====================================================================
-- chat_messages (chat.js)
-- WHERE m.room_id = $1, WHERE m.room_id = $1 AND m.id > $2
-- ORDER BY m.created_at DESC
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON chat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created ON chat_messages(room_id, created_at DESC);

-- ====================================================================
-- user_activities (konfi.js, konfi-managment.js, badges.js, activities.js)
-- WHERE ka.user_id = $1 AND ka.organization_id = $2, WHERE ka.activity_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON user_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_organization_id ON user_activities(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_activity_id ON user_activities(activity_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_user_org ON user_activities(user_id, organization_id);

-- ====================================================================
-- user_badges (konfi.js, konfi-managment.js, badges.js, teamer.js)
-- WHERE kb.user_id = $1 AND kb.organization_id = $2, WHERE kb.badge_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_organization_id ON user_badges(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_user_org ON user_badges(user_id, organization_id);

-- ====================================================================
-- activities (activities.js, konfi.js, badges.js)
-- WHERE a.organization_id = $1, WHERE a.category_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_activities_organization_id ON activities(organization_id);
-- activities hat keine category_id Spalte (Kategorien laufen ueber activity_category_assignments)

-- ====================================================================
-- custom_badges (badges.js, konfi.js, konfi-managment.js)
-- WHERE cb.organization_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_custom_badges_organization_id ON custom_badges(organization_id);

-- ====================================================================
-- jahrgaenge (jahrgaenge.js, konfi.js, organizations.js)
-- WHERE j.organization_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_jahrgaenge_organization_id ON jahrgaenge(organization_id);

-- ====================================================================
-- roles (roles.js, auth.js, chat.js)
-- WHERE r.organization_id = $1, WHERE r.name = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_roles_organization_id ON roles(organization_id);
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);

-- ====================================================================
-- notifications (notifications.js, organizations.js)
-- WHERE n.user_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

-- ====================================================================
-- activity_requests (konfi.js, konfi-managment.js, activities.js, organizations.js)
-- WHERE ar.konfi_id = $1, WHERE ar.organization_id = $1, WHERE ar.status = 'pending'
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_activity_requests_konfi_id ON activity_requests(konfi_id);
CREATE INDEX IF NOT EXISTS idx_activity_requests_organization_id ON activity_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_activity_requests_status ON activity_requests(status);

-- ====================================================================
-- bonus_points (konfi.js, konfi-managment.js, organizations.js)
-- WHERE bp.konfi_id = $1, WHERE bp.organization_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_bonus_points_konfi_id ON bonus_points(konfi_id);
CREATE INDEX IF NOT EXISTS idx_bonus_points_organization_id ON bonus_points(organization_id);

-- ====================================================================
-- event_timeslots (events.js, konfi.js)
-- WHERE et.event_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_event_timeslots_event_id ON event_timeslots(event_id);

-- ====================================================================
-- chat_read_status (chat.js)
-- WHERE crs.room_id = $1 AND crs.user_id = $2
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_chat_read_status_room_user ON chat_read_status(room_id, user_id);

-- ====================================================================
-- chat_polls (chat.js)
-- WHERE p.room_id = $1, WHERE p.message_id = $1
-- ====================================================================
-- chat_polls hat keine room_id Spalte (hat message_id)
CREATE INDEX IF NOT EXISTS idx_chat_polls_message_id ON chat_polls(message_id);

-- ====================================================================
-- chat_poll_votes (chat.js)
-- WHERE v.poll_id = $1, WHERE v.user_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_chat_poll_votes_poll_id ON chat_poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_chat_poll_votes_user_id ON chat_poll_votes(user_id);

-- ====================================================================
-- event_jahrgang_assignments (events.js, konfi-managment.js)
-- WHERE eja.event_id = $1, WHERE eja.jahrgang_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_event_jahrgang_assignments_event_id ON event_jahrgang_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_event_jahrgang_assignments_jahrgang_id ON event_jahrgang_assignments(jahrgang_id);

-- ====================================================================
-- event_categories (events.js) — Join-Tabelle Event <-> Category
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_event_categories_event_id ON event_categories(event_id);
CREATE INDEX IF NOT EXISTS idx_event_categories_category_id ON event_categories(category_id);

-- ====================================================================
-- event_points (konfi.js, konfi-managment.js, organizations.js)
-- WHERE ep.konfi_id = $1 AND ep.organization_id = $2, WHERE ep.event_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_event_points_konfi_id ON event_points(konfi_id);
CREATE INDEX IF NOT EXISTS idx_event_points_organization_id ON event_points(organization_id);
CREATE INDEX IF NOT EXISTS idx_event_points_event_id ON event_points(event_id);

-- ====================================================================
-- password_resets (auth.js, organizations.js)
-- WHERE pr.user_id = $1, WHERE pr.token = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);

-- ====================================================================
-- settings (settings.js, organizations.js)
-- WHERE s.organization_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_settings_organization_id ON settings(organization_id);

-- ====================================================================
-- push_tokens (notifications.js, organizations.js)
-- WHERE pt.user_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);

-- ====================================================================
-- user_jahrgang_assignments (users.js, chat.js, konfi-managment.js, events.js)
-- WHERE uja.user_id = $1, WHERE uja.jahrgang_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_user_jahrgang_assignments_user_id ON user_jahrgang_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_jahrgang_assignments_jahrgang_id ON user_jahrgang_assignments(jahrgang_id);

-- ====================================================================
-- categories (organizations.js, konfi.js, badges.js)
-- WHERE c.organization_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_categories_organization_id ON categories(organization_id);

-- ====================================================================
-- invite_codes (auth.js, organizations.js)
-- (idx_invite_codes_code und idx_invite_codes_expires existieren bereits)
-- WHERE ic.organization_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_invite_codes_organization_id ON invite_codes(organization_id);

-- ====================================================================
-- certificate_types (teamer.js, organizations.js)
-- WHERE ct.organization_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_certificate_types_organization_id ON certificate_types(organization_id);

-- ====================================================================
-- user_certificates (teamer.js, konfi-managment.js)
-- WHERE uc.user_id = $1, WHERE uc.organization_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_user_certificates_user_id ON user_certificates(user_id);
CREATE INDEX IF NOT EXISTS idx_user_certificates_organization_id ON user_certificates(organization_id);

-- ====================================================================
-- material_files (material.js)
-- WHERE mf.material_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_material_files_material_id ON material_files(material_id);

-- ====================================================================
-- material_events (material.js)
-- WHERE me.material_id = $1, WHERE me.event_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_material_events_material_id ON material_events(material_id);
CREATE INDEX IF NOT EXISTS idx_material_events_event_id ON material_events(event_id);

-- ====================================================================
-- material_jahrgaenge (material.js)
-- WHERE mj.material_id = $1, WHERE mj.jahrgang_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_material_jahrgaenge_material_id ON material_jahrgaenge(material_id);
CREATE INDEX IF NOT EXISTS idx_material_jahrgaenge_jahrgang_id ON material_jahrgaenge(jahrgang_id);

-- ====================================================================
-- material_file_tags (material.js)
-- WHERE mft.material_id = $1, WHERE mft.tag_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_material_file_tags_material_id ON material_file_tags(material_id);
CREATE INDEX IF NOT EXISTS idx_material_file_tags_tag_id ON material_file_tags(tag_id);

-- ====================================================================
-- materials (material.js)
-- WHERE m.organization_id = $1
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_materials_organization_id ON materials(organization_id);

-- ====================================================================
-- activity_categories (organizations.js) — Join-Tabelle Activity <-> Category
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_activity_categories_activity_id ON activity_categories(activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_categories_category_id ON activity_categories(category_id);
