-- Migration: Add RLS policies for messages table and create RLS-protected analytics view
-- Ensures staff can only see analytics for their assigned politicians.
-- Uses a normal view over messages (no materialized view).

BEGIN;

-- Remove legacy analytics functions
DROP TRIGGER IF EXISTS trigger_refresh_analytics_on_insert ON public.messages;
DROP FUNCTION IF EXISTS refresh_analytics_on_message_insert() CASCADE;
DROP FUNCTION IF EXISTS refresh_daily_analytics() CASCADE;
DROP FUNCTION IF EXISTS get_message_analytics_daily(integer) CASCADE;

-- Drop old analytics objects safely (view vs materialized view)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'daily_message_analytics'
      AND c.relkind = 'm'
  ) THEN
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.daily_message_analytics CASCADE';
  END IF;

  -- Drop view form (also covers cases where relkind = 'v')
  EXECUTE 'DROP VIEW IF EXISTS public.daily_message_analytics CASCADE';
END $$;

-- Drop any old views that might exist
DROP VIEW IF EXISTS public.message_analytics_view CASCADE;

-- 1) Enable RLS on messages table
ALTER TABLE IF EXISTS public.messages ENABLE ROW LEVEL SECURITY;

-- Drop existing message policies if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Messages: staff can select own politicians' AND polrelid = 'public.messages'::regclass) THEN
    EXECUTE 'DROP POLICY "Messages: staff can select own politicians" ON public.messages';
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Messages: staff can insert' AND polrelid = 'public.messages'::regclass) THEN
    EXECUTE 'DROP POLICY "Messages: staff can insert" ON public.messages';
  END IF;
END$$;

-- Allow staff to only see messages for their assigned politicians
CREATE POLICY "Messages: staff can select own politicians" ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    -- User can access messages if they are staff for the message's politician
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.politician_id = public.messages.politician_id
        AND ps.user_id = (SELECT auth.uid())
    )
  );

-- Allow staff to insert messages (for their assigned politicians)
CREATE POLICY "Messages: staff can insert" ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- User can insert messages if they are staff for the politician
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.politician_id = public.messages.politician_id
        AND ps.user_id = (SELECT auth.uid())
    )
  );

-- 2) Add indexes aligned with analytics access patterns.
CREATE INDEX IF NOT EXISTS idx_messages_campaign_id ON public.messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_messages_politician_campaign_received
  ON public.messages(politician_id, campaign_id, received_at DESC);

-- 3) Create analytics view from base table (RLS applies through messages).
CREATE VIEW public.message_analytics_view AS
SELECT 
  date_trunc('day', m.received_at) AS date,
  m.campaign_id,
  c.name AS campaign_name,
  m.politician_id,
  COUNT(*) AS message_count
FROM messages m
INNER JOIN campaigns c ON m.campaign_id = c.id
GROUP BY date_trunc('day', m.received_at), m.campaign_id, c.name, m.politician_id
ORDER BY date ASC;

-- Views do not support RLS; rely on underlying table RLS (messages).
GRANT SELECT ON public.message_analytics_view TO authenticated;

-- 4) Recreate analytics RPC and enforce staff filtering
CREATE OR REPLACE FUNCTION public.get_message_analytics_daily(
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
  SELECT
    a.date,
    a.campaign_id,
    a.campaign_name,
    a.message_count
  FROM public.message_analytics_view a
  WHERE a.date >= NOW() - (days_back || ' days')::interval
    AND EXISTS (
      SELECT 1
      FROM public.politician_staff ps
      WHERE ps.politician_id = a.politician_id
        AND ps.user_id = (SELECT auth.uid())
    )
  ORDER BY a.date ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_message_analytics_daily(integer) TO authenticated;

COMMIT;
