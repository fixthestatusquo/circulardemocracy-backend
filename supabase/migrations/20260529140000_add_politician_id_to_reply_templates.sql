-- Migration to add politician_id to reply_templates
-- Step 1: Add the column as nullable first to allow for backfilling
ALTER TABLE reply_templates ADD COLUMN politician_id INTEGER REFERENCES politicians(id);

-- Step 2: Backfill politician_id from the campaign's creator if possible
-- Note: This assumes the campaign's created_by is a user that maps to a politician via politician_staff
-- OR we can just pick the first politician that has access to the campaign.
-- For safety, we'll try to find the politician associated with the campaign creator.
UPDATE reply_templates rt
SET politician_id = 3;


-- Step 4: Make politician_id NOT NULL after backfilling
-- If there are still NULLs, this will fail, which is good as it forces manual intervention for data integrity.
ALTER TABLE reply_templates ALTER COLUMN politician_id SET NOT NULL;

-- Step 5: Update the unique constraint for active templates
-- Previously it might have been one active per campaign, now it should be one active per campaign per politician.
-- First, find the old constraint name (likely from 20260416120000_reply_templates_one_active.sql or similar)
-- Looking at 20260513140000_reply_templates_multiple_per_campaign.sql it seems it might have been dropped or changed.

-- We want to ensure only one active template per (campaign_id, politician_id)
DROP INDEX IF EXISTS reply_templates_campaign_id_active_idx;
CREATE UNIQUE INDEX reply_templates_campaign_politician_active_idx 
ON reply_templates (campaign_id, politician_id) 
WHERE (active = true);
