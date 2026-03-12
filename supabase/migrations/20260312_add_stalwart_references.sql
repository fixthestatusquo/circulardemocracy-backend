-- Add Stalwart JMAP reference fields to messages table
-- These fields store references to messages in Stalwart, not the actual content

BEGIN;

-- Add stalwart_message_id field (JMAP message ID)
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS stalwart_message_id VARCHAR(255);

-- Add stalwart_account_id field (JMAP account ID)
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS stalwart_account_id VARCHAR(255);

-- Add index for JMAP lookups
CREATE INDEX IF NOT EXISTS idx_messages_stalwart_message_id 
ON messages(stalwart_message_id) 
WHERE stalwart_message_id IS NOT NULL;

-- Add comment explaining privacy architecture
COMMENT ON COLUMN messages.stalwart_message_id IS 
'JMAP message ID reference in Stalwart. Actual message content remains in Stalwart, not in this database.';

COMMENT ON COLUMN messages.stalwart_account_id IS 
'JMAP account ID reference in Stalwart. Used to retrieve message content on-demand.';

COMMIT;
