-- Fix: Change from L2 distance (<->) to cosine distance (<=>)
-- The <-> operator was returning L2 (Euclidean) distance instead of cosine distance
-- This caused messages from the same campaign to not be recognized as similar

-- Update find_similar_messages to use correct cosine distance operator
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

COMMENT ON FUNCTION find_similar_messages IS 
'Finds messages similar to a query embedding using cosine distance.
Uses the <=> operator for true cosine distance (not L2 distance).
Lower distance = more similar (0 = identical, 2 = opposite).
Threshold of 0.2 works well for multilingual campaign messages.';
