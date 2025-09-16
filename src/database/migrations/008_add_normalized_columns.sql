ALTER TABLE fundly_leads
  ADD COLUMN IF NOT EXISTS urgency_code text,
  ADD COLUMN IF NOT EXISTS tib_months integer,
  ADD COLUMN IF NOT EXISTS annual_revenue_min_usd numeric,
  ADD COLUMN IF NOT EXISTS annual_revenue_max_usd numeric,
  ADD COLUMN IF NOT EXISTS annual_revenue_usd_approx numeric,
  ADD COLUMN IF NOT EXISTS bank_account_bool boolean,
  ADD COLUMN IF NOT EXISTS use_of_funds_norm text,
  ADD COLUMN IF NOT EXISTS industry_norm text;

-- Optional simple indexes for reporting/filters
CREATE INDEX IF NOT EXISTS idx_fundly_leads_tib_months ON fundly_leads(tib_months);
CREATE INDEX IF NOT EXISTS idx_fundly_leads_rev_min ON fundly_leads(annual_revenue_min_usd);
CREATE INDEX IF NOT EXISTS idx_fundly_leads_urgency_code ON fundly_leads(urgency_code);

