-- Fix message uniqueness constraint to allow same external_id across different politicians
-- while preventing duplicates within the same politician

-- Drop the existing unique constraint
ALTER TABLE messages 
DROP CONSTRAINT IF EXISTS messages_external_id_channel_source_key;

-- Drop the associated index that was created with the old constraint
DROP INDEX IF EXISTS idx_messages_external_id;

-- Add new composite unique constraint including politician_id
ALTER TABLE messages 
ADD CONSTRAINT messages_external_id_channel_source_politician_key 
UNIQUE (external_id, channel_source, politician_id);

-- Create a new index to support the uniqueness constraint and lookups
CREATE INDEX idx_messages_external_id_politician ON messages(external_id, channel_source, politician_id);

-- Add a comment explaining the constraint
COMMENT ON CONSTRAINT messages_external_id_channel_source_politician_key ON messages IS 
'Prevents duplicate messages for the same politician while allowing the same external_id to be sent to different politicians';
