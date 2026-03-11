-- Migration: Add sender_emails table for temporary email storage
-- Date: 2026-03-10
-- Purpose: Store sender emails temporarily for auto-reply functionality
-- Privacy: Emails are stored only for messages that need auto-replies (duplicate_rank = 0)
--          and should be purged after successful reply or after retention period

BEGIN;

-- =============================================================================
-- 1. CREATE sender_emails TABLE
-- =============================================================================

-- Table to temporarily store sender emails for auto-reply purposes
-- This table stores actual email addresses only for messages that need replies
-- Emails are linked to messages via message_id and sender_hash for verification
CREATE TABLE IF NOT EXISTS sender_emails (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    sender_hash VARCHAR(64) NOT NULL, -- For verification against messages.sender_hash
    email VARCHAR(255) NOT NULL,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reply_sent BOOLEAN DEFAULT FALSE,
    purged_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    
    -- Constraints
    UNIQUE(message_id), -- One email per message
    CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- =============================================================================
-- 2. CREATE INDEXES
-- =============================================================================

-- Index for quick lookup by message_id
CREATE INDEX IF NOT EXISTS idx_sender_emails_message_id 
ON sender_emails(message_id);

-- Index for lookup by sender_hash (for verification)
CREATE INDEX IF NOT EXISTS idx_sender_emails_sender_hash 
ON sender_emails(sender_hash);

-- Index for finding unsent emails
CREATE INDEX IF NOT EXISTS idx_sender_emails_reply_sent 
ON sender_emails(reply_sent, created_at) 
WHERE reply_sent = FALSE AND purged_at IS NULL;

-- =============================================================================
-- 3. ADD RETRY TRACKING TO messages TABLE
-- =============================================================================

-- Add retry count for failed auto-reply attempts
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS reply_retry_count INTEGER DEFAULT 0;

-- Add last retry timestamp
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS reply_last_retry_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add failure reason tracking
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS reply_failure_reason TEXT DEFAULT NULL;

-- =============================================================================
-- 4. CREATE CLEANUP FUNCTION
-- =============================================================================

-- Function to purge old sender emails (for privacy)
-- Should be called periodically to remove emails after successful send or retention period
CREATE OR REPLACE FUNCTION purge_old_sender_emails()
RETURNS INTEGER AS $$
DECLARE
    purged_count INTEGER;
BEGIN
    -- Mark emails as purged if:
    -- 1. Reply was sent successfully, OR
    -- 2. Email is older than 30 days
    UPDATE sender_emails 
    SET purged_at = NOW()
    WHERE purged_at IS NULL
    AND (
        reply_sent = TRUE
        OR created_at < NOW() - INTERVAL '30 days'
    );
    
    GET DIAGNOSTICS purged_count = ROW_COUNT;
    
    -- Actually delete purged records older than 7 days
    DELETE FROM sender_emails 
    WHERE purged_at IS NOT NULL 
    AND purged_at < NOW() - INTERVAL '7 days';
    
    RETURN purged_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 5. CREATE TRIGGER TO MARK EMAILS AS SENT
-- =============================================================================

-- Automatically mark sender_email as sent when message reply_status becomes 'sent'
CREATE OR REPLACE FUNCTION mark_sender_email_sent()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.reply_status = 'sent' AND OLD.reply_status != 'sent' THEN
        UPDATE sender_emails 
        SET reply_sent = TRUE 
        WHERE message_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_mark_sender_email_sent
AFTER UPDATE ON messages
FOR EACH ROW
WHEN (NEW.reply_status = 'sent')
EXECUTE FUNCTION mark_sender_email_sent();

-- =============================================================================
-- 6. ADD COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE sender_emails IS 
'Temporary storage for sender email addresses needed for auto-replies. Emails are purged after successful send or retention period for privacy.';

COMMENT ON COLUMN sender_emails.message_id IS 
'Reference to the message that needs a reply';

COMMENT ON COLUMN sender_emails.sender_hash IS 
'Hash of sender email for verification against messages.sender_hash';

COMMENT ON COLUMN sender_emails.reply_sent IS 
'Whether the auto-reply has been successfully sent';

COMMENT ON COLUMN sender_emails.purged_at IS 
'Timestamp when email was marked for purging (for privacy compliance)';

COMMENT ON COLUMN messages.reply_retry_count IS 
'Number of times auto-reply sending has been attempted';

COMMENT ON COLUMN messages.reply_last_retry_at IS 
'Timestamp of last auto-reply send attempt';

COMMENT ON COLUMN messages.reply_failure_reason IS 
'Reason for last auto-reply failure (for debugging)';

COMMIT;
