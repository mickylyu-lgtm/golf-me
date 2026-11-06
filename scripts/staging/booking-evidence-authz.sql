-- ===========================================================================
-- Booking status + evidence + review: role boundaries and lifecycle.
-- STAGING ONLY. NEVER RUN THIS ON PRODUCTION (golfme-dev, adokdenbmpshqgjbzshb).
-- Not a migration. One transaction, ROLLED BACK at the end.
-- ===========================================================================
-- Run AFTER 20261107150000_booking_status_and_evidence. Requires the staging
-- marker. Every check raises on failure; success prints NOTICE "PASS <id>".
-- Storage is exercised through storage.objects rows + RLS (what the Storage
-- API enforces with the caller's JWT); the HTTP API itself (signed URLs,
-- bucket MIME/size enforcement) is NOT exercised here.
-- Fixture ids bb200000-... (users), cc200000-... (rounds), @example.invalid.
--
--   H  host of RH (upcoming), RP (past), RC (to be cancelled)
--   M  joined member of RH          U  unrelated host of RU
--   A  admin (also a reviewer), hosts RA     R  booking_reviewer (not admin)
--   X  signed-in user, nothing to do with any of it
-- ===========================================================================

begin;

do $$
begin
  if to_regclass('staging_meta.environment') is null
     or not exists (select 1 from staging_meta.environment where name = 'golfme-staging') then
    raise exception 'No staging marker: this is not the staging database. Nothing was changed.';
  end if;
  if to_regclass('public.booking_evidence') is null
     or to_regprocedure('public.submit_booking_evidence(uuid, text, uuid, integer)') is null then
    raise exception 'Apply 20261107150000 first.';
  end if;
  if exists (select 1 from auth.users where id::text like 'bb200000-0000-4000-8000-%') then
    raise exception 'Fixture ids already exist. Investigate first.';
  end if;
end $$;

-- Supabase blocks direct storage.objects deletes unless this is set; the
-- deletes below are what the Storage API runs under the caller's RLS.
select set_config('storage.allow_delete_query', 'true', true);

insert into auth.users (id, email)
select ('bb200000-0000-4000-8000-0000000000' || k)::uuid, 'stg-bk-' || k || '@example.invalid'
from unnest(array['a1','b2','c3','d4','e5','f6']) as k;
insert into public.profiles (id)
select ('bb200000-0000-4000-8000-0000000000' || k)::uuid from unnest(array['a1','b2','c3','d4','e5','f6']) as k
on conflict (id) do nothing;
update public.profiles p set name = v.name, language = v.lang
from (values
  ('bb200000-0000-4000-8000-0000000000a1'::uuid, 'Stg Host', 'en'),
  ('bb200000-0000-4000-8000-0000000000b2'::uuid, 'Stg Member', 'es'),
  ('bb200000-0000-4000-8000-0000000000c3'::uuid, 'Stg Other Host', 'en'),
  ('bb200000-0000-4000-8000-0000000000d4'::uuid, 'Stg Admin', 'en'),
  ('bb200000-0000-4000-8000-0000000000e5'::uuid, 'Stg Reviewer', 'en'),
  ('bb200000-0000-4000-8000-0000000000f6'::uuid, 'Stg Stranger', 'en')
) as v(id, name, lang) where p.id = v.id;
insert into public.user_roles (user_id, role) values
  ('bb200000-0000-4000-8000-0000000000d4', 'admin'),
  ('bb200000-0000-4000-8000-0000000000e5', 'booking_reviewer');

insert into public.golf_calls (id, host_user_id, course_name, date_iso, tee_time_label, total_spots) values
  ('cc200000-0000-4000-8000-0000000000a1', 'bb200000-0000-4000-8000-0000000000a1', 'Stg Dyker Beach', now() + interval '3 days', '9:00 AM', 4),
  ('cc200000-0000-4000-8000-0000000000c3', 'bb200000-0000-4000-8000-0000000000c3', 'Stg Skyway', now() + interval '3 days', '10:00 AM', 4),
  ('cc200000-0000-4000-8000-0000000000d4', 'bb200000-0000-4000-8000-0000000000d4', 'Stg Admin Course', now() + interval '3 days', '11:00 AM', 4),
  ('cc200000-0000-4000-8000-0000000000e1', 'bb200000-0000-4000-8000-0000000000a1', 'Stg Past Course', now() - interval '3 days', '9:00 AM', 4),
  ('cc200000-0000-4000-8000-0000000000e2', 'bb200000-0000-4000-8000-0000000000a1', 'Stg Cancel Course', now() + interval '4 days', '8:00 AM', 4);
insert into public.round_participants (round_id, user_id) values
  ('cc200000-0000-4000-8000-0000000000a1', 'bb200000-0000-4000-8000-0000000000a1'),
  ('cc200000-0000-4000-8000-0000000000a1', 'bb200000-0000-4000-8000-0000000000b2'),
  ('cc200000-0000-4000-8000-0000000000c3', 'bb200000-0000-4000-8000-0000000000c3'),
  ('cc200000-0000-4000-8000-0000000000d4', 'bb200000-0000-4000-8000-0000000000d4'),
  ('cc200000-0000-4000-8000-0000000000e2', 'bb200000-0000-4000-8000-0000000000a1'),
  ('cc200000-0000-4000-8000-0000000000e2', 'bb200000-0000-4000-8000-0000000000b2');

-- ---------------------------------------------------------------------------
-- 1. Anon: nothing.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare v_denied int := 0;
begin
  begin perform public.set_booking_status('cc200000-0000-4000-8000-0000000000a1', 'booked', null, null, 0); exception when insufficient_privilege then v_denied := v_denied + 1; end;
  begin perform * from public.submit_booking_evidence('cc200000-0000-4000-8000-0000000000a1', 'x', gen_random_uuid(), 0); exception when insufficient_privilege then v_denied := v_denied + 1; end;
  begin perform * from public.my_booking_evidence('cc200000-0000-4000-8000-0000000000a1'); exception when insufficient_privilege then v_denied := v_denied + 1; end;
  begin perform * from public.list_booking_evidence_queue(10); exception when insufficient_privilege then v_denied := v_denied + 1; end;
  begin perform public.review_booking_evidence(gen_random_uuid(), 'reviewed', null, null, 0); exception when insufficient_privilege then v_denied := v_denied + 1; end;
  begin perform 1 from public.booking_evidence; exception when insufficient_privilege then v_denied := v_denied + 1; end;
  begin perform 1 from public.booking_evidence_reviews; exception when insufficient_privilege then v_denied := v_denied + 1; end;
  assert v_denied = 7, 'anon reached a booking function or table (' || v_denied || '/7 denied)';
  assert not exists (select 1 from storage.objects where bucket_id = 'booking-proofs'), 'anon sees booking-proofs objects';
  raise notice 'PASS anon-denied';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 2. The forged-badge path is closed (host H, round RH still 'unknown').
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"bb200000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_ok boolean;
begin
  -- Old RPC retired.
  v_ok := false;
  begin perform public.attach_booking_proof('cc200000-0000-4000-8000-0000000000a1', 'nothing/here.pdf', 'pdf', 'Confirmed directly by the course - guaranteed', null);
  exception when feature_not_supported then v_ok := true; end;
  assert v_ok, 'attach_booking_proof still works';
  -- Evidence before claiming a booking: refused.
  v_ok := false;
  begin perform * from public.submit_booking_evidence('cc200000-0000-4000-8000-0000000000a1',
    'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/11111111-1111-4111-8111-111111111111.jpg', gen_random_uuid(), 0);
  exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'evidence accepted on an unbooked round';
  -- Direct writes to every trust column: refused.
  v_ok := false;
  begin update public.golf_calls set evidence_status = 'reviewed', evidence_reviewed_at = now() where id = 'cc200000-0000-4000-8000-0000000000a1';
  exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'host wrote evidence_status directly';
  v_ok := false;
  begin update public.golf_calls set booking_status = 'booked' where id = 'cc200000-0000-4000-8000-0000000000a1';
  exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'host wrote booking_status directly';
  v_ok := false;
  begin update public.golf_calls set tee_time_source = 'user_verified' where id = 'cc200000-0000-4000-8000-0000000000a1';
  exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'host wrote tee_time_source directly';
  -- Free-text public source: refused.
  v_ok := false;
  begin perform public.set_booking_status('cc200000-0000-4000-8000-0000000000a1', 'booked', 2::smallint, 'Confirmed directly by the course - guaranteed', 0);
  exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'free-text booking source accepted';
  raise notice 'PASS forged-badge-closed';
end $$;

-- A direct round insert can't start booked or reviewed.
insert into public.golf_calls (id, host_user_id, course_name, date_iso, tee_time_label, total_spots, booking_status, evidence_status, evidence_reviewed_at, booking_version)
values ('cc200000-0000-4000-8000-0000000000f9', 'bb200000-0000-4000-8000-0000000000a1', 'Stg Direct', now() + interval '2 days', '9 AM', 4, 'booked', 'reviewed', now(), 7);
do $$
begin
  assert (select booking_status = 'unknown' and evidence_status = 'none' and evidence_reviewed_at is null and booking_version = 0
          from public.golf_calls where id = 'cc200000-0000-4000-8000-0000000000f9'), 'direct insert kept trust values';
  raise notice 'PASS insert-forced-defaults';
end $$;

-- Claim the booking (party 3 via GolfNow) and upload evidence.
select public.set_booking_status('cc200000-0000-4000-8000-0000000000a1', 'booked', 3::smallint, 'GolfNow', 0);
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('booking-proofs', 'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/11111111-1111-4111-8111-111111111111.jpg',
   'bb200000-0000-4000-8000-0000000000a1', '{"mimetype":"image/jpeg","size":120000}'),
  ('booking-proofs', 'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/22222222-2222-4222-8222-222222222222.jpg',
   'bb200000-0000-4000-8000-0000000000a1', '{"mimetype":"image/jpeg","size":6000000}'),
  ('booking-proofs', 'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/33333333-3333-4333-8333-333333333333.jpg',
   'bb200000-0000-4000-8000-0000000000a1', '{"mimetype":"image/png","size":1000}');
do $$
declare v_ok boolean; v_id uuid; v_id2 uuid; v_cnt int;
begin
  -- Upload outside a hosted live round / wrong name: refused by storage RLS.
  v_ok := false;
  begin insert into storage.objects (bucket_id, name, owner_id) values ('booking-proofs', 'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000c3/44444444-4444-4444-8444-444444444444.jpg', 'bb200000-0000-4000-8000-0000000000a1');
  exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'upload into another host''s round folder';
  v_ok := false;
  begin insert into storage.objects (bucket_id, name, owner_id) values ('booking-proofs', 'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000e1/44444444-4444-4444-8444-444444444444.jpg', 'bb200000-0000-4000-8000-0000000000a1');
  exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'upload into a past round';  -- RP is still 'open' but its day is over
  v_ok := false;
  begin insert into storage.objects (bucket_id, name, owner_id) values ('booking-proofs', 'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/page.html', 'bb200000-0000-4000-8000-0000000000a1');
  exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'non-jpg name accepted';
  -- Missing object, other user's path, oversize, wrong type: refused.
  v_ok := false;
  begin perform * from public.submit_booking_evidence('cc200000-0000-4000-8000-0000000000a1', 'nothing/here.pdf', gen_random_uuid(), 1);
  exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'path outside own round folder accepted';
  v_ok := false;
  begin perform * from public.submit_booking_evidence('cc200000-0000-4000-8000-0000000000a1',
    'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/99999999-9999-4999-8999-999999999999.jpg', gen_random_uuid(), 1);
  exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'missing object accepted (badge without upload)';
  v_ok := false;
  begin perform * from public.submit_booking_evidence('cc200000-0000-4000-8000-0000000000a1',
    'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/22222222-2222-4222-8222-222222222222.jpg', gen_random_uuid(), 1);
  exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'oversize accepted';
  v_ok := false;
  begin perform * from public.submit_booking_evidence('cc200000-0000-4000-8000-0000000000a1',
    'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/33333333-3333-4333-8333-333333333333.jpg', gen_random_uuid(), 1);
  exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'png accepted';
  -- Stale version: refused.
  v_ok := false;
  begin perform * from public.submit_booking_evidence('cc200000-0000-4000-8000-0000000000a1',
    'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/11111111-1111-4111-8111-111111111111.jpg', gen_random_uuid(), 0);
  exception when serialization_failure then v_ok := true; end;
  assert v_ok, 'stale booking_version accepted';
  -- Real submit, then a retry with the same request id: one version.
  select evidence_id into v_id from public.submit_booking_evidence('cc200000-0000-4000-8000-0000000000a1',
    'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/11111111-1111-4111-8111-111111111111.jpg', 'dddddddd-0000-4000-8000-000000000001', 1);
  select evidence_id into v_id2 from public.submit_booking_evidence('cc200000-0000-4000-8000-0000000000a1',
    'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/11111111-1111-4111-8111-111111111111.jpg', 'dddddddd-0000-4000-8000-000000000001', 1);
  assert v_id = v_id2, 'retry created a second version';
  select count(*) into v_cnt from public.booking_evidence where golf_call_id = 'cc200000-0000-4000-8000-0000000000a1';
  assert v_cnt = 1, 'versions after retry: ' || v_cnt;
  assert (select evidence_status = 'submitted' and evidence_reviewed_at is null and tee_time_source = 'user_verified'
          from public.golf_calls where id = 'cc200000-0000-4000-8000-0000000000a1'), 'upload moved past submitted';
  -- Host can't delete the file of current evidence (badge can't outlive it).
  delete from storage.objects where name = 'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/11111111-1111-4111-8111-111111111111.jpg';
  assert exists (select 1 from storage.objects where name = 'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/11111111-1111-4111-8111-111111111111.jpg'), 'current evidence file deleted directly';
  -- Host sees own status, not reviews.
  assert (select status from public.my_booking_evidence('cc200000-0000-4000-8000-0000000000a1')) = 'submitted', 'host my_booking_evidence';
  assert not exists (select 1 from public.booking_evidence_reviews), 'host reads review audit';
  -- Host can't review (not a reviewer).
  v_ok := false;
  begin perform public.review_booking_evidence(v_id, 'reviewed', null, null, 1); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'host reviewed own evidence';
  raise notice 'PASS submit-rules';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 3. Other members, unrelated hosts, strangers: no evidence, no changes.
-- ---------------------------------------------------------------------------
do $$
declare
  who text;
  v_ok boolean;
begin
  foreach who in array array['bb200000-0000-4000-8000-0000000000b2', 'bb200000-0000-4000-8000-0000000000c3', 'bb200000-0000-4000-8000-0000000000f6'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    assert not exists (select 1 from public.booking_evidence), who || ' reads booking_evidence';
    assert not exists (select 1 from public.booking_evidence_reviews), who || ' reads reviews';
    assert not exists (select 1 from storage.objects where bucket_id = 'booking-proofs'), who || ' sees evidence objects (could sign a URL)';
    assert not exists (select 1 from public.my_booking_evidence('cc200000-0000-4000-8000-0000000000a1')), who || ' my_booking_evidence of RH';
    v_ok := false;
    begin perform public.set_booking_status('cc200000-0000-4000-8000-0000000000a1', 'cancelled', null, null, 1); exception when insufficient_privilege then v_ok := true; end;
    assert v_ok, who || ' changed RH booking';
    v_ok := false;
    begin perform public.withdraw_booking_evidence('cc200000-0000-4000-8000-0000000000a1'); exception when insufficient_privilege then v_ok := true; end;
    assert v_ok, who || ' withdrew RH evidence';
    v_ok := false;
    begin perform * from public.list_booking_evidence_queue(10); exception when insufficient_privilege then v_ok := true; end;
    assert v_ok, who || ' listed the review queue';
    delete from storage.objects where bucket_id = 'booking-proofs';
    update public.golf_calls set evidence_status = 'none' where id = 'cc200000-0000-4000-8000-0000000000a1';
    reset role;
  end loop;
  assert (select count(*) from storage.objects where bucket_id = 'booking-proofs' and name like 'bb200000-0000-4000-8000-0000000000a1/%') = 3, 'someone deleted H''s files';
  assert (select evidence_status from public.golf_calls where id = 'cc200000-0000-4000-8000-0000000000a1') = 'submitted', 'someone changed RH';
  raise notice 'PASS others-isolated';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Review: reviewer R. Wrong version refused; then reviewed.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"bb200000-0000-4000-8000-0000000000e5","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_ok boolean; v_id uuid;
begin
  select evidence_id into v_id from public.list_booking_evidence_queue(10) where golf_call_id = 'cc200000-0000-4000-8000-0000000000a1';
  assert v_id is not null, 'reviewer queue misses RH';
  assert exists (select 1 from storage.objects where name = 'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/11111111-1111-4111-8111-111111111111.jpg'), 'reviewer can''t see the current file';
  assert not exists (select 1 from storage.objects where name like '%22222222-2222-4222-8222-222222222222.jpg'), 'reviewer sees a non-evidence file';
  v_ok := false;
  begin perform public.review_booking_evidence(v_id, 'reviewed', null, null, 0); exception when serialization_failure then v_ok := true; end;
  assert v_ok, 'stale review accepted';
  v_ok := false;
  begin perform public.review_booking_evidence(v_id, 'rejected', null, null, 1); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'rejection without a reason accepted';
  perform public.review_booking_evidence(v_id, 'reviewed', null, null, 1);
  raise notice 'PASS review-version-guard';
end $$;
reset role;
do $$
begin
  assert (select evidence_status = 'reviewed' and evidence_reviewed_at is not null from public.golf_calls where id = 'cc200000-0000-4000-8000-0000000000a1'), 'review not recorded';
  assert (select count(*) from public.booking_evidence_reviews where golf_call_id = 'cc200000-0000-4000-8000-0000000000a1' and reviewer_id = 'bb200000-0000-4000-8000-0000000000e5') = 1, 'audit row';
  assert exists (select 1 from public.notifications where user_id = 'bb200000-0000-4000-8000-0000000000a1' and type = 'booking_evidence_reviewed'), 'host not told';
  assert not exists (select 1 from public.notifications where user_id = 'bb200000-0000-4000-8000-0000000000b2' and type = 'booking_evidence_reviewed'), 'member told about a review';
  raise notice 'PASS review-recorded';
end $$;

-- Self-review: admin A on A's own round.
select set_config('request.jwt.claims', '{"sub":"bb200000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
set local role authenticated;
select public.set_booking_status('cc200000-0000-4000-8000-0000000000d4', 'booked', null, null, 0);
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('booking-proofs', 'bb200000-0000-4000-8000-0000000000d4/cc200000-0000-4000-8000-0000000000d4/55555555-5555-4555-8555-555555555555.jpg',
   'bb200000-0000-4000-8000-0000000000d4', '{"mimetype":"image/jpeg","size":2000}');
do $$
declare v_ok boolean := false; v_id uuid;
begin
  select evidence_id into v_id from public.submit_booking_evidence('cc200000-0000-4000-8000-0000000000d4',
    'bb200000-0000-4000-8000-0000000000d4/cc200000-0000-4000-8000-0000000000d4/55555555-5555-4555-8555-555555555555.jpg', gen_random_uuid(), 1);
  assert not exists (select 1 from public.list_booking_evidence_queue(50) where golf_call_id = 'cc200000-0000-4000-8000-0000000000d4'), 'own round offered for review';
  begin perform public.review_booking_evidence(v_id, 'reviewed', null, null, 1); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'admin reviewed own round';
  raise notice 'PASS no-self-review';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 5. Edit tee time -> "changed", evidence + review invalidated, one notice.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"bb200000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select * from public.edit_golf_call_tee_time('cc200000-0000-4000-8000-0000000000a1', null, 'Stg Dyker Beach', '', null, null,
  (select date_iso from public.golf_calls where id = 'cc200000-0000-4000-8000-0000000000a1'), '7:30 AM');
reset role;
do $$
begin
  assert (select booking_status = 'changed' and evidence_status = 'none' and evidence_reviewed_at is null and booking_version = 2 and tee_time_source = 'manual'
          from public.golf_calls where id = 'cc200000-0000-4000-8000-0000000000a1'), 'edit left a badge';
  assert (select status from public.booking_evidence where storage_path like '%11111111-1111-4111-8111-111111111111.jpg') = 'invalidated', 'evidence not invalidated';
  assert (select count(*) from public.notifications where user_id = 'bb200000-0000-4000-8000-0000000000b2' and type = 'tee_time_updated') = 1, 'member tee-time notice';
  assert not exists (select 1 from public.notifications where user_id = 'bb200000-0000-4000-8000-0000000000b2' and type = 'booking_status_changed'), 'second notice for one edit';
  raise notice 'PASS edit-invalidates';
end $$;
select set_config('request.jwt.claims', '{"sub":"bb200000-0000-4000-8000-0000000000e5","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_ok boolean := false;
begin
  begin perform public.review_booking_evidence((select id from public.booking_evidence where storage_path like '%11111111-1111-4111-8111-111111111111.jpg'), 'reviewed', null, null, 2);
  exception when serialization_failure then v_ok := true; end;
  assert v_ok, 'invalidated evidence reviewed';
  assert not exists (select 1 from storage.objects where name like '%11111111-1111-4111-8111-111111111111.jpg'), 'reviewer still sees an invalidated file';
  raise notice 'PASS no-review-of-outdated';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 6. Replace: reviewed -> new upload supersedes; host cancels booking.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"bb200000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.set_booking_status('cc200000-0000-4000-8000-0000000000a1', 'booked', 3::smallint, 'GolfNow', 2);
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('booking-proofs', 'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/66666666-6666-4666-8666-666666666666.jpg',
   'bb200000-0000-4000-8000-0000000000a1', '{"mimetype":"image/jpeg","size":3000}'),
  ('booking-proofs', 'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/77777777-7777-4777-8777-777777777777.jpg',
   'bb200000-0000-4000-8000-0000000000a1', '{"mimetype":"image/jpeg","size":3000}');
select * from public.submit_booking_evidence('cc200000-0000-4000-8000-0000000000a1',
  'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/66666666-6666-4666-8666-666666666666.jpg', gen_random_uuid(), 3);
reset role;
select set_config('request.jwt.claims', '{"sub":"bb200000-0000-4000-8000-0000000000e5","role":"authenticated"}', true);
set local role authenticated;
select public.review_booking_evidence((select evidence_id from public.list_booking_evidence_queue(10) where golf_call_id = 'cc200000-0000-4000-8000-0000000000a1'), 'reviewed', null, null, 3);
reset role;
select set_config('request.jwt.claims', '{"sub":"bb200000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_old text;
begin
  select superseded_path into v_old from public.submit_booking_evidence('cc200000-0000-4000-8000-0000000000a1',
    'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/77777777-7777-4777-8777-777777777777.jpg', gen_random_uuid(), 3);
  assert v_old like '%66666666-6666-4666-8666-666666666666.jpg', 'superseded path not returned';
  assert (select evidence_status = 'submitted' and evidence_reviewed_at is null from public.golf_calls where id = 'cc200000-0000-4000-8000-0000000000a1'), 'replacement kept the reviewed badge';
  -- Old file is no longer current: the host may delete it now.
  delete from storage.objects where name = v_old;
  assert not exists (select 1 from storage.objects where name = v_old), 'superseded file not deletable';
  raise notice 'PASS replace-drops-review';
end $$;
select public.set_booking_status('cc200000-0000-4000-8000-0000000000a1', 'cancelled', null, null, 3);
reset role;
do $$
begin
  assert (select booking_status = 'cancelled' and evidence_status = 'none' and booking_party_size is null and booking_source is null
          from public.golf_calls where id = 'cc200000-0000-4000-8000-0000000000a1'), 'booking cancel left evidence';
  assert (select count(*) from public.notifications where user_id = 'bb200000-0000-4000-8000-0000000000b2' and type = 'booking_status_changed') = 1, 'member not told about the cancelled booking';
  assert (select status from public.golf_calls where id = 'cc200000-0000-4000-8000-0000000000a1') = 'open', 'booking cancel cancelled the GolfMe round';
  raise notice 'PASS booking-cancel';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Group cancel closes evidence, keeps the booking claim; past round frozen.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"bb200000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.set_booking_status('cc200000-0000-4000-8000-0000000000e2', 'booked', null, 'Phone Reservation', 0);
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('booking-proofs', 'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000e2/88888888-8888-4888-8888-888888888888.jpg',
   'bb200000-0000-4000-8000-0000000000a1', '{"mimetype":"image/jpeg","size":3000}');
select * from public.submit_booking_evidence('cc200000-0000-4000-8000-0000000000e2',
  'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000e2/88888888-8888-4888-8888-888888888888.jpg', gen_random_uuid(), 1);
update public.golf_calls set status = 'cancelled' where id = 'cc200000-0000-4000-8000-0000000000e2';
do $$
declare v_ok boolean := false;
begin
  begin perform public.set_booking_status('cc200000-0000-4000-8000-0000000000e1', 'booked', null, null, 0); exception when invalid_parameter_value then v_ok := true; end;
  assert v_ok, 'past round booking changed';
  raise notice 'PASS past-round-frozen';
end $$;
reset role;
do $$
begin
  assert (select status = 'cancelled' and booking_status = 'booked' and evidence_status = 'none' and tee_time_source = 'manual'
          from public.golf_calls where id = 'cc200000-0000-4000-8000-0000000000e2'), 'group cancel state';
  assert (select status from public.booking_evidence where golf_call_id = 'cc200000-0000-4000-8000-0000000000e2') = 'withdrawn', 'evidence not closed on cancel';
  raise notice 'PASS group-cancel-closes-evidence';
end $$;

-- ---------------------------------------------------------------------------
-- 8. Retention sweep: admin only.
-- ---------------------------------------------------------------------------
update public.booking_evidence set closed_at = now() - interval '8 days' where golf_call_id = 'cc200000-0000-4000-8000-0000000000e2';
select set_config('request.jwt.claims', '{"sub":"bb200000-0000-4000-8000-0000000000e5","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_ok boolean := false;
begin
  begin perform * from public.admin_booking_evidence_sweep(); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'non-admin reviewer ran the sweep';
  raise notice 'PASS sweep-admin-only';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"bb200000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_paths text[];
begin
  select array_agg(storage_path) into v_paths from public.admin_booking_evidence_sweep();
  assert 'bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000e2/88888888-8888-4888-8888-888888888888.jpg' = any (v_paths), 'closed > 7 days not swept';
  assert not ('bb200000-0000-4000-8000-0000000000a1/cc200000-0000-4000-8000-0000000000a1/77777777-7777-4777-8777-777777777777.jpg' = any (coalesce(v_paths, '{}'))), 'recently closed swept early';
  assert not exists (select 1 from unnest(v_paths) p where p like '%55555555-5555-4555-8555-555555555555.jpg'), 'current evidence swept';
  raise notice 'PASS sweep-candidates';
end $$;
reset role;

rollback;
