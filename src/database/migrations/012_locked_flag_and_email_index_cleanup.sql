-- Add a single boolean flag for exclusivity/locked contact info
ALTER TABLE fundly_leads
  ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT FALSE;

-- Backfill locked flag from legacy sentinel usage
UPDATE fundly_leads
SET locked = TRUE
WHERE email = 'LOCKED' OR phone = 'LOCKED';

-- Null-out invalid/sentinel contact values
UPDATE fundly_leads
SET email = NULL
WHERE email IS NOT NULL AND (
  email = 'LOCKED' OR btrim(email) = '' OR position('@' in email) = 0
);

UPDATE fundly_leads
SET phone = NULL
WHERE phone IS NOT NULL AND (
  phone = 'LOCKED' OR btrim(phone) = ''
);

-- Drop redundant/legacy unique email indexes and replace with a single CI partial unique index
DROP INDEX IF EXISTS ux_fundly_leads_email_real;
DROP INDEX IF EXISTS ux_fundly_leads_email_ci_real;

CREATE UNIQUE INDEX IF NOT EXISTS ux_fundly_leads_email_ci
  ON fundly_leads (lower(email))
  WHERE email IS NOT NULL AND position('@' in email) > 0;

-- Keep existing unique(fundly_id) intact

