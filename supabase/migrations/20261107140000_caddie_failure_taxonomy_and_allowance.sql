-- Caddie: failure taxonomy, retry on the same job, and "only a delivered
-- analysis uses an allowance slot" (2026-11-06, Micky's decisions after the
-- 2026-11-04 failures investigation).
--
-- What changes
--   1. caddie_analyses gets job bookkeeping: attempt (1 = first run, +1 per
--      Try again, max 4 = 3 retries), attempt_started_at (stale detection now
--      keys off this, not created_at, because a retried row keeps its
--      created_at), stage / stage_updated_at (last persisted pipeline stage,
--      so a killed worker still says where it died), finished_at,
--      failure_stage / failure_category / failure_retryable /
--      provider_http_status (structured, enum-checked, no free text), and the
--      golfer-picked trim window (trim_start_seconds / trim_end_seconds),
--      which used to live only inside error_message.
--   2. Three private tables (RLS on, no policies, no grants -- the same
--      posture as private.unsent_message_copies):
--        private.caddie_allowance_charges  one row per DELIVERED analysis,
--          written by a trigger on the first transition to 'complete'.
--          Append-only for clients, so flipping your own row back to
--          'failed' can never refund a slot.
--        private.caddie_pipeline_starts    one row per pipeline run (insert
--          as 'processing' + every Try again). Hidden cost ceiling: 60 per
--          user per 24 h, failures included.
--        private.caddie_job_diagnostics    redacted, classified failure
--          detail per attempt, admin-readable through
--          admin_list_caddie_failures() only.
--   3. enforce_caddie_daily_limit() is replaced (same trigger): it now counts
--      charged (delivered) analyses + the caller's live in-flight jobs
--      against the 30/24 h allowance, and pipeline starts against the 60/24 h
--      ceiling. It is SECURITY DEFINER now (it must read the private
--      ledgers), so it first checks new.owner_id = auth.uid(): a spoofed
--      owner_id skips every count and is then rejected by RLS exactly as
--      before -- a client can never probe another user's usage.
--   4. private.guard_caddie_job() (BEFORE UPDATE) makes the bookkeeping
--      trustworthy for JWT callers (the app and analyze-swing): attempt may
--      only go up by exactly 1, together with a flip to 'processing' from
--      'failed' or a stale (> 6 min) 'processing' row, at most to 4, inside
--      the allowance and the ceiling; attempt_started_at is set by the
--      database, never the caller; finished_at is stamped on the terminal
--      transition. Concurrent Try agains on one row serialize on the row
--      lock, and analyze-swing's `.eq('attempt', n)` guard makes the loser a
--      no-op, so one tap = one run, never a duplicate record.
--   4b. The ledgers have NO foreign key to the analysis row, so the new
--      delete_caddie_analysis() (owner-only; refuses a live 'processing'
--      job; returns the caller's now-unreferenced caddie-media paths for the
--      app to remove via the Storage API) never refunds a slot or a run,
--      and the admin failure stats (now read from the diagnostics ledger,
--      one row per failed attempt via private.record_caddie_failure) keep
--      their totals. Deleting the ACCOUNT still removes all of it (owner_id
--      -> auth.users ON DELETE CASCADE).
--   5. RPCs: caddie_allowance_status() (caller's own usage),
--      sweep_stale_caddie_jobs() (invoker: marks the caller's own dead
--      'processing' rows failed/worker_lost, keeping the last stage),
--      record_caddie_diagnostic() (owner-checked, capped, re-redacted),
--      admin_caddie_failure_stats() and admin_list_caddie_failures() (admin
--      gate, user ids only -- no names, emails, URLs or paths).
--
-- Known and accepted (Option B, Micky 2026-11-06): caddie_analyses_update_own
-- still lets a client update its own row's other columns (status, stage,
-- failure_*). That only ever affects the caller's own rows and admin
-- counters; it cannot refund a slot (append-only ledger) or start a free
-- pipeline (starts are recorded by the database). Option A -- column-level
-- UPDATE grants limited to shared_to_community, with analyze-swing and
-- translate writing job state through the service role -- is the documented
-- follow-up.
--
-- Backfill: every existing 'complete' row is charged at its created_at and
-- every existing row is recorded as one start at its created_at, so the
-- 24 h windows are right from the moment this applies. Failed rows from the
-- last 24 h stop counting against the allowance immediately (the new rule).
--
-- Keep in sync with supabase/functions/_shared/caddieReliability.ts
-- (CADDIE_STAGES, CADDIE_FAILURE_CATEGORIES, DAILY_LIMIT_PER_USER = 30,
-- PIPELINE_START_CEILING = 60, MAX_ATTEMPTS = 4, stale 6 min) --
-- tests/caddieTaxonomy.test.ts reads this file and fails on drift.

-- ---------------------------------------------------------------------
-- 1. Job bookkeeping columns
-- ---------------------------------------------------------------------
alter table public.caddie_analyses
  add column attempt smallint not null default 1,
  add column attempt_started_at timestamptz,
  add column stage text,
  add column stage_updated_at timestamptz,
  add column finished_at timestamptz,
  add column failure_stage text,
  add column failure_category text,
  add column failure_retryable boolean,
  add column provider_http_status smallint,
  add column trim_start_seconds numeric(8, 3),
  add column trim_end_seconds numeric(8, 3);

alter table public.caddie_analyses
  add constraint caddie_analyses_attempt_range check (attempt between 1 and 4),
  add constraint caddie_analyses_stage_valid check (
    stage is null or stage in (
      'queued', 'media_fetch', 'trim', 'frame_extract', 'pose', 'pose_gate',
      'gemini_upload', 'gemini_processing', 'gemini_generate', 'output_validation', 'save'
    )
  ),
  add constraint caddie_analyses_failure_stage_valid check (
    failure_stage is null or failure_stage in (
      'queued', 'media_fetch', 'trim', 'frame_extract', 'pose', 'pose_gate',
      'gemini_upload', 'gemini_processing', 'gemini_generate', 'output_validation', 'save'
    )
  ),
  add constraint caddie_analyses_failure_category_valid check (
    failure_category is null or failure_category in (
      'video_unreadable', 'video_too_long_or_large', 'pose_not_found',
      'provider_rate_limited', 'provider_unavailable', 'provider_quota_exhausted', 'provider_config',
      'model_output_invalid', 'deadline_exceeded', 'worker_lost', 'save_failed', 'internal'
    )
  ),
  add constraint caddie_analyses_provider_http_status_range check (
    provider_http_status is null or provider_http_status between 100 and 599
  ),
  add constraint caddie_analyses_trim_window_valid check (
    (trim_start_seconds is null and trim_end_seconds is null)
    or (trim_start_seconds >= 0 and trim_end_seconds > trim_start_seconds and trim_end_seconds - trim_start_seconds <= 15)
  );

comment on column public.caddie_analyses.attempt is
  '1 = first run; +1 per Try again (same row). Max 4. Only the database moves it (private.guard_caddie_job).';
comment on column public.caddie_analyses.attempt_started_at is
  'When the current attempt started. Set by the database on insert and on each retry; stale detection uses this, not created_at.';
comment on column public.caddie_analyses.stage is
  'Last persisted pipeline stage of the current attempt (where a killed worker died).';
comment on column public.caddie_analyses.failure_category is
  'Structured failure class (no free text). Detail, redacted, lives in private.caddie_job_diagnostics.';

create index caddie_analyses_processing_idx
  on public.caddie_analyses (owner_id, attempt_started_at)
  where status = 'processing';

-- ---------------------------------------------------------------------
-- 2. Private ledgers + diagnostics (RLS on, no policies, no grants)
--
-- analysis_id is deliberately NOT a foreign key to caddie_analyses: the
-- golfer can delete an analysis (delete_caddie_analysis below), and a
-- cascade would refund its allowance slot and its pipeline starts, making
-- delete-and-retry free, unlimited AI spend. The ledgers outlive the row.
-- owner_id IS a foreign key to auth.users with ON DELETE CASCADE, so
-- deleting the ACCOUNT still removes everything about that user.
-- ---------------------------------------------------------------------
create table private.caddie_allowance_charges (
  analysis_id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  charged_at timestamptz not null default now()
);
create index caddie_allowance_charges_owner_idx on private.caddie_allowance_charges (owner_id, charged_at desc);
alter table private.caddie_allowance_charges enable row level security;
revoke all on table private.caddie_allowance_charges from public, anon, authenticated;

create table private.caddie_pipeline_starts (
  id bigint generated always as identity primary key,
  analysis_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  attempt smallint not null,
  started_at timestamptz not null default now(),
  constraint caddie_pipeline_starts_one_per_attempt unique (analysis_id, attempt)
);
create index caddie_pipeline_starts_owner_idx on private.caddie_pipeline_starts (owner_id, started_at desc);
alter table private.caddie_pipeline_starts enable row level security;
revoke all on table private.caddie_pipeline_starts from public, anon, authenticated;

-- One row per failed attempt, written by the database on every transition
-- to 'failed' (private.record_caddie_failure) and enriched with analyze-
-- swing's redacted detail (record_caddie_diagnostic). This is the admin
-- failure statistics' source, so the aggregates survive the golfer deleting
-- the analysis (no FK to the row, see above). It holds no video, URL, path
-- or free text beyond the redacted 300-char detail; deleting the account
-- removes it.
create table private.caddie_job_diagnostics (
  id bigint generated always as identity primary key,
  analysis_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  attempt smallint not null check (attempt between 1 and 4),
  -- + 'unknown' for rows that failed before stages existed (backfill).
  stage text not null check (stage in (
    'queued', 'media_fetch', 'trim', 'frame_extract', 'pose', 'pose_gate',
    'gemini_upload', 'gemini_processing', 'gemini_generate', 'output_validation', 'save', 'unknown'
  )),
  -- + 'unclassified' for rows that failed before categories existed.
  category text not null check (category in (
    'video_unreadable', 'video_too_long_or_large', 'pose_not_found',
    'provider_rate_limited', 'provider_unavailable', 'provider_quota_exhausted', 'provider_config',
    'model_output_invalid', 'deadline_exceeded', 'worker_lost', 'save_failed', 'internal', 'unclassified'
  )),
  retryable boolean not null default false,
  provider_http_status smallint check (provider_http_status is null or provider_http_status between 100 and 599),
  step_attempts smallint not null default 1 check (step_attempts between 1 and 10),
  detail text not null default '' check (length(detail) <= 300),
  created_at timestamptz not null default now()
);
create index caddie_job_diagnostics_analysis_idx on private.caddie_job_diagnostics (analysis_id, created_at desc);
create index caddie_job_diagnostics_created_idx on private.caddie_job_diagnostics (created_at desc);
alter table private.caddie_job_diagnostics enable row level security;
revoke all on table private.caddie_job_diagnostics from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Allowance + ceiling on insert (replaces the 20260924140000 body)
-- ---------------------------------------------------------------------
create or replace function public.enforce_caddie_daily_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit constant integer := 30;     -- delivered analyses per rolling 24 h
  v_ceiling constant integer := 60;   -- pipeline starts per rolling 24 h (failures included)
  v_uid uuid := (select auth.uid());
  v_used integer;
  v_starts integer;
begin
  new.created_at := now();
  new.attempt := 1;
  new.attempt_started_at := now();
  new.finished_at := null;

  -- DEFINER: count only the caller's own usage. A spoofed owner_id (or a
  -- JWT-less service/SQL insert) skips the counts; RLS's WITH CHECK then
  -- rejects a spoofed client insert exactly as before.
  if v_uid is null or new.owner_id is distinct from v_uid then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('caddie_daily_limit:' || new.owner_id::text, 0));

  select
    (select count(*) from private.caddie_allowance_charges c
      where c.owner_id = new.owner_id and c.charged_at >= now() - interval '24 hours')
    + (select count(*) from public.caddie_analyses a
        where a.owner_id = new.owner_id and a.status = 'processing'
          and coalesce(a.attempt_started_at, a.created_at) >= now() - interval '6 minutes')
  into v_used;

  if v_used >= v_limit then
    raise exception 'You''ve reached today''s Caddie analysis limit (%). Try again tomorrow.', v_limit
      using errcode = 'P0001', hint = 'caddie_daily_limit';
  end if;

  if new.status = 'processing' then
    select count(*) into v_starts from private.caddie_pipeline_starts s
      where s.owner_id = new.owner_id and s.started_at >= now() - interval '24 hours';
    if v_starts >= v_ceiling then
      raise exception 'Caddie has had a lot of attempts today. Please try again tomorrow.'
        using errcode = 'P0001', hint = 'caddie_attempt_ceiling';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_caddie_daily_limit() from public, anon, authenticated;

-- One start row per pipeline run created by an insert.
create function private.record_caddie_pipeline_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'processing' then
    insert into private.caddie_pipeline_starts (analysis_id, owner_id, attempt)
    values (new.id, new.owner_id, new.attempt)
    on conflict (analysis_id, attempt) do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function private.record_caddie_pipeline_start() from public, anon, authenticated;

create trigger record_caddie_pipeline_start
  after insert on public.caddie_analyses
  for each row execute function private.record_caddie_pipeline_start();

-- ---------------------------------------------------------------------
-- 4. Retry / bookkeeping guard on update
-- ---------------------------------------------------------------------
create function private.guard_caddie_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_attempts constant smallint := 4;   -- 1 run + 3 Try agains
  v_limit constant integer := 30;
  v_ceiling constant integer := 60;
  v_uid uuid := (select auth.uid());
  v_used integer;
  v_starts integer;
  v_old_stale boolean;
begin
  -- JWT-less callers (SQL editor, service role) are trusted as-is, apart
  -- from the finished_at stamp below.
  if v_uid is not null then
    if new.attempt is distinct from old.attempt then
      if new.attempt <> old.attempt + 1 or new.status <> 'processing' then
        raise exception 'This analysis can''t be restarted that way.'
          using errcode = 'P0001', hint = 'caddie_retry_invalid';
      end if;

      v_old_stale := old.status = 'processing'
        and coalesce(old.attempt_started_at, old.created_at) < now() - interval '6 minutes';
      if not (old.status = 'failed' or v_old_stale) then
        raise exception 'This analysis is already running.'
          using errcode = 'P0001', hint = 'caddie_retry_not_allowed';
      end if;

      if new.attempt > v_max_attempts then
        raise exception 'Caddie has tried this swing several times. Please film a new clip.'
          using errcode = 'P0001', hint = 'caddie_retry_cap';
      end if;

      perform pg_advisory_xact_lock(hashtextextended('caddie_daily_limit:' || old.owner_id::text, 0));

      select
        (select count(*) from private.caddie_allowance_charges c
          where c.owner_id = old.owner_id and c.charged_at >= now() - interval '24 hours')
        + (select count(*) from public.caddie_analyses a
            where a.owner_id = old.owner_id and a.status = 'processing' and a.id <> old.id
              and coalesce(a.attempt_started_at, a.created_at) >= now() - interval '6 minutes')
      into v_used;
      if v_used >= v_limit then
        raise exception 'You''ve reached today''s Caddie analysis limit (%). Try again tomorrow.', v_limit
          using errcode = 'P0001', hint = 'caddie_daily_limit';
      end if;

      select count(*) into v_starts from private.caddie_pipeline_starts s
        where s.owner_id = old.owner_id and s.started_at >= now() - interval '24 hours';
      if v_starts >= v_ceiling then
        raise exception 'Caddie has had a lot of attempts today. Please try again tomorrow.'
          using errcode = 'P0001', hint = 'caddie_attempt_ceiling';
      end if;

      new.attempt_started_at := now();
      new.finished_at := null;
      insert into private.caddie_pipeline_starts (analysis_id, owner_id, attempt)
      values (old.id, old.owner_id, new.attempt)
      on conflict (analysis_id, attempt) do nothing;
    else
      -- Outside a retry the database owns attempt_started_at.
      new.attempt_started_at := old.attempt_started_at;
    end if;
  end if;

  if new.status in ('complete', 'failed') and old.status is distinct from new.status then
    new.finished_at := now();
  end if;

  return new;
end;
$$;

revoke execute on function private.guard_caddie_job() from public, anon, authenticated;

create trigger guard_caddie_job
  before update on public.caddie_analyses
  for each row execute function private.guard_caddie_job();

-- ---------------------------------------------------------------------
-- 5. Charge on the first delivery
-- ---------------------------------------------------------------------
create function private.charge_caddie_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'complete' and old.status is distinct from 'complete' then
    insert into private.caddie_allowance_charges (analysis_id, owner_id)
    values (new.id, new.owner_id)
    on conflict (analysis_id) do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function private.charge_caddie_allowance() from public, anon, authenticated;

create trigger charge_caddie_allowance
  after update of status on public.caddie_analyses
  for each row execute function private.charge_caddie_allowance();

-- One diagnostics row per failed attempt, whoever wrote the failure
-- (analyze-swing's fail(), the worker_lost sweep, an older function build).
-- Capped per analysis so a client flipping its own row can't flood it.
create function private.record_caddie_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage text;
  v_category text;
begin
  if new.status = 'failed' and old.status is distinct from 'failed' then
    if (select count(*) from private.caddie_job_diagnostics d where d.analysis_id = new.id) >= 40 then
      return null;
    end if;
    v_stage := coalesce(new.failure_stage, new.stage, 'unknown');
    v_category := coalesce(new.failure_category, 'unclassified');
    insert into private.caddie_job_diagnostics (analysis_id, owner_id, attempt, stage, category, retryable, provider_http_status)
    values (
      new.id, new.owner_id, greatest(1, least(new.attempt, 4)),
      case when v_stage in ('queued', 'media_fetch', 'trim', 'frame_extract', 'pose', 'pose_gate', 'gemini_upload',
                            'gemini_processing', 'gemini_generate', 'output_validation', 'save') then v_stage else 'unknown' end,
      v_category,
      coalesce(new.failure_retryable, false),
      new.provider_http_status
    );
  end if;
  return null;
end;
$$;

revoke execute on function private.record_caddie_failure() from public, anon, authenticated;

create trigger record_caddie_failure
  after update of status on public.caddie_analyses
  for each row execute function private.record_caddie_failure();

-- ---------------------------------------------------------------------
-- 6. Client/function RPCs
-- ---------------------------------------------------------------------
-- The caller's own usage (analyze-swing's friendly pre-check; the app may
-- show "n left").
create function public.caddie_allowance_status()
returns table (used integer, daily_limit integer, starts integer, start_ceiling integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;
  return query
  select
    ((select count(*) from private.caddie_allowance_charges c
       where c.owner_id = v_uid and c.charged_at >= now() - interval '24 hours')
     + (select count(*) from public.caddie_analyses a
         where a.owner_id = v_uid and a.status = 'processing'
           and coalesce(a.attempt_started_at, a.created_at) >= now() - interval '6 minutes'))::integer,
    30,
    (select count(*) from private.caddie_pipeline_starts s
      where s.owner_id = v_uid and s.started_at >= now() - interval '24 hours')::integer,
    60;
end;
$$;

revoke execute on function public.caddie_allowance_status() from public, anon;
grant execute on function public.caddie_allowance_status() to authenticated;

-- Marks the CALLER's own dead 'processing' rows (worker killed before it
-- could write an outcome: > 6.5 min, above analyze-swing's 330 s deadline
-- and 6 min stale cutoff) as failed/worker_lost, keeping the last stage.
-- Invoker: RLS limits it to the caller's rows on top of the owner filter.
create function public.sweep_stale_caddie_jobs()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.caddie_analyses a
     set status = 'failed',
         failure_category = 'worker_lost',
         failure_stage = coalesce(a.stage, 'queued'),
         failure_retryable = true,
         error_message = 'code:timeout'
           || case when a.trim_start_seconds is not null and a.trim_end_seconds is not null
                   then ' window:' || a.trim_start_seconds::text || '-' || a.trim_end_seconds::text
                   else '' end
           || ' worker_lost'
   where a.owner_id = (select auth.uid())
     and a.status = 'processing'
     and coalesce(a.attempt_started_at, a.created_at) < now() - interval '390 seconds';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.sweep_stale_caddie_jobs() from public, anon;
grant execute on function public.sweep_stale_caddie_jobs() to authenticated;

-- analyze-swing's per-attempt failure detail (already classified and
-- redacted there; redacted again here as defense in depth). It fills in the
-- row private.record_caddie_failure wrote for this attempt (or adds one if
-- there is none). Owner-checked and capped per analysis, so a client can
-- only ever add a bounded amount of noise to its own rows' diagnostics.
create function public.record_caddie_diagnostic(
  p_analysis_id uuid,
  p_attempt smallint,
  p_stage text,
  p_category text,
  p_retryable boolean,
  p_http_status smallint,
  p_step_attempts smallint,
  p_detail text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_detail text;
  v_attempt smallint := greatest(1, least(coalesce(p_attempt, 1), 4));
  v_diag_id bigint;
begin
  select a.owner_id into v_owner from public.caddie_analyses a where a.id = p_analysis_id;
  if v_owner is null or v_owner is distinct from (select auth.uid()) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  v_detail := coalesce(p_detail, '');
  v_detail := regexp_replace(v_detail, 'https?://[^[:space:]"'']+', '[url]', 'gi');
  v_detail := regexp_replace(v_detail, '(key|token|signature|sig|secret|password)=[^&[:space:]"'']+', '\1=[redacted]', 'gi');
  v_detail := regexp_replace(v_detail, 'Bearer[[:space:]]+[A-Za-z0-9._~+/=-]+', 'Bearer [redacted]', 'gi');
  v_detail := regexp_replace(v_detail, 'AIza[0-9A-Za-z_-]{16,}', '[redacted-key]', 'g');

  select d.id into v_diag_id from private.caddie_job_diagnostics d
   where d.analysis_id = p_analysis_id and d.attempt = v_attempt and d.detail = ''
   order by d.id desc limit 1;
  if v_diag_id is not null then
    update private.caddie_job_diagnostics d
       set detail = left(v_detail, 300),
           step_attempts = greatest(1, least(coalesce(p_step_attempts, 1), 10)),
           retryable = coalesce(p_retryable, d.retryable),
           provider_http_status = coalesce(case when p_http_status between 100 and 599 then p_http_status end, d.provider_http_status)
     where d.id = v_diag_id;
    return;
  end if;

  if (select count(*) from private.caddie_job_diagnostics d where d.analysis_id = p_analysis_id) >= 40 then
    return;
  end if;
  insert into private.caddie_job_diagnostics
    (analysis_id, owner_id, attempt, stage, category, retryable, provider_http_status, step_attempts, detail)
  values (
    p_analysis_id, v_owner,
    v_attempt,
    p_stage, p_category, coalesce(p_retryable, false),
    case when p_http_status between 100 and 599 then p_http_status else null end,
    greatest(1, least(coalesce(p_step_attempts, 1), 10)),
    left(v_detail, 300)
  );
end;
$$;

revoke execute on function public.record_caddie_diagnostic(uuid, smallint, text, text, boolean, smallint, smallint, text) from public, anon;
grant execute on function public.record_caddie_diagnostic(uuid, smallint, text, text, boolean, smallint, smallint, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Admin dashboard (same private.has_role gate as every admin RPC)
-- ---------------------------------------------------------------------
create function public.admin_caddie_failure_stats()
returns table (
  failure_category text,
  failure_stage text,
  last_24h bigint,
  last_7d bigint,
  total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- Failed attempts come from the diagnostics ledger (one row per failed
  -- attempt, kept when the golfer deletes the analysis); dead workers not
  -- yet swept come from the live rows.
  return query
  with f as (
    select d.category, d.stage, d.created_at as at
    from private.caddie_job_diagnostics d
    union all
    select 'stuck_processing', coalesce(a.stage, 'unknown'), coalesce(a.attempt_started_at, a.created_at)
    from public.caddie_analyses a
    where a.status = 'processing' and coalesce(a.attempt_started_at, a.created_at) < now() - interval '390 seconds'
  )
  select f.category, f.stage,
         count(*) filter (where f.at >= now() - interval '24 hours'),
         count(*) filter (where f.at >= now() - interval '7 days'),
         count(*)
  from f
  group by f.category, f.stage
  order by count(*) filter (where f.at >= now() - interval '7 days') desc, count(*) desc;
end;
$$;

revoke execute on function public.admin_caddie_failure_stats() from public, anon;
grant execute on function public.admin_caddie_failure_stats() to authenticated;

create function public.admin_list_caddie_failures(p_limit integer default 50)
returns table (
  id uuid,
  owner_id uuid,
  status text,
  attempt smallint,
  failure_stage text,
  failure_category text,
  provider_http_status smallint,
  created_at timestamptz,
  finished_at timestamptz,
  detail text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- One line per failed attempt; status is the row's CURRENT status, or
  -- 'deleted' once the golfer deleted the analysis.
  return query
  select * from (
    select d.analysis_id, d.owner_id, coalesce(a.status, 'deleted'), d.attempt, d.stage, d.category, d.provider_http_status,
           a.created_at, d.created_at as finished_at, d.detail
    from private.caddie_job_diagnostics d
    left join public.caddie_analyses a on a.id = d.analysis_id
    union all
    select a.id, a.owner_id, a.status, a.attempt, a.stage, 'stuck_processing'::text, null::smallint,
           a.created_at, coalesce(a.attempt_started_at, a.created_at), null::text
    from public.caddie_analyses a
    where a.status = 'processing' and coalesce(a.attempt_started_at, a.created_at) < now() - interval '390 seconds'
  ) x
  order by x.finished_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke execute on function public.admin_list_caddie_failures(integer) from public, anon;
grant execute on function public.admin_list_caddie_failures(integer) to authenticated;

-- ---------------------------------------------------------------------
-- 7b. Delete an analysis (Micky 2026-11-06: "a delete button on Caddie")
--
-- Owner only, for failed, complete and dead (stale) rows. A LIVE
-- 'processing' row is refused (hint caddie_delete_running): its worker
-- would keep spending Roboflow/Gemini credits and could upload a trimmed
-- copy after the cleanup. Every analyze-swing write is conditional on
-- id + status = 'processing' + attempt, so a write racing the delete
-- matches 0 rows either way; the refusal stops the spend and the orphan.
-- Allowance: the charge / start / diagnostics ledgers have no FK to the
-- row, so deleting never refunds anything (section 2).
-- Storage: objects can't be deleted from SQL (storage.protect_delete), so,
-- like delete_community_post(), this returns the caddie-media paths that
-- are now unreferenced and the app removes them through the Storage API,
-- where caddie_media_delete_own limits it to the caller's own folder:
-- the row's video (the original, or the trimmed copy once complete), its
-- thumbnail and every per-attempt trimmed copy. Only paths in the caller's
-- folder, never one another of their analyses still uses, and never a
-- community-media URL: a shared Community post has its OWN copies (Share
-- copies the files at publish time) and an Ask-Caddie analysis reads its
-- post's media, so no post is affected.
-- Returns '{}' for an id that doesn't exist (already deleted).
-- ---------------------------------------------------------------------
create function public.delete_caddie_analysis(p_analysis_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.caddie_analyses%rowtype;
  v_candidates text[];
  v_paths text[];
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  select * into v_row from public.caddie_analyses a where a.id = p_analysis_id for update;
  if not found then
    return '{}'::text[];
  end if;
  if v_row.owner_id <> v_uid then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if v_row.status = 'processing' and coalesce(v_row.attempt_started_at, v_row.created_at) >= now() - interval '390 seconds' then
    raise exception 'Caddie is still working on this swing.' using errcode = 'P0001', hint = 'caddie_delete_running';
  end if;

  v_candidates := array[v_row.source_media_path, v_row.thumbnail_path, v_uid::text || '/caddie-trimmed-' || v_row.id || '.mp4']
    || array(select v_uid::text || '/caddie-trimmed-' || v_row.id || '-a' || n || '.mp4' from generate_series(1, 4) n);

  delete from public.caddie_analyses a where a.id = p_analysis_id;

  select coalesce(array_agg(distinct c.path), '{}'::text[]) into v_paths
  from unnest(v_candidates) as c(path)
  where c.path is not null
    and c.path like v_uid::text || '/%'
    and position('..' in c.path) = 0
    and not exists (
      select 1 from public.caddie_analyses o
      where o.source_media_path = c.path or o.thumbnail_path = c.path
    );

  return v_paths;
end;
$$;

revoke execute on function public.delete_caddie_analysis(uuid) from public, anon;
grant execute on function public.delete_caddie_analysis(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Backfill the ledgers (see header)
-- ---------------------------------------------------------------------
insert into private.caddie_allowance_charges (analysis_id, owner_id, charged_at)
select a.id, a.owner_id, a.created_at
from public.caddie_analyses a
where a.status = 'complete'
on conflict (analysis_id) do nothing;

insert into private.caddie_pipeline_starts (analysis_id, owner_id, attempt, started_at)
select a.id, a.owner_id, 1, a.created_at
from public.caddie_analyses a
on conflict (analysis_id, attempt) do nothing;

-- Existing failed rows become one unclassified diagnostics row each, so the
-- admin failure totals don't drop when the stats move to the ledger.
insert into private.caddie_job_diagnostics (analysis_id, owner_id, attempt, stage, category, created_at)
select a.id, a.owner_id, 1, 'unknown', 'unclassified', a.updated_at
from public.caddie_analyses a
where a.status = 'failed';
