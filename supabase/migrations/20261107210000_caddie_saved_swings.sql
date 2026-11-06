-- Caddie "Saved swings" (Micky, 2026-11-06: "a sub-section where people
-- can save their fav swings, compiled by big categories like driver or
-- iron or woods, so they can go back and find it").
--
-- A per-user favourite flag on the analysis row itself: saved_at is null
-- (not saved) or when the owner saved it. Same row, so:
--   - only the owner ever sees it (caddie_analyses_select_own);
--   - deleting the analysis (delete_caddie_analysis) or the account
--     (owner_id -> auth.users cascade) removes the save with it;
--   - the change reaches the app through the existing owner-filtered
--     realtime subscription on caddie_analyses (already in the
--     supabase_realtime publication, 20260822090000), which refetches
--     the list. Nothing about the persisted job changes: saved_at is not
--     read or written by analyze-swing / translate-caddie-analysis, and
--     the job triggers (guard_caddie_job, charge/record/notify on status)
--     ignore it.
--
-- Writes go through set_caddie_analysis_saved(id, saved) (SECURITY
-- DEFINER, fixed empty search_path): it checks the caller owns the row
-- and, to save, that the analysis is complete, and it writes ONLY
-- saved_at (updated_at is bumped by the existing set_updated_at trigger).
-- Not found and not yours give the same answer, so ids can't be probed.
--
-- Known and accepted: caddie_analyses_update_own (Option B, see
-- 20261107140000) still lets an owner UPDATE their own row directly, so
-- the column-level route can't be narrowed without the Option A change.
-- The CHECK below keeps the "complete only" rule true on that path as
-- well; it can only ever touch the caller's own rows.
--
-- Independent of 20261107140000 (uses only id, owner_id and status), so
-- it applies whether or not that migration is live.

alter table public.caddie_analyses
  add column saved_at timestamptz;

comment on column public.caddie_analyses.saved_at is
  'When the owner saved this analysis to Saved swings (null = not saved). Complete analyses only. Written by set_caddie_analysis_saved().';

-- Only a complete analysis can be saved. A complete row never leaves
-- 'complete' (Try again only restarts failed or dead rows, and every
-- analyze-swing write is conditional on status = 'processing'), so this
-- can't trip the job pipeline.
alter table public.caddie_analyses
  add constraint caddie_analyses_saved_only_complete check (saved_at is null or status = 'complete');

create index caddie_analyses_saved_idx
  on public.caddie_analyses (owner_id, saved_at desc)
  where saved_at is not null;

-- Returns the row's saved_at after the call (null when unsaved). Saving an
-- already-saved row keeps its first saved time, so a double tap or a
-- retried request is harmless.
create function public.set_caddie_analysis_saved(p_analysis_id uuid, p_saved boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_status text;
  v_current timestamptz;
  v_next timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;
  if p_analysis_id is null or p_saved is null then
    raise exception 'Missing analysis or value.' using errcode = '22023';
  end if;

  select a.owner_id, a.status, a.saved_at
    into v_owner, v_status, v_current
    from public.caddie_analyses a
   where a.id = p_analysis_id
   for update;

  if not found or v_owner is distinct from v_uid then
    raise exception 'Analysis not found.' using errcode = 'P0001', hint = 'caddie_save_not_found';
  end if;

  if p_saved then
    if v_status <> 'complete' then
      raise exception 'Only a finished analysis can be saved.' using errcode = 'P0001', hint = 'caddie_save_not_complete';
    end if;
    v_next := coalesce(v_current, now());
  else
    v_next := null;
  end if;

  if v_next is distinct from v_current then
    update public.caddie_analyses a
       set saved_at = v_next
     where a.id = p_analysis_id;
  end if;

  return v_next;
end;
$$;

revoke execute on function public.set_caddie_analysis_saved(uuid, boolean) from public, anon;
grant execute on function public.set_caddie_analysis_saved(uuid, boolean) to authenticated;
