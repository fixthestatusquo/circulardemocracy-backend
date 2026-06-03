-- Migration: Fix reply_templates RLS policies
-- Ensure staff can only access templates belonging to their associated politician

BEGIN;

-- 1) Drop existing overly broad policies
DROP POLICY IF EXISTS "ReplyTemplates: staff can select" ON public.reply_templates;
DROP POLICY IF EXISTS "ReplyTemplates: staff can insert" ON public.reply_templates;
DROP POLICY IF EXISTS "ReplyTemplates: staff can update" ON public.reply_templates;
DROP POLICY IF EXISTS "ReplyTemplates: staff can delete" ON public.reply_templates;

-- 2) Create new restrictive policies using politician_id

-- SELECT: staff can only see templates for their politician
CREATE POLICY "ReplyTemplates: staff can select"
ON public.reply_templates
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.politician_staff ps
    WHERE ps.user_id = (SELECT auth.uid())
      AND ps.politician_id = public.reply_templates.politician_id
    LIMIT 1
  )
);

-- INSERT: staff can only create templates for their politician
CREATE POLICY "ReplyTemplates: staff can insert"
ON public.reply_templates
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.politician_staff ps
    WHERE ps.user_id = (SELECT auth.uid())
      AND ps.politician_id = politician_id
    LIMIT 1
  )
);

-- UPDATE: staff can only update templates for their politician
CREATE POLICY "ReplyTemplates: staff can update"
ON public.reply_templates
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.politician_staff ps
    WHERE ps.user_id = (SELECT auth.uid())
      AND ps.politician_id = public.reply_templates.politician_id
    LIMIT 1
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.politician_staff ps
    WHERE ps.user_id = (SELECT auth.uid())
      AND ps.politician_id = politician_id
    LIMIT 1
  )
);

-- DELETE: staff can only delete templates for their politician
CREATE POLICY "ReplyTemplates: staff can delete"
ON public.reply_templates
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.politician_staff ps
    WHERE ps.user_id = (SELECT auth.uid())
      AND ps.politician_id = public.reply_templates.politician_id
    LIMIT 1
  )
);

COMMIT;
