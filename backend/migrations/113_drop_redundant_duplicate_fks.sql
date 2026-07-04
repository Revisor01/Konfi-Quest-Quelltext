
ALTER TABLE bonus_points    DROP CONSTRAINT IF EXISTS fk_bonus_points_org;
ALTER TABLE user_activities DROP CONSTRAINT IF EXISTS fk_user_activities_activity;
ALTER TABLE event_bookings  DROP CONSTRAINT IF EXISTS fk_event_bookings_event;
ALTER TABLE event_bookings  DROP CONSTRAINT IF EXISTS fk_event_bookings_user;
ALTER TABLE event_points    DROP CONSTRAINT IF EXISTS fk_event_points_event;
ALTER TABLE event_points    DROP CONSTRAINT IF EXISTS fk_event_points_konfi;
