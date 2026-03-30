-- Migration: Update similarity threshold from 0.1 to 0.2
-- Based on real testing with 16 Mercosur messages:
-- - Average distance: 0.0983
-- - Max distance: 0.1563
-- - Threshold 0.1 was too strict, missing valid similar messages

-- Update find_similar_messages function with new default threshold
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
    (m.message_embedding <-> query_embedding) as distance
  FROM messages m
  WHERE m.message_embedding IS NOT NULL 
    AND m.politician_id = politician_id_filter
    AND (m.message_embedding <-> query_embedding) < distance_threshold
  ORDER BY m.message_embedding <-> query_embedding
  LIMIT match_limit;
END;
$$;

COMMENT ON FUNCTION find_similar_messages IS 
'Finds messages similar to a query embedding using cosine distance.
Threshold updated to 0.2 based on real testing with multilingual campaign messages.
Lower distance = more similar (0 = identical, 1 = orthogonal).';
