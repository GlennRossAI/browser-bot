-- Migration: Add looking_for_min, looking_for_max, and fundly_id columns
-- Date: 2025-09-14
-- Description: Update fundly_leads table to match JSON extraction structure

ALTER TABLE fundly_leads
ADD COLUMN IF NOT EXISTS looking_for_min TEXT,
ADD COLUMN IF NOT EXISTS looking_for_max TEXT,
ADD COLUMN IF NOT EXISTS fundly_id TEXT;

-- Add index on fundly_id for efficient lookups
CREATE INDEX IF NOT EXISTS idx_fundly_leads_fundly_id ON fundly_leads(fundly_id);

-- Add comment for documentation
COMMENT ON COLUMN fundly_leads.fundly_id IS 'The lead ID from Fundly system';
COMMENT ON COLUMN fundly_leads.looking_for_min IS 'Minimum funding amount the lead is looking for';
COMMENT ON COLUMN fundly_leads.looking_for_max IS 'Maximum funding amount the lead is looking for';