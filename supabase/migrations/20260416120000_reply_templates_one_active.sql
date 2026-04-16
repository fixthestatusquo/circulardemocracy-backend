-- Ensure at most one active reply template per campaign
CREATE UNIQUE INDEX IF NOT EXISTS reply_templates_one_active_per_campaign
ON reply_templates (campaign_id)
WHERE active = true;

