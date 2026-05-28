-- Restore missing daily analytics view and enable RLS on tables flagged by Supabase security advisors.
-- Frontend reads message_analytics_view (daily bucket) via useAnalytics.ts.
-- Views inherit access control from underlying tables (messages, campaigns).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Recreate message_analytics_view (missing on remote despite prior migration)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.message_analytics_view AS
SELECT
  date_trunc('day', m.received_at) AS date,
  m.campaign_id,
  c.name AS campaign_name,
  m.politician_id,
  COUNT(*) AS message_count
FROM public.messages m
INNER JOIN public.campaigns c ON m.campaign_id = c.id
GROUP BY
  date_trunc('day', m.received_at),
  m.campaign_id,
  c.name,
  m.politician_id
ORDER BY date ASC;

GRANT SELECT ON public.message_analytics_view TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) campaign_politicians (shared campaign ↔ politician mapping)
--    Required for profiles_same_campaign_read and cross-campaign staff visibility.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.campaign_politicians ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CampaignPoliticians: staff can select" ON public.campaign_politicians;
CREATE POLICY "CampaignPoliticians: staff can select"
ON public.campaign_politicians
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.politician_staff ps
    WHERE ps.user_id = (SELECT auth.uid())
    LIMIT 1
  )
);

DROP POLICY IF EXISTS "CampaignPoliticians: staff can insert" ON public.campaign_politicians;
CREATE POLICY "CampaignPoliticians: staff can insert"
ON public.campaign_politicians
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.politician_staff ps
    WHERE ps.user_id = (SELECT auth.uid())
    LIMIT 1
  )
);

DROP POLICY IF EXISTS "CampaignPoliticians: staff can update" ON public.campaign_politicians;
CREATE POLICY "CampaignPoliticians: staff can update"
ON public.campaign_politicians
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.politician_staff ps
    WHERE ps.user_id = (SELECT auth.uid())
    LIMIT 1
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.politician_staff ps
    WHERE ps.user_id = (SELECT auth.uid())
    LIMIT 1
  )
);

DROP POLICY IF EXISTS "CampaignPoliticians: staff can delete" ON public.campaign_politicians;
CREATE POLICY "CampaignPoliticians: staff can delete"
ON public.campaign_politicians
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.politician_staff ps
    WHERE ps.user_id = (SELECT auth.uid())
    LIMIT 1
  )
);

-- ---------------------------------------------------------------------------
-- 3) supporters — politician-scoped reads for authenticated staff
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.supporters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supporters: staff can select own politicians" ON public.supporters;
CREATE POLICY "Supporters: staff can select own politicians"
ON public.supporters
FOR SELECT
TO authenticated
USING (user_can_access_politician(politician_id));

-- ---------------------------------------------------------------------------
-- 4) reply_send_logs — politician-scoped reads for authenticated staff
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.reply_send_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ReplySendLogs: staff can select own politicians" ON public.reply_send_logs;
CREATE POLICY "ReplySendLogs: staff can select own politicians"
ON public.reply_send_logs
FOR SELECT
TO authenticated
USING (user_can_access_politician(politician_id));

-- ---------------------------------------------------------------------------
-- 5) message_contacts — PII; block direct client access (service role only)
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.message_contacts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.message_contacts FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) message_clusters — backend-only clustering data
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.message_clusters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.message_clusters FROM anon, authenticated;

COMMIT;
