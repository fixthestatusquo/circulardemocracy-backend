-- Allow multiple reply_templates per campaign; keep at most one active per campaign
-- (reply_templates_one_active_per_campaign partial unique index, prior migration).

BEGIN;

DROP VIEW IF EXISTS public.campaign_with_extra CASCADE;

DROP INDEX IF EXISTS public.idx_reply_templates_unique_campaign;

CREATE VIEW public.campaign_with_extra AS
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

COMMIT;
