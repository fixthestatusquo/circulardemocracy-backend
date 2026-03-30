-- Migration: Add message-to-message similarity search function
-- This enables delayed classification where messages are compared to each other
-- rather than immediately assigned to campaigns

-- Create function to find similar messages based on embedding distance
CREATE OR REPLACE FUNCTION find_similar_messages(
  query_embedding vector(1024),
  politician_id_filter integer,
  distance_threshold float DEFAULT 0.1,
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

-- Add comment explaining the function
COMMENT ON FUNCTION find_similar_messages IS 
'Finds messages similar to a query embedding using cosine distance. 
Used for message-to-message delayed classification where campaigns emerge from groups of similar messages.
Lower distance = more similar (0 = identical, 1 = orthogonal).';
