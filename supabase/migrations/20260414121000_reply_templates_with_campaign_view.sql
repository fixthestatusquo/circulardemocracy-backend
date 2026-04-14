-- View: reply_templates_with_campaign
-- Purpose: return reply templates with campaign metadata in one query,
-- avoiding frontend multi-fetch merge patterns.

BEGIN;

DROP VIEW IF EXISTS public.reply_templates_with_campaign CASCADE;

CREATE VIEW public.reply_templates_with_campaign AS
SELECT
  rt.id,
  rt.campaign_id,
  c.name AS campaign_name,
  rt.name,
  rt.subject,
  rt.body,
  rt.active,
  rt.send_timing,
  rt.scheduled_for,
  rt.created_at,
  rt.updated_at
FROM public.reply_templates rt
LEFT JOIN public.campaigns c ON c.id = rt.campaign_id;

GRANT SELECT ON public.reply_templates_with_campaign TO authenticated;

COMMIT;
