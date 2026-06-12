-- Migration: Grant staff SELECT on message_clusters
-- Staff need to read clusters for the frontend cluster-management UI.

ALTER TABLE IF EXISTS public.message_clusters ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.message_clusters TO authenticated;

DROP POLICY IF EXISTS "MessageClusters: staff can select" ON public.message_clusters;
CREATE POLICY "MessageClusters: staff can select"
ON public.message_clusters
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
