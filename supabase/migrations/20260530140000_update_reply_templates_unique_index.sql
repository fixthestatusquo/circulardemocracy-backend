-- Migration: Update reply_templates unique constraint
-- Alter the index reply_templates_campaign_id_name_key to have unique (campaign_id, name, politician_id)

BEGIN;

-- Drop the existing unique constraint if it exists
-- The name reply_templates_campaign_id_name_key is the default for UNIQUE(campaign_id, name)
ALTER TABLE public.reply_templates 
DROP CONSTRAINT IF EXISTS reply_templates_campaign_id_name_key;

-- Add the new unique constraint including politician_id
ALTER TABLE public.reply_templates 
ADD CONSTRAINT reply_templates_campaign_id_name_politician_id_key 
UNIQUE (campaign_id, name, politician_id);

COMMIT;
