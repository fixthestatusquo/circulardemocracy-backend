-- Migration: Add auto-reply fields to reply_templates and messages tables
-- Date: 2026-03-10
-- Purpose: Support campaign auto-reply functionality with layout types and reply scheduling

BEGIN;

-- =============================================================================
-- 1. UPDATE reply_templates TABLE
-- =============================================================================

-- Add layout_type field to reply_templates
-- Determines the email layout format (text_only or standard_header)
ALTER TABLE reply_templates 
ADD COLUMN IF NOT EXISTS layout_type VARCHAR(20) DEFAULT 'standard_header'
CHECK (layout_type IN ('text_only', 'standard_header'));

-- Update send_timing to use 'office_hours' as default instead of 'immediate'
-- This is a safer default to avoid sending emails outside business hours
ALTER TABLE reply_templates 
ALTER COLUMN send_timing SET DEFAULT 'office_hours';

-- Add constraint to validate send_timing values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'valid_send_timing' 
    AND conrelid = 'reply_templates'::regclass
  ) THEN
    ALTER TABLE reply_templates 
    ADD CONSTRAINT valid_send_timing 
    CHECK (send_timing IN ('immediate', 'office_hours', 'scheduled'));
  END IF;
END$$;

-- =============================================================================
-- 2. UPDATE messages TABLE
-- =============================================================================

-- Add reply_status field to track the state of auto-reply processing
-- Possible values: 'pending', 'scheduled', 'sent'
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS reply_status VARCHAR(20) DEFAULT NULL
CHECK (reply_status IN ('pending', 'scheduled', 'sent'));

-- Add reply_scheduled_at field to track when a reply is scheduled to be sent
-- This is used for office_hours and scheduled send_timing modes
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS reply_scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- =============================================================================
-- 3. CREATE INDEXES FOR PERFORMANCE
-- =============================================================================

-- Index for finding messages that need replies to be sent
-- This will be used by the auto-reply worker to find pending/scheduled messages
CREATE INDEX IF NOT EXISTS idx_messages_reply_status 
ON messages(reply_status, reply_scheduled_at) 
WHERE reply_status IN ('pending', 'scheduled');

-- Index for finding messages by layout type (via template)
-- Useful for analytics and reporting
CREATE INDEX IF NOT EXISTS idx_reply_templates_layout_type 
ON reply_templates(layout_type) 
WHERE active = true;

-- =============================================================================
-- 4. ADD COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON COLUMN reply_templates.layout_type IS 
'Email layout format: text_only (plain text) or standard_header (with politician branding)';

COMMENT ON COLUMN reply_templates.send_timing IS 
'When to send replies: immediate (right away), office_hours (during business hours), scheduled (at specific time)';

COMMENT ON COLUMN messages.reply_status IS 
'Auto-reply processing status: pending (needs reply), scheduled (queued for sending), sent (reply already sent)';

COMMENT ON COLUMN messages.reply_scheduled_at IS 
'Timestamp when the reply is scheduled to be sent (for office_hours and scheduled modes)';

COMMIT;
