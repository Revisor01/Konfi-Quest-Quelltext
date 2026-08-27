
ALTER TABLE challenges ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_created_by_fkey;
ALTER TABLE challenges ADD CONSTRAINT challenges_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
