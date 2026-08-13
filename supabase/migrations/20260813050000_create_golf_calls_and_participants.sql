-- Real multiplayer rounds (Phase 4 of the real-backend migration). Two
-- tables + two SECURITY DEFINER functions that are the only sanctioned way
-- to join/leave a round — round_participants has no client-facing
-- insert/update policy at all, so every membership change goes through the
-- atomic, row-locked logic in join_golf_call()/leave_golf_call() rather
-- than a bare client upsert that could race.

create table public.golf_calls (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users (id) on delete cascade,

  -- Course snapshot: course_id links back to Phase 3's courses cache
  -- (carries provider/external_id) when the host picked a real search
  -- result; the name/coords are copied onto the round itself so it keeps
  -- its own record even if the courses cache entry changes later, and so
  -- hosting still works for a course that hasn't been searched/cached yet.
  course_id uuid references public.courses (id) on delete set null,
  course_name text not null,
  course_area_label text not null default '',
  course_lat double precision,
  course_lng double precision,

  date_iso timestamptz not null,
  tee_time_label text not null,
  holes int not null default 18 check (holes in (9, 18)),
  game_format text not null default 'Standard Stroke Play',
  estimated_price_per_person numeric,
  total_spots int not null check (total_spots between 2 and 4),
  -- Request-to-join (host approval) is explicitly deferred this phase —
  -- real rounds are instant-join only, see DEVELOPMENT_STATUS.md.
  join_mode text not null default 'instant' check (join_mode in ('instant')),
  skill_level text not null default 'Any Skill Level',
  vibe text not null default 'Casual & Social',
  walk_or_cart text not null default 'Either',
  status text not null default 'open' check (status in ('open', 'full', 'completed', 'cancelled')),
  notes text,

  -- Tee time is always user-entered this phase, never real live
  -- availability — these columns exist now so a future real tee-time
  -- provider integration doesn't need a schema change, but tee_time_source
  -- must never be set to anything but 'user_entered' yet.
  tee_time_source text not null default 'user_entered' check (tee_time_source in ('user_entered')),
  tee_time_provider text,
  external_tee_time_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.golf_calls is
  'Real hosted rounds. Membership (round_participants) is only ever mutated through join_golf_call()/leave_golf_call() — never a direct client insert/update — so overfilling is impossible by construction.';

alter table public.golf_calls enable row level security;

create policy "golf_calls_select_authenticated"
  on public.golf_calls for select
  to authenticated
  using (true);

create policy "golf_calls_insert_own"
  on public.golf_calls for insert
  to authenticated
  with check ((select auth.uid()) = host_user_id);

-- Covers direct host actions (cancel, edit) — join/leave's status flips
-- (open<->full) happen inside the SECURITY DEFINER functions below, which
-- bypass RLS entirely, so this policy is never the thing gating those.
create policy "golf_calls_update_host"
  on public.golf_calls for update
  to authenticated
  using ((select auth.uid()) = host_user_id)
  with check ((select auth.uid()) = host_user_id);

create trigger set_golf_calls_updated_at
  before update on public.golf_calls
  for each row execute function public.set_updated_at();

create table public.round_participants (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.golf_calls (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  participant_status text not null default 'joined' check (participant_status in ('joined', 'left')),
  joined_at timestamptz not null default now(),
  unique (round_id, user_id)
);

comment on table public.round_participants is
  'No client-facing insert/update policy on purpose — every membership change must go through join_golf_call()/leave_golf_call() so the total_spots check and the write happen inside one locked transaction, never as two separate round-trippable steps a client could race.';

alter table public.round_participants enable row level security;

create policy "round_participants_select_authenticated"
  on public.round_participants for select
  to authenticated
  using (true);

-- Row-locks the round for the duration of the check-then-insert so two
-- golfers hitting "join" on the last spot at the same instant are
-- serialized by Postgres itself: the second caller's lock acquisition waits
-- for the first's transaction to commit, then re-reads the now-current
-- joined count and correctly sees the round as full.
create function public.join_golf_call(p_round_id uuid)
returns public.round_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.golf_calls%rowtype;
  v_participant public.round_participants%rowtype;
  v_joined_count int;
begin
  select * into v_call from public.golf_calls where id = p_round_id for update;
  if not found then
    raise exception 'Round not found.';
  end if;
  if v_call.status <> 'open' then
    raise exception 'This round is no longer open to join.';
  end if;
  if v_call.host_user_id = (select auth.uid()) then
    raise exception 'You are already hosting this round.';
  end if;

  select count(*) into v_joined_count from public.round_participants
    where round_id = p_round_id and participant_status = 'joined';
  if v_joined_count >= v_call.total_spots then
    raise exception 'This round is full.';
  end if;

  insert into public.round_participants (round_id, user_id, participant_status, joined_at)
    values (p_round_id, (select auth.uid()), 'joined', now())
    on conflict (round_id, user_id)
    do update set participant_status = 'joined', joined_at = now()
    returning * into v_participant;

  select count(*) into v_joined_count from public.round_participants
    where round_id = p_round_id and participant_status = 'joined';
  if v_joined_count >= v_call.total_spots then
    update public.golf_calls set status = 'full' where id = p_round_id;
  end if;

  return v_participant;
end;
$$;

revoke execute on function public.join_golf_call(uuid) from public, anon;
grant execute on function public.join_golf_call(uuid) to authenticated;

create function public.leave_golf_call(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.golf_calls where id = p_round_id for update;

  update public.round_participants
    set participant_status = 'left'
    where round_id = p_round_id and user_id = (select auth.uid()) and participant_status = 'joined';

  update public.golf_calls
    set status = 'open'
    where id = p_round_id and status = 'full';
end;
$$;

revoke execute on function public.leave_golf_call(uuid) from public, anon;
grant execute on function public.leave_golf_call(uuid) to authenticated;

-- Membership changes need to reach every open device without a manual
-- refresh — the whole point of requirement H.
alter publication supabase_realtime add table public.golf_calls;
alter publication supabase_realtime add table public.round_participants;
