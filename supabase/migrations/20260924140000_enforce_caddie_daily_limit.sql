-- Health audit P3-5: the Caddie daily limit could be bypassed.
--
-- analyze-swing enforces DAILY_LIMIT_PER_USER (30 per rolling 24h) and the
-- 30s cooldown by counting the caller's own caddie_analyses rows, using the
-- caller's JWT. Two client-reachable writes let a user shrink that count and
-- re-spend Roboflow + Gemini credits without limit (cost abuse only; no
-- other user's data is reachable):
--   (a) caddie_analyses_delete_own -- delete your own rows via the REST API.
--       Nothing in the app deletes an analysis (no "delete analysis" UI;
--       failed runs are kept as status = 'failed'; account deletion goes
--       through the auth.users ON DELETE CASCADE, which RLS doesn't gate).
--   (b) caddie_analyses_update_own has no column limits, so created_at could
--       be back-dated out of the 24h window (and out of the cooldown).
-- The count was also a check-then-insert in the Edge Function, so N parallel
-- requests could all pass it before any row existed.
--
-- Fix, all at the database:
--   1. Drop the client delete policy (RLS then denies client deletes).
--   2. Freeze created_at on every update. No writer ever changes it.
--   3. Enforce the daily limit in a BEFORE INSERT trigger, serialized per
--      owner with a transaction-scoped advisory lock, so parallel requests
--      can't race past it. analyze-swing's own pre-check stays as the
--      friendly fast path; this is the backstop that can't be bypassed.
--
-- Unchanged on purpose: the persisted-job model. Every attempt is still one
-- row; a stale 'processing' row (> 5 min) is still retryable -- the retry is
-- a new row, counted exactly like today; failed rows stay as 'failed' and
-- still count toward the limit, as they always have. The limit value (30)
-- matches DAILY_LIMIT_PER_USER in supabase/functions/analyze-swing/index.ts
-- -- change both together.

-- 1. No client deletes.
drop policy if exists caddie_analyses_delete_own on public.caddie_analyses;

-- 2. created_at is immutable.
create function public.freeze_caddie_analyses_created_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.created_at := old.created_at;
  return new;
end;
$$;

revoke execute on function public.freeze_caddie_analyses_created_at() from public, anon, authenticated;

create trigger freeze_caddie_analyses_created_at
  before update on public.caddie_analyses
  for each row execute function public.freeze_caddie_analyses_created_at();

-- 3. Daily limit, enforced atomically on insert. created_at is also pinned to
-- now() here so a client insert can't pre-date its own row out of the window.
-- SECURITY INVOKER on purpose: BEFORE triggers run before the insert
-- policy's WITH CHECK, so a definer-rights count would let a client probe
-- whether ANOTHER user is at their limit by inserting with a spoofed
-- owner_id (the limit error would fire before RLS rejects it). As invoker,
-- the count goes through caddie_analyses_select_own, so a client only ever
-- counts its own rows -- exactly the caller's quota -- and a spoofed
-- owner_id counts 0 and then fails RLS as usual. analyze-swing inserts with
-- the caller's JWT, so this is the same row set it counts today.
create function public.enforce_caddie_daily_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit constant integer := 30;
  v_count integer;
begin
  new.created_at := now();

  perform pg_advisory_xact_lock(hashtextextended('caddie_daily_limit:' || new.owner_id::text, 0));

  select count(*) into v_count
  from public.caddie_analyses
  where owner_id = new.owner_id
    and created_at >= now() - interval '24 hours';

  if v_count >= v_limit then
    raise exception 'You''ve reached today''s Caddie analysis limit (%). Try again tomorrow.', v_limit
      using errcode = 'P0001', hint = 'caddie_daily_limit';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_caddie_daily_limit() from public, anon, authenticated;

create trigger enforce_caddie_daily_limit
  before insert on public.caddie_analyses
  for each row execute function public.enforce_caddie_daily_limit();
