-- The previous migration's `revoke execute ... from public` didn't actually
-- remove anon's EXECUTE privilege -- this project's database has default
-- privileges configured so every newly created function auto-grants EXECUTE
-- to anon/authenticated/service_role independently of the PUBLIC default,
-- the same gotcha already documented for the notification trigger functions
-- (20260813211500). Revoking from public alone doesn't touch a grant a role
-- holds independently. Fix: revoke from anon explicitly too (authenticated
-- keeps EXECUTE, matching join_golf_call/host_golf_call/submit_round_review
-- -- this is meant to be called directly by signed-in real users).
revoke execute on function public.upsert_external_course(text, text, text, text, text, text, text, text, double precision, double precision) from anon;
