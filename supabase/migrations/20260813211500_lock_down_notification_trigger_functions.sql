-- Same class of issue Phase 1 already closed for handle_new_user(): Postgres
-- grants EXECUTE to PUBLIC on every new function by default, which made
-- these four trigger-only functions directly callable via
-- /rest/v1/rpc/notify_* by anon/authenticated even though they're only ever
-- meant to fire implicitly as AFTER INSERT/UPDATE triggers. A direct call
-- outside trigger context errors out (NEW/OLD are unassigned), so this
-- wasn't exploitable, but there's no reason to leave the surface open.
revoke execute on function public.notify_round_joined() from public, anon, authenticated;
revoke execute on function public.notify_round_left() from public, anon, authenticated;
revoke execute on function public.notify_round_cancelled() from public, anon, authenticated;
revoke execute on function public.notify_new_message() from public, anon, authenticated;
