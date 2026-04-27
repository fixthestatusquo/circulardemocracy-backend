-- After sender_emails was dropped (20260413184818_cleanup), stray triggers on
-- messages could still reference it and break reply updates (42P01).
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'messages'
      AND NOT t.tgisinternal
      AND p.prolang IN (
        (SELECT oid FROM pg_language WHERE lanname = 'plpgsql'),
        (SELECT oid FROM pg_language WHERE lanname = 'sql')
      )
      AND pg_get_functiondef(p.oid) ILIKE '%sender_emails%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.messages', rec.tgname);
  END LOOP;
END;
$$;
