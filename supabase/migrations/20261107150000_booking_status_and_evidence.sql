-- Honest booking status + host booking evidence + review (Stages 2 and 3 of
-- docs/booking-status-plan.md; Micky's brief "Honest tee-time status and
-- host booking evidence", decisions recorded 2026-11-05).
--
-- Three things kept separate:
--   A. GolfMe group (round_participants / total_spots)      -- unchanged
--   B. Host-reported booking  golf_calls.booking_status      -- new
--   C. Evidence review        golf_calls.evidence_status     -- new
--      (public summary) + public.booking_evidence (private, versioned) +
--      public.booking_evidence_reviews (private audit)
-- Course availability stays "not connected": nothing here reads or claims
-- course inventory.
--
-- Server-enforced rules
--   * Only the host changes B, only through set_booking_status() /
--     edit_golf_call_tee_time(); only the host submits or withdraws evidence;
--     only a reviewer (admin or booking_reviewer, never the round's host)
--     records a review, and only for the CURRENT evidence version of a round
--     whose booking details have not changed since (booking_version).
--   * Evidence is a JPEG the host uploaded into
--     booking-proofs/<host uid>/<round id>/<uuid>.jpg; submit checks the
--     object exists, is the caller's, image/jpeg, <= 5 MB (Micky: images only,
--     5 MB, re-encoded on the device; no PDFs). An upload alone never moves
--     anything past "submitted".
--   * Any change of course/date/time, party size or status invalidates the
--     current evidence (and its review); cancelling or completing the round
--     closes it. A reviewed badge is never left on a changed booking.
--   * Every golf_calls trust column stays frozen for direct client writes
--     (guard_golf_calls_client_writes, extended here).
--   * Fixes the forged-badge finding (attach_booking_proof accepted any path
--     and any public "source" text): attach_booking_proof/remove_booking_proof
--     are retired (they now raise), booking_source is a fixed list.
--
-- Retention (Micky, 2026-11-05): replaced/removed/invalidated raw files 7
-- days; all raw evidence 30 days after the round; minimal audit 12 months.
-- admin_booking_evidence_sweep() computes it; the admin page deletes the
-- files through the Storage API (deleting storage.objects rows in SQL would
-- leave the bytes behind) and confirms with admin_mark_booking_evidence_purged().
-- Supabase backups keep deleted data for the plan's backup window.
--
-- Notifications (Micky, 2026-11-05): host marks the booking "changed" or
-- "cancelled" -> joined players, bell + push (existing push rules/toggles,
-- same collapse id as round updates). A tee-time edit that marks the booking
-- "changed" sends no second notification (the tee_time_updated push already
-- went out). Review outcome -> the host, bell only. The old
-- booking_proof_attached / booking_proof_removed triggers are dropped.
--
-- Client compatibility: the app feature-detects booking_status on the round
-- row; without this migration it keeps the Stage 1 behaviour. tee_time_source
-- is kept as a mirror ('user_verified' iff booked with current evidence) for
-- cached Stage 1 clients, which then show "Booked · Host reported".
--
-- Paste-ready apply / check / rollback SQL: scratchpad booking-stage23/.

-- ===========================================================================
-- 0. Reviewer role
-- ===========================================================================
alter table public.user_roles drop constraint user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('coach_reviewer', 'admin', 'test', 'app_reviewer', 'seeded', 'bot', 'pre_launch', 'booking_reviewer'));

create function private.is_booking_reviewer(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and (private.has_role(p_user_id, 'admin') or private.has_role(p_user_id, 'booking_reviewer'));
$$;
revoke execute on function private.is_booking_reviewer(uuid) from public, anon;
grant execute on function private.is_booking_reviewer(uuid) to authenticated;

-- ===========================================================================
-- 1. Public-safe booking columns on golf_calls
-- ===========================================================================
-- "Booked via" becomes a fixed list. Anything else already stored (it was
-- free text, shown publicly) is normalised to 'Other'.
update public.golf_calls
  set booking_source = 'Other'
  where booking_source is not null
    and booking_source not in ('Course Website', 'GolfNow', 'Lightspeed / Chronogolf', 'Phone Reservation', 'Other');

alter table public.golf_calls
  add column booking_status text not null default 'unknown',
  add column booking_status_updated_at timestamptz,
  add column booking_party_size smallint,
  add column evidence_status text not null default 'none',
  add column evidence_reviewed_at timestamptz,
  add column booking_version integer not null default 0;

alter table public.golf_calls
  add constraint golf_calls_booking_status_check
    check (booking_status in ('unknown', 'not_needed', 'needed', 'pending', 'booked', 'changed', 'cancelled')),
  add constraint golf_calls_evidence_status_check
    check (evidence_status in ('none', 'submitted', 'reviewed', 'needs_correction')),
  add constraint golf_calls_booking_party_size_check
    check (booking_party_size is null or booking_party_size between 1 and 8),
  add constraint golf_calls_booking_source_check
    check (booking_source is null or booking_source in ('Course Website', 'GolfNow', 'Lightspeed / Chronogolf', 'Phone Reservation', 'Other')),
  -- Evidence and a party size only ever sit on a booked round; a reviewed
  -- round always carries its review time.
  add constraint golf_calls_evidence_needs_booked
    check (evidence_status = 'none' or booking_status = 'booked'),
  add constraint golf_calls_party_size_needs_booked
    check (booking_party_size is null or booking_status in ('booked', 'changed')),
  add constraint golf_calls_reviewed_has_time
    check ((evidence_status = 'reviewed') = (evidence_reviewed_at is not null));

comment on column public.golf_calls.booking_status is
  'Host-reported course booking state. unknown = legacy/not said. Never implies course confirmation. Written only by set_booking_status()/edit_golf_call_tee_time().';
comment on column public.golf_calls.evidence_status is
  'Public summary of the current booking_evidence version: none / submitted (not reviewed) / reviewed (an authorised reviewer matched it at evidence_reviewed_at; not live course confirmation) / needs_correction.';
comment on column public.golf_calls.booking_version is
  'Bumped on every material booking change (course/date/time, party size, status). Reviews pin it; a stale review is refused.';

-- ===========================================================================
-- 2. Evidence versions (private) + review audit (private)
-- ===========================================================================
create table public.booking_evidence (
  id uuid primary key default gen_random_uuid(),
  golf_call_id uuid not null references public.golf_calls (id) on delete cascade,
  host_user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type = 'image/jpeg'),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  status text not null default 'submitted'
    check (status in ('submitted', 'reviewed', 'needs_correction', 'rejected', 'superseded', 'withdrawn', 'invalidated', 'expired')),
  -- What the round said when this version was submitted; a review checks
  -- the evidence against exactly this.
  snap_course_id uuid,
  snap_course_name text not null,
  snap_date_iso timestamptz not null,
  snap_tee_time_label text not null,
  snap_party_size smallint,
  snap_booking_version integer not null,
  client_request_id uuid not null unique,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  object_deleted_at timestamptz,
  constraint booking_evidence_path_pinned
    check (storage_path ~ ('^' || host_user_id::text || '/' || golf_call_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')),
  constraint booking_evidence_closed_has_time
    check ((status in ('submitted', 'reviewed', 'needs_correction')) = (closed_at is null))
);

create unique index booking_evidence_one_current
  on public.booking_evidence (golf_call_id)
  where status in ('submitted', 'reviewed', 'needs_correction');
create index booking_evidence_queue_idx on public.booking_evidence (created_at) where status in ('submitted', 'needs_correction');
create index booking_evidence_host_idx on public.booking_evidence (host_user_id);

comment on table public.booking_evidence is
  'Private: host-uploaded booking evidence, one row per version. Readable by the host and booking reviewers only; written only by SECURITY DEFINER functions. Raw files live in the private booking-proofs bucket and are deleted per the retention rules (7 days after closing, 30 days after the round).';

alter table public.booking_evidence enable row level security;
create policy booking_evidence_select_host_or_reviewer on public.booking_evidence
  for select to authenticated
  using (host_user_id = (select auth.uid()) or private.is_booking_reviewer((select auth.uid())));
revoke insert, update, delete, truncate on public.booking_evidence from anon, authenticated;
revoke select on public.booking_evidence from anon;

create table public.booking_evidence_reviews (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.booking_evidence (id) on delete cascade,
  golf_call_id uuid not null references public.golf_calls (id) on delete cascade,
  reviewer_id uuid references auth.users (id) on delete set null,
  outcome text not null check (outcome in ('reviewed', 'needs_correction', 'rejected')),
  reason_code text check (reason_code in ('illegible', 'course_mismatch', 'date_mismatch', 'time_mismatch', 'party_size_mismatch', 'not_a_booking', 'other')),
  note text check (note is null or char_length(note) <= 200),
  reviewed_booking_version integer not null,
  created_at timestamptz not null default now(),
  constraint booking_evidence_reviews_reason_required check (outcome = 'reviewed' or reason_code is not null)
);
create index booking_evidence_reviews_evidence_idx on public.booking_evidence_reviews (evidence_id);

comment on table public.booking_evidence_reviews is
  'Private, append-only review audit (outcome, reason, reviewer, time, booking version). Reviewers only; the host sees outcome + reason through my_booking_evidence(). Kept 12 months.';

alter table public.booking_evidence_reviews enable row level security;
create policy booking_evidence_reviews_select_reviewer on public.booking_evidence_reviews
  for select to authenticated
  using (private.is_booking_reviewer((select auth.uid())));
revoke insert, update, delete, truncate on public.booking_evidence_reviews from anon, authenticated;
revoke select on public.booking_evidence_reviews from anon;

-- Legacy booking_proofs: stop keeping confirmation numbers (Micky: no longer
-- collected). The rows stay only until their files are purged.
update public.booking_proofs set booking_reference = null where booking_reference is not null;

-- ===========================================================================
-- 3. Freeze the new columns against direct client writes
-- ===========================================================================
-- Same function as 20260924100100 plus the booking/evidence columns.
create or replace function public.guard_golf_calls_client_writes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Rounds are created through host_golf_call(); a direct insert never
    -- gets to start out verified, booked or already finished.
    new.status := 'open';
    new.tee_time_source := 'manual';
    new.booking_source := null;
    new.verification_created_at := null;
    new.tee_time_provider := null;
    new.external_tee_time_id := null;
    new.booking_status := 'unknown';
    new.booking_status_updated_at := null;
    new.booking_party_size := null;
    new.evidence_status := 'none';
    new.evidence_reviewed_at := null;
    new.booking_version := 0;
    return new;
  end if;

  if new.tee_time_source is distinct from old.tee_time_source
     or new.booking_source is distinct from old.booking_source
     or new.verification_created_at is distinct from old.verification_created_at
     or new.tee_time_provider is distinct from old.tee_time_provider
     or new.external_tee_time_id is distinct from old.external_tee_time_id then
    raise exception 'Booking proof can only be changed by attaching or removing proof.' using errcode = '42501';
  end if;

  if new.booking_status is distinct from old.booking_status
     or new.booking_status_updated_at is distinct from old.booking_status_updated_at
     or new.booking_party_size is distinct from old.booking_party_size
     or new.evidence_status is distinct from old.evidence_status
     or new.evidence_reviewed_at is distinct from old.evidence_reviewed_at
     or new.booking_version is distinct from old.booking_version then
    raise exception 'Booking status can only be changed from the round''s booking panel.' using errcode = '42501';
  end if;

  if new.course_id is distinct from old.course_id
     or new.course_name is distinct from old.course_name
     or new.course_area_label is distinct from old.course_area_label
     or new.course_lat is distinct from old.course_lat
     or new.course_lng is distinct from old.course_lng
     or new.date_iso is distinct from old.date_iso
     or new.tee_time_label is distinct from old.tee_time_label then
    raise exception 'Use Edit tee time to change the course, date or time.' using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.host_user_id is distinct from old.host_user_id
     or new.created_at is distinct from old.created_at
     or new.total_spots is distinct from old.total_spots
     or new.join_mode is distinct from old.join_mode then
    raise exception 'That round detail can''t be changed.' using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke execute on function public.guard_golf_calls_client_writes() from public, anon, authenticated;

-- ===========================================================================
-- 4. Storage: booking-proofs
-- ===========================================================================
update storage.buckets
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg']
  where id = 'booking-proofs';

drop policy if exists booking_proofs_storage_select_own_or_admin on storage.objects;
drop policy if exists booking_proofs_storage_insert_own on storage.objects;
drop policy if exists booking_proofs_storage_delete_own on storage.objects;

-- Read: the owner; a reviewer only for a CURRENT evidence version; an admin
-- also for files that are no longer current evidence (needed to purge them
-- through the Storage API, which selects what it deletes).
create policy booking_proofs_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'booking-proofs'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (
        private.is_booking_reviewer((select auth.uid()))
        and exists (
          select 1 from public.booking_evidence e
          where e.storage_path = name and e.status in ('submitted', 'reviewed', 'needs_correction')
        )
      )
      or (
        private.has_role((select auth.uid()), 'admin')
        and not exists (
          select 1 from public.booking_evidence e
          where e.storage_path = name and e.status in ('submitted', 'reviewed', 'needs_correction')
        )
      )
    )
  );

-- Write: only <own uid>/<a round the caller hosts, open or full and not
-- over>/<uuid>.jpg. No more free private file hosting: nothing outside a
-- live hosted round.
create policy booking_proofs_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'booking-proofs'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.golf_calls g
      where g.id::text = (storage.foldername(name))[2]
        and g.host_user_id = (select auth.uid())
        and g.status in ('open', 'full')
        and now() <= g.date_iso + interval '12 hours'
    )
  );

-- Delete: the owner, except a file that is current evidence (withdraw it
-- first); an admin, for anything that is not current evidence (purge).
create policy booking_proofs_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'booking-proofs'
    and not exists (
      select 1 from public.booking_evidence e
      where e.storage_path = name and e.status in ('submitted', 'reviewed', 'needs_correction')
    )
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or private.has_role((select auth.uid()), 'admin')
    )
  );

-- ===========================================================================
-- 5. Internal helpers
-- ===========================================================================
-- Closes the round's current evidence version (if any) with p_status and
-- resets the public summary. Returns the closed version's storage path.
-- Caller must hold the round row lock.
create function private.close_current_booking_evidence(p_golf_call_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  update public.booking_evidence
    set status = p_status, closed_at = now()
    where golf_call_id = p_golf_call_id and status in ('submitted', 'reviewed', 'needs_correction')
    returning storage_path into v_path;
  return v_path;
end;
$$;
revoke execute on function private.close_current_booking_evidence(uuid, text) from public, anon, authenticated;

-- The Stage 1 mirror for cached clients: 'user_verified' iff booked with a
-- current evidence version.
create function private.booking_mirror_source(p_booking_status text, p_evidence_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_booking_status = 'booked' and p_evidence_status <> 'none' then 'user_verified' else 'manual' end;
$$;
revoke execute on function private.booking_mirror_source(text, text) from public, anon, authenticated;

-- Raises unless the caller hosts the round and it can still change.
-- Returns the locked row.
create function private.lock_hosted_live_round(p_golf_call_id uuid)
returns public.golf_calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.golf_calls%rowtype;
begin
  select * into v_call from public.golf_calls where id = p_golf_call_id for update;
  if not found or v_call.host_user_id is distinct from (select auth.uid()) then
    raise exception 'Only the host can change this round''s booking.' using errcode = '42501';
  end if;
  if v_call.status not in ('open', 'full') then
    raise exception 'This round can no longer be changed.' using errcode = '22023';
  end if;
  if now() > v_call.date_iso + interval '12 hours' then
    raise exception 'This round has already taken place.' using errcode = '22023';
  end if;
  return v_call;
end;
$$;
revoke execute on function private.lock_hosted_live_round(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 6. Host RPCs
-- ===========================================================================
-- Host sets the booking state. p_status: not_needed | needed | pending |
-- booked | changed | cancelled. p_party_size / p_booked_via are set with
-- 'booked', kept as they were with 'changed', cleared otherwise.
-- p_expected_version must equal the round's booking_version
-- (another tab or device may have changed it; error 40001 = refresh).
-- Any real change bumps the version and closes the current evidence
-- (invalidated), except a no-op call, which returns the row unchanged.
create function public.set_booking_status(
  p_golf_call_id uuid,
  p_status text,
  p_party_size smallint,
  p_booked_via text,
  p_expected_version integer
)
returns public.golf_calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.golf_calls%rowtype;
  v_party smallint := case when p_status = 'booked' then p_party_size else null end;
  v_via text := case when p_status = 'booked' then nullif(btrim(coalesce(p_booked_via, '')), '') else null end;
begin
  if p_status is null or p_status not in ('not_needed', 'needed', 'pending', 'booked', 'changed', 'cancelled') then
    raise exception 'Unknown booking status.' using errcode = '22023';
  end if;
  if v_party is not null and (v_party < 1 or v_party > 8) then
    raise exception 'Party size must be between 1 and 8.' using errcode = '22023';
  end if;
  if v_via is not null and v_via not in ('Course Website', 'GolfNow', 'Lightspeed / Chronogolf', 'Phone Reservation', 'Other') then
    raise exception 'Unknown booking source.' using errcode = '22023';
  end if;

  v_call := private.lock_hosted_live_round(p_golf_call_id);
  if p_expected_version is distinct from v_call.booking_version then
    raise exception 'This round''s booking changed. Refresh and try again.' using errcode = '40001';
  end if;
  if p_status = 'changed' then
    v_party := v_call.booking_party_size;
    v_via := v_call.booking_source;
  end if;

  if v_call.booking_status = p_status
     and v_call.booking_party_size is not distinct from v_party
     and v_call.booking_source is not distinct from v_via then
    return v_call;
  end if;

  perform private.close_current_booking_evidence(p_golf_call_id, 'invalidated');

  update public.golf_calls set
    booking_status = p_status,
    booking_status_updated_at = now(),
    booking_party_size = v_party,
    booking_source = v_via,
    evidence_status = 'none',
    evidence_reviewed_at = null,
    booking_version = booking_version + 1,
    tee_time_source = 'manual',
    verification_created_at = null
  where id = p_golf_call_id
  returning * into v_call;
  return v_call;
end;
$$;
revoke execute on function public.set_booking_status(uuid, text, smallint, text, integer) from public, anon;
grant execute on function public.set_booking_status(uuid, text, smallint, text, integer) to authenticated;

-- Host submits (or replaces) evidence for a booked round. The file must
-- already be uploaded to booking-proofs/<uid>/<round>/<uuid>.jpg by the
-- caller. Idempotent on p_client_request_id: a retry of the same submission
-- returns the same row instead of a second version. Returns the new
-- evidence id and the superseded version's path (the client deletes it).
create function public.submit_booking_evidence(
  p_golf_call_id uuid,
  p_storage_path text,
  p_client_request_id uuid,
  p_expected_version integer
)
returns table (evidence_id uuid, superseded_path text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_call public.golf_calls%rowtype;
  v_existing public.booking_evidence%rowtype;
  v_mime text;
  v_size bigint;
  v_old text;
  v_id uuid;
begin
  if p_client_request_id is null or p_storage_path is null then
    raise exception 'Missing upload.' using errcode = '22023';
  end if;

  v_call := private.lock_hosted_live_round(p_golf_call_id);

  select * into v_existing from public.booking_evidence where client_request_id = p_client_request_id;
  if found then
    if v_existing.golf_call_id = p_golf_call_id and v_existing.host_user_id = v_uid and v_existing.storage_path = p_storage_path then
      return query select v_existing.id, null::text;
      return;
    end if;
    raise exception 'That upload was already used.' using errcode = '22023';
  end if;

  if v_call.booking_status <> 'booked' then
    raise exception 'Mark the round as booked before adding evidence.' using errcode = '22023';
  end if;
  if p_expected_version is distinct from v_call.booking_version then
    raise exception 'This round''s booking changed. Refresh and try again.' using errcode = '40001';
  end if;
  if p_storage_path !~ ('^' || v_uid::text || '/' || p_golf_call_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
    raise exception 'That file isn''t in your folder for this round.' using errcode = '42501';
  end if;

  select o.metadata ->> 'mimetype', nullif(o.metadata ->> 'size', '')::bigint
    into v_mime, v_size
    from storage.objects o
    where o.bucket_id = 'booking-proofs' and o.name = p_storage_path
      and coalesce(o.owner_id, o.owner::text) = v_uid::text;
  if not found then
    raise exception 'The upload didn''t finish. Try again.' using errcode = '22023';
  end if;
  if v_mime is distinct from 'image/jpeg' then
    raise exception 'Only JPEG images are accepted.' using errcode = '22023';
  end if;
  if v_size is null or v_size <= 0 or v_size > 5242880 then
    raise exception 'That image is too large.' using errcode = '22023';
  end if;

  v_old := private.close_current_booking_evidence(p_golf_call_id, 'superseded');

  insert into public.booking_evidence (
    golf_call_id, host_user_id, storage_path, mime_type, size_bytes,
    snap_course_id, snap_course_name, snap_date_iso, snap_tee_time_label, snap_party_size, snap_booking_version,
    client_request_id
  ) values (
    p_golf_call_id, v_uid, p_storage_path, v_mime, v_size::integer,
    v_call.course_id, v_call.course_name, v_call.date_iso, v_call.tee_time_label, v_call.booking_party_size, v_call.booking_version,
    p_client_request_id
  ) returning id into v_id;

  update public.golf_calls set
    evidence_status = 'submitted',
    evidence_reviewed_at = null,
    tee_time_source = 'user_verified',
    verification_created_at = now()
  where id = p_golf_call_id;

  return query select v_id, v_old;
end;
$$;
revoke execute on function public.submit_booking_evidence(uuid, text, uuid, integer) from public, anon;
grant execute on function public.submit_booking_evidence(uuid, text, uuid, integer) to authenticated;

-- Host removes the current evidence. The booking claim itself stays.
-- Returns the withdrawn file's path (the client deletes it).
create function public.withdraw_booking_evidence(p_golf_call_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.golf_calls%rowtype;
  v_path text;
begin
  select * into v_call from public.golf_calls where id = p_golf_call_id for update;
  if not found or v_call.host_user_id is distinct from (select auth.uid()) then
    raise exception 'Only the host can remove this round''s evidence.' using errcode = '42501';
  end if;
  v_path := private.close_current_booking_evidence(p_golf_call_id, 'withdrawn');
  if v_path is not null then
    update public.golf_calls set
      evidence_status = 'none', evidence_reviewed_at = null,
      tee_time_source = 'manual', verification_created_at = null
    where id = p_golf_call_id;
  end if;
  return v_path;
end;
$$;
revoke execute on function public.withdraw_booking_evidence(uuid) from public, anon;
grant execute on function public.withdraw_booking_evidence(uuid) to authenticated;

-- What the host may know about their own current evidence: its state,
-- path (to view their own file), and the latest review's outcome + reason
-- (never the reviewer's identity or note).
create function public.my_booking_evidence(p_golf_call_id uuid)
returns table (
  evidence_id uuid,
  status text,
  storage_path text,
  created_at timestamptz,
  review_outcome text,
  review_reason_code text,
  reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.status, e.storage_path, e.created_at, r.outcome, r.reason_code, r.created_at
  from public.booking_evidence e
  left join lateral (
    select rv.outcome, rv.reason_code, rv.created_at
    from public.booking_evidence_reviews rv
    where rv.evidence_id = e.id
    order by rv.created_at desc
    limit 1
  ) r on true
  where e.golf_call_id = p_golf_call_id
    and e.host_user_id = (select auth.uid())
    and (e.status in ('submitted', 'reviewed', 'needs_correction') or (e.status = 'rejected' and e.closed_at > now() - interval '30 days'))
  order by e.created_at desc
  limit 1;
$$;
revoke execute on function public.my_booking_evidence(uuid) from public, anon;
grant execute on function public.my_booking_evidence(uuid) to authenticated;

-- ===========================================================================
-- 7. Tee-time edit: invalidate, mark the booking "changed"
-- ===========================================================================
-- Same signature and result shape as 20260818070000. A real change of
-- course/date/time bumps booking_version, closes the current evidence
-- (invalidated) and, for a booked round, sets booking_status = 'changed'
-- ("Booking changed · Updated evidence needed"). The follow-up UPDATE does
-- not list course/date/time, so the tee-time push fires once; it sets a
-- transaction-local flag so the booking-status notification stays quiet
-- (the players were already told the time changed).
create or replace function public.edit_golf_call_tee_time(
  p_golf_call_id uuid,
  p_course_id uuid,
  p_course_name text,
  p_course_area_label text,
  p_course_lat double precision,
  p_course_lng double precision,
  p_date_iso timestamptz,
  p_tee_time_label text
)
returns table (updated_call public.golf_calls, proof_invalidated boolean, invalidated_storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.golf_calls%rowtype;
  v_changed boolean;
  v_invalidated boolean := false;
  v_old_path text;
  v_legacy_path text;
begin
  select * into v_call from public.golf_calls where id = p_golf_call_id and host_user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'Only the host can edit this round.' using errcode = '42501';
  end if;
  if v_call.status not in ('open', 'full') then
    raise exception 'This round can no longer be edited.';
  end if;

  v_changed := (v_call.course_name is distinct from p_course_name)
    or (v_call.course_id is distinct from p_course_id)
    or (v_call.date_iso is distinct from p_date_iso)
    or (v_call.tee_time_label is distinct from p_tee_time_label);

  update public.golf_calls set
    course_id = p_course_id, course_name = p_course_name, course_area_label = p_course_area_label,
    course_lat = p_course_lat, course_lng = p_course_lng,
    date_iso = p_date_iso, tee_time_label = p_tee_time_label
  where id = p_golf_call_id
  returning * into v_call;

  if v_changed then
    v_old_path := private.close_current_booking_evidence(p_golf_call_id, 'invalidated');
    -- Legacy (pre-migration) proof row, if one is still around.
    delete from public.booking_proofs where golf_call_id = p_golf_call_id returning storage_path into v_legacy_path;
    v_invalidated := v_old_path is not null or v_legacy_path is not null or v_call.evidence_status <> 'none';
    perform set_config('golfme.booking_notify_skip', 'on', true);
    update public.golf_calls set
      booking_status = case when booking_status = 'booked' then 'changed' else booking_status end,
      booking_status_updated_at = case when booking_status = 'booked' then now() else booking_status_updated_at end,
      evidence_status = 'none',
      evidence_reviewed_at = null,
      booking_version = booking_version + 1,
      tee_time_source = 'manual',
      verification_created_at = null
    where id = p_golf_call_id
    returning * into v_call;
    perform set_config('golfme.booking_notify_skip', 'off', true);
  end if;

  return query select v_call, v_invalidated, coalesce(v_old_path, v_legacy_path);
end;
$$;
revoke execute on function public.edit_golf_call_tee_time(uuid, uuid, text, text, double precision, double precision, timestamptz, text) from public, anon;
grant execute on function public.edit_golf_call_tee_time(uuid, uuid, text, text, double precision, double precision, timestamptz, text) to authenticated;

-- ===========================================================================
-- 8. Round cancelled or completed: close the evidence
-- ===========================================================================
-- Cancelling the GolfMe round is not cancelling the course booking, so
-- booking_status is left alone (the app shows no booking line on a
-- cancelled round); the evidence and any review just stop counting.
-- BEFORE trigger named to sort after golf_calls_guard_* (which police the
-- client's own columns first).
create function public.close_booking_evidence_on_round_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('cancelled', 'completed') and old.status in ('open', 'full') then
    perform private.close_current_booking_evidence(new.id, case when new.status = 'cancelled' then 'withdrawn' else 'expired' end);
    new.evidence_status := 'none';
    new.evidence_reviewed_at := null;
    new.tee_time_source := 'manual';
  end if;
  return new;
end;
$$;
revoke execute on function public.close_booking_evidence_on_round_end() from public, anon, authenticated;

create trigger golf_calls_zz_close_booking_evidence
  before update of status on public.golf_calls
  for each row execute function public.close_booking_evidence_on_round_end();

-- ===========================================================================
-- 9. Review (reviewers only)
-- ===========================================================================
create function public.list_booking_evidence_queue(p_limit integer default 50)
returns table (
  evidence_id uuid,
  golf_call_id uuid,
  status text,
  storage_path text,
  submitted_at timestamptz,
  host_user_id uuid,
  host_name text,
  snap_course_name text,
  snap_date_iso timestamptz,
  snap_tee_time_label text,
  snap_party_size smallint,
  snap_booking_version integer,
  round_course_name text,
  round_date_iso timestamptz,
  round_tee_time_label text,
  round_party_size smallint,
  round_booking_version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_booking_reviewer((select auth.uid())) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  return query
    select e.id, e.golf_call_id, e.status, e.storage_path, e.created_at, e.host_user_id, p.name,
      e.snap_course_name, e.snap_date_iso, e.snap_tee_time_label, e.snap_party_size, e.snap_booking_version,
      g.course_name, g.date_iso, g.tee_time_label, g.booking_party_size, g.booking_version
    from public.booking_evidence e
    join public.golf_calls g on g.id = e.golf_call_id
    left join public.profiles p on p.id = e.host_user_id
    where e.status in ('submitted', 'needs_correction')
      and g.status in ('open', 'full')
      and now() <= g.date_iso + interval '12 hours'
      and g.host_user_id <> (select auth.uid()) -- never offered your own round (no self-review)
    order by e.created_at
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;
revoke execute on function public.list_booking_evidence_queue(integer) from public, anon;
grant execute on function public.list_booking_evidence_queue(integer) to authenticated;

-- One review of the CURRENT version. p_expected_booking_version is what the
-- reviewer saw; it must equal both the evidence snapshot and the round now.
-- The reviewer must not be the round's host (no self-review).
create function public.review_booking_evidence(
  p_evidence_id uuid,
  p_outcome text,
  p_reason_code text,
  p_note text,
  p_expected_booking_version integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ev public.booking_evidence%rowtype;
  v_call public.golf_calls%rowtype;
  v_lang text;
  v_text text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not private.is_booking_reviewer(v_uid) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('reviewed', 'needs_correction', 'rejected') then
    raise exception 'Unknown review outcome.' using errcode = '22023';
  end if;
  if p_outcome <> 'reviewed' and p_reason_code is null then
    raise exception 'Pick a reason.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'Keep the note under 200 characters.' using errcode = '22023';
  end if;

  select * into v_ev from public.booking_evidence where id = p_evidence_id;
  if not found then
    raise exception 'Evidence not found.' using errcode = '22023';
  end if;
  -- Lock the round first, then re-read the evidence under the lock.
  select * into v_call from public.golf_calls where id = v_ev.golf_call_id for update;
  select * into v_ev from public.booking_evidence where id = p_evidence_id for update;

  if v_ev.host_user_id = v_uid or v_call.host_user_id = v_uid then
    raise exception 'You can''t review evidence for your own round.' using errcode = '42501';
  end if;
  -- 'reviewed' may be reviewed again (e.g. after a report: needs_correction).
  if v_ev.status not in ('submitted', 'needs_correction', 'reviewed') then
    raise exception 'This evidence is no longer current.' using errcode = '40001';
  end if;
  if v_call.status not in ('open', 'full') or now() > v_call.date_iso + interval '12 hours' then
    raise exception 'This round is over or cancelled.' using errcode = '22023';
  end if;
  if v_call.booking_status <> 'booked'
     or p_expected_booking_version is distinct from v_call.booking_version
     or v_ev.snap_booking_version is distinct from v_call.booking_version
     or v_ev.snap_course_name is distinct from v_call.course_name
     or v_ev.snap_date_iso is distinct from v_call.date_iso
     or v_ev.snap_tee_time_label is distinct from v_call.tee_time_label
     or v_ev.snap_party_size is distinct from v_call.booking_party_size then
    raise exception 'The booking changed since this evidence was submitted.' using errcode = '40001';
  end if;

  insert into public.booking_evidence_reviews (evidence_id, golf_call_id, reviewer_id, outcome, reason_code, note, reviewed_booking_version)
  values (v_ev.id, v_ev.golf_call_id, v_uid, p_outcome, case when p_outcome = 'reviewed' then null else p_reason_code end, v_note, v_call.booking_version);

  update public.booking_evidence set
    status = p_outcome,
    closed_at = case when p_outcome = 'rejected' then now() else null end
  where id = v_ev.id;

  update public.golf_calls set
    evidence_status = case p_outcome when 'reviewed' then 'reviewed' when 'needs_correction' then 'needs_correction' else 'none' end,
    evidence_reviewed_at = case when p_outcome = 'reviewed' then now() else null end,
    tee_time_source = case when p_outcome = 'rejected' then 'manual' else tee_time_source end,
    verification_created_at = case when p_outcome = 'rejected' then null else verification_created_at end
  where id = v_call.id;

  -- Host: bell only.
  select p.language into v_lang from public.profiles p where p.id = v_call.host_user_id;
  v_text := private.booking_review_copy(v_lang, p_outcome, v_call.course_name);
  insert into public.notifications (user_id, type, actor_id, text, link_to)
  values (v_call.host_user_id, 'booking_evidence_reviewed', null, v_text, '/golf-calls/' || v_call.id);

  return p_outcome;
end;
$$;

-- ===========================================================================
-- 10. Notifications
-- ===========================================================================
-- 'post_liked' belongs to 20261107200000 (likes). Listed here as well so
-- applying this file after that one doesn't drop it (allowing a type that
-- nothing writes yet is harmless).
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (
    type = any (array[
      'round_joined', 'round_left', 'round_cancelled', 'new_message',
      'comment_reply', 'post_reply', 'round_created_from_post', 'post_became_round',
      'booking_proof_attached', 'tee_time_updated', 'booking_proof_removed',
      'caddie_analysis_complete',
      'new_round_nearby', 'circle_post',
      'booking_status_changed', 'booking_evidence_reviewed',
      'post_liked'
    ])
  );

drop trigger if exists trg_notify_booking_proof_attached on public.golf_calls;
drop trigger if exists trg_notify_booking_proof_removed on public.golf_calls;
drop function if exists public.notify_booking_proof_attached();
drop function if exists public.notify_booking_proof_removed();

-- p_kind: 'changed' | 'cancelled'
create function private.booking_status_copy(p_lang text, p_kind text, p_host text, p_course text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n text := btrim(coalesce(p_host, ''));
  c text := left(btrim(coalesce(p_course, '')), 60);
begin
  case coalesce(p_lang, 'en')
    when 'es' then
      return case p_kind
        when 'cancelled' then n || ' indica que la reserva con el campo para tu ronda en ' || c || ' está cancelada. Revisa la ronda.'
        else n || ' indica que la reserva de tu ronda en ' || c || ' cambió. Revisa la ronda.'
      end;
    when 'ja' then
      return case p_kind
        when 'cancelled' then n || 'さんによると、' || c || 'のラウンドのコース予約はキャンセルされました。ラウンドを確認してください。'
        else n || 'さんによると、' || c || 'のラウンドの予約が変更されました。ラウンドを確認してください。'
      end;
    when 'ko' then
      return case p_kind
        when 'cancelled' then n || '님이 ' || c || ' 라운드의 골프장 예약이 취소되었다고 알렸어요. 라운드를 확인하세요.'
        else n || '님이 ' || c || ' 라운드의 예약이 변경되었다고 알렸어요. 라운드를 확인하세요.'
      end;
    when 'zh-CN' then
      return case p_kind
        when 'cancelled' then n || ' 表示你在 ' || c || ' 的球局的球场预订已取消。请查看球局。'
        else n || ' 表示你在 ' || c || ' 的球局的预订有变动。请查看球局。'
      end;
    when 'zh-TW' then
      return case p_kind
        when 'cancelled' then n || ' 表示你在 ' || c || ' 的球局的球場預訂已取消。請查看球局。'
        else n || ' 表示你在 ' || c || ' 的球局的預訂有變動。請查看球局。'
      end;
    else
      return case p_kind
        when 'cancelled' then n || ' says the course booking for your round at ' || c || ' is cancelled. Check the round.'
        else n || ' says the booking for your round at ' || c || ' changed. Check the round.'
      end;
  end case;
end;
$$;
revoke execute on function private.booking_status_copy(text, text, text, text) from public, anon, authenticated;

create function private.booking_status_title(p_lang text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_lang, 'en')
    when 'es' then 'Cambio en la reserva'
    when 'ja' then '予約の変更'
    when 'ko' then '예약 변경'
    when 'zh-CN' then '预订有变动'
    when 'zh-TW' then '預訂有變動'
    else 'Booking update'
  end;
$$;
revoke execute on function private.booking_status_title(text) from public, anon, authenticated;

-- p_outcome: 'reviewed' | 'needs_correction' | 'rejected'
create function private.booking_review_copy(p_lang text, p_outcome text, p_course text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  c text := left(btrim(coalesce(p_course, '')), 60);
begin
  case coalesce(p_lang, 'en')
    when 'es' then
      return case p_outcome
        when 'reviewed' then 'GolfMe revisó la prueba de reserva de tu ronda en ' || c || '.'
        when 'needs_correction' then 'La prueba de reserva de tu ronda en ' || c || ' necesita una actualización. Abre la ronda para ver por qué.'
        else 'La prueba de reserva de tu ronda en ' || c || ' no fue aceptada. Abre la ronda para ver por qué.'
      end;
    when 'ja' then
      return case p_outcome
        when 'reviewed' then 'GolfMeが' || c || 'のラウンドの予約資料を確認しました。'
        when 'needs_correction' then c || 'のラウンドの予約資料は更新が必要です。理由はラウンドで確認できます。'
        else c || 'のラウンドの予約資料は受け付けられませんでした。理由はラウンドで確認できます。'
      end;
    when 'ko' then
      return case p_outcome
        when 'reviewed' then 'GolfMe가 ' || c || ' 라운드의 예약 자료를 검토했어요.'
        when 'needs_correction' then c || ' 라운드의 예약 자료를 업데이트해야 해요. 라운드에서 이유를 확인하세요.'
        else c || ' 라운드의 예약 자료가 승인되지 않았어요. 라운드에서 이유를 확인하세요.'
      end;
    when 'zh-CN' then
      return case p_outcome
        when 'reviewed' then 'GolfMe 已审核你在 ' || c || ' 的球局的预订资料。'
        when 'needs_correction' then '你在 ' || c || ' 的球局的预订资料需要更新。打开球局查看原因。'
        else '你在 ' || c || ' 的球局的预订资料未被接受。打开球局查看原因。'
      end;
    when 'zh-TW' then
      return case p_outcome
        when 'reviewed' then 'GolfMe 已審核你在 ' || c || ' 的球局的預訂資料。'
        when 'needs_correction' then '你在 ' || c || ' 的球局的預訂資料需要更新。打開球局查看原因。'
        else '你在 ' || c || ' 的球局的預訂資料未被接受。打開球局查看原因。'
      end;
    else
      return case p_outcome
        when 'reviewed' then 'GolfMe reviewed the booking evidence for your round at ' || c || '.'
        when 'needs_correction' then 'The booking evidence for your round at ' || c || ' needs an update. Open the round to see why.'
        else 'The booking evidence for your round at ' || c || ' wasn''t accepted. Open the round to see why.'
      end;
  end case;
end;
$$;
revoke execute on function private.booking_review_copy(text, text, text) from public, anon, authenticated;

revoke execute on function public.review_booking_evidence(uuid, text, text, text, integer) from public, anon;
grant execute on function public.review_booking_evidence(uuid, text, text, text, integer) to authenticated;

-- Host marks the booking changed or cancelled -> joined players (not the
-- host): bell, plus a push while the round is still to be played (same
-- send_round_push rules and collapse id as round updates).
create function public.notify_booking_status_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host_name text;
  v_push_secret text;
  v_live boolean;
  v_text text;
  v_link text := '/golf-calls/' || new.id;
  r record;
begin
  if new.booking_status is not distinct from old.booking_status
     or new.booking_status not in ('changed', 'cancelled')
     or coalesce(current_setting('golfme.booking_notify_skip', true), '') = 'on'
     or new.status not in ('open', 'full') then
    return new;
  end if;

  v_live := now() <= new.date_iso + interval '12 hours';
  select nullif(btrim(p.name), '') into v_host_name from public.profiles p where p.id = new.host_user_id;
  select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;

  for r in
    select rp.user_id, p.language
    from public.round_participants rp
    left join public.profiles p on p.id = rp.user_id
    where rp.round_id = new.id and rp.participant_status = 'joined' and rp.user_id <> new.host_user_id
  loop
    v_text := private.booking_status_copy(r.language, new.booking_status,
      coalesce(v_host_name, private.round_push_host_fallback(r.language)), new.course_name);
    insert into public.notifications (user_id, type, actor_id, text, link_to)
    values (r.user_id, 'booking_status_changed', new.host_user_id, v_text, v_link);
    if v_live then
      perform private.send_round_push(v_push_secret, r.user_id, private.booking_status_title(r.language), v_text, v_link, 'round-' || new.id);
    end if;
  end loop;
  return new;
end;
$$;
revoke execute on function public.notify_booking_status_changed() from public, anon, authenticated;

create trigger trg_notify_booking_status_changed
  after update of booking_status on public.golf_calls
  for each row execute function public.notify_booking_status_changed();

-- New-round push: "3 GolfMe places open" (was "3 spots open"). Same
-- function otherwise (20261030120000), 6 languages.
create or replace function private.fanout_round_copy(p_lang text, p_course text, p_date_iso timestamptz, p_time text, p_spots integer)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_day date := (p_date_iso at time zone 'UTC')::date;
  v_dow integer := extract(dow from v_day)::integer; -- 0 = Sunday
  v_soon boolean := v_day - (now() at time zone 'UTC')::date between -1 and 6;
  v_md text := extract(month from v_day)::integer || '/' || extract(day from v_day)::integer;
  v_dm text := extract(day from v_day)::integer || '/' || extract(month from v_day)::integer;
  v_course text := left(btrim(coalesce(p_course, '')), 60);
  v_time text := left(btrim(coalesce(p_time, '')), 20);
  v_when text;
begin
  case coalesce(p_lang, 'en')
    when 'es' then
      v_when := (array['dom','lun','mar','mié','jue','vie','sáb'])[v_dow + 1] || case when v_soon then '' else ' ' || v_dm end;
      return 'Nueva ronda en ' || v_course || ' · ' || btrim(v_when || ' ' || v_time) || ' · '
        || case when p_spots = 1 then '1 plaza libre en GolfMe' else p_spots || ' plazas libres en GolfMe' end;
    when 'ja' then
      v_when := case when v_soon then (array['日','月','火','水','木','金','土'])[v_dow + 1] || '曜'
                     else v_md || '(' || (array['日','月','火','水','木','金','土'])[v_dow + 1] || ')' end;
      return v_course || 'で新しいラウンド · ' || btrim(v_when || ' ' || v_time) || ' · GolfMe枠 残り' || p_spots;
    when 'ko' then
      v_when := case when v_soon then (array['일','월','화','수','목','금','토'])[v_dow + 1] || '요일'
                     else v_md || '(' || (array['일','월','화','수','목','금','토'])[v_dow + 1] || ')' end;
      return v_course || ' 새 라운드 · ' || btrim(v_when || ' ' || v_time) || ' · GolfMe 자리 ' || p_spots || '개 남음';
    when 'zh-CN' then
      v_when := case when v_soon then '' else v_md || ' ' end || (array['周日','周一','周二','周三','周四','周五','周六'])[v_dow + 1];
      return v_course || ' 有新球局 · ' || btrim(v_when || ' ' || v_time) || ' · GolfMe 名额剩 ' || p_spots || ' 个';
    when 'zh-TW' then
      v_when := case when v_soon then '' else v_md || ' ' end || (array['週日','週一','週二','週三','週四','週五','週六'])[v_dow + 1];
      return v_course || ' 有新球局 · ' || btrim(v_when || ' ' || v_time) || ' · GolfMe 名額剩 ' || p_spots || ' 個';
    else
      v_when := (array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[v_dow + 1] || case when v_soon then '' else ' ' || v_md end;
      return 'New round at ' || v_course || ' · ' || btrim(v_when || ' ' || v_time) || ' · '
        || p_spots || case when p_spots = 1 then ' GolfMe place open' else ' GolfMe places open' end;
  end case;
end;
$$;
revoke execute on function private.fanout_round_copy(text, text, timestamptz, text, integer) from public, anon, authenticated;

-- ===========================================================================
-- 11. Retire the old attach/remove RPCs (the forged-badge path)
-- ===========================================================================
create or replace function public.attach_booking_proof(
  p_golf_call_id uuid, p_storage_path text, p_proof_type text, p_booking_source text, p_booking_reference text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Update GolfMe to add a booking confirmation.' using errcode = '0A000';
end;
$$;
create or replace function public.remove_booking_proof(p_golf_call_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Update GolfMe to remove a booking confirmation.' using errcode = '0A000';
end;
$$;

-- ===========================================================================
-- 12. Retention sweep (admin)
-- ===========================================================================
-- 1. Current evidence on rounds whose day is over -> 'expired'.
-- 2. Returns booking-proofs paths whose bytes should now be deleted:
--      closed versions closed > 7 days ago; any version whose round day
--      ended > 30 days ago; files no evidence row references that are
--      > 7 days old (abandoned uploads, legacy proofs never migrated).
-- 3. Deletes evidence + review rows older than 12 months whose file is gone.
-- The admin page then removes the files (Storage API) and calls
-- admin_mark_booking_evidence_purged(paths).
create function public.admin_booking_evidence_sweep()
returns table (storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  with ended as (
    update public.booking_evidence e set status = 'expired', closed_at = now()
    from public.golf_calls g
    where g.id = e.golf_call_id and e.status in ('submitted', 'reviewed', 'needs_correction')
      and now() > g.date_iso + interval '12 hours'
    returning e.golf_call_id
  )
  update public.golf_calls g set evidence_status = 'none', evidence_reviewed_at = null, tee_time_source = 'manual'
  where g.id in (select golf_call_id from ended);

  delete from public.booking_evidence e
  where e.object_deleted_at is not null and e.created_at < now() - interval '12 months';

  return query
    select e.storage_path
    from public.booking_evidence e
    join public.golf_calls g on g.id = e.golf_call_id
    where e.object_deleted_at is null
      and (
        (e.closed_at is not null and e.closed_at < now() - interval '7 days')
        or g.date_iso < now() - interval '30 days'
      )
    union
    select o.name
    from storage.objects o
    where o.bucket_id = 'booking-proofs'
      and o.created_at < now() - interval '7 days'
      and not exists (select 1 from public.booking_evidence e where e.storage_path = o.name);
end;
$$;
revoke execute on function public.admin_booking_evidence_sweep() from public, anon;
grant execute on function public.admin_booking_evidence_sweep() to authenticated;

create function public.admin_mark_booking_evidence_purged(p_paths text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  -- Only paths whose file is really gone, and never current evidence.
  update public.booking_evidence e set object_deleted_at = now()
  where e.storage_path = any (p_paths)
    and e.object_deleted_at is null
    and e.status not in ('submitted', 'reviewed', 'needs_correction')
    and not exists (select 1 from storage.objects o where o.bucket_id = 'booking-proofs' and o.name = e.storage_path);
  get diagnostics v_count = row_count;
  delete from public.booking_proofs bp
  where bp.storage_path = any (p_paths)
    and not exists (select 1 from storage.objects o where o.bucket_id = 'booking-proofs' and o.name = bp.storage_path);
  return v_count;
end;
$$;
revoke execute on function public.admin_mark_booking_evidence_purged(text[]) from public, anon;
grant execute on function public.admin_mark_booking_evidence_purged(text[]) to authenticated;

-- ===========================================================================
-- 13. Backfill (existing rounds)
-- ===========================================================================
-- Nothing becomes 'reviewed'. 'manual' rounds stay 'unknown' (the default).
-- A round the host attached proof to is a host booking claim -> 'booked'.
-- Its legacy proof becomes a 'submitted' version only if the round is still
-- to be played and the file exists as a JPEG of at most 5 MB; otherwise the
-- round keeps the claim with no evidence (legacy PDFs/large files are
-- purged by the sweep).
update public.golf_calls
  set booking_status = 'booked', booking_status_updated_at = coalesce(verification_created_at, now())
  where tee_time_source = 'user_verified';

insert into public.booking_evidence (
  golf_call_id, host_user_id, storage_path, mime_type, size_bytes,
  snap_course_id, snap_course_name, snap_date_iso, snap_tee_time_label, snap_party_size, snap_booking_version,
  client_request_id, created_at
)
select bp.golf_call_id, bp.uploaded_by_user_id, bp.storage_path, 'image/jpeg', (o.metadata ->> 'size')::integer,
  g.course_id, g.course_name, g.date_iso, g.tee_time_label, null, g.booking_version,
  gen_random_uuid(), bp.created_at
from public.booking_proofs bp
join public.golf_calls g on g.id = bp.golf_call_id
join storage.objects o on o.bucket_id = 'booking-proofs' and o.name = bp.storage_path
where g.tee_time_source = 'user_verified'
  and g.status in ('open', 'full')
  and now() <= g.date_iso + interval '12 hours'
  and bp.uploaded_by_user_id = g.host_user_id
  and o.metadata ->> 'mimetype' = 'image/jpeg'
  and nullif(o.metadata ->> 'size', '')::bigint between 1 and 5242880
  and bp.storage_path ~ ('^' || g.host_user_id::text || '/' || g.id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$');

update public.golf_calls g
  set evidence_status = 'submitted'
  where exists (select 1 from public.booking_evidence e where e.golf_call_id = g.id and e.status = 'submitted');

-- Mirror: user_verified only where a current version now exists.
update public.golf_calls g
  set tee_time_source = 'manual', verification_created_at = null
  where g.tee_time_source = 'user_verified' and g.evidence_status = 'none';
