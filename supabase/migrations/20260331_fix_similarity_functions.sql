-- Fix missing similarity functions
-- This ensures all clustering functions are properly created

-- Drop and recreate find_similar_campaigns with correct signature
DROP FUNCTION IF EXISTS find_similar_campaigns(vector, float, int);

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

-- Grant permissions
GRANT EXECUTE ON FUNCTION find_similar_campaigns(vector, float, int) TO authenticated;

-- Add comment
COMMENT ON FUNCTION find_similar_campaigns IS 
'Finds campaigns with reference vectors similar to query embedding.
Uses cosine similarity (1 - cosine_distance).';
