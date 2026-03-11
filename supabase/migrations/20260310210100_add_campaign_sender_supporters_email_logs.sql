BEGIN;

-- Add campaign technical sender email used for outbound auto-replies
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS technical_email VARCHAR(255);

-- Optional reply-to address for outbound auto-replies
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS reply_to_email VARCHAR(255);

-- Supporters table (campaign-level supporter contact tracking)
CREATE TABLE IF NOT EXISTS supporters (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  politician_id INTEGER NOT NULL REFERENCES politicians(id) ON DELETE CASCADE,
  sender_hash VARCHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  first_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_supporter_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  UNIQUE (campaign_id, politician_id, sender_hash)
);

CREATE INDEX IF NOT EXISTS idx_supporters_campaign_politician
ON supporters(campaign_id, politician_id);

CREATE INDEX IF NOT EXISTS idx_supporters_sender_hash
ON supporters(sender_hash);

-- Email delivery log for outbound auto-replies
CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  politician_id INTEGER NOT NULL REFERENCES politicians(id) ON DELETE CASCADE,
  supporter_id INTEGER REFERENCES supporters(id) ON DELETE SET NULL,
  sender_email VARCHAR(255) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  provider VARCHAR(20) NOT NULL DEFAULT 'jmap',
  provider_message_id VARCHAR(255),
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_message_id
ON email_logs(message_id);

CREATE INDEX IF NOT EXISTS idx_email_logs_campaign_sent_at
ON email_logs(campaign_id, sent_at DESC);

-- Keep supporters.updated_at fresh
DROP TRIGGER IF EXISTS update_supporters_updated_at ON supporters;
CREATE TRIGGER update_supporters_updated_at
BEFORE UPDATE ON supporters
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

COMMENT ON COLUMN campaigns.technical_email IS
'Campaign-owned technical sender address used for outbound auto-replies.';

COMMENT ON COLUMN campaigns.reply_to_email IS
'Optional campaign-level Reply-To override for outbound auto-replies; falls back to politician email when null.';

COMMENT ON TABLE supporters IS
'Supporter contact records by campaign/politician, derived from incoming messages.';

COMMENT ON TABLE email_logs IS
'Audit log of outbound auto-reply emails and delivery outcomes.';

COMMIT;
