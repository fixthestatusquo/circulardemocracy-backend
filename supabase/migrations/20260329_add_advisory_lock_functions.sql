-- Add PostgreSQL advisory lock wrapper functions for clustering race condition prevention
-- These functions allow Supabase RPC calls to use PostgreSQL's advisory locks

-- Function to acquire an advisory lock (non-blocking)
-- Returns true if lock was acquired, false if already held by another session
CREATE OR REPLACE FUNCTION acquire_clustering_lock(lock_key bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT pg_try_advisory_lock(lock_key);
$$;

-- Function to release an advisory lock
-- Should be called after acquire_clustering_lock when work is complete
CREATE OR REPLACE FUNCTION release_clustering_lock(lock_key bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT pg_advisory_unlock(lock_key);
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION acquire_clustering_lock(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION release_clustering_lock(bigint) TO authenticated;

-- Add comment explaining the purpose
COMMENT ON FUNCTION acquire_clustering_lock(bigint) IS 
'Wrapper for PostgreSQL advisory lock to prevent race conditions in message clustering. Uses politician_id as the lock key.';

COMMENT ON FUNCTION release_clustering_lock(bigint) IS 
'Releases advisory lock acquired by acquire_clustering_lock. Must be called after clustering operation completes.';
