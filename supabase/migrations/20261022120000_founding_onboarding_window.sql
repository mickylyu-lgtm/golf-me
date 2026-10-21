-- Founding Golfer: award at onboarding + 14-day correction window + admin
-- review (Micky's decision B, 2026-10-21). Prepared 2026-10-21, NOT applied.
-- Depends on 20261006120000 / 20261006120100 (applied). Independent of
-- 20261021120000 (Phase 2 place columns): it neither reads nor needs them.
--
-- What changes
--   Before: any save that moved an onboarded, un-numbered golfer's saved
--   coordinates into the zone awarded the next number, at any time.
--   After:
--     1. Qualifying onboarding (the save that first sets has_onboarded) is
--        unchanged: it calls private.award_founding_golfer() exactly as
--        before.
--     2. Correction window: a later move of the SAVED coordinates into the
--        zone within 14 days of onboarding still awards automatically, via
--        the same private.award_founding_golfer(), unless the move cap is
--        exceeded. Every such award is recorded in
--        public.founding_eligibility_reviews (status 'auto_awarded') with
--        abuse flags, so admins can review and, if needed, revoke with the
--        existing admin_revoke_founding_award().
--     3. Outside the window: no award. A move into the zone creates (or
--        refreshes) ONE pending manual-review row per golfer. An admin
--        approves (awards through the same private.award_founding_golfer(),
--        atomically, and only if the golfer is still eligible right then) or
--        dismisses it.
--
-- Abuse checks (constants in private.founding_on_location_change):
--   window           14 days from onboarding
--   move cap         at most 3 saved-coordinate changes after onboarding can
--                    lead to an automatic award; a 4th or later change that
--                    lands in the zone goes to manual review instead
--                    (reason 'correction_over_cap', flag 'move_cap_exceeded')
--   rapid_moves      flag: 3 or more saved-coordinate changes in 24 hours
--                    (recorded, does not block on its own)
--   far_jump         flag: the previous saved coordinates were more than
--                    500 miles from Midtown (recorded, does not block: a
--                    wrong-city pick is exactly what the window is for)
--   Only coordinate changes count; re-saving the same area, label edits,
--   bio edits and place-id/country/timezone/unit changes never count, never
--   call the award function and never create a review.
--
-- Transition rule for existing accounts (no backfill, no UPDATE of any row):
--   profiles.onboarded_at is new and stays NULL for accounts that onboarded
--   before this migration. Their window is measured from profiles.created_at
--   (signup, which always precedes onboarding, so the proxy can only make
--   the window shorter, never longer). So an existing golfer who signed up
--   less than 14 days before this is applied keeps the remainder of that
--   window; anyone older goes to manual review. Existing awards, the cohort
--   counter and every profile row are untouched by applying this file.
--
-- Unchanged on purpose: private.award_founding_golfer() (the only writer of
-- the ledger/counter/mirror), private.in_founding_zone(), the cap (250), the
-- append-only ledger and its guards, numbers never reused, the exclusion
-- roles, the confirmed-email rule, the trigger's column list and WHEN clause
-- (has_onboarded / playing_area_lat / playing_area_lng only), and the rule
-- that only saved profile coordinates count (never area_label text, never a
-- city search, never playing_area_place_id).

-- ---------------------------------------------------------------------------
-- 1. profiles.onboarded_at: when the account first finished onboarding.
-- ---------------------------------------------------------------------------
alter table public.profiles add column onboarded_at timestamptz;

comment on column public.profiles.onboarded_at is
  'When the account first set has_onboarded = true (server-stamped, clients cannot write it). NULL for accounts onboarded before 20261022120000; the Founding correction window then uses created_at.';

-- Stamps onboarded_at on the first has_onboarded transition and keeps
-- clients from writing it (they could otherwise reopen their own window).
-- SECURITY INVOKER so current_user is the real caller, same pattern as
-- guard_profile_founding_columns. A server-side reset of has_onboarded (the
-- admin test tool) keeps the original stamp, so re-onboarding is a later
-- save measured against the first onboarding.
create function public.profiles_stamp_onboarded_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.onboarded_at := null;
    else
      new.onboarded_at := old.onboarded_at;
    end if;
  end if;

  if new.has_onboarded and new.onboarded_at is null then
    if tg_op = 'INSERT' then
      new.onboarded_at := now();
    elsif not old.has_onboarded then
      new.onboarded_at := now();
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_stamp_onboarded_at() from public, anon, authenticated;

create trigger profiles_stamp_onboarded_at
  before insert or update on public.profiles
  for each row execute function public.profiles_stamp_onboarded_at();

-- ---------------------------------------------------------------------------
-- 2. Private move log (counts coordinate changes inside the window only).
-- ---------------------------------------------------------------------------
-- Stores no location at all: one timestamp per saved-coordinate change made
-- during a golfer's correction window, used for the move cap and the
-- rapid-moves flag. RLS on, no policies, no grants: no client role can read
-- or write it.
create table private.founding_location_moves (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  moved_at timestamptz not null default now()
);
create index founding_location_moves_user_idx on private.founding_location_moves (user_id, moved_at);
alter table private.founding_location_moves enable row level security;
revoke all on table private.founding_location_moves from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Admin-reviewable record (auto-awarded corrections + manual reviews).
-- ---------------------------------------------------------------------------
-- Distances, never coordinates: each row says how far (miles, 0.1 mi) the
-- previous and new saved areas were from Midtown, plus the area labels the
-- golfer already shows on their profile.
create table public.founding_eligibility_reviews (
  id bigint generated always as identity primary key,
  cohort text not null default 'nyc_2026' references public.founding_cohort_state (cohort),
  user_id uuid references auth.users (id) on delete set null,
  reason text not null check (reason in ('in_window_correction', 'correction_over_cap', 'outside_window')),
  status text not null check (status in ('auto_awarded', 'pending', 'approved', 'dismissed')),
  flags text[] not null default '{}'
    check (flags <@ array['far_jump', 'rapid_moves', 'move_cap_exceeded', 'no_previous_coordinates']::text[]),
  window_anchor_at timestamptz not null,
  window_anchor_source text not null check (window_anchor_source in ('onboarded_at', 'created_at')),
  window_ends_at timestamptz not null,
  counted_moves integer not null default 0 check (counted_moves >= 0),
  previous_area_label text check (char_length(previous_area_label) <= 200),
  previous_distance_mi numeric(7, 1),
  area_label text check (char_length(area_label) <= 200),
  distance_mi numeric(7, 1),
  member_number integer references public.founding_golfer_awards (member_number),
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text check (char_length(decision_note) <= 500),
  constraint founding_eligibility_reviews_state check (
    (status = 'auto_awarded' and reason = 'in_window_correction' and member_number is not null and decided_at is null)
    or (status = 'pending' and reason <> 'in_window_correction' and member_number is null and decided_at is null)
    or (status = 'approved' and reason <> 'in_window_correction' and member_number is not null and decided_at is not null)
    or (status = 'dismissed' and reason <> 'in_window_correction' and member_number is null and decided_at is not null)
  )
);
-- At most one open review per golfer; later moves refresh it.
create unique index founding_eligibility_reviews_one_pending
  on public.founding_eligibility_reviews (user_id) where status = 'pending';
create index founding_eligibility_reviews_user_id_idx
  on public.founding_eligibility_reviews (user_id);
create index founding_eligibility_reviews_status_idx
  on public.founding_eligibility_reviews (status, first_detected_at);
create index founding_eligibility_reviews_member_number_idx
  on public.founding_eligibility_reviews (member_number) where member_number is not null;
create index founding_eligibility_reviews_decided_by_idx
  on public.founding_eligibility_reviews (decided_by) where decided_by is not null;

alter table public.founding_eligibility_reviews enable row level security;
revoke all on table public.founding_eligibility_reviews from public, anon, authenticated;
grant select on table public.founding_eligibility_reviews to authenticated;
create policy founding_eligibility_reviews_select_admin on public.founding_eligibility_reviews
  for select to authenticated
  using (private.has_role((select auth.uid()), 'admin'));
-- No insert/update/delete grants or policies: only the SECURITY DEFINER
-- functions below write here.

-- ---------------------------------------------------------------------------
-- 4. Decision logic.
-- ---------------------------------------------------------------------------
create function private.founding_zone_distance_mi(p_lat double precision, p_lng double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  -- Same haversine as private.in_founding_zone (20261006120000).
  select case when p_lat is null or p_lng is null then null else
    2 * 3958.8 * asin(sqrt(
      power(sin(radians(p_lat - 40.7549) / 2), 2)
      + cos(radians(40.7549)) * cos(radians(p_lat))
        * power(sin(radians(p_lng - (-73.9840)) / 2), 2)
    )) end;
$$;
revoke execute on function private.founding_zone_distance_mi(double precision, double precision) from public, anon, authenticated;

-- Called only by the profile trigger below. Returns a short outcome code
-- (for tests and logs); never raises on purpose.
create function private.founding_on_location_change(
  p_user_id uuid,
  p_initial boolean,
  p_coords_changed boolean,
  p_prev_lat double precision,
  p_prev_lng double precision,
  p_prev_label text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_window constant interval := interval '14 days';
  c_max_counted_moves constant integer := 3;
  c_rapid_moves constant integer := 3;
  c_rapid_span constant interval := interval '24 hours';
  c_far_jump_miles constant double precision := 500;
  v_now timestamptz := now();
  v_p record;
  v_anchor timestamptz;
  v_anchor_source text;
  v_moves integer;
  v_recent integer;
  v_prev_dist double precision;
  v_new_dist double precision;
  v_flags text[] := '{}';
  v_number integer;
  v_reason text;
begin
  -- 1. Qualifying onboarding: exactly the pre-existing behaviour.
  if p_initial then
    v_number := private.award_founding_golfer(p_user_id);
    return case when v_number is null then 'onboarding_not_awarded' else 'onboarding_awarded' end;
  end if;

  -- Only a real change of the saved coordinates counts. A save that merely
  -- re-sends the same coordinates (or re-flips has_onboarded after an admin
  -- reset) never awards and never creates a review.
  if not p_coords_changed then
    return 'unchanged';
  end if;

  select p.has_onboarded, p.playing_area_lat, p.playing_area_lng, p.area_label,
         p.founding_member_number, p.onboarded_at, p.created_at, u.email_confirmed_at
    into v_p
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_user_id;

  if not found or v_p.founding_member_number is not null or not coalesce(v_p.has_onboarded, false) then
    return 'noop';
  end if;

  if v_p.onboarded_at is not null then
    v_anchor := v_p.onboarded_at;
    v_anchor_source := 'onboarded_at';
  else
    v_anchor := v_p.created_at;  -- transition rule (see header)
    v_anchor_source := 'created_at';
  end if;

  -- Count the move first (also moves that stay outside the zone), so the cap
  -- covers every coordinate change made during the window.
  if v_now < v_anchor + c_window then
    insert into private.founding_location_moves (user_id, moved_at) values (p_user_id, v_now);
  end if;

  if not private.in_founding_zone(v_p.playing_area_lat, v_p.playing_area_lng) then
    return 'outside_zone';
  end if;

  -- Base rules the award path enforces too. Checked here so nobody is put in
  -- front of an admin when an approval could never succeed.
  if v_p.email_confirmed_at is null
     or exists (
       select 1 from public.user_roles r
       where r.user_id = p_user_id and r.active
         and r.role in ('admin', 'test', 'app_reviewer', 'seeded', 'bot'))
     or exists (select 1 from public.founding_golfer_awards a where a.user_id = p_user_id) then
    return 'not_eligible';
  end if;
  if not exists (
    select 1 from public.founding_cohort_state s
    where s.cohort = 'nyc_2026' and s.is_open and s.closed_at is null and s.next_number <= s.cap) then
    return 'cohort_closed';
  end if;

  v_prev_dist := private.founding_zone_distance_mi(p_prev_lat, p_prev_lng);
  v_new_dist := private.founding_zone_distance_mi(v_p.playing_area_lat, v_p.playing_area_lng);
  if v_prev_dist is null then
    v_flags := v_flags || 'no_previous_coordinates'::text;
  elsif v_prev_dist > c_far_jump_miles then
    v_flags := v_flags || 'far_jump'::text;
  end if;

  if v_now < v_anchor + c_window then
    select count(*) filter (where m.moved_at >= v_anchor),
           count(*) filter (where m.moved_at > v_now - c_rapid_span)
      into v_moves, v_recent
    from private.founding_location_moves m
    where m.user_id = p_user_id;

    if v_recent >= c_rapid_moves then
      v_flags := v_flags || 'rapid_moves'::text;
    end if;

    if v_moves <= c_max_counted_moves then
      v_number := private.award_founding_golfer(p_user_id);
      if v_number is null then
        return 'not_awarded';
      end if;
      insert into public.founding_eligibility_reviews (
        user_id, reason, status, flags, window_anchor_at, window_anchor_source, window_ends_at,
        counted_moves, previous_area_label, previous_distance_mi, area_label, distance_mi, member_number)
      values (
        p_user_id, 'in_window_correction', 'auto_awarded', v_flags, v_anchor, v_anchor_source, v_anchor + c_window,
        v_moves, left(p_prev_label, 200), round(v_prev_dist::numeric, 1), left(v_p.area_label, 200),
        round(v_new_dist::numeric, 1), v_number);
      return 'correction_awarded';
    end if;

    v_flags := v_flags || 'move_cap_exceeded'::text;
    v_reason := 'correction_over_cap';
  else
    select count(*) filter (where m.moved_at >= v_anchor) into v_moves
    from private.founding_location_moves m
    where m.user_id = p_user_id;
    v_reason := 'outside_window';
  end if;

  insert into public.founding_eligibility_reviews (
    user_id, reason, status, flags, window_anchor_at, window_anchor_source, window_ends_at,
    counted_moves, previous_area_label, previous_distance_mi, area_label, distance_mi)
  values (
    p_user_id, v_reason, 'pending', v_flags, v_anchor, v_anchor_source, v_anchor + c_window,
    v_moves, left(p_prev_label, 200), round(v_prev_dist::numeric, 1), left(v_p.area_label, 200),
    round(v_new_dist::numeric, 1))
  on conflict (user_id) where status = 'pending' do update
    set reason = case when public.founding_eligibility_reviews.reason = 'correction_over_cap'
                      then 'correction_over_cap' else excluded.reason end,
        flags = array(select distinct f from unnest(public.founding_eligibility_reviews.flags || excluded.flags) f order by f),
        counted_moves = excluded.counted_moves,
        previous_area_label = excluded.previous_area_label,
        previous_distance_mi = excluded.previous_distance_mi,
        area_label = excluded.area_label,
        distance_mi = excluded.distance_mi,
        last_detected_at = v_now;
  return 'review';
end;
$$;
revoke execute on function private.founding_on_location_change(uuid, boolean, boolean, double precision, double precision, text) from public, anon, authenticated;

-- Same trigger (column list + WHEN unchanged), new body. Failures still
-- downgrade to a WARNING so a Founding check can never break a profile save.
create or replace function public.award_founding_golfer_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initial boolean;
  v_changed boolean;
begin
  begin
    if tg_op = 'INSERT' then
      v_initial := true;
      v_changed := true;
      perform private.founding_on_location_change(new.id, true, true, null, null, null);
    else
      -- First onboarding = has_onboarded was false and no earlier stamp
      -- exists (an admin-reset account keeps its first onboarded_at; a
      -- pre-migration account reset by the admin tool has none and is
      -- treated as onboarding again, as before this migration).
      v_initial := not old.has_onboarded and old.onboarded_at is null;
      v_changed := old.playing_area_lat is distinct from new.playing_area_lat
                   or old.playing_area_lng is distinct from new.playing_area_lng;
      perform private.founding_on_location_change(
        new.id, v_initial, v_changed, old.playing_area_lat, old.playing_area_lng, old.area_label);
    end if;
  exception when others then
    raise warning 'founding_on_location_change failed for %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end;
$$;
revoke execute on function public.award_founding_golfer_on_profile_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Admin RPCs (same private.has_role admin check as the other founding RPCs).
-- ---------------------------------------------------------------------------
create function public.admin_list_founding_reviews(p_status text default 'pending', p_limit integer default 100)
returns table (
  id bigint,
  user_id uuid,
  name text,
  username text,
  reason text,
  status text,
  flags text[],
  window_anchor_at timestamptz,
  window_anchor_source text,
  window_ends_at timestamptz,
  counted_moves integer,
  previous_area_label text,
  previous_distance_mi numeric,
  area_label text,
  distance_mi numeric,
  current_area_label text,
  current_in_zone boolean,
  member_number integer,
  first_detected_at timestamptz,
  last_detected_at timestamptz,
  decided_at timestamptz,
  decision_note text
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
  if p_status is not null and p_status not in ('auto_awarded', 'pending', 'approved', 'dismissed') then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;

  return query
  select r.id, r.user_id, p.name, p.username, r.reason, r.status, r.flags,
         r.window_anchor_at, r.window_anchor_source, r.window_ends_at, r.counted_moves,
         r.previous_area_label, r.previous_distance_mi, r.area_label, r.distance_mi,
         p.area_label, private.in_founding_zone(p.playing_area_lat, p.playing_area_lng),
         r.member_number, r.first_detected_at, r.last_detected_at, r.decided_at, r.decision_note
  from public.founding_eligibility_reviews r
  left join public.profiles p on p.id = r.user_id
  where p_status is null or r.status = p_status
  order by r.first_detected_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;
revoke execute on function public.admin_list_founding_reviews(text, integer) from public, anon;
grant execute on function public.admin_list_founding_reviews(text, integer) to authenticated;

-- Awards through the same private.award_founding_golfer() as onboarding, so
-- every live rule (saved coordinates in the zone right now, confirmed email,
-- onboarded, no exclusion role, never held a number, cohort open, row lock)
-- applies at approval time. If it can't award, nothing changes and the
-- review stays pending.
create function public.admin_approve_founding_review(p_review_id bigint, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review record;
  v_number integer;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select r.id, r.user_id, r.status into v_review
  from public.founding_eligibility_reviews r
  where r.id = p_review_id
  for update;
  if not found or v_review.status <> 'pending' then
    raise exception 'Pending review not found.' using errcode = 'P0002';
  end if;
  if v_review.user_id is null then
    raise exception 'The account no longer exists.' using errcode = 'P0002';
  end if;

  v_number := private.award_founding_golfer(v_review.user_id);
  if v_number is null then
    raise exception 'Not awarded: the golfer is not eligible right now (saved area outside the zone, unconfirmed email, excluded role, already held a number, or the cohort is full/closed).'
      using errcode = '55000';
  end if;

  update public.founding_eligibility_reviews
  set status = 'approved',
      member_number = v_number,
      decided_at = now(),
      decided_by = (select auth.uid()),
      decision_note = left(nullif(btrim(coalesce(p_note, '')), ''), 500)
  where id = v_review.id;

  return v_number;
end;
$$;
revoke execute on function public.admin_approve_founding_review(bigint, text) from public, anon;
grant execute on function public.admin_approve_founding_review(bigint, text) to authenticated;

create function public.admin_dismiss_founding_review(p_review_id bigint, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  update public.founding_eligibility_reviews
  set status = 'dismissed',
      decided_at = now(),
      decided_by = (select auth.uid()),
      decision_note = left(nullif(btrim(coalesce(p_note, '')), ''), 500)
  where id = p_review_id and status = 'pending';
  if not found then
    raise exception 'Pending review not found.' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.admin_dismiss_founding_review(bigint, text) from public, anon;
grant execute on function public.admin_dismiss_founding_review(bigint, text) to authenticated;
