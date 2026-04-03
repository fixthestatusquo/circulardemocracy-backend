-- Migration: Add daily analytics materialized view
-- Optimizes analytics by pre-aggregating data at daily level

-- Drop existing objects if they exist
DROP TRIGGER IF EXISTS trigger_refresh_analytics_on_insert ON messages;
DROP FUNCTION IF EXISTS refresh_analytics_on_message_insert() CASCADE;
DROP FUNCTION IF EXISTS refresh_daily_analytics() CASCADE;
DROP FUNCTION IF EXISTS get_message_analytics_daily(integer) CASCADE;
DROP MATERIALIZED VIEW IF EXISTS daily_message_analytics CASCADE;

-- Create materialized view for daily message analytics
CREATE MATERIALIZED VIEW daily_message_analytics AS
SELECT 
  date_trunc('day', m.received_at) AS date,
  m.campaign_id,
  c.name AS campaign_name,
  COUNT(*) AS message_count
FROM messages m
INNER JOIN campaigns c ON m.campaign_id = c.id
GROUP BY date_trunc('day', m.received_at), m.campaign_id, c.name
ORDER BY date ASC;

-- Create indexes for performance
CREATE INDEX idx_daily_message_analytics_date ON daily_message_analytics(date);
CREATE INDEX idx_daily_message_analytics_campaign ON daily_message_analytics(campaign_id);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_daily_analytics()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY daily_message_analytics;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to refresh view when messages are inserted
CREATE OR REPLACE FUNCTION refresh_analytics_on_message_insert()
RETURNS trigger AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY daily_message_analytics;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on messages table
CREATE TRIGGER trigger_refresh_analytics_on_insert
AFTER INSERT ON messages
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_analytics_on_message_insert();

-- New optimized RPC function that queries the materialized view
CREATE OR REPLACE FUNCTION get_message_analytics_daily(
  days_back integer DEFAULT 7
)
RETURNS TABLE (
  date timestamp with time zone,
  campaign_id integer,
  campaign_name text,
  message_count bigint
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM daily_message_analytics
  WHERE date >= NOW() - (days_back || ' days')::interval
  ORDER BY date ASC;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_message_analytics_daily(integer) TO authenticated;
