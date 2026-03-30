-- Migration: Implement centroid-based clustering for better performance
-- Compare messages with cluster centroids instead of individual messages

-- Create function to find similar clusters by centroid distance
CREATE OR REPLACE FUNCTION find_similar_clusters(
  query_embedding vector(1024),
  distance_threshold float DEFAULT 0.2,
  match_limit int DEFAULT 10
)
RETURNS TABLE (
  id int,
  politician_id int,
  centroid_vector vector(1024),
  message_count int,
  status text,
  distance float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    mc.id,
    mc.politician_id,
    mc.centroid_vector,
    mc.message_count,
    mc.status,
    (mc.centroid_vector <-> query_embedding) as distance
  FROM message_clusters mc
  WHERE mc.centroid_vector IS NOT NULL 
    AND mc.status IN ('forming', 'ready')
    AND (mc.centroid_vector <-> query_embedding) < distance_threshold
  ORDER BY mc.centroid_vector <-> query_embedding
  LIMIT match_limit;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION find_similar_clusters(vector, float, int) TO authenticated;

-- Comments
COMMENT ON FUNCTION find_similar_clusters IS 
'Finds clusters with centroids similar to a query embedding.
More efficient than message-to-message comparison for clustering decisions.
Lower distance = more similar centroid (0 = identical, 1 = orthogonal).';
