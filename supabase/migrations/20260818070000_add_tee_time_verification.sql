-- Tee-time trust: lets a host attach supporting evidence (screenshot/PDF +
-- optional source/reference) for a tee time they entered, without GolfMe
-- ever claiming it independently confirmed the booking. Three levels,
-- reusing golf_calls.tee_time_source (already existed, previously locked to
-- the single value 'user_entered' pending a future provider integration —
-- see its original comment) rather than adding a parallel status column:
--   manual            -- host typed it in, no evidence attached (the old
--                         'user_entered' default, renamed for clarity)
--   user_verified      -- host attached booking proof (this migration)
--   provider_verified  -- reserved for a real future API/provider
--                         integration; tee_time_provider/external_tee_time_id
--                         already exist on this table for exactly that and
--                         are untouched here. Nothing in this migration ever
--                         sets this value -- there is no provider yet.

alter table public.golf_calls drop constraint golf_calls_tee_time_source_check;
update public.golf_calls set tee_time_source = 'manual' where tee_time_source = 'user_entered';
alter table public.golf_calls alter column tee_time_source set default 'manual';
alter table public.golf_calls add constraint golf_calls_tee_time_source_check
  check (tee_time_source in ('manual', 'user_verified', 'provider_verified'));

-- Public-safe verification metadata lives directly on golf_calls (same
-- open-select policy as the rest of the row -- "Source: Course Website" and
-- "Added 2h ago" are meant to be visible to anyone viewing the round, see
-- the round-detail explanation in the brief). The booking reference number
-- is deliberately NOT here -- see booking_proofs below for why.
alter table public.golf_calls add column booking_source text;
alter table public.golf_calls add column verification_created_at timestamptz;

-- The actual proof: one row per round (replacing proof overwrites the row,
-- never accumulates duplicates), storage path only -- never a base64 file
-- in the database. booking_reference lives HERE rather than on golf_calls
-- specifically because golf_calls has a blanket
-- "select true for authenticated" RLS policy (every real account can read
-- every round's public fields) -- putting a confirmation number there would
-- leak it to every GolfMe user via a direct query regardless of what the UI
-- chooses to render, defeating the brief's explicit "do not publicly expose
-- the full reference number" requirement. This table gets its own, much
-- narrower RLS instead (see below): only the host who uploaded it, or an
-- admin, can ever select a row here.
create table public.booking_proofs (
  id uuid primary key default gen_random_uuid(),
  golf_call_id uuid not null unique references public.golf_calls (id) on delete cascade,
  uploaded_by_user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  proof_type text not null check (proof_type in ('image', 'pdf')),
  booking_reference text,
  created_at timestamptz not null default now()
);
alter table public.booking_proofs enable row level security;

create policy booking_proofs_select_own_or_admin on public.booking_proofs
  for select to authenticated
  using (uploaded_by_user_id = (select auth.uid()) or private.has_role((select auth.uid()), 'admin'));

-- No insert/update/delete policy on purpose -- every write goes through
-- attach_booking_proof()/remove_booking_proof() below, which re-check that
-- the caller actually hosts the round in question (uploaded_by_user_id
-- alone isn't enough of a check to trust from a raw client insert -- it
-- must also match golf_calls.host_user_id for that specific round).

-- Private bucket (unlike avatars/community-media, which are public-read by
-- design) -- a booking confirmation screenshot is meaningfully more
-- sensitive than a profile photo or a community post's image.
insert into storage.buckets (id, name, public, file_size_limit)
values ('booking-proofs', 'booking-proofs', false, 15728640) -- 15MB
on conflict (id) do nothing;

create policy booking_proofs_storage_select_own_or_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'booking-proofs' and ((storage.foldername(name))[1] = (select auth.uid())::text or private.has_role((select auth.uid()), 'admin')));
create policy booking_proofs_storage_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'booking-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy booking_proofs_storage_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'booking-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Attaches (or replaces) booking proof for a round -- host-only, re-checked
-- server-side rather than trusted from the client. Returns the previous
-- storage_path (or null) so the caller can clean up the old object from
-- Storage after a successful replace.
create function public.attach_booking_proof(
  p_golf_call_id uuid,
  p_storage_path text,
  p_proof_type text,
  p_booking_source text,
  p_booking_reference text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_path text;
begin
  if not exists (select 1 from public.golf_calls where id = p_golf_call_id and host_user_id = (select auth.uid())) then
    raise exception 'Only the host can add booking proof for this round.' using errcode = '42501';
  end if;

  select storage_path into v_old_path from public.booking_proofs where golf_call_id = p_golf_call_id;

  insert into public.booking_proofs (golf_call_id, uploaded_by_user_id, storage_path, proof_type, booking_reference)
  values (p_golf_call_id, (select auth.uid()), p_storage_path, p_proof_type, nullif(trim(coalesce(p_booking_reference, '')), ''))
  on conflict (golf_call_id) do update
    set uploaded_by_user_id = excluded.uploaded_by_user_id, storage_path = excluded.storage_path,
        proof_type = excluded.proof_type, booking_reference = excluded.booking_reference, created_at = now();

  update public.golf_calls
    set tee_time_source = 'user_verified', booking_source = nullif(trim(coalesce(p_booking_source, '')), ''), verification_created_at = now()
    where id = p_golf_call_id;

  return v_old_path;
end;
$$;
revoke execute on function public.attach_booking_proof(uuid, text, text, text, text) from public, anon;
grant execute on function public.attach_booking_proof(uuid, text, text, text, text) to authenticated;

-- Removes proof and reverts the round to 'manual' -- host-only. Returns the
-- removed storage_path so the caller can delete the actual Storage object.
create function public.remove_booking_proof(p_golf_call_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  if not exists (select 1 from public.golf_calls where id = p_golf_call_id and host_user_id = (select auth.uid())) then
    raise exception 'Only the host can remove booking proof for this round.' using errcode = '42501';
  end if;

  select storage_path into v_path from public.booking_proofs where golf_call_id = p_golf_call_id;
  delete from public.booking_proofs where golf_call_id = p_golf_call_id;

  update public.golf_calls
    set tee_time_source = 'manual', booking_source = null, verification_created_at = null
    where id = p_golf_call_id;

  return v_path;
end;
$$;
revoke execute on function public.remove_booking_proof(uuid) from public, anon;
grant execute on function public.remove_booking_proof(uuid) to authenticated;

-- The first host-initiated edit of an already-created round (previously
-- only cancel/complete existed as post-creation host mutations, both
-- single-column status flips) -- deliberately scoped to just the three
-- fields verification is tied to (course/date/time), not a general-purpose
-- round editor. If any of those actually changed AND the round currently
-- has attached proof, the proof no longer describes the (now different)
-- booking, so it's deleted and the round reverts to 'manual' in the same
-- transaction -- never leaves proof for one booking silently "verifying" a
-- different one. Returns whether that invalidation happened (and the freed
-- storage path) so the client can clean up Storage and tell the host.
create function public.edit_golf_call_tee_time(
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

  if v_changed and v_call.tee_time_source = 'user_verified' then
    select storage_path into v_old_path from public.booking_proofs where golf_call_id = p_golf_call_id;
    delete from public.booking_proofs where golf_call_id = p_golf_call_id;
    update public.golf_calls set tee_time_source = 'manual', booking_source = null, verification_created_at = null
      where id = p_golf_call_id
      returning * into v_call;
    v_invalidated := true;
  end if;

  return query select v_call, v_invalidated, v_old_path;
end;
$$;
revoke execute on function public.edit_golf_call_tee_time(uuid, uuid, text, text, double precision, double precision, timestamptz, text) from public, anon;
grant execute on function public.edit_golf_call_tee_time(uuid, uuid, text, text, double precision, double precision, timestamptz, text) to authenticated;

-- Notify already-joined participants (not the host) the moment a round
-- they're in gets proof attached -- fires once per transition into
-- 'user_verified', never on every unrelated golf_calls update.
create function public.notify_booking_proof_attached()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host_name text;
begin
  if new.tee_time_source = 'user_verified' and old.tee_time_source is distinct from 'user_verified' then
    select name into v_host_name from public.profiles where id = new.host_user_id;
    insert into public.notifications (user_id, type, actor_id, text, link_to)
    select rp.user_id, 'booking_proof_attached', new.host_user_id,
      coalesce(v_host_name, 'Your host') || ' added booking proof to your round at ' || new.course_name || '.',
      '/golf-calls/' || new.id
    from public.round_participants rp
    where rp.round_id = new.id and rp.participant_status = 'joined' and rp.user_id <> new.host_user_id;
  end if;
  return new;
end;
$$;

create trigger trg_notify_booking_proof_attached
  after update of tee_time_source on public.golf_calls
  for each row execute function public.notify_booking_proof_attached();

revoke execute on function public.notify_booking_proof_attached() from public, anon, authenticated;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('round_joined', 'round_left', 'round_cancelled', 'new_message', 'comment_reply', 'post_reply', 'round_created_from_post', 'post_became_round', 'booking_proof_attached'));
