-- handle_new_user() only needs to run as a trigger fired by auth.users
-- inserts (which Postgres invokes directly, independent of EXECUTE grants
-- on the function). Postgres grants EXECUTE to PUBLIC on every new function
-- by default, which — combined with SECURITY DEFINER — made this callable
-- directly via /rest/v1/rpc/handle_new_user by anon/authenticated, letting
-- anyone insert an arbitrary-id row into public.profiles. Revoking EXECUTE
-- closes that off without touching the trigger itself.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
