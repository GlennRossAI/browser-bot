-- Replace strict unique(email) with a partial unique index so multiple
-- exclusive/hidden emails stored as 'LOCKED' (or missing '@') don't conflict.
DO $$
BEGIN
  BEGIN
    ALTER TABLE fundly_leads DROP CONSTRAINT fundly_leads_email_key;
  EXCEPTION WHEN undefined_object THEN
    -- constraint may not exist; ignore
    NULL;
  END;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_fundly_leads_email_real
  ON fundly_leads(email)
  WHERE email IS NOT NULL AND email <> 'LOCKED' AND position('@' in email) > 0;

