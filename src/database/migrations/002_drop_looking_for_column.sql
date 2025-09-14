-- Migration: Drop legacy looking_for column
-- Date: 2025-09-14
-- Description: Remove the old looking_for column since we now have looking_for_min and looking_for_max

ALTER TABLE fundly_leads DROP COLUMN IF EXISTS looking_for;

-- Add comment for documentation
COMMENT ON TABLE fundly_leads IS 'Fundly lead data with structured funding amount ranges';