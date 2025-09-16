ALTER TABLE fundly_leads
  ADD COLUMN IF NOT EXISTS filter_success text;

CREATE INDEX IF NOT EXISTS idx_fundly_leads_filter_success ON fundly_leads(filter_success);

