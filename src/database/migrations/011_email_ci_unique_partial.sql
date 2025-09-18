-- Drop case-insensitive unique index on email, replace with partial unique.
DROP INDEX IF EXISTS fundly_leads_email_ci_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fundly_leads_email_ci_real
  ON fundly_leads (lower(email))
  WHERE email IS NOT NULL AND email <> 'LOCKED' AND position('@' in email) > 0;

