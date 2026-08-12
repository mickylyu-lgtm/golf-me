-- profiles: 1:1 extension of auth.users, populated by the ProfileSetup
-- onboarding wizard. A stub row is auto-created (see handle_new_user below)
-- the moment someone signs up; has_onboarded stays false until the 4-step
-- wizard finishes, giving the client a real 3-state auth model:
--   no auth.users row            -> logged out
--   auth.users row, has_onboarded=false -> mid-onboarding
--   auth.users row, has_onboarded=true  -> fully set up
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,

  -- Identity (nullable until onboarding fills them in)
  name text,
  avatar_color text,
  avatar_initials text,
  photo_url text,
  age_range text check (age_range in ('18-24','25-34','35-44','45-54','55-64','65+')),
  gender text,
  bio text not null default '',

  -- Location — general area only, never an exact address (matches the
  -- existing client's privacy stance)
  area_label text,
  playing_area_lat double precision,
  playing_area_lng double precision,

  -- Golf basics
  handicap integer,
  favorite_courses text[] not null default '{}',
  walk_or_cart text check (walk_or_cart in ('Walking','Cart','Either')),
  vibes text[] not null default '{}',

  -- Budget & travel
  budget_min integer not null default 0,
  budget_max integer not null default 0,
  no_budget_preference boolean not null default false,
  travel_radius_miles integer not null default 25,

  -- Availability
  availability text[] not null default '{}',

  -- Match preferences (the 5 signals Auto-Match gates on; "No Preference"-
  -- shaped defaults match every existing golfer until a golfer opts in)
  preferred_courses text[] not null default '{}',
  handicap_preference_min integer not null default 0,
  handicap_preference_max integer not null default 36,
  age_preference_min integer not null default 18,
  age_preference_max integer not null default 75,
  no_age_preference boolean not null default true,
  gender_preference text not null default 'No preference'
    check (gender_preference in ('No preference','Men','Women','Prefer mixed group')),
  round_length_preference text not null default 'No Preference'
    check (round_length_preference in ('No Preference','9 Holes','18 Holes')),
  group_type_preference text not null default 'No Preference'
    check (group_type_preference in ('No Preference','New Golfers','People I Follow','Golf Circle','Mixed / Anyone')),
  game_format_preference text not null default 'No Preference'
    check (game_format_preference in ('No Preference','Standard Stroke Play','Match Play','Scramble','Best Ball','Practice / Casual Round')),
  networking_preference text not null default 'No Preference'
    check (networking_preference in ('No Preference','Not Looking to Network','Open to Networking','Business / Professional Networking')),

  -- Trust & verification
  phone_verified boolean not null default false,
  email_verified boolean not null default false,
  verified_golfer boolean not null default false,

  -- Reputation (denormalized counters, same shape as the existing mock;
  -- real aggregation from a future `reviews` table comes in a later phase)
  completed_rounds integer not null default 0,
  show_up_rate_pct integer not null default 0,
  would_play_again_pct integer not null default 0,
  on_time_pct integer not null default 0,
  respectful_pct integer not null default 0,
  good_pace_pct integer not null default 0,
  circle_size integer not null default 0,

  -- Onboarding / lifecycle
  has_onboarded boolean not null default false,
  member_since timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per golfer, 1:1 with auth.users. Stub row auto-created on signup by handle_new_user(); ProfileSetup fills it in and flips has_onboarded.';

alter table public.profiles enable row level security;

-- Any authenticated golfer can read any profile — needed for Find/Discover/
-- matching, mirrors the existing mock's "visibleGolfers()" behavior. No
-- anon (logged-out) read access.
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- A golfer can only ever modify their own row. UPDATE needs both USING and
-- WITH CHECK or a golfer could reassign someone else's row to themselves.
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Generic updated_at maintenance, reusable by later tables.
create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a stub profile the moment someone signs up. SECURITY DEFINER
-- is required here (the trigger fires as supabase_auth_admin, which has no
-- access to public.profiles otherwise) — scoped tightly per Supabase's own
-- documented pattern: search_path pinned to '', every reference fully
-- qualified, and it only ever does anything meaningful inside a genuine
-- AFTER INSERT ON auth.users trigger context (NEW is unassigned otherwise),
-- so direct RPC invocation by anon/authenticated is a no-op at worst.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
