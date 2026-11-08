-- Caddie: reuse a failed attempt's pose work on Try again (2026-11-08,
-- Micky's "yes"; golfme-architect). PREPARED, NOT APPLIED.
-- Requires 20261107140000 (caddie_analyses.attempt / status job columns) and
-- pg_cron (enabled by 20261107240000); the guard below refuses otherwise.
--
-- What is kept: ONLY the trusted pose data analyze-swing already hands
-- Gemini and already stores on a COMPLETE row (roboflow_analysis_json:
-- per-frame body keypoints in video pixels, phase metrics, timestamps).
-- No video, no frame images, no URL/path (the source is a sha-256), no
-- free text. The failed attempt's trimmed video copy is still removed as
-- before; a Try again re-trims (no Roboflow credits) and skips frame
-- extraction + every Roboflow call when its checkpoint matches.
--
-- Retention, whichever comes first:
--   * the analysis completes -> deleted (trigger below; the final pose data
--     lives on the complete row, as it always has);
--   * the analysis is deleted (delete_caddie_analysis) or the account is
--     deleted -> deleted (ON DELETE CASCADE on both FKs);
--   * 7 days after it was written -> deleted by the daily pg_cron job
--     'golfme-purge-caddie-preprocessing' (04:41 UTC); analyze-swing also
--     never reads one older than that (get_ RPC filters expires_at).
--
-- Access: private table, RLS on, no policies, no grants. Two SECURITY
-- DEFINER RPCs (owner-checked, granted to authenticated because analyze-
-- swing runs with the golfer's own JWT): save_ only while that attempt of
-- the caller's own row is processing; get_ only the caller's own,
-- unexpired row. A client calling save_ itself can't make analyze-swing
-- trust it: every checkpoint carries an HMAC from a server-only secret,
-- checked before reuse (_shared/caddiePreprocessing.ts).
--
-- Verify: caddie-preprocessing-check.sql (scratchpad). Rollback:
-- caddie-preprocessing-rollback.sql (drops the job, trigger, RPCs, table).

create extension if not exists pg_cron;

create table private.caddie_preprocessing (
  analysis_id uuid primary key references public.caddie_analyses (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- The attempt that produced it (diagnostics; reuse doesn't require it).
  attempt smallint not null check (attempt between 1 and 4),
  source_key text not null check (source_key ~ '^[0-9a-f]{64}$'),
  trim_start_seconds numeric(8, 3),
  trim_end_seconds numeric(8, 3),
  pipeline_version text not null check (length(pipeline_version) between 1 and 200),
  pose jsonb not null check (jsonb_typeof(pose) = 'object' and pg_column_size(pose) <= 1500000),
  sig text not null check (sig ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  constraint caddie_preprocessing_window check (
    (trim_start_seconds is null and trim_end_seconds is null)
    or (trim_start_seconds >= 0 and trim_end_seconds > trim_start_seconds)
  )
);
create index caddie_preprocessing_owner_idx on private.caddie_preprocessing (owner_id);
create index caddie_preprocessing_expires_idx on private.caddie_preprocessing (expires_at);
alter table private.caddie_preprocessing enable row level security;
revoke all on table private.caddie_preprocessing from public, anon, authenticated;

-- analyze-swing, after the pose gate and dense pass, before Gemini.
create function public.save_caddie_preprocessing(
  p_analysis_id uuid,
  p_attempt smallint,
  p_source_key text,
  p_trim_start_seconds numeric,
  p_trim_end_seconds numeric,
  p_pipeline_version text,
  p_pose jsonb,
  p_sig text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select a.owner_id into v_owner
    from public.caddie_analyses a
   where a.id = p_analysis_id
     and a.status = 'processing'
     and a.attempt = p_attempt;
  if v_owner is null or v_owner is distinct from (select auth.uid()) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  insert into private.caddie_preprocessing as c
    (analysis_id, owner_id, attempt, source_key, trim_start_seconds, trim_end_seconds, pipeline_version, pose, sig, created_at, expires_at)
  values
    (p_analysis_id, v_owner, p_attempt, p_source_key, p_trim_start_seconds, p_trim_end_seconds, p_pipeline_version, p_pose, p_sig, now(), now() + interval '7 days')
  on conflict (analysis_id) do update set
    attempt = excluded.attempt,
    source_key = excluded.source_key,
    trim_start_seconds = excluded.trim_start_seconds,
    trim_end_seconds = excluded.trim_end_seconds,
    pipeline_version = excluded.pipeline_version,
    pose = excluded.pose,
    sig = excluded.sig,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at;
end;
$$;

revoke execute on function public.save_caddie_preprocessing(uuid, smallint, text, numeric, numeric, text, jsonb, text) from public, anon;
grant execute on function public.save_caddie_preprocessing(uuid, smallint, text, numeric, numeric, text, jsonb, text) to authenticated;

-- analyze-swing, at the start of a Try again. Nothing (not an error) when
-- there is none, it expired, or the row isn't the caller's.
create function public.get_caddie_preprocessing(p_analysis_id uuid)
returns table (
  analysis_id uuid,
  attempt smallint,
  source_key text,
  trim_start_seconds numeric,
  trim_end_seconds numeric,
  pipeline_version text,
  pose jsonb,
  sig text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.analysis_id, c.attempt, c.source_key, c.trim_start_seconds, c.trim_end_seconds, c.pipeline_version, c.pose, c.sig, c.created_at
    from private.caddie_preprocessing c
   where c.analysis_id = p_analysis_id
     and c.owner_id = (select auth.uid())
     and c.expires_at > now();
$$;

revoke execute on function public.get_caddie_preprocessing(uuid) from public, anon;
grant execute on function public.get_caddie_preprocessing(uuid) to authenticated;

-- Completed: the checkpoint has done its job.
create function private.drop_caddie_preprocessing_on_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'complete' and old.status is distinct from 'complete' then
    delete from private.caddie_preprocessing where analysis_id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function private.drop_caddie_preprocessing_on_complete() from public, anon, authenticated;

create trigger drop_caddie_preprocessing_on_complete
  after update of status on public.caddie_analyses
  for each row execute function private.drop_caddie_preprocessing_on_complete();

-- Daily: anything past its 7 days.
create function private.purge_expired_caddie_preprocessing()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from private.caddie_preprocessing where expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function private.purge_expired_caddie_preprocessing() from public, anon, authenticated;

do $$
declare
  v_job bigint;
begin
  for v_job in select jobid from cron.job where jobname = 'golfme-purge-caddie-preprocessing' loop
    perform cron.unschedule(v_job);
  end loop;
  perform cron.schedule('golfme-purge-caddie-preprocessing', '41 4 * * *', 'select private.purge_expired_caddie_preprocessing()');
end;
$$;
