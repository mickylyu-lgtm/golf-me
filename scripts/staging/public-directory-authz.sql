-- ===========================================================================
-- Public golfer directory: database authorization checks.
-- STAGING ONLY. NEVER RUN THIS ON PRODUCTION (golfme-dev, adokdenbmpshqgjbzshb).
-- Not a migration; never copy into supabase/migrations.
-- ===========================================================================
-- Run in the STAGING SQL editor (or psql as postgres) AFTER
-- 20261106120000_add_public_golfer_directory, and again after
-- 20261106120100_restrict_profiles_select_to_own_row: the table-access
-- section checks whichever select policy is in place.
--
-- One transaction, ROLLED BACK at the end: fixture accounts
-- (dd000000-...@example.invalid, never able to sign in) exist only inside
-- it. Requires the staging marker staging_meta.environment (created by
-- scripts/staging/staging-setup.sql on the global-hosting branch), so a
-- production run stops before any write. Acts as each fixture the way
-- PostgREST does (set local role authenticated + request.jwt.claims).
-- Every check raises on failure (the whole script stops); success prints
-- NOTICE lines "PASS <id>".
--
-- Fixtures (coords already 2-decimal like profiles_coarsen_location):
--   A  viewer, Brooklyn 40.68,-73.97          B  discoverable, Manhattan 40.73,-73.99 (~3.6 mi)
--   H  Discoverable off                       N  not onboarded
--   K  onboarded, blank name                  X  A blocked X       Y  Y blocked A
--   T  role test   R  role app_reviewer   S  role seeded   P  role pre_launch (stays listed)
--   F  the founder id with role admin (stays listed)
--   L  Los Angeles 34.05,-118.24              Z  no coordinates
-- ===========================================================================

begin;

do $$
begin
  if to_regclass('staging_meta.environment') is null
     or not exists (select 1 from staging_meta.environment where name = 'golfme-staging') then
    raise exception 'No staging marker: this is not the staging database. Nothing was changed.';
  end if;
  if to_regprocedure('public.golfer_directory(integer, integer)') is null then
    raise exception 'Apply 20261106120000_add_public_golfer_directory first.';
  end if;
  if exists (select 1 from auth.users where id::text like 'dd000000-0000-4000-8000-%') then
    raise exception 'Fixture ids already exist; a previous run committed? Investigate first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('11be6983-7cd6-434d-bb52-6bfaf1d6e309', 'staging-founder@example.invalid')
  on conflict (id) do nothing;
insert into public.profiles (id) values ('11be6983-7cd6-434d-bb52-6bfaf1d6e309') on conflict (id) do nothing;

insert into auth.users (id, email)
select ('dd000000-0000-4000-8000-0000000000' || k)::uuid, 'stg-dir-' || k || '@example.invalid'
from unnest(array['a1','b2','c3','d4','e5','e6','e7','f1','f2','f3','f4','f5','f6']) as k;
insert into public.profiles (id)
select ('dd000000-0000-4000-8000-0000000000' || k)::uuid
from unnest(array['a1','b2','c3','d4','e5','e6','e7','f1','f2','f3','f4','f5','f6']) as k
on conflict (id) do nothing;

update public.profiles set name = 'Staging Founder', has_onboarded = true, discoverable = true,
  playing_area_lat = 40.75, playing_area_lng = -73.98
  where id = '11be6983-7cd6-434d-bb52-6bfaf1d6e309';
update public.profiles p set
  name = v.name, has_onboarded = v.onb, discoverable = v.disc,
  playing_area_lat = v.lat, playing_area_lng = v.lng, gender = 'Man', bio = 'fixture'
from (values
  ('dd000000-0000-4000-8000-0000000000a1'::uuid, 'Staging A', true, true, 40.68, -73.97),
  ('dd000000-0000-4000-8000-0000000000b2'::uuid, 'Staging B', true, true, 40.73, -73.99),
  ('dd000000-0000-4000-8000-0000000000c3'::uuid, 'Staging Hidden', true, false, 40.69, -73.96),
  ('dd000000-0000-4000-8000-0000000000d4'::uuid, 'Staging Newbie', false, true, 40.69, -73.96),
  ('dd000000-0000-4000-8000-0000000000e5'::uuid, 'Staging Blocked', true, true, 40.69, -73.96),
  ('dd000000-0000-4000-8000-0000000000e6'::uuid, 'Staging Blocker', true, true, 40.69, -73.96),
  ('dd000000-0000-4000-8000-0000000000e7'::uuid, '   ', true, true, 40.69, -73.96),
  ('dd000000-0000-4000-8000-0000000000f1'::uuid, 'Staging Test', true, true, 40.69, -73.96),
  ('dd000000-0000-4000-8000-0000000000f2'::uuid, 'Staging Reviewer', true, true, 40.69, -73.96),
  ('dd000000-0000-4000-8000-0000000000f3'::uuid, 'Staging Seeded', true, true, 40.69, -73.96),
  ('dd000000-0000-4000-8000-0000000000f4'::uuid, 'Staging Prelaunch', true, true, 40.69, -73.96),
  ('dd000000-0000-4000-8000-0000000000f5'::uuid, 'Staging LA', true, true, 34.05, -118.24),
  ('dd000000-0000-4000-8000-0000000000f6'::uuid, 'Staging Nowhere', true, true, null, null)
) as v(id, name, onb, disc, lat, lng)
where p.id = v.id;

insert into public.blocks (blocker_id, blocked_id) values
  ('dd000000-0000-4000-8000-0000000000a1', 'dd000000-0000-4000-8000-0000000000e5'),
  ('dd000000-0000-4000-8000-0000000000e6', 'dd000000-0000-4000-8000-0000000000a1');

insert into public.user_roles (user_id, role, granted_by, active) values
  ('dd000000-0000-4000-8000-0000000000f1', 'test', null, true),
  ('dd000000-0000-4000-8000-0000000000f2', 'app_reviewer', null, true),
  ('dd000000-0000-4000-8000-0000000000f3', 'seeded', null, true),
  ('dd000000-0000-4000-8000-0000000000f4', 'pre_launch', null, true),
  ('11be6983-7cd6-434d-bb52-6bfaf1d6e309', 'admin', null, true)
on conflict (user_id, role) do update set active = true, revoked_at = null;

-- ---------------------------------------------------------------------------
-- Anon: no access at all
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare v_denied int := 0;
begin
  begin perform * from public.golfer_directory(10, 0); exception when insufficient_privilege then v_denied := v_denied + 1; end;
  begin perform * from public.golfer_public_profiles(array['dd000000-0000-4000-8000-0000000000b2'::uuid]); exception when insufficient_privilege then v_denied := v_denied + 1; end;
  begin perform * from public.search_golfer_profiles('Staging', 10); exception when insufficient_privilege then v_denied := v_denied + 1; end;
  assert v_denied = 3, 'anon could execute a directory RPC';
  assert (select count(*) from public.profiles) = 0, 'anon can read profiles';
  raise notice 'PASS anon-denied';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- As A
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"dd000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  ids uuid[];
  keys text[];
  v_bucket text;
begin
  select array_agg(id) into ids from public.golfer_directory(100, 0) where id::text like 'dd000000-%' or id = '11be6983-7cd6-434d-bb52-6bfaf1d6e309';

  assert 'dd000000-0000-4000-8000-0000000000b2' = any(ids), 'B missing from directory';
  raise notice 'PASS dir-includes-discoverable';
  assert not ('dd000000-0000-4000-8000-0000000000a1' = any(ids)), 'directory returned the caller';
  raise notice 'PASS dir-excludes-self';
  assert not ('dd000000-0000-4000-8000-0000000000c3' = any(ids)), 'hidden golfer listed';
  raise notice 'PASS dir-excludes-hidden';
  assert not ('dd000000-0000-4000-8000-0000000000d4' = any(ids)), 'non-onboarded golfer listed';
  assert not ('dd000000-0000-4000-8000-0000000000e7' = any(ids)), 'blank-name golfer listed';
  raise notice 'PASS dir-excludes-incomplete';
  assert not ('dd000000-0000-4000-8000-0000000000e5' = any(ids)), 'golfer A blocked is listed';
  assert not ('dd000000-0000-4000-8000-0000000000e6' = any(ids)), 'golfer who blocked A is listed';
  raise notice 'PASS dir-excludes-blocks-both-ways';
  assert not ('dd000000-0000-4000-8000-0000000000f1' = any(ids)), 'test account listed';
  assert not ('dd000000-0000-4000-8000-0000000000f2' = any(ids)), 'app reviewer listed';
  assert not ('dd000000-0000-4000-8000-0000000000f3' = any(ids)), 'seeded account listed';
  raise notice 'PASS dir-excludes-test-reviewer-seeded';
  assert 'dd000000-0000-4000-8000-0000000000f4' = any(ids), 'pre_launch golfer hidden';
  assert '11be6983-7cd6-434d-bb52-6bfaf1d6e309' = any(ids), 'founder hidden';
  raise notice 'PASS dir-keeps-prelaunch-and-founder';

  -- Narrow columns only: no coordinates, no gender, no private settings.
  select array_agg(k) into keys from (
    select jsonb_object_keys(to_jsonb(d)) as k from public.golfer_directory(1, 0) d
  ) s;
  assert not (keys && array['playing_area_lat','playing_area_lng','gender','push_enabled','notify_new_rounds','language',
    'travel_radius_miles','gender_preference','discoverable','has_onboarded','email_verified','phone_verified']),
    'directory leaks a private column: ' || array_to_string(keys, ',');
  raise notice 'PASS dir-narrow-columns';

  -- Distance buckets
  select distance_bucket into v_bucket from public.golfer_directory(100, 0) where id = 'dd000000-0000-4000-8000-0000000000b2';
  assert v_bucket = 'within_5', 'B bucket ' || coalesce(v_bucket, 'null');
  select distance_bucket into v_bucket from public.golfer_directory(100, 0) where id = 'dd000000-0000-4000-8000-0000000000f5';
  assert v_bucket = 'over_50', 'LA bucket ' || coalesce(v_bucket, 'null');
  assert exists (select 1 from public.golfer_directory(100, 0) where id = 'dd000000-0000-4000-8000-0000000000f6' and distance_bucket is null), 'no-coords golfer missing or has a bucket';
  raise notice 'PASS dir-distance-buckets';

  -- Limits / pagination
  assert (select count(*) from public.golfer_directory(1000, 0)) <= 100, 'limit not capped';
  assert (select count(*) from public.golfer_directory(1, 0)) = 1, 'limit 1';
  assert (select id from public.golfer_directory(1, 0)) is distinct from (select id from public.golfer_directory(1, 1)), 'offset does not page';
  raise notice 'PASS dir-limits';

  -- By id: relationships still resolve a hidden golfer; blocks never do.
  assert exists (select 1 from public.golfer_public_profiles(array['dd000000-0000-4000-8000-0000000000c3'::uuid])), 'hidden golfer not resolvable by id';
  assert not exists (select 1 from public.golfer_public_profiles(array['dd000000-0000-4000-8000-0000000000e5'::uuid, 'dd000000-0000-4000-8000-0000000000e6'::uuid])), 'blocked golfer resolvable by id';
  assert exists (select 1 from public.golfer_public_profiles(array['dd000000-0000-4000-8000-0000000000a1'::uuid]) where distance_bucket is null), 'own row by id';
  select array_agg(k) into keys from (
    select jsonb_object_keys(to_jsonb(d)) as k from public.golfer_public_profiles(array['dd000000-0000-4000-8000-0000000000b2'::uuid]) d
  ) s;
  assert not (keys && array['playing_area_lat','playing_area_lng','push_enabled','language','travel_radius_miles','discoverable']), 'by-id leaks a private column';
  assert (select count(*) from public.golfer_public_profiles((select array_agg(gen_random_uuid()) from generate_series(1, 500)))) = 0, 'random ids';
  raise notice 'PASS byid-rules';

  -- Search and suggestions apply the same discovery rules.
  assert not exists (select 1 from public.search_golfer_profiles('Staging', 25) where id in (
    'dd000000-0000-4000-8000-0000000000c3', 'dd000000-0000-4000-8000-0000000000d4', 'dd000000-0000-4000-8000-0000000000e5',
    'dd000000-0000-4000-8000-0000000000e6', 'dd000000-0000-4000-8000-0000000000f1', 'dd000000-0000-4000-8000-0000000000f2')), 'search leaks';
  assert exists (select 1 from public.search_golfer_profiles('Staging B', 25) where id = 'dd000000-0000-4000-8000-0000000000b2'), 'search misses B';
  assert not exists (select 1 from public.suggested_golfer_profiles(12) where id in (
    'dd000000-0000-4000-8000-0000000000c3', 'dd000000-0000-4000-8000-0000000000f1', 'dd000000-0000-4000-8000-0000000000f2')), 'suggestions leak';
  raise notice 'PASS search-suggest-rules';
end $$;

-- Own-row update works; someone else's row does not change.
update public.profiles set discoverable = false where id = 'dd000000-0000-4000-8000-0000000000a1';
update public.profiles set discoverable = false where id = 'dd000000-0000-4000-8000-0000000000b2';
do $$
begin
  assert (select discoverable from public.golfer_public_profiles(array['dd000000-0000-4000-8000-0000000000a1'::uuid]) g
          join public.profiles p using (id)) = false, 'own update did not apply';
  raise notice 'PASS own-update';
  assert (select count(*) from public.profiles where id = 'dd000000-0000-4000-8000-0000000000a1') = 1, 'own row unreadable';
  raise notice 'PASS own-read';
  -- Table access: depends on which phase is applied.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_own') then
    assert (select count(*) from public.profiles where id <> 'dd000000-0000-4000-8000-0000000000a1') = 0, 'phase 2: other rows readable';
    raise notice 'PASS phase2-table-own-row-only';
  else
    assert (select count(*) from public.profiles where id = 'dd000000-0000-4000-8000-0000000000c3') = 1, 'phase 1 expected broad read';
    raise notice 'INFO phase 1: the table is still broadly readable (apply phase 2 to close it)';
  end if;
end $$;
-- Hiding yourself never limits what you can browse.
do $$
begin
  assert exists (select 1 from public.golfer_directory(100, 0) where id = 'dd000000-0000-4000-8000-0000000000f4'), 'own flag limited browsing';
  raise notice 'PASS own-flag-does-not-limit-browsing';
end $$;
reset role;

do $$
begin
  assert (select discoverable from public.profiles where id = 'dd000000-0000-4000-8000-0000000000b2') = true, 'A changed B''s row';
  raise notice 'PASS cannot-update-others';
end $$;

-- B (not blocked by anyone) sees A disappear once A hid themself.
select set_config('request.jwt.claims', '{"sub":"dd000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  assert not exists (select 1 from public.golfer_directory(100, 0) where id = 'dd000000-0000-4000-8000-0000000000a1'), 'hidden A still listed for B';
  raise notice 'PASS hide-takes-effect';
end $$;
reset role;

-- Y (who blocked A) can't see A either, by list or by id.
select set_config('request.jwt.claims', '{"sub":"dd000000-0000-4000-8000-0000000000e6","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  assert not exists (select 1 from public.golfer_public_profiles(array['dd000000-0000-4000-8000-0000000000a1'::uuid])), 'blocker resolves blocked';
  raise notice 'PASS byid-block-reverse';
end $$;
reset role;

-- New-round alert about a hidden host carries no actor (as table owner, like the fan-out).
do $$
declare v_actor uuid;
begin
  insert into public.notifications (user_id, type, actor_id, text, link_to)
    values ('dd000000-0000-4000-8000-0000000000b2', 'new_round_nearby', 'dd000000-0000-4000-8000-0000000000c3', 'verify', '/golf-calls/verify')
    returning actor_id into v_actor;
  assert v_actor is null, 'hidden host named on alert';
  insert into public.notifications (user_id, type, actor_id, text, link_to)
    values ('dd000000-0000-4000-8000-0000000000b2', 'new_round_nearby', 'dd000000-0000-4000-8000-0000000000f4', 'verify', '/golf-calls/verify')
    returning actor_id into v_actor;
  assert v_actor = 'dd000000-0000-4000-8000-0000000000f4', 'visible host lost';
  raise notice 'PASS alert-actor';
end $$;

rollback;
