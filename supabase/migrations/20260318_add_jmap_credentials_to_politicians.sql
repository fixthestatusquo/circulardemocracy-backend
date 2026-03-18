-- Add JMAP credentials to politicians table for multi-tenant authentication
-- Each politician will have their own Stalwart credentials

ALTER TABLE politicians 
ADD COLUMN stalwart_username TEXT,
ADD COLUMN stalwart_app_password TEXT,
ADD COLUMN stalwart_jmap_endpoint TEXT DEFAULT 'https://mail.circulardemocracy.org/.well-known/jmap';

-- Add comment explaining the security model
COMMENT ON COLUMN politicians.stalwart_app_password IS 'Encrypted app password for JMAP authentication. Should be encrypted at application layer before storage.';
COMMENT ON COLUMN politicians.stalwart_username IS 'JMAP username for this politician (typically their email address)';
COMMENT ON COLUMN politicians.stalwart_jmap_endpoint IS 'JMAP endpoint URL for this politician';

-- Index for faster lookups when fetching credentials
CREATE INDEX idx_politicians_stalwart_username ON politicians(stalwart_username) WHERE stalwart_username IS NOT NULL;
