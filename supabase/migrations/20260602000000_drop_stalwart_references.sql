-- Drop Stalwart JMAP reference columns and add reply_id to messages table
-- The stalwart_* columns stored JMAP message/account ID references to Stalwart,
-- but the architecture has since been consolidated. The new reply_id column
-- stores the JMAP message ID of the outgoing reply sent via the reply worker.

BEGIN;

-- Drop the partial index first (requires the column to exist)
DROP INDEX IF EXISTS idx_messages_stalwart_message_id;

-- Drop the old stalwart reference columns
ALTER TABLE messages
  DROP COLUMN IF EXISTS stalwart_message_id,
  DROP COLUMN IF EXISTS stalwart_account_id;

-- Add reply_id to store the JMAP message ID of the sent reply
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_id VARCHAR(255);

-- Add index for reply lookups
CREATE INDEX IF NOT EXISTS idx_messages_reply_id
  ON messages(reply_id)
  WHERE reply_id IS NOT NULL;

COMMIT;
