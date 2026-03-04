BEGIN;

-- Ensure helper exists (only create if missing). Adjust if you already have a version.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'user_can_access_politician'
      AND pg_catalog.pg_get_function_arguments(oid) = 'integer'
  ) THEN
    CREATE FUNCTION public.user_can_access_politician(p_id integer)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    AS $$
      SELECT EXISTS (
        SELECT 1
        FROM public.politician_staff ps
        WHERE ps.politician_id = $1
          AND ps.user_id = (SELECT auth.uid())
        LIMIT 1
      );
    $$;
    REVOKE EXECUTE ON FUNCTION public.user_can_access_politician(integer) FROM anon, authenticated;
  END IF;
END$$;

-- 1) Enable RLS on policy_staff table
ALTER TABLE IF EXISTS public.policy_staff ENABLE ROW LEVEL SECURITY;

-- Drop existing policy for reading staff in same politician (if present)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'PolicyStaff: staff can select same politician' AND polrelid = 'public.policy_staff'::regclass) THEN
    EXECUTE 'DROP POLICY "PolicyStaff: staff can select same politician" ON public.policy_staff';
  END IF;
END$$;

-- Allow staff to see other staff for the same politician
CREATE POLICY "PolicyStaff: staff can select same politician" ON public.policy_staff
  FOR SELECT
  TO authenticated
  USING (
    -- the current auth user must be staff for the same politician
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.politician_id = public.policy_staff.politician_id
        AND ps.user_id = (SELECT auth.uid())
    )
  );

-- Optional: allow staff to insert/update/delete their own staff rows if needed.
-- Insert: only existing staff for that politician can add staff
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'PolicyStaff: staff can insert' AND polrelid = 'public.policy_staff'::regclass) THEN
    EXECUTE 'DROP POLICY "PolicyStaff: staff can insert" ON public.policy_staff';
  END IF;
END$$;

CREATE POLICY "PolicyStaff: staff can insert" ON public.policy_staff
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.politician_id = NEW.politician_id
        AND ps.user_id = (SELECT auth.uid())
    )
  );

-- Update: only staff for same politician can update staff entries for that politician
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'PolicyStaff: staff can update' AND polrelid = 'public.policy_staff'::regclass) THEN
    EXECUTE 'DROP POLICY "PolicyStaff: staff can update" ON public.policy_staff';
  END IF;
END$$;

CREATE POLICY "PolicyStaff: staff can update" ON public.policy_staff
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.politician_id = public.policy_staff.politician_id
        AND ps.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.politician_id = NEW.politician_id
        AND ps.user_id = (SELECT auth.uid())
    )
  );

-- Delete: only staff for same politician can delete staff entries for that politician
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'PolicyStaff: staff can delete' AND polrelid = 'public.policy_staff'::regclass) THEN
    EXECUTE 'DROP POLICY "PolicyStaff: staff can delete" ON public.policy_staff';
  END IF;
END$$;

CREATE POLICY "PolicyStaff: staff can delete" ON public.policy_staff
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.politician_id = public.policy_staff.politician_id
        AND ps.user_id = (SELECT auth.uid())
    )
  );

-- 2) Enable RLS on campaign table
ALTER TABLE IF EXISTS public.campaign ENABLE ROW LEVEL SECURITY;

-- Drop existing general select policy if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Campaigns: staff can select all' AND polrelid = 'public.campaign'::regclass) THEN
    EXECUTE 'DROP POLICY "Campaigns: staff can select all" ON public.campaign';
  END IF;
END$$;

-- Allow any authenticated staff (of any politician) to see all campaigns.
-- The requirement: "every staff can see every campaign" — we'll enforce by checking that the requester is staff for at least one politician.
CREATE POLICY "Campaigns: staff can select all" ON public.campaign
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.user_id = (SELECT auth.uid())
      LIMIT 1
    )
  );

-- Optionally allow staff to insert/update/delete campaigns if needed.
-- Insert: allow staff to create campaigns
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Campaigns: staff can insert' AND polrelid = 'public.campaign'::regclass) THEN
    EXECUTE 'DROP POLICY "Campaigns: staff can insert" ON public.campaign';
  END IF;
END$$;

CREATE POLICY "Campaigns: staff can insert" ON public.campaign
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.user_id = (SELECT auth.uid())
      LIMIT 1
    )
  );

-- Update/Delete: restrict to staff as well (you can narrow further if you want campaign->politician mapping)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Campaigns: staff can update' AND polrelid = 'public.campaign'::regclass) THEN
    EXECUTE 'DROP POLICY "Campaigns: staff can update" ON public.campaign';
  END IF;
END$$;

CREATE POLICY "Campaigns: staff can update" ON public.campaign
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.user_id = (SELECT auth.uid())
      LIMIT 1
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.user_id = (SELECT auth.uid())
      LIMIT 1
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Campaigns: staff can delete' AND polrelid = 'public.campaign'::regclass) THEN
    EXECUTE 'DROP POLICY "Campaigns: staff can delete" ON public.campaign';
  END IF;
END$$;

CREATE POLICY "Campaigns: staff can delete" ON public.campaign
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.user_id = (SELECT auth.uid())
      LIMIT 1
    )
  );

COMMIT;
