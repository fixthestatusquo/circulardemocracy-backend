-- View: campaign_with_extra
-- Purpose: provide campaign fields plus per-campaign aggregates (messages, reply templates)
-- so the frontend can fetch everything in one query without client-side counting.

BEGIN;

DROP VIEW IF EXISTS public.campaign_with_extra CASCADE;

-- Enforce one reply template per campaign.
-- If duplicates exist, keep the active/latest row and remove older ones.
WITH ranked_templates AS (
  SELECT
    rt.id,
    ROW_NUMBER() OVER (
      PARTITION BY rt.campaign_id
      ORDER BY rt.active DESC, rt.updated_at DESC, rt.id DESC
    ) AS row_num
  FROM public.reply_templates rt
),
templates_to_remove AS (
  SELECT id
  FROM ranked_templates
  WHERE row_num > 1
)
DELETE FROM public.reply_templates rt
USING templates_to_remove dupes
WHERE rt.id = dupes.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_templates_unique_campaign
  ON public.reply_templates(campaign_id);

-- Campaign rollups are grouped by campaign_id; keep this index explicit.
CREATE INDEX IF NOT EXISTS idx_messages_campaign_received
  ON public.messages(campaign_id, received_at DESC);

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
  CASE WHEN rt.id IS NULL THEN 0 ELSE 1 END AS reply_template_count,
  CASE WHEN rt.active THEN 1 ELSE 0 END AS active_reply_template_count,
  (rt.id IS NOT NULL) AS has_reply_template,
  rt.id AS template_id
FROM public.campaigns c
LEFT JOIN (
  SELECT
    m.campaign_id,
    COUNT(*)::int AS message_count
  FROM public.messages m
  WHERE m.campaign_id IS NOT NULL
  GROUP BY m.campaign_id
) m ON m.campaign_id = c.id
LEFT JOIN public.reply_templates rt ON rt.campaign_id = c.id;

-- Make view selectable by authenticated users (RLS on underlying tables still applies)
GRANT SELECT ON public.campaign_with_extra TO authenticated;

COMMIT;
