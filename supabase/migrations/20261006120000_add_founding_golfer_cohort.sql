-- Founding Golfer cohort (nyc_2026), 2026-10-06.
--
-- A permanent, scarce cohort: at most 250 numbered Founding Golfers,
-- numbers #1..#250 handed out sequentially, never above 250, never reused
-- (not after an account deletion, not after an admin revokes a mistaken
-- award). Awarded automatically and server-side only, the moment a profile
-- becomes eligible:
--   * profiles.has_onboarded = true (name + 18+ + location, i.e. the
--     completed golfer profile), and
--   * playing_area_lat/lng both non-null and within 30 miles (haversine) of
--     Midtown NYC (40.7549, -73.9840). The coordinates are already rounded
--     to 2 decimals by profiles_coarsen_location (20260930090000); the
--     location label text is never used, and
--   * auth.users.email_confirmed_at is not null, and
--   * the account has no active admin or exclusion role in user_roles
--     ('test', 'app_reviewer', 'seeded', 'bot', 'pre_launch'), and
--   * the account has never held a ledger row before (a revoked award is
--     not silently re-awarded on the next profile save).
--
-- Pieces:
--   founding_cohort_state   -- one row per cohort, row-locked (FOR UPDATE)
--                              by the award path; holds next_number / cap /
--                              is_open / opened_at / closed_at. The ONLY
--                              source of the next number (never max() over
--                              profiles, which would recycle deleted users'
--                              numbers).
--   founding_golfer_awards  -- append-only ledger, member_number PK. user_id
--                              goes NULL on account deletion, the row (and so
--                              the consumed number) stays.
--   profiles.founding_*     -- read-only mirror the app reads wherever it
--                              already selects profiles. Client roles can
--                              never write it (guard trigger below).
--
-- The cohort is created CLOSED-but-not-finished (is_open = false,
-- closed_at = null). 20261006120100 grants the exclusion roles, opens it and
-- backfills existing eligible users in auth.users.created_at order, so no
-- profile save between the two files can take a number out of order or hand
-- one to a test/reviewer account. closed_at set = permanently closed (by an
-- admin, or automatically when #cap is awarded); nothing can reopen it.

-- ---------------------------------------------------------------------------
-- 1. user_roles: exclusion roles (reuses the existing role table/concept).
-- ---------------------------------------------------------------------------
-- 'pre_launch' (added 2026-10-25, before this file was ever applied): real
-- golfers from the pre-launch friends/testers list whom Micky chose to leave
-- out of the cohort (Founding #1 is the first signup after them). It means
-- "real account, no Founding number" and nothing else: unlike 'test' /
-- 'seeded' / 'bot' it must never be used to hide an account from stats,
-- search, suggestions or any other feature.
alter table public.user_roles drop constraint user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('coach_reviewer', 'admin', 'test', 'app_reviewer', 'seeded', 'bot', 'pre_launch'));

-- ---------------------------------------------------------------------------
-- 2. Cohort state (row-locked counter).
-- ---------------------------------------------------------------------------
create table public.founding_cohort_state (
  cohort text primary key check (cohort = 'nyc_2026'),
  cap integer not null default 250 check (cap between 1 and 250),
  next_number integer not null default 1,
  is_open boolean not null default false,
  opened_at timestamptz,
  closed_at timestamptz,
  constraint founding_cohort_state_next_number_range check (next_number between 1 and cap + 1),
  constraint founding_cohort_state_closed_is_not_open check (closed_at is null or is_open = false)
);
alter table public.founding_cohort_state enable row level security;

insert into public.founding_cohort_state (cohort, cap, next_number, is_open)
values ('nyc_2026', 250, 1, false);

-- Nothing here is sensitive (cap / counter / open flag) -- it's exactly what
-- the onboarding "spots remaining" line shows -- so it's readable directly;
-- get_founding_cohort_status() below is SECURITY INVOKER on top of this.
-- No client write grants or policies at all.
revoke all on public.founding_cohort_state from anon, authenticated;
grant select on public.founding_cohort_state to anon, authenticated;
create policy founding_cohort_state_select_all on public.founding_cohort_state
  for select to anon, authenticated using (true);

-- Backstop against any writer (service_role/SQL editor included): the counter
-- never goes backwards, the cap never changes, and a closed cohort never
-- reopens.
create function public.guard_founding_cohort_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Founding cohort state cannot be deleted.' using errcode = '42501';
  end if;
  if new.cohort is distinct from old.cohort or new.cap is distinct from old.cap then
    raise exception 'Founding cohort identity/cap cannot change.' using errcode = '42501';
  end if;
  if new.next_number < old.next_number then
    raise exception 'Founding numbers are never reused.' using errcode = '42501';
  end if;
  if old.closed_at is not null and (new.is_open or new.closed_at is distinct from old.closed_at) then
    raise exception 'The founding cohort is permanently closed.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_founding_cohort_state() from public, anon, authenticated;

create trigger founding_cohort_state_guard
  before update or delete on public.founding_cohort_state
  for each row execute function public.guard_founding_cohort_state();

-- ---------------------------------------------------------------------------
-- 3. Append-only award ledger.
-- ---------------------------------------------------------------------------
create table public.founding_golfer_awards (
  member_number integer primary key check (member_number between 1 and 250),
  cohort text not null references public.founding_cohort_state (cohort),
  user_id uuid references auth.users (id) on delete set null,
  awarded_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  constraint founding_golfer_awards_revoke_reason check (revoked_at is not null or revoked_reason is null)
);
-- One ledger row per account, ever (revoked rows included), so a revoked
-- award is never auto-re-awarded and two awards can't land on one user.
-- NULLs (deleted accounts) don't collide.
create unique index founding_golfer_awards_user_id_key on public.founding_golfer_awards (user_id);
alter table public.founding_golfer_awards enable row level security;

revoke all on public.founding_golfer_awards from anon, authenticated;
grant select on public.founding_golfer_awards to authenticated;
create policy founding_golfer_awards_select_admin on public.founding_golfer_awards
  for select to authenticated
  using (private.has_role((select auth.uid()), 'admin'));
-- No insert/update/delete policies: only the SECURITY DEFINER award/revoke
-- functions write here.

-- Append-only backstop for every writer: rows are never deleted; number /
-- cohort / awarded_at never change; user_id may only become NULL (the
-- ON DELETE SET NULL action -- user triggers do fire for it); a revocation
-- is one-way.
create function public.guard_founding_golfer_awards()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Founding Golfer awards are permanent ledger rows.' using errcode = '42501';
  end if;
  if new.member_number is distinct from old.member_number
     or new.cohort is distinct from old.cohort
     or new.awarded_at is distinct from old.awarded_at then
    raise exception 'Founding Golfer award details cannot change.' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id and new.user_id is not null then
    raise exception 'A Founding Golfer number cannot be reassigned.' using errcode = '42501';
  end if;
  if old.revoked_at is not null
     and (new.revoked_at is distinct from old.revoked_at or new.revoked_reason is distinct from old.revoked_reason) then
    raise exception 'A revocation cannot be undone.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_founding_golfer_awards() from public, anon, authenticated;

create trigger founding_golfer_awards_guard
  before update or delete on public.founding_golfer_awards
  for each row execute function public.guard_founding_golfer_awards();

-- ---------------------------------------------------------------------------
-- 4. profiles mirror columns.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column founding_golfer boolean not null default false,
  add column founding_member_number integer
    constraint profiles_founding_member_number_key unique
    constraint profiles_founding_member_number_fkey references public.founding_golfer_awards (member_number),
  add column founding_cohort text,
  add column founding_awarded_at timestamptz,
  add constraint profiles_founding_mirror_consistent check (
    (founding_golfer and founding_member_number is not null and founding_cohort is not null and founding_awarded_at is not null)
    or (not founding_golfer and founding_member_number is null and founding_cohort is null and founding_awarded_at is null)
  );

-- Client roles can never write the four founding columns (insert or update).
-- This is deliberately a NEW SECURITY INVOKER trigger instead of more lines in
-- protect_unverified_trust_columns(): that function is SECURITY DEFINER, so
-- inside it current_user is always its owner and it cannot tell a client
-- write from the sanctioned award path -- it can only freeze unconditionally.
-- Same pattern as guard_golf_calls_client_writes (20260924100100): PostgREST
-- requests run as authenticated/anon; the SECURITY DEFINER award/revoke
-- functions run as their owner and pass straight through.
create function public.guard_profile_founding_columns()
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
    new.founding_golfer := false;
    new.founding_member_number := null;
    new.founding_cohort := null;
    new.founding_awarded_at := null;
  else
    new.founding_golfer := old.founding_golfer;
    new.founding_member_number := old.founding_member_number;
    new.founding_cohort := old.founding_cohort;
    new.founding_awarded_at := old.founding_awarded_at;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_profile_founding_columns() from public, anon, authenticated;

create trigger profiles_guard_founding_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profile_founding_columns();

-- ---------------------------------------------------------------------------
-- 5. Eligibility + award (private schema: never a /rest/v1/rpc endpoint).
-- ---------------------------------------------------------------------------
create function private.in_founding_zone(p_lat double precision, p_lng double precision)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_lat is not null and p_lng is not null
    and 2 * 3958.8 * asin(sqrt(
          power(sin(radians(p_lat - 40.7549) / 2), 2)
          + cos(radians(40.7549)) * cos(radians(p_lat))
            * power(sin(radians(p_lng - (-73.9840)) / 2), 2)
        )) <= 30;
$$;
revoke execute on function private.in_founding_zone(double precision, double precision) from public, anon, authenticated;

-- Returns the awarded number, or NULL when nothing was awarded.
-- Concurrency: every award serializes on the cohort-state row lock (SELECT
-- ... FOR UPDATE). Under READ COMMITTED a waiting transaction re-reads the
-- committed row once the lock frees, so it sees the advanced next_number; if
-- the holder rolls back, its number was never consumed and the waiter takes
-- it. The per-user ledger check happens AFTER the lock so two concurrent
-- saves of one profile can't both award. UNIQUE(member_number) (ledger PK +
-- profiles unique), UNIQUE(user_id) and CHECK 1..250 are backstops only.
-- Ineligible users return before touching the lock, so non-NYC profile saves
-- never contend on it.
create function private.award_founding_golfer(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_state record;
  v_number integer;
  v_now timestamptz := now();
begin
  -- Confirmed email required. No auth.users trigger re-attempts the award on
  -- confirmation because in GolfMe confirmation always precedes onboarding:
  -- every sign-in path (Google OAuth, email OTP/magic link, password sign-in
  -- for pre-created accounts; the client never calls auth.signUp) only yields
  -- a session -- and so a ProfileSetup save -- after the email is confirmed.
  -- Leaving auth.users trigger-free also keeps auth and delete-account
  -- untouched. An unconfirmed account that somehow onboarded is picked up on
  -- its next onboarding/location save.
  select p.has_onboarded, p.playing_area_lat, p.playing_area_lng, p.founding_member_number,
         u.email_confirmed_at
    into v_profile
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_user_id;

  if not found
     or v_profile.email_confirmed_at is null
     or v_profile.founding_member_number is not null
     or not coalesce(v_profile.has_onboarded, false)
     or not private.in_founding_zone(v_profile.playing_area_lat, v_profile.playing_area_lng) then
    return null;
  end if;

  if exists (
    select 1 from public.user_roles r
    where r.user_id = p_user_id and r.active
      and r.role in ('admin', 'test', 'app_reviewer', 'seeded', 'bot', 'pre_launch')
  ) then
    return null;
  end if;

  select s.cohort, s.cap, s.next_number, s.is_open, s.closed_at
    into v_state
  from public.founding_cohort_state s
  where s.cohort = 'nyc_2026'
  for update;

  if not found or not v_state.is_open or v_state.closed_at is not null
     or v_state.next_number > v_state.cap then
    return null;
  end if;

  -- Re-checked under the lock: one ledger row per account, ever.
  if exists (select 1 from public.founding_golfer_awards a where a.user_id = p_user_id) then
    return null;
  end if;

  v_number := v_state.next_number;

  insert into public.founding_golfer_awards (member_number, cohort, user_id, awarded_at)
  values (v_number, v_state.cohort, p_user_id, v_now);

  update public.founding_cohort_state
  set next_number = v_number + 1,
      is_open = (v_number + 1 <= cap),
      closed_at = case when v_number + 1 > cap then v_now else closed_at end
  where cohort = v_state.cohort;

  -- Only the four founding columns are in the SET list, so the AFTER UPDATE
  -- OF has_onboarded/playing_area_* award trigger does not re-fire, and
  -- trg_notify_founder_welcome no-ops (has_onboarded unchanged).
  update public.profiles
  set founding_golfer = true,
      founding_member_number = v_number,
      founding_cohort = v_state.cohort,
      founding_awarded_at = v_now
  where id = p_user_id;

  return v_number;
end;
$$;
revoke execute on function private.award_founding_golfer(uuid) from public, anon, authenticated;

-- AFTER trigger so it sees the coarsened coordinates and the committed row
-- values. Any unexpected failure is downgraded to a WARNING: a Founding
-- Golfer award must never be able to break a normal profile save.
create function public.award_founding_golfer_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.award_founding_golfer(new.id);
  exception when others then
    raise warning 'award_founding_golfer failed for %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end;
$$;
revoke execute on function public.award_founding_golfer_on_profile_change() from public, anon, authenticated;

create trigger profiles_award_founding_golfer
  after insert or update of has_onboarded, playing_area_lat, playing_area_lng on public.profiles
  for each row
  when (new.has_onboarded and new.founding_member_number is null
        and new.playing_area_lat is not null and new.playing_area_lng is not null)
  execute function public.award_founding_golfer_on_profile_change();

-- ---------------------------------------------------------------------------
-- 6. Public status RPC (onboarding "Founding Golfer spots remaining").
-- ---------------------------------------------------------------------------
create function public.get_founding_cohort_status()
returns table (cap integer, awarded_count integer, remaining integer, is_open boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.cap,
         s.next_number - 1,
         case when s.is_open then greatest(s.cap - (s.next_number - 1), 0) else 0 end,
         s.is_open and s.closed_at is null and s.next_number <= s.cap
  from public.founding_cohort_state s
  where s.cohort = 'nyc_2026';
$$;
revoke execute on function public.get_founding_cohort_status() from public;
grant execute on function public.get_founding_cohort_status() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Admin RPCs (same private.has_role admin check as admin_list_reports).
-- ---------------------------------------------------------------------------
create function public.admin_set_founding_exclusion(p_user_id uuid, p_role text, p_excluded boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('test', 'app_reviewer', 'seeded', 'bot', 'pre_launch') then
    raise exception 'Invalid exclusion role.' using errcode = '22023';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;

  insert into public.user_roles (user_id, role, granted_by, granted_at, active, revoked_at)
  values (p_user_id, p_role, (select auth.uid()), now(), coalesce(p_excluded, false),
          case when coalesce(p_excluded, false) then null else now() end)
  on conflict (user_id, role) do update
    set active = excluded.active,
        granted_by = excluded.granted_by,
        granted_at = case when excluded.active then now() else public.user_roles.granted_at end,
        revoked_at = excluded.revoked_at;
  -- Unsetting an exclusion does not award retroactively; the next profile
  -- save that touches has_onboarded/location will (if still eligible).
end;
$$;
revoke execute on function public.admin_set_founding_exclusion(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_founding_exclusion(uuid, text, boolean) to authenticated;

create function public.admin_close_founding_cohort()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  update public.founding_cohort_state
  set is_open = false, closed_at = now()
  where cohort = 'nyc_2026' and closed_at is null;
end;
$$;
revoke execute on function public.admin_close_founding_cohort() from public, anon;
grant execute on function public.admin_close_founding_cohort() to authenticated;

create function public.admin_revoke_founding_award(p_member_number integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;

  select a.user_id into v_user_id
  from public.founding_golfer_awards a
  where a.member_number = p_member_number and a.revoked_at is null
  for update;
  if not found then
    raise exception 'Active award not found.' using errcode = 'P0002';
  end if;

  -- Clear the mirror first (profiles FK points at the ledger row, which stays).
  if v_user_id is not null then
    update public.profiles
    set founding_golfer = false,
        founding_member_number = null,
        founding_cohort = null,
        founding_awarded_at = null
    where id = v_user_id and founding_member_number = p_member_number;
  end if;

  -- The number stays consumed: next_number is never touched here.
  update public.founding_golfer_awards
  set revoked_at = now(), revoked_reason = left(btrim(p_reason), 500)
  where member_number = p_member_number;
end;
$$;
revoke execute on function public.admin_revoke_founding_award(integer, text) from public, anon;
grant execute on function public.admin_revoke_founding_award(integer, text) to authenticated;

create function public.admin_list_founding_awards()
returns table (
  member_number integer,
  cohort text,
  user_id uuid,
  name text,
  username text,
  awarded_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text
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

  return query
  select a.member_number, a.cohort, a.user_id, p.name, p.username,
         a.awarded_at, a.revoked_at, a.revoked_reason
  from public.founding_golfer_awards a
  left join public.profiles p on p.id = a.user_id
  order by a.member_number;
end;
$$;
revoke execute on function public.admin_list_founding_awards() from public, anon;
grant execute on function public.admin_list_founding_awards() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Find Friends: expose founding_member_number from search + suggestions.
-- ---------------------------------------------------------------------------
-- Both RPCs return a fixed RETURNS TABLE, so the new LAST column needs a
-- drop + recreate. Bodies are copied verbatim from the live definitions
-- (pg_get_functiondef, 2026-10-12) with only p.founding_member_number added;
-- the profiles mirror is NULL for never-awarded and revoked accounts. Live
-- ACL on both was {postgres, authenticated, service_role} (no PUBLIC, no
-- anon) -- restored exactly below, since a fresh function gets PUBLIC plus
-- Supabase's default anon/authenticated/service_role grants.
drop function public.search_golfer_profiles(text, integer);
create function public.search_golfer_profiles(p_query text, p_limit integer default 10)
returns table (id uuid, name text, username text, avatar_color text, avatar_initials text, photo_url text, handicap integer, area_label text, completed_rounds integer, would_play_again_pct integer, founding_member_number integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.username, p.avatar_color, p.avatar_initials, p.photo_url, p.handicap, p.area_label, p.completed_rounds, p.would_play_again_pct, p.founding_member_number
  from public.profiles p
  where p.id <> (select auth.uid())
    and trim(coalesce(p_query, '')) <> ''
    and (p.username ilike '%' || trim(p_query) || '%' or p.name ilike '%' || trim(p_query) || '%')
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = (select auth.uid()))
    )
  order by
    case
      when lower(p.username) = lower(trim(p_query)) then 0
      when p.username ilike trim(p_query) || '%' then 1
      when lower(p.name) = lower(trim(p_query)) then 2
      when p.name ilike trim(p_query) || '%' then 3
      else 4
    end,
    p.name
  limit least(coalesce(p_limit, 10), 25);
$$;
revoke execute on function public.search_golfer_profiles(text, integer) from public, anon;
grant execute on function public.search_golfer_profiles(text, integer) to authenticated, service_role;

drop function public.suggested_golfer_profiles(integer);
create function public.suggested_golfer_profiles(p_limit integer default 6)
returns table (id uuid, name text, username text, avatar_color text, avatar_initials text, photo_url text, handicap integer, area_label text, completed_rounds integer, would_play_again_pct integer, founding_member_number integer)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select handicap, vibes, playing_area_lat, playing_area_lng
    from public.profiles
    where id = (select auth.uid())
  )
  select p.id, p.name, p.username, p.avatar_color, p.avatar_initials, p.photo_url, p.handicap, p.area_label, p.completed_rounds, p.would_play_again_pct, p.founding_member_number
  from public.profiles p, me
  where p.id <> (select auth.uid())
    and p.has_onboarded
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = (select auth.uid()))
    )
    and not exists (
      select 1 from public.follows f
      where f.follower_id = (select auth.uid()) and f.following_id = p.id
    )
  order by
    (
      greatest(0, 20 - coalesce(abs(p.handicap - me.handicap), 20))
      + cardinality(array(select unnest(p.vibes) intersect select unnest(me.vibes))) * 5
      + (
          case
            when me.playing_area_lat is not null and me.playing_area_lng is not null
             and p.playing_area_lat is not null and p.playing_area_lng is not null
            then greatest(0, 20 - (point(p.playing_area_lng, p.playing_area_lat) <-> point(me.playing_area_lng, me.playing_area_lat)) * 20)
            else 0
          end
        )
    ) desc,
    p.created_at desc
  limit least(coalesce(p_limit, 6), 12);
$$;
revoke execute on function public.suggested_golfer_profiles(integer) from public, anon;
grant execute on function public.suggested_golfer_profiles(integer) to authenticated, service_role;
