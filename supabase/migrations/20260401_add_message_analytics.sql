-- Migration: Add message analytics RPC function
-- Provides hourly message counts grouped by campaign for the last 7 days

CREATE OR REPLACE FUNCTION get_message_analytics(
  days_back integer DEFAULT 7
)
RETURNS TABLE (
  hour timestamp with time zone,
  campaign_id integer,
  campaign_name text,
  message_count bigint
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    date_trunc('hour', m.received_at) AS hour,
    m.campaign_id,
    c.name AS campaign_name,
    COUNT(*) AS message_count
  FROM messages m
  INNER JOIN campaigns c ON m.campaign_id = c.id
  WHERE m.received_at >= NOW() - (days_back || ' days')::interval
  GROUP BY date_trunc('hour', m.received_at), m.campaign_id, c.name
  ORDER BY hour ASC;
END;
$$;
