-- ===========================================================================
-- Directory follow-ups: blocked-list names + search-area directory.
-- STAGING ONLY. NEVER RUN THIS ON PRODUCTION (golfme-dev, adokdenbmpshqgjbzshb).
-- Not a migration. One transaction, ROLLED BACK at the end.
-- ===========================================================================
-- Run AFTER 20261106130000_add_my_blocked_profiles and
-- 20261106130100_add_golfer_directory_from_origin (and the directory step 1
-- they build on). Requires the staging marker (scripts/staging/staging-setup.sql
-- on the global-hosting branch). Every check raises on failure; success
-- prints NOTICE "PASS <id>". Fixture ids dd100000-..., @example.invalid.
--
--   A  viewer, saved area NYC (40.68,-73.97)
--   B  NYC golfer (40.73,-73.99)         L  LA golfer (34.05,-118.24)
--   K  A blocked K                       M  A blocked M, and M blocked A back
--   Q  Q blocked A (A did not block Q)   O  an unrelated pair: O blocked B
-- ===========================================================================

begin;

do $$
begin
  if to_regclass('staging_meta.environment') is null
     or not exists (select 1 from staging_meta.environment where name = 'golfme-staging') then
    raise exception 'No staging marker: this is not the staging database. Nothing was changed.';
  end if;
  if to_regprocedure('public.my_blocked_profiles()') is null
     or to_regprocedure('public.golfer_directory_from(double precision, double precision, integer, integer)') is null then
    raise exception 'Apply 20261106130000 and 20261106130100 first.';
  end if;
  if exists (select 1 from auth.users where id::text like 'dd100000-0000-4000-8000-%') then
    raise exception 'Fixture ids already exist. Investigate first.';
  end if;
end $$;

insert into auth.users (id, email) values ('11be6983-7cd6-434d-bb52-6bfaf1d6e309', 'staging-founder@example.invalid')
  on conflict (id) do nothing;
insert into public.profiles (id) values ('11be6983-7cd6-434d-bb52-6bfaf1d6e309') on conflict (id) do nothing;

insert into auth.users (id, email)
select ('dd100000-0000-4000-8000-0000000000' || k)::uuid, 'stg-fu-' || k || '@example.invalid'
from unnest(array['a1','b2','c3','d4','e5','f6','f7']) as k;
insert into public.profiles (id)
select ('dd100000-0000-4000-8000-0000000000' || k)::uuid
from unnest(array['a1','b2','c3','d4','e5','f6','f7']) as k
on conflict (id) do nothing;

update public.profiles p set name = v.name, has_onboarded = true, discoverable = true,
  playing_area_lat = v.lat, playing_area_lng = v.lng, bio = 'fixture'
from (values
  ('dd100000-0000-4000-8000-0000000000a1'::uuid, 'Staging Viewer', 40.68, -73.97),
  ('dd100000-0000-4000-8000-0000000000b2'::uuid, 'Staging NYC', 40.73, -73.99),
  ('dd100000-0000-4000-8000-0000000000c3'::uuid, 'Staging LA', 34.05, -118.24),
  ('dd100000-0000-4000-8000-0000000000d4'::uuid, 'Staging Blocked', 40.70, -73.95),
  ('dd100000-0000-4000-8000-0000000000e5'::uuid, 'Staging Mutual', 40.70, -73.95),
  ('dd100000-0000-4000-8000-0000000000f6'::uuid, 'Staging Blocker', 40.70, -73.95),
  ('dd100000-0000-4000-8000-0000000000f7'::uuid, 'Staging Other', 40.70, -73.95)
) as v(id, name, lat, lng)
where p.id = v.id;

insert into public.blocks (blocker_id, blocked_id) values
  ('dd100000-0000-4000-8000-0000000000a1', 'dd100000-0000-4000-8000-0000000000d4'),  -- A blocked K
  ('dd100000-0000-4000-8000-0000000000a1', 'dd100000-0000-4000-8000-0000000000e5'),  -- A blocked M
  ('dd100000-0000-4000-8000-0000000000e5', 'dd100000-0000-4000-8000-0000000000a1'),  -- M blocked A back
  ('dd100000-0000-4000-8000-0000000000f6', 'dd100000-0000-4000-8000-0000000000a1'),  -- Q blocked A
  ('dd100000-0000-4000-8000-0000000000f7', 'dd100000-0000-4000-8000-0000000000b2');  -- O blocked B

-- Anon: neither new function.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare v_denied int := 0;
begin
  begin perform * from public.my_blocked_profiles(); exception when insufficient_privilege then v_denied := v_denied + 1; end;
  begin perform * from public.golfer_directory_from(34.05, -118.24, 10, 0); exception when insufficient_privilege then v_denied := v_denied + 1; end;
  assert v_denied = 2, 'anon could execute a follow-up function';
  raise notice 'PASS anon-denied';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- As A
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"dd100000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  keys text[];
  v_bucket text;
begin
  -- 1. Blocked list: names only for people A blocked who didn't block A back.
  assert exists (select 1 from public.my_blocked_profiles() where id = 'dd100000-0000-4000-8000-0000000000d4' and name = 'Staging Blocked'), 'K not named';
  assert not exists (select 1 from public.my_blocked_profiles() where id = 'dd100000-0000-4000-8000-0000000000e5'), 'M (blocked A back) named';
  assert not exists (select 1 from public.my_blocked_profiles() where id = 'dd100000-0000-4000-8000-0000000000f6'), 'Q (blocked A, not blocked by A) listed';
  assert not exists (select 1 from public.my_blocked_profiles() where id = 'dd100000-0000-4000-8000-0000000000b2'), 'someone else''s block listed';
  select array_agg(k) into keys from (select jsonb_object_keys(to_jsonb(b)) as k from public.my_blocked_profiles() b) s;
  assert keys <@ array['id','name','avatar_color','avatar_initials','photo_url'], 'blocked list leaks: ' || array_to_string(keys, ',');
  raise notice 'PASS blocked-names-rules';
  -- The rows the client lists regardless (its own blocks) are all readable.
  assert (select count(*) from public.blocks where blocker_id = 'dd100000-0000-4000-8000-0000000000a1') = 2, 'own blocks unreadable';
  -- The by-id lookup still hides all three (unchanged rule) -> the fallback label is needed.
  assert not exists (select 1 from public.golfer_public_profiles(array['dd100000-0000-4000-8000-0000000000d4','dd100000-0000-4000-8000-0000000000e5','dd100000-0000-4000-8000-0000000000f6']::uuid[])), 'by-id shows blocked';
  raise notice 'PASS byid-still-hides-blocked';

  -- 2. Other users' blocks: not readable.
  assert not exists (select 1 from public.blocks where blocker_id = 'dd100000-0000-4000-8000-0000000000f7'), 'A reads O''s block of B';
  raise notice 'PASS cannot-read-others-blocks';

  -- 3. Search-area directory: NYC home, LA search.
  select distance_bucket into v_bucket from public.golfer_directory(100, 0) where id = 'dd100000-0000-4000-8000-0000000000b2';
  assert v_bucket = 'within_5', 'home: NYC ' || coalesce(v_bucket, 'null');
  select distance_bucket into v_bucket from public.golfer_directory(100, 0) where id = 'dd100000-0000-4000-8000-0000000000c3';
  assert v_bucket = 'over_50', 'home: LA ' || coalesce(v_bucket, 'null');
  select distance_bucket into v_bucket from public.golfer_directory_from(34.05, -118.24, 100, 0) where id = 'dd100000-0000-4000-8000-0000000000c3';
  assert v_bucket = 'within_5', 'LA search: LA ' || coalesce(v_bucket, 'null');
  select distance_bucket into v_bucket from public.golfer_directory_from(34.05, -118.24, 100, 0) where id = 'dd100000-0000-4000-8000-0000000000b2';
  assert v_bucket = 'over_50', 'LA search: NYC ' || coalesce(v_bucket, 'null');
  raise notice 'PASS origin-buckets-nyc-home-la-search';

  -- Same rules as the home directory (blocks, never self).
  assert not exists (select 1 from public.golfer_directory_from(40.70, -73.95, 100, 0) where id in (
    'dd100000-0000-4000-8000-0000000000a1', 'dd100000-0000-4000-8000-0000000000d4',
    'dd100000-0000-4000-8000-0000000000e5', 'dd100000-0000-4000-8000-0000000000f6')), 'origin directory ignores rules';
  raise notice 'PASS origin-same-rules';

  -- Origin snapping: two origins inside one cell give identical answers.
  assert (select array_agg(id::text || ':' || coalesce(distance_bucket, '-') order by id) from public.golfer_directory_from(34.0501, -118.2401, 100, 0))
       = (select array_agg(id::text || ':' || coalesce(distance_bucket, '-') order by id) from public.golfer_directory_from(34.0999, -118.2001, 100, 0)),
    'origin not snapped to its cell';
  raise notice 'PASS origin-snapped';

  -- No coordinates in the response.
  select array_agg(k) into keys from (select jsonb_object_keys(to_jsonb(d)) as k from public.golfer_directory_from(34.05, -118.24, 1, 0) d) s;
  assert not (keys && array['playing_area_lat','playing_area_lng','lat','lng','origin_lat','origin_lng']), 'origin directory leaks coordinates';
  raise notice 'PASS origin-no-coordinates';

  -- Invalid origins are rejected, never silently treated as home.
  begin perform * from public.golfer_directory_from(null, -118.24, 10, 0); raise exception 'null accepted'; exception when invalid_parameter_value then null; end;
  begin perform * from public.golfer_directory_from(91, 0, 10, 0); raise exception 'lat 91 accepted'; exception when invalid_parameter_value then null; end;
  begin perform * from public.golfer_directory_from(0, 181, 10, 0); raise exception 'lng 181 accepted'; exception when invalid_parameter_value then null; end;
  begin perform * from public.golfer_directory_from('NaN', 0, 10, 0); raise exception 'NaN accepted'; exception when invalid_parameter_value then null; end;
  raise notice 'PASS origin-validated';
  assert (select count(*) from public.golfer_directory_from(34.05, -118.24, 1000, 0)) <= 100, 'limit not capped';
  raise notice 'PASS origin-limits';
end $$;

-- 4. A cannot change other people's blocks (RLS: insert/delete own only, no update).
insert into public.blocks (blocker_id, blocked_id)
select 'dd100000-0000-4000-8000-0000000000a1', 'dd100000-0000-4000-8000-0000000000c3';  -- own: allowed
do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.blocks (blocker_id, blocked_id) values ('dd100000-0000-4000-8000-0000000000b2', 'dd100000-0000-4000-8000-0000000000c3');
  exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'A inserted a block as B';
  raise notice 'PASS cannot-insert-as-other';
end $$;
delete from public.blocks where blocker_id = 'dd100000-0000-4000-8000-0000000000f6';      -- Q's block of A: RLS -> 0 rows
delete from public.blocks where blocker_id = 'dd100000-0000-4000-8000-0000000000f7';      -- O's block of B: 0 rows
update public.blocks set blocked_id = 'dd100000-0000-4000-8000-0000000000b2'
  where blocker_id = 'dd100000-0000-4000-8000-0000000000a1' and blocked_id = 'dd100000-0000-4000-8000-0000000000c3'; -- no update policy: 0 rows
-- Unblock (own row) works and is persisted.
delete from public.blocks where blocker_id = 'dd100000-0000-4000-8000-0000000000a1' and blocked_id = 'dd100000-0000-4000-8000-0000000000d4';
reset role;

do $$
begin
  assert exists (select 1 from public.blocks where blocker_id = 'dd100000-0000-4000-8000-0000000000f6' and blocked_id = 'dd100000-0000-4000-8000-0000000000a1'), 'A deleted Q''s block';
  assert exists (select 1 from public.blocks where blocker_id = 'dd100000-0000-4000-8000-0000000000f7'), 'A deleted O''s block';
  assert not exists (select 1 from public.blocks where blocker_id = 'dd100000-0000-4000-8000-0000000000a1' and blocked_id = 'dd100000-0000-4000-8000-0000000000b2'), 'A updated a block';
  assert not exists (select 1 from public.blocks where blocker_id = 'dd100000-0000-4000-8000-0000000000a1' and blocked_id = 'dd100000-0000-4000-8000-0000000000d4'), 'unblock not persisted';
  raise notice 'PASS others-blocks-untouched-and-unblock-persisted';
end $$;

-- 5. Deleted account: its block rows cascade away.
delete from auth.users where id = 'dd100000-0000-4000-8000-0000000000e5';
do $$
begin
  assert not exists (select 1 from public.blocks where blocker_id = 'dd100000-0000-4000-8000-0000000000e5' or blocked_id = 'dd100000-0000-4000-8000-0000000000e5'), 'blocks survived account deletion';
  raise notice 'PASS delete-cascades-blocks';
end $$;

rollback;
