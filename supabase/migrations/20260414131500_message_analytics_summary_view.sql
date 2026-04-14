-- Cleanup: remove summary analytics view.
-- Frontend now reads daily rows and aggregates client-side.

BEGIN;

DROP VIEW IF EXISTS public.message_analytics_summary CASCADE;

COMMIT;
