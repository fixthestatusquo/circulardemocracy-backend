-- Migration: Add persistent cluster tracking for unclassified messages
-- This enables automatic campaign creation when clusters reach valid size

-- Create message_clusters table to track groups of related messages
CREATE TABLE message_clusters (
    id SERIAL PRIMARY KEY,
    politician_id INTEGER NOT NULL REFERENCES politicians(id),
    
    -- Cluster metadata
    centroid_vector vector(1024), -- average embedding of messages in cluster
    message_count INTEGER DEFAULT 0,
    
    -- Campaign association
    campaign_id INTEGER REFERENCES campaigns(id), -- NULL until campaign created
    
    -- Status tracking
    status VARCHAR(20) DEFAULT 'forming', -- 'forming', 'ready', 'campaigned'
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT valid_message_count CHECK (message_count >= 0)
);

-- Add cluster_id to messages table
ALTER TABLE messages 
ADD COLUMN cluster_id INTEGER REFERENCES message_clusters(id);

-- Create index for efficient cluster lookups
CREATE INDEX idx_messages_cluster_id ON messages(cluster_id);
CREATE INDEX idx_message_clusters_status ON message_clusters(status);
CREATE INDEX idx_message_clusters_politician ON message_clusters(politician_id);

-- Function to find which cluster a message should join
-- Returns cluster_id if message is close to existing cluster, NULL otherwise
CREATE OR REPLACE FUNCTION find_cluster_for_message(
  query_embedding vector(1024),
  politician_id_filter integer,
  distance_threshold float DEFAULT 0.1
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  closest_cluster_id INTEGER;
  closest_distance FLOAT;
BEGIN
  -- Find cluster with centroid closest to query embedding
  SELECT 
    mc.id,
    (mc.centroid_vector <-> query_embedding) as distance
  INTO closest_cluster_id, closest_distance
  FROM message_clusters mc
  WHERE mc.politician_id = politician_id_filter
    AND mc.centroid_vector IS NOT NULL
    AND mc.status IN ('forming', 'ready')
    AND (mc.centroid_vector <-> query_embedding) < distance_threshold
  ORDER BY mc.centroid_vector <-> query_embedding
  LIMIT 1;
  
  RETURN closest_cluster_id;
END;
$$;

COMMENT ON TABLE message_clusters IS 
'Tracks groups of related messages based on embedding similarity. 
Enables automatic campaign creation when clusters reach minimum size.';

COMMENT ON FUNCTION find_cluster_for_message IS
'Finds the closest cluster for a message based on centroid distance.
Returns cluster_id if within threshold, NULL if message should start new cluster.';
