-- View: message_analytics_summary
-- Purpose: provide a single-row pre-aggregated analytics payload for the last 7 days
-- so frontend can consume analytics without client-side grouping/reduction or RPC calls.

BEGIN;

DROP VIEW IF EXISTS public.message_analytics_summary CASCADE;

CREATE VIEW public.message_analytics_summary AS
WITH base AS (
  SELECT
    date::date AS date,
    campaign_id,
    campaign_name,
    message_count::bigint AS message_count
  FROM public.message_analytics_view
  WHERE date >= NOW() - interval '7 days'
),
totals AS (
  SELECT COALESCE(SUM(message_count), 0)::bigint AS total_messages
  FROM base
),
by_day AS (
  SELECT
    date,
    SUM(message_count)::bigint AS count
  FROM base
  GROUP BY date
  ORDER BY date
),
by_campaign AS (
  SELECT
    campaign_id AS "campaignId",
    MIN(campaign_name) AS "campaignName",
    SUM(message_count)::bigint AS count
  FROM base
  GROUP BY campaign_id
  ORDER BY campaign_id
),
by_day_campaign AS (
  SELECT
    date,
    jsonb_object_agg(campaign_name, message_count ORDER BY campaign_name) AS campaigns
  FROM base
  GROUP BY date
  ORDER BY date
)
SELECT
  totals.total_messages AS total_messages,
  0::bigint AS replies_sent,
  totals.total_messages AS pending_replies,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object('date', date, 'count', count) ORDER BY date) FROM by_day),
    '[]'::jsonb
  ) AS messages_by_day,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'campaignId', "campaignId",
          'campaignName', "campaignName",
          'count', count
        )
        ORDER BY "campaignId"
      )
      FROM by_campaign
    ),
    '[]'::jsonb
  ) AS messages_by_campaign,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object('date', date, 'campaigns', campaigns)
        ORDER BY date
      )
      FROM by_day_campaign
    ),
    '[]'::jsonb
  ) AS daily_campaign_data
FROM totals;

GRANT SELECT ON public.message_analytics_summary TO authenticated;

COMMIT;
