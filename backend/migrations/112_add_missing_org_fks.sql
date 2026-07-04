
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['activities','categories','custom_badges','events','jahrgaenge','event_timeslots','notifications'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_' || t || '_organization') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT fk_%s_organization FOREIGN KEY (organization_id) REFERENCES organizations(id)',
        t, t);
    END IF;
  END LOOP;
END $$;
