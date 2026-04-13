-- =========================
-- politician_staff policies
-- =========================

-- Drop the old policies (these have incorrect logic)
DROP POLICY IF EXISTS "Staff: staff can select (same politician)" ON public.politician_staff;
DROP POLICY IF EXISTS "Staff: staff can insert (same politician)" ON public.politician_staff;
DROP POLICY IF EXISTS "Staff: staff can update (same politician)" ON public.politician_staff;
DROP POLICY IF EXISTS "Staff: staff can delete (same politician)" ON public.politician_staff;

-- Create the correct function-based policies
CREATE POLICY "Staff: staff can select (same politician)"
ON public.politician_staff
FOR SELECT
TO authenticated
USING (user_can_access_politician(politician_id));

CREATE POLICY "Staff: staff can insert (same politician)"
ON public.politician_staff
FOR INSERT
TO authenticated
WITH CHECK (user_can_access_politician(politician_id));

CREATE POLICY "Staff: staff can update (same politician)"
ON public.politician_staff
FOR UPDATE
TO authenticated
USING (user_can_access_politician(politician_id))
WITH CHECK (user_can_access_politician(politician_id));

CREATE POLICY "Staff: staff can delete (same politician)"
ON public.politician_staff
FOR DELETE
TO authenticated
USING (user_can_access_politician(politician_id));

