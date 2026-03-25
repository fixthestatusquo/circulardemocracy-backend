-- Simplify reply templates to be campaign-specific only
-- One campaign can only have one reply template that all politicians and staff share

-- First, delete existing templates since we're changing the structure
-- This ensures we don't have orphaned data
DELETE FROM reply_templates;

-- Remove politician_id column and add unique constraint on campaign_id
ALTER TABLE reply_templates DROP COLUMN politician_id;

-- Add unique constraint to ensure one template per campaign
ALTER TABLE reply_templates ADD CONSTRAINT unique_campaign_template UNIQUE(campaign_id);

-- Update the index since we no longer need politician_id
DROP INDEX IF EXISTS idx_reply_templates_politician_campaign;
CREATE INDEX idx_reply_templates_campaign_active ON reply_templates(campaign_id, active);

-- Update the unique constraint since we removed politician_id
ALTER TABLE reply_templates DROP CONSTRAINT IF EXISTS reply_templates_politician_id_campaign_id_name_key;
ALTER TABLE reply_templates ADD CONSTRAINT unique_campaign_template_name UNIQUE(campaign_id, name);
