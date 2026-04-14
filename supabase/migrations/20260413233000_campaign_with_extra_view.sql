-- View: campaign_with_extra
-- Purpose: provide campaign fields plus per-campaign aggregates (messages, reply templates)
-- so the frontend can fetch everything in one query without client-side counting.

BEGIN;

DROP VIEW IF EXISTS public.campaign_with_extra CASCADE;

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
  COALESCE(rt.reply_template_count, 0) AS reply_template_count,
  COALESCE(rt.active_reply_template_count, 0) AS active_reply_template_count,
  (COALESCE(rt.reply_template_count, 0) > 0) AS has_reply_template,
  -- Pick active template first; otherwise the most recently updated template.
  rt.template_id AS template_id
FROM public.campaigns c
LEFT JOIN (
  SELECT
    m.campaign_id,
    COUNT(*)::int AS message_count
  FROM public.messages m
  WHERE m.campaign_id IS NOT NULL
  GROUP BY m.campaign_id
) m ON m.campaign_id = c.id
LEFT JOIN LATERAL (
  SELECT
    counts.reply_template_count,
    counts.active_reply_template_count,
    chosen.template_id
  FROM (
    SELECT
      COUNT(*)::int AS reply_template_count,
      COUNT(*) FILTER (WHERE rt.active = true)::int AS active_reply_template_count
    FROM public.reply_templates rt
    WHERE rt.campaign_id = c.id
  ) counts
  LEFT JOIN LATERAL (
    SELECT rt.id AS template_id
    FROM public.reply_templates rt
    WHERE rt.campaign_id = c.id
    ORDER BY rt.active DESC, rt.updated_at DESC, rt.id DESC
    LIMIT 1
  ) chosen ON true
) rt ON true;

-- Make view selectable by authenticated users (RLS on underlying tables still applies)
GRANT SELECT ON public.campaign_with_extra TO authenticated;

COMMIT;
