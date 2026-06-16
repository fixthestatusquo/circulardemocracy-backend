-- Create email_events table for tracking outbound mail events
-- (unsubscribe, bounce, complaint) and opt-out checks.

BEGIN;

-- Event type enum
CREATE TYPE email_event_type AS ENUM ('unsubscribe', 'bounce', 'complaint');

-- Event log table (append-only, no updates)
CREATE TABLE email_events (
    event_type      email_event_type NOT NULL,
    message_id      INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    politician_id   INTEGER NOT NULL REFERENCES politicians(id),
    sender_hash     VARCHAR(64) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Opt-out lookup: find the latest event for a sender+politician
CREATE INDEX idx_email_events_opt_out
    ON email_events (sender_hash, politician_id, created_at DESC);

-- FK / join lookups from messages
CREATE INDEX idx_email_events_message_id
    ON email_events (message_id)
    WHERE message_id IS NOT NULL;

-- BRIN for time-range scans (analytics / reporting)
CREATE INDEX idx_email_events_created_at
    ON email_events USING BRIN (created_at)
    WITH (pages_per_range = 32);

COMMIT;
