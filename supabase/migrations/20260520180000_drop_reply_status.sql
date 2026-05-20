-- Auto-reply eligibility is: campaign assigned, active template, duplicate_rank = 0,
-- reply_sent_at IS NULL, and reply_scheduled_at due (or null for immediate).
-- reply_status is redundant with reply_sent_at + reply_scheduled_at.

DROP INDEX IF EXISTS idx_messages_reply_status;
DROP INDEX IF EXISTS idx_messages_reply_scheduled_at;

CREATE INDEX IF NOT EXISTS idx_messages_reply_scheduled_at
  ON messages(reply_scheduled_at)
  WHERE reply_sent_at IS NULL AND reply_scheduled_at IS NOT NULL;

ALTER TABLE messages DROP COLUMN IF EXISTS reply_status;
