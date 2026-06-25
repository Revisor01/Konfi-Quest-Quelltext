-- Umbenennung activity_requests.konfi_id -> user_id (Schema-Konsistenz mit user_activities, user_badges)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'activity_requests' AND column_name = 'konfi_id'
  ) THEN
    ALTER TABLE activity_requests RENAME COLUMN konfi_id TO user_id;
  END IF;
END $$;
