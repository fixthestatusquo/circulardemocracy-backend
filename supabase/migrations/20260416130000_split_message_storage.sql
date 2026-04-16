-- Split storage model:
-- 1) Long-term non-PII analytics/model storage (messages + supporters hash aggregates)
-- 2) Short-term PII contact storage used only for replying

-- Long-term supporter aggregate table (no email/name)
CREATE TABLE IF NOT EXISTS supporters (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    politician_id INTEGER NOT NULL REFERENCES politicians(id) ON DELETE CASCADE,
    sender_hash VARCHAR(64) NOT NULL,
    first_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    message_count INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(campaign_id, politician_id, sender_hash)
);

CREATE INDEX IF NOT EXISTS idx_supporters_campaign_politician ON supporters(campaign_id, politician_id);
CREATE INDEX IF NOT EXISTS idx_supporters_sender_hash ON supporters(sender_hash);

-- Short-term contact storage (PII) used for reply delivery only
CREATE TABLE IF NOT EXISTS message_contacts (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    sender_hash VARCHAR(64) NOT NULL,
    sender_email VARCHAR(255) NOT NULL,
    sender_name VARCHAR(255),
    contact_captured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    reply_sent BOOLEAN DEFAULT false,
    purged_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(message_id)
);

CREATE INDEX IF NOT EXISTS idx_message_contacts_sender_hash ON message_contacts(sender_hash) WHERE purged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_message_contacts_message_id ON message_contacts(message_id);

