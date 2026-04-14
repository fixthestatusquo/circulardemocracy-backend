-- Cleanup: remove summary RPC in favor of client-side aggregation
-- from message_analytics_view/get_message_analytics_daily rows.

BEGIN;

DROP FUNCTION IF EXISTS public.get_message_analytics_summary(integer) CASCADE;

COMMIT;
