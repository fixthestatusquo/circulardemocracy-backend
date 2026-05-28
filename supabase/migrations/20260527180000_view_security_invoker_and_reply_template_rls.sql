-- Postgres 17.4 supports security_invoker on views (PG 15+).
-- Recreate client-facing views so RLS on underlying tables applies to the caller.
-- Tighten reply_templates policies to require staff membership.
-- Drop legacy daily_message_analytics view (superseded by message_analytics_view).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Client-facing views — security_invoker = true
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.message_analytics_view
WITH (security_invoker = true)
AS
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

CREATE OR REPLACE VIEW public.message_analytics_weekly_view
WITH (security_invoker = true)
AS
SELECT
  date_trunc('week', m.received_at) AS date,
  m.campaign_id,
  c.name AS campaign_name,
  m.politician_id,
  COUNT(*) AS message_count
FROM public.messages m
INNER JOIN public.campaigns c ON m.campaign_id = c.id
GROUP BY
  date_trunc('week', m.received_at),
  m.campaign_id,
  c.name,
  m.politician_id
ORDER BY date ASC;

GRANT SELECT ON public.message_analytics_weekly_view TO authenticated;

DROP VIEW IF EXISTS public.campaign_with_extra CASCADE;

CREATE VIEW public.campaign_with_extra
WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.name,
  c.slug,
  c.description,
  c.keywords,
  c.reference_vector,
  c.vector_updated_at,
  c.status,
  c.created_by,
  c.created_at,
  c.updated_at,
  COALESCE(m.message_count, 0) AS message_count,
  COALESCE(tpl.reply_template_count, 0) AS reply_template_count,
  COALESCE(tpl.active_reply_template_count, 0) AS active_reply_template_count,
  (COALESCE(tpl.reply_template_count, 0) > 0) AS has_reply_template,
  tpl.primary_template_id AS template_id
FROM public.campaigns c
LEFT JOIN (
  SELECT
    m.campaign_id,
    COUNT(*)::int AS message_count
  FROM public.messages m
  WHERE m.campaign_id IS NOT NULL
  GROUP BY m.campaign_id
) m ON m.campaign_id = c.id
LEFT JOIN (
  SELECT
    rt.campaign_id,
    COUNT(*)::int AS reply_template_count,
    COUNT(*) FILTER (WHERE rt.active)::int AS active_reply_template_count,
    (array_agg(rt.id ORDER BY rt.active DESC, rt.updated_at DESC NULLS LAST, rt.id DESC))[1] AS primary_template_id
  FROM public.reply_templates rt
  GROUP BY rt.campaign_id
) tpl ON tpl.campaign_id = c.id;

GRANT SELECT ON public.campaign_with_extra TO authenticated;

DROP VIEW IF EXISTS public.reply_templates_with_campaign CASCADE;

CREATE VIEW public.reply_templates_with_campaign
WITH (security_invoker = true)
AS
SELECT
  rt.id,
  rt.campaign_id,
  c.name AS campaign_name,
  rt.name,
  rt.subject,
  rt.body,
  rt.active,
  rt.layout_type,
  rt.send_timing,
  rt.scheduled_for,
  rt.created_at,
  rt.updated_at
FROM public.reply_templates rt
LEFT JOIN public.campaigns c ON c.id = rt.campaign_id;

GRANT SELECT ON public.reply_templates_with_campaign TO authenticated;

CREATE OR REPLACE VIEW public.stalwart_mailbox_addresses
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (lower(trim(s.mailbox_address)))
  trim(s.mailbox_address) AS mailbox_address,
  split_part(lower(trim(s.mailbox_address)), '@', 2) AS email_domain
FROM (
  SELECT p.email AS mailbox_address
  FROM public.politicians p
  WHERE p.active
    AND p.email IS NOT NULL
    AND trim(p.email) <> ''
  UNION ALL
  SELECT ae AS mailbox_address
  FROM public.politicians p
  CROSS JOIN LATERAL unnest(COALESCE(p.additional_emails, ARRAY[]::text[])) AS ae
  WHERE p.active
    AND ae IS NOT NULL
    AND trim(ae) <> ''
  UNION ALL
  SELECT c.technical_email AS mailbox_address
  FROM public.campaigns c
  WHERE c.status IN ('active', 'unconfirmed')
    AND c.technical_email IS NOT NULL
    AND trim(c.technical_email) <> ''
) s(mailbox_address)
WHERE position('@' IN s.mailbox_address) > 0
ORDER BY lower(trim(s.mailbox_address)), trim(s.mailbox_address);

GRANT SELECT ON public.stalwart_mailbox_addresses TO service_role;

DROP VIEW IF EXISTS public.politician_staff_with_profile CASCADE;

CREATE VIEW public.politician_staff_with_profile
WITH (security_invoker = true)
AS
SELECT
  ps.user_id,
  ps.role,
  ps.created_at,
  ps.updated_at,
  p.firstname,
  p.lastname,
  p.job_title
FROM public.politician_staff ps
LEFT JOIN public.profiles p ON p.id = ps.user_id;

GRANT SELECT ON public.politician_staff_with_profile TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) reply_templates — require staff membership (same rule as campaigns)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view reply templates for their campaigns" ON public.reply_templates;
DROP POLICY IF EXISTS "Users can create reply templates for their campaigns" ON public.reply_templates;
DROP POLICY IF EXISTS "Users can update reply templates for their campaigns" ON public.reply_templates;
DROP POLICY IF EXISTS "Users can delete reply templates for their campaigns" ON public.reply_templates;

CREATE POLICY "ReplyTemplates: staff can select"
ON public.reply_templates
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

CREATE POLICY "ReplyTemplates: staff can insert"
ON public.reply_templates
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

CREATE POLICY "ReplyTemplates: staff can update"
ON public.reply_templates
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

CREATE POLICY "ReplyTemplates: staff can delete"
ON public.reply_templates
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
-- 3) Cleanup — unused legacy view
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.daily_message_analytics CASCADE;

COMMIT;
