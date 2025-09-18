-- Circular Democracy Backend Database Schema
-- Analytics storage + on-demand personal data retrieval via JMAP

-- Enable pgvector extension for vector operations
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- CORE TABLES
-- =============================================================================

-- Politicians/Representatives table
CREATE TABLE politicians (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(255) UNIQUE, -- external system identifier
    email VARCHAR(255) UNIQUE NOT NULL, -- primary email for receiving messages
    additional_emails TEXT[], -- other emails this politician receives on
    name VARCHAR(255) NOT NULL,
    party VARCHAR(100),
    country VARCHAR(2), -- ISO country code
    region VARCHAR(100), -- constituency/region
    level VARCHAR(50), -- 'national', 'regional', 'local', 'european'
    position VARCHAR(100), -- 'MP', 'MEP', 'Mayor', etc.
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Campaigns table (created by NGOs/admins, not politicians)
CREATE TABLE campaigns (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL, -- URL-friendly identifier
    description TEXT,
    keywords TEXT[], -- help with classification
    reference_vector vector(1024), -- average embedding of messages in this campaign
    vector_updated_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'unconfirmed', -- 'unconfirmed', 'active', 'archived', 'closed'
    created_by VARCHAR(50) DEFAULT 'system', -- 'ngo', 'admin', 'system'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages storage (analytics + reference to external data)
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(255) NOT NULL, -- JMAP message ID or API provider ID
    
    -- Message metadata
    channel VARCHAR(20) NOT NULL, -- 'api', 'email'
    channel_source VARCHAR(100), -- which API provider, which email server
    
    -- Routing
    politician_id INTEGER NOT NULL REFERENCES politicians(id),
    
    -- Sender info (anonymized)
    sender_hash VARCHAR(64) NOT NULL, -- hash of sender email
    sender_country VARCHAR(2), -- if we can determine it
    
    -- Classification
    campaign_id INTEGER REFERENCES campaigns(id),
    classification_confidence FLOAT, -- 0-1, how confident we are about campaign assignment
    message_embedding vector(1024), -- BGE-M3 embedding
    language VARCHAR(5), -- ISO language code
    
    -- Timestamps
    received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Processing metadata
    duplicate_rank INTEGER DEFAULT 0, -- 0 = first message from this sender, 1+ = subsequent
    processing_status VARCHAR(20) DEFAULT 'processed', -- 'processed', 'failed', 'manual_review'
    
    -- Reply tracking
    reply_sent_at TIMESTAMP WITH TIME ZONE,
    reply_template_id INTEGER, -- reference to which template was used
    
    CONSTRAINT valid_confidence CHECK (classification_confidence >= 0 AND classification_confidence <= 1),
    CONSTRAINT valid_duplicate_rank CHECK (duplicate_rank >= 0),
    UNIQUE(external_id, channel_source) -- prevent duplicates from same source
);

-- Reply templates (created by politicians)
CREATE TABLE reply_templates (
    id SERIAL PRIMARY KEY,
    politician_id INTEGER NOT NULL REFERENCES politicians(id),
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
    
    name VARCHAR(255) NOT NULL, -- internal name for the template
    subject VARCHAR(255) NOT NULL,
    body TEXT NOT NULL, -- markdown format
    
    -- Template metadata
    active BOOLEAN DEFAULT true,
    send_timing VARCHAR(20) DEFAULT 'immediate', -- 'immediate', 'office_hours', 'scheduled'
    scheduled_for TIMESTAMP WITH TIME ZONE, -- if send_timing = 'scheduled'
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(politician_id, campaign_id, name)
);

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- Analytics queries
CREATE INDEX idx_messages_campaign_received ON messages(campaign_id, received_at DESC);
CREATE INDEX idx_messages_sender_hash ON messages(sender_hash);
CREATE INDEX idx_messages_received_at ON messages(received_at DESC);
CREATE INDEX idx_messages_channel ON messages(channel, received_at DESC);
CREATE INDEX idx_messages_politician ON messages(politician_id, received_at DESC);
CREATE INDEX idx_messages_external_id ON messages(external_id, channel_source);

-- Vector similarity searches
CREATE INDEX idx_messages_embedding ON messages USING ivfflat (message_embedding vector_cosine_ops);
CREATE INDEX idx_campaigns_reference_vector ON campaigns USING ivfflat (reference_vector vector_cosine_ops);

-- Politician lookups
CREATE INDEX idx_politicians_emails ON politicians USING gin(additional_emails);
CREATE INDEX idx_politicians_external_id ON politicians(external_id);

-- Reply templates
CREATE INDEX idx_reply_templates_politician_campaign ON reply_templates(politician_id, campaign_id, active);

-- =============================================================================
-- FUNCTIONS & TRIGGERS
-- =============================================================================

-- Function to automatically update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update triggers
CREATE TRIGGER update_politicians_updated_at BEFORE UPDATE ON politicians FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_reply_templates_updated_at BEFORE UPDATE ON reply_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to hash sender emails consistently
CREATE OR REPLACE FUNCTION hash_email(email TEXT)
RETURNS VARCHAR(64) AS $$
BEGIN
    RETURN encode(sha256(lower(trim(email))::bytea), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to clean up old unconfirmed campaigns
CREATE OR REPLACE FUNCTION cleanup_unconfirmed_campaigns()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM campaigns 
    WHERE status = 'unconfirmed' 
    AND created_at < NOW() - INTERVAL '7 days'
    AND NOT EXISTS (
        SELECT 1 FROM messages WHERE campaign_id = campaigns.id
    );
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;


-- Function to find politician by email (including additional_emails)
CREATE OR REPLACE FUNCTION find_politician_by_email(email_address TEXT)
RETURNS INTEGER AS $$
DECLARE
    politician_id INTEGER;
BEGIN
    SELECT id INTO politician_id 
    FROM politicians 
    WHERE active = true 
    AND (
        email = email_address 
        OR additional_emails @> ARRAY[email_address]
    );
    
    RETURN politician_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION find_similar_campaigns(
  query_embedding vector(1024),
  similarity_threshold float DEFAULT 0.1,
  match_limit int DEFAULT 3
)
RETURNS TABLE (
  id int,
  name text,
  slug text,
  status text,
  reference_vector vector(1024),
  similarity float
)
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.slug,
    c.status,
    c.reference_vector,
    (1 - (c.reference_vector <-> query_embedding)) as similarity
  FROM campaigns c
  WHERE c.reference_vector IS NOT NULL 
    AND c.status IN ('active', 'unconfirmed')
    AND (1 - (c.reference_vector <-> query_embedding)) > similarity_threshold
  ORDER BY c.reference_vector <-> query_embedding
  LIMIT match_limit;
END;
$$ LANGUAGE plpgsql;