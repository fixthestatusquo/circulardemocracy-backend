-- Migration: Handle transition from old clustering to consolidated system
-- This migration safely transitions from the old scattered migrations 
-- to the new consolidated auto-reply and clustering systems

-- First, check if columns already exist before adding them
DO $$
BEGIN
    -- Add reply scheduling fields if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'messages' AND column_name = 'reply_status') THEN
        ALTER TABLE messages ADD COLUMN reply_status VARCHAR(20) DEFAULT NULL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'messages' AND column_name = 'reply_scheduled_at') THEN
        ALTER TABLE messages ADD COLUMN reply_scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'messages' AND column_name = 'reply_sent_at') THEN
        ALTER TABLE messages ADD COLUMN reply_sent_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'messages' AND column_name = 'reply_retry_count') THEN
        ALTER TABLE messages ADD COLUMN reply_retry_count INTEGER DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'messages' AND column_name = 'reply_last_retry_at') THEN
        ALTER TABLE messages ADD COLUMN reply_last_retry_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'messages' AND column_name = 'reply_failure_reason') THEN
        ALTER TABLE messages ADD COLUMN reply_failure_reason TEXT DEFAULT NULL;
    END IF;
END $$;

-- Add campaign contact fields if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'campaigns' AND column_name = 'technical_email') THEN
        ALTER TABLE campaigns ADD COLUMN technical_email VARCHAR(255);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'campaigns' AND column_name = 'reply_to_email') THEN
        ALTER TABLE campaigns ADD COLUMN reply_to_email VARCHAR(255);
    END IF;
END $$;

-- Create tables if they don't exist
CREATE TABLE IF NOT EXISTS reply_templates (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    active BOOLEAN DEFAULT true,
    layout_type VARCHAR(20) DEFAULT 'standard_header',
    send_timing VARCHAR(20) DEFAULT 'office_hours',
    scheduled_for TIME DEFAULT '09:00:00',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supporters (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    politician_id INTEGER NOT NULL REFERENCES politicians(id) ON DELETE CASCADE,
    sender_hash VARCHAR(64) NOT NULL,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    first_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    message_count INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(campaign_id, politician_id, sender_hash)
);

CREATE TABLE IF NOT EXISTS sender_emails (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    sender_hash VARCHAR(64) NOT NULL,
    email VARCHAR(255) NOT NULL,
    reply_sent BOOLEAN DEFAULT false,
    purged_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(message_id)
);

CREATE TABLE IF NOT EXISTS email_logs (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id),
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
    politician_id INTEGER NOT NULL REFERENCES politicians(id),
    supporter_id INTEGER REFERENCES supporters(id),
    sender_email VARCHAR(255) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL,
    provider VARCHAR(50) DEFAULT 'jmap',
    provider_message_id VARCHAR(255),
    error_message TEXT,
    error_code VARCHAR(50),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Update message_clusters table to remove politician_id if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'message_clusters' AND column_name = 'politician_id') THEN
        -- Drop index if it exists
        DROP INDEX IF EXISTS idx_message_clusters_politician;
        
        -- Drop the column
        ALTER TABLE message_clusters DROP COLUMN politician_id;
    END IF;
END $$;

-- Add cluster_id to messages if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'messages' AND column_name = 'cluster_id') THEN
        ALTER TABLE messages ADD COLUMN cluster_id INTEGER REFERENCES message_clusters(id);
    END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_messages_reply_status ON messages(reply_status);
CREATE INDEX IF NOT EXISTS idx_messages_reply_scheduled_at ON messages(reply_scheduled_at) WHERE reply_status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_reply_templates_campaign_active ON reply_templates(campaign_id, active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_supporters_campaign_politician ON supporters(campaign_id, politician_id);
CREATE INDEX IF NOT EXISTS idx_supporters_sender_hash ON supporters(sender_hash);
CREATE INDEX IF NOT EXISTS idx_sender_emails_message ON sender_emails(message_id);
CREATE INDEX IF NOT EXISTS idx_sender_emails_hash ON sender_emails(sender_hash) WHERE purged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_logs_message ON email_logs(message_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_campaign ON email_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON email_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_messages_cluster_id ON messages(cluster_id);
CREATE INDEX IF NOT EXISTS idx_message_clusters_status ON message_clusters(status);
CREATE INDEX IF NOT EXISTS idx_message_clusters_campaign ON message_clusters(campaign_id) WHERE campaign_id IS NOT NULL;

-- Update functions to use correct cosine distance and remove politician boundaries
DROP FUNCTION IF EXISTS find_similar_campaigns(vector, float, int);
DROP FUNCTION IF EXISTS find_similar_messages_global(vector, float, int);
DROP FUNCTION IF EXISTS find_similar_messages(vector, int, float, int);
DROP FUNCTION IF EXISTS find_similar_clusters(vector, float, int);
DROP FUNCTION IF EXISTS acquire_global_clustering_lock();
DROP FUNCTION IF EXISTS release_global_clustering_lock();

-- Recreate all functions with correct implementations
CREATE OR REPLACE FUNCTION find_similar_campaigns(
  query_embedding vector(1024),
  similarity_threshold float DEFAULT 0.8,
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
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.slug,
    c.status,
    c.reference_vector,
    (1 - (c.reference_vector <=> query_embedding)) as similarity
  FROM campaigns c
  WHERE c.reference_vector IS NOT NULL 
    AND c.status IN ('active', 'unconfirmed')
    AND (1 - (c.reference_vector <=> query_embedding)) > similarity_threshold
  ORDER BY c.reference_vector <=> query_embedding
  LIMIT match_limit;
END;
$$;

CREATE OR REPLACE FUNCTION find_similar_messages_global(
  query_embedding vector(1024),
  distance_threshold float DEFAULT 0.2,
  match_limit int DEFAULT 10
)
RETURNS TABLE (
  id int,
  politician_id int,
  campaign_id int,
  cluster_id int,
  distance float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.politician_id,
    m.campaign_id,
    m.cluster_id,
    (m.message_embedding <=> query_embedding) as distance
  FROM messages m
  WHERE m.message_embedding IS NOT NULL
    AND (m.message_embedding <=> query_embedding) < distance_threshold
  ORDER BY m.message_embedding <=> query_embedding
  LIMIT match_limit;
END;
$$;

CREATE OR REPLACE FUNCTION find_similar_messages(
  query_embedding vector(1024),
  politician_id_filter integer,
  distance_threshold float DEFAULT 0.2,
  match_limit int DEFAULT 10
)
RETURNS TABLE (
  id int,
  campaign_id int,
  distance float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.campaign_id,
    (m.message_embedding <=> query_embedding) as distance
  FROM messages m
  WHERE m.message_embedding IS NOT NULL 
    AND m.politician_id = politician_id_filter
    AND (m.message_embedding <=> query_embedding) < distance_threshold
  ORDER BY m.message_embedding <=> query_embedding
  LIMIT match_limit;
END;
$$;

CREATE OR REPLACE FUNCTION find_similar_clusters(
  query_embedding vector(1024),
  distance_threshold float DEFAULT 0.2,
  match_limit int DEFAULT 10
)
RETURNS TABLE (
  id integer,
  centroid_vector vector(1024),
  message_count integer,
  status character varying(20),
  distance double precision
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    mc.id::integer,
    mc.centroid_vector,
    mc.message_count::integer,
    mc.status::character varying(20),
    (mc.centroid_vector <=> query_embedding)::double precision
  FROM message_clusters mc
  WHERE mc.centroid_vector IS NOT NULL
    AND mc.status IN ('forming', 'ready')
    AND (mc.centroid_vector <=> query_embedding) < distance_threshold
  ORDER BY mc.centroid_vector <=> query_embedding
  LIMIT match_limit;
END;
$$;

CREATE OR REPLACE FUNCTION acquire_global_clustering_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT pg_try_advisory_lock(999999);
$$;

CREATE OR REPLACE FUNCTION release_global_clustering_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT pg_advisory_unlock(999999);
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION find_similar_campaigns(vector, float, int) TO authenticated;
GRANT EXECUTE ON FUNCTION find_similar_messages_global(vector, float, int) TO authenticated;
GRANT EXECUTE ON FUNCTION find_similar_messages(vector, int, float, int) TO authenticated;
GRANT EXECUTE ON FUNCTION find_similar_clusters(vector, float, int) TO authenticated;
GRANT EXECUTE ON FUNCTION acquire_global_clustering_lock() TO authenticated;
GRANT EXECUTE ON FUNCTION release_global_clustering_lock() TO authenticated;
