-- Per-politician Stalwart JMAP credentials for outbound reply sending.
-- This enables dynamic JMAP client auth per politician with optional
-- global env credentials as fallback.

ALTER TABLE politicians
ADD COLUMN IF NOT EXISTS stalwart_jmap_endpoint VARCHAR(512);

ALTER TABLE politicians
ADD COLUMN IF NOT EXISTS stalwart_jmap_account_id VARCHAR(255);

ALTER TABLE politicians
ADD COLUMN IF NOT EXISTS stalwart_username VARCHAR(255);

ALTER TABLE politicians
ADD COLUMN IF NOT EXISTS stalwart_app_password TEXT;

COMMENT ON COLUMN politicians.stalwart_jmap_endpoint IS
'Per-politician JMAP endpoint URL for sending replies (e.g. https://mail.example/.well-known/jmap).';

COMMENT ON COLUMN politicians.stalwart_jmap_account_id IS
'Per-politician JMAP account ID for MailSubmission.';

COMMENT ON COLUMN politicians.stalwart_username IS
'Per-politician JMAP username used for Basic auth.';

COMMENT ON COLUMN politicians.stalwart_app_password IS
'Per-politician JMAP app password used for Basic auth.';
