-- Migration: Refactor campaign-politician mapping
-- 1) Update reply_templates_with_campaign view to include politician_id
-- 2) Delete the legacy campaign_politicians table
-- 3) Update campaign_with_extra view to filter templates by the caller's politician_id

BEGIN;

-- 1) Update reply_templates_with_campaign view
DROP VIEW IF EXISTS public.reply_templates_with_campaign CASCADE;

CREATE VIEW public.reply_templates_with_campaign
WITH (security_invoker = true)
AS
SELECT
  rt.id,
  rt.campaign_id,
  rt.politician_id,
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

-- 2) Delete the legacy campaign_politicians table
DROP TABLE IF EXISTS public.campaign_politicians CASCADE;

-- 3) Update campaign_with_extra view
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
  WHERE rt.politician_id IN (
    SELECT ps.politician_id 
    FROM public.politician_staff ps 
    WHERE ps.user_id = auth.uid()
  )
  GROUP BY rt.campaign_id
) tpl ON tpl.campaign_id = c.id;

GRANT SELECT ON public.campaign_with_extra TO authenticated;

COMMIT;
