
DELETE FROM activity_categories ac
WHERE NOT EXISTS (SELECT 1 FROM activities a WHERE a.id = ac.activity_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_activity_categories_activity') THEN
    ALTER TABLE activity_categories
      ADD CONSTRAINT fk_activity_categories_activity
      FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_categories_activity_category
  ON activity_categories (activity_id, category_id);
