-- Description: Add contact_name column to fundly_leads to store person's name
-- Safe to run multiple times

ALTER TABLE fundly_leads
  ADD COLUMN IF NOT EXISTS contact_name text;

COMMENT ON COLUMN fundly_leads.contact_name IS 'Full name of the contact associated with this lead';

