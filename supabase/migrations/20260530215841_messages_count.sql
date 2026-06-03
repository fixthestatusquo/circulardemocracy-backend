DROP FUNCTION get_message_status_count(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION get_message_status_count(
  from_date timestamptz DEFAULT NULL,
  to_date timestamptz DEFAULT NULL
)
RETURNS TABLE(status text, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_politician_id int;
BEGIN
  SELECT ps.politician_id INTO v_politician_id
  FROM public.politician_staff ps
  WHERE ps.user_id = auth.uid()
  LIMIT 1;

  IF v_politician_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
    SELECT m.processing_status::text as status, COUNT(*)
    FROM messages m
    WHERE
      m.politician_id = v_politician_id
      AND (from_date IS NULL OR m.received_at >= from_date)
      AND (to_date IS NULL OR m.received_at <= to_date)
    GROUP BY m.processing_status;
END;
$$;
