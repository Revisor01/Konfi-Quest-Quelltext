-- ====================================================================
-- Migration 064: Fehlende Foreign Keys ergaenzen
--
-- Alle FK-Constraints sind idempotent (IF NOT EXISTS Check via
-- information_schema). Alle mit ON DELETE CASCADE, da Organization-
-- Delete bereits kaskadierend loescht.
-- ====================================================================

-- ====================================================================
-- Verwaiste Daten bereinigen BEVOR Foreign Keys gesetzt werden
-- (User wurden geloescht aber referenzierende Zeilen blieben)
-- ====================================================================
DELETE FROM push_tokens WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM notifications WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM password_resets WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM event_points WHERE konfi_id NOT IN (SELECT id FROM users);
DELETE FROM event_points WHERE event_id NOT IN (SELECT id FROM events);
DELETE FROM event_points WHERE organization_id NOT IN (SELECT id FROM organizations);
DELETE FROM chat_read_status WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM chat_read_status WHERE room_id NOT IN (SELECT id FROM chat_rooms);
DELETE FROM chat_poll_votes WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM chat_poll_votes WHERE poll_id NOT IN (SELECT id FROM chat_polls);
DELETE FROM bonus_points WHERE konfi_id NOT IN (SELECT id FROM users);
DELETE FROM bonus_points WHERE organization_id NOT IN (SELECT id FROM organizations);
DELETE FROM activity_requests WHERE konfi_id NOT IN (SELECT id FROM users);
DELETE FROM activity_requests WHERE organization_id NOT IN (SELECT id FROM organizations);
DELETE FROM event_bookings WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM event_bookings WHERE event_id NOT IN (SELECT id FROM events);
DELETE FROM event_bookings WHERE organization_id NOT IN (SELECT id FROM organizations);
DELETE FROM user_activities WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM user_activities WHERE activity_id NOT IN (SELECT id FROM activities);
DELETE FROM user_activities WHERE organization_id NOT IN (SELECT id FROM organizations);
DELETE FROM user_badges WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM user_badges WHERE organization_id NOT IN (SELECT id FROM organizations);

-- ====================================================================
-- push_tokens.user_id -> users(id)
-- Tabelle hat "user_id INTEGER NOT NULL" aber KEINEN FK (add_push_foundation.sql)
-- ====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_push_tokens_user' AND table_name = 'push_tokens') THEN
    ALTER TABLE push_tokens ADD CONSTRAINT fk_push_tokens_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ====================================================================
-- notifications.user_id -> users(id)
-- Tabelle wird in notifications.js und organizations.js referenziert
-- ====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_notifications_user' AND table_name = 'notifications') THEN
    ALTER TABLE notifications ADD CONSTRAINT fk_notifications_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ====================================================================
-- password_resets.user_id -> users(id)
-- Tabelle wird in auth.js und organizations.js referenziert
-- ====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_password_resets_user' AND table_name = 'password_resets') THEN
    ALTER TABLE password_resets ADD CONSTRAINT fk_password_resets_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ====================================================================
-- event_points.konfi_id -> users(id)
-- event_points.event_id -> events(id)
-- event_points.organization_id -> organizations(id)
-- Tabelle wird in konfi.js, konfi-managment.js, organizations.js referenziert
-- ====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_event_points_konfi' AND table_name = 'event_points') THEN
    ALTER TABLE event_points ADD CONSTRAINT fk_event_points_konfi
      FOREIGN KEY (konfi_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_event_points_event' AND table_name = 'event_points') THEN
    ALTER TABLE event_points ADD CONSTRAINT fk_event_points_event
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_event_points_org' AND table_name = 'event_points') THEN
    ALTER TABLE event_points ADD CONSTRAINT fk_event_points_org
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ====================================================================
-- chat_read_status.room_id -> chat_rooms(id)
-- chat_read_status.user_id -> users(id)
-- Tabelle wird in chat.js und organizations.js referenziert
-- ====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_chat_read_status_room' AND table_name = 'chat_read_status') THEN
    ALTER TABLE chat_read_status ADD CONSTRAINT fk_chat_read_status_room
      FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_chat_read_status_user' AND table_name = 'chat_read_status') THEN
    ALTER TABLE chat_read_status ADD CONSTRAINT fk_chat_read_status_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- chat_polls hat message_id (nicht room_id) — FK auf chat_messages existiert bereits

-- ====================================================================
-- chat_poll_votes.poll_id -> chat_polls(id)
-- chat_poll_votes.user_id -> users(id)
-- Tabelle wird in chat.js und organizations.js referenziert
-- ====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_chat_poll_votes_poll' AND table_name = 'chat_poll_votes') THEN
    ALTER TABLE chat_poll_votes ADD CONSTRAINT fk_chat_poll_votes_poll
      FOREIGN KEY (poll_id) REFERENCES chat_polls(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_chat_poll_votes_user' AND table_name = 'chat_poll_votes') THEN
    ALTER TABLE chat_poll_votes ADD CONSTRAINT fk_chat_poll_votes_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ====================================================================
-- bonus_points.konfi_id -> users(id)
-- bonus_points.organization_id -> organizations(id)
-- Tabelle wird in konfi.js, konfi-managment.js, organizations.js referenziert
-- ====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_bonus_points_konfi' AND table_name = 'bonus_points') THEN
    ALTER TABLE bonus_points ADD CONSTRAINT fk_bonus_points_konfi
      FOREIGN KEY (konfi_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_bonus_points_org' AND table_name = 'bonus_points') THEN
    ALTER TABLE bonus_points ADD CONSTRAINT fk_bonus_points_org
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ====================================================================
-- activity_requests.konfi_id -> users(id)
-- activity_requests.organization_id -> organizations(id)
-- Tabelle wird in konfi.js, activities.js, organizations.js referenziert
-- ====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_activity_requests_konfi' AND table_name = 'activity_requests') THEN
    ALTER TABLE activity_requests ADD CONSTRAINT fk_activity_requests_konfi
      FOREIGN KEY (konfi_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_activity_requests_org' AND table_name = 'activity_requests') THEN
    ALTER TABLE activity_requests ADD CONSTRAINT fk_activity_requests_org
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ====================================================================
-- event_bookings.event_id -> events(id)
-- event_bookings.user_id -> users(id)
-- event_bookings.organization_id -> organizations(id)
-- Tabelle wird in events.js, konfi.js, badges.js, organizations.js referenziert
-- ====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_event_bookings_event' AND table_name = 'event_bookings') THEN
    ALTER TABLE event_bookings ADD CONSTRAINT fk_event_bookings_event
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_event_bookings_user' AND table_name = 'event_bookings') THEN
    ALTER TABLE event_bookings ADD CONSTRAINT fk_event_bookings_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_event_bookings_org' AND table_name = 'event_bookings') THEN
    ALTER TABLE event_bookings ADD CONSTRAINT fk_event_bookings_org
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ====================================================================
-- user_activities.user_id -> users(id)
-- user_activities.activity_id -> activities(id)
-- user_activities.organization_id -> organizations(id)
-- Tabelle wird in konfi.js, badges.js, activities.js, organizations.js referenziert
-- ====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_user_activities_user' AND table_name = 'user_activities') THEN
    ALTER TABLE user_activities ADD CONSTRAINT fk_user_activities_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_user_activities_activity' AND table_name = 'user_activities') THEN
    ALTER TABLE user_activities ADD CONSTRAINT fk_user_activities_activity
      FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_user_activities_org' AND table_name = 'user_activities') THEN
    ALTER TABLE user_activities ADD CONSTRAINT fk_user_activities_org
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ====================================================================
-- user_badges.user_id -> users(id)
-- user_badges.organization_id -> organizations(id)
-- Tabelle wird in konfi.js, badges.js, konfi-managment.js, organizations.js referenziert
-- ====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_user_badges_user' AND table_name = 'user_badges') THEN
    ALTER TABLE user_badges ADD CONSTRAINT fk_user_badges_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_user_badges_org' AND table_name = 'user_badges') THEN
    ALTER TABLE user_badges ADD CONSTRAINT fk_user_badges_org
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
