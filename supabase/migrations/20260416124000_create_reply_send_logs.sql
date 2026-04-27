-- PII-safe reply delivery tracking table
CREATE TABLE IF NOT EXISTS reply_send_logs (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id),
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
    politician_id INTEGER NOT NULL REFERENCES politicians(id),
    supporter_id INTEGER,
    subject VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL,
    provider VARCHAR(50) DEFAULT 'jmap',
    provider_message_id VARCHAR(255),
    error_message TEXT,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reply_send_logs_message ON reply_send_logs(message_id);
CREATE INDEX IF NOT EXISTS idx_reply_send_logs_campaign ON reply_send_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_reply_send_logs_status ON reply_send_logs(status);
CREATE INDEX IF NOT EXISTS idx_reply_send_logs_sent_at ON reply_send_logs(sent_at);

