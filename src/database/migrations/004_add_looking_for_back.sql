-- Migration: Add legacy/compatibility looking_for column back
-- Rationale: Some dashboards still SELECT looking_for; keep alongside min/max.

ALTER TABLE fundly_leads
  ADD COLUMN IF NOT EXISTS looking_for TEXT;

-- Backfill combined text where possible
UPDATE fundly_leads
SET looking_for = CONCAT(looking_for_min, ' - ', looking_for_max)
WHERE looking_for IS NULL
  AND looking_for_min IS NOT NULL
  AND looking_for_max IS NOT NULL;

