-- Migration: Fix global clustering implementation
-- Removes politician_id filter from clustering and uses single global lock

-- Create global clustering function (no politician filter)
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
    (m.message_embedding <-> query_embedding) as distance
  FROM messages m
  WHERE m.message_embedding IS NOT NULL 
    AND (m.message_embedding <-> query_embedding) < distance_threshold
  ORDER BY m.message_embedding <-> query_embedding
  LIMIT match_limit;
END;
$$;

-- Add global clustering lock functions
CREATE OR REPLACE FUNCTION acquire_global_clustering_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT pg_try_advisory_lock(999999); -- Fixed global lock key
$$;

CREATE OR REPLACE FUNCTION release_global_clustering_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT pg_advisory_unlock(999999);
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION find_similar_messages_global(vector, float, int) TO authenticated;
GRANT EXECUTE ON FUNCTION acquire_global_clustering_lock() TO authenticated;
GRANT EXECUTE ON FUNCTION release_global_clustering_lock() TO authenticated;

-- Update message_clusters table to remove politician dependency
-- Note: politician_id column already exists, just make it nullable
ALTER TABLE message_clusters 
ALTER COLUMN politician_id DROP NOT NULL;

-- Comments
COMMENT ON FUNCTION find_similar_messages_global IS 
'Finds messages similar to a query embedding across ALL politicians (global clustering).
Used for cross-politician campaign discovery. Removes politician boundaries.';

COMMENT ON FUNCTION acquire_global_clustering_lock() IS 
'Acquires single global lock for clustering operations to prevent race conditions.
Uses fixed key 999999 for all clustering regardless of politician.';

COMMENT ON FUNCTION release_global_clustering_lock() IS 
'Releases the global clustering lock. Must be called after clustering completes.';
