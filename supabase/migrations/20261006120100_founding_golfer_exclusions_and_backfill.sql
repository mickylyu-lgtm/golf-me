-- Founding Golfer exclusions + opening + backfill, 2026-10-06.
-- Depends on 20261006120000_add_founding_golfer_cohort.sql.
--
-- Order matters and is all one transaction:
--   1. grant exclusion roles (before anything can be awarded),
--   2. open the cohort,
--   3. award every existing eligible, non-excluded account through the SAME
--      private.award_founding_golfer() the live trigger uses, oldest
--      auth.users.created_at first, so numbering is consistent with the
--      live rules (#1 = earliest eligible signup),
--   4. abort the whole migration unless exactly the expected set was awarded.
--
-- The founder account (11be6983-7cd6-434d-bb52-6bfaf1d6e309) already holds
-- an active 'admin' role (20260818040000 bootstrap), which excludes it -- it
-- never consumes a number.

-- Exclusion list confirmed by Micky 2026-10-12. The 'test' accounts below are
-- a ONE-OFF backfill judgment (onboarded accounts without a clear first +
-- last name); it is NOT a rule for future signups.
do $$
declare
  v_exclusions_confirmed constant boolean := true;
begin
  if not v_exclusions_confirmed then
    raise exception 'Founding Golfer backfill: confirm the exclusion list in 20261006120100 before applying.';
  end if;
end;
$$;

-- Every listed account must exist -- a typo'd / missing uuid aborts the
-- migration instead of silently leaving a test account eligible.
do $$
declare
  v_missing text;
begin
  select string_agg(v.user_id::text, ', ')
    into v_missing
  from (values
    ('24c3c140-b336-4af1-90cb-492c1641901f'::uuid),
    ('5dae1847-bd29-4b21-b98d-67deed32fcf1'::uuid),
    ('e8ddc755-4754-4af3-a13f-e7ea9ccc5ad6'::uuid),
    ('c1c60b9c-8c4d-491a-990d-166a446d771a'::uuid),
    ('81765aff-1c84-4069-b89e-faf393795b58'::uuid),
    ('2d468e5b-c8ec-407b-921b-37303681dd0b'::uuid)
  ) as v(user_id)
  where not exists (select 1 from auth.users u where u.id = v.user_id);

  if v_missing is not null then
    raise exception 'Founding Golfer exclusions: unknown auth.users id(s): %', v_missing;
  end if;
end;
$$;

insert into public.user_roles (user_id, role, granted_by, granted_at, active)
select v.user_id, v.role, '11be6983-7cd6-434d-bb52-6bfaf1d6e309'::uuid, now(), true
from (
  values
    ('24c3c140-b336-4af1-90cb-492c1641901f'::uuid, 'app_reviewer'), -- Apple App Store reviewer
    ('5dae1847-bd29-4b21-b98d-67deed32fcf1'::uuid, 'test'),         -- "tutorial tester"
    ('e8ddc755-4754-4af3-a13f-e7ea9ccc5ad6'::uuid, 'test'),         -- "Nini"
    ('c1c60b9c-8c4d-491a-990d-166a446d771a'::uuid, 'test'),         -- "Jim"
    ('81765aff-1c84-4069-b89e-faf393795b58'::uuid, 'test'),         -- "beta tester"
    ('2d468e5b-c8ec-407b-921b-37303681dd0b'::uuid, 'test')          -- "Beta Tester"
) as v(user_id, role)
on conflict (user_id, role) do update
  set active = true, revoked_at = null, granted_at = now(), granted_by = excluded.granted_by;

-- Open the cohort (it was created closed-but-not-finished).
update public.founding_cohort_state
set is_open = true, opened_at = now()
where cohort = 'nyc_2026' and closed_at is null and not is_open;

-- Backfill through the live award function, signup order, then verify.
--
-- EXPECTED RESULT (verified read-only 2026-10-12), in created_at order:
--   #1 1101110c-3d0d-4823-ae85-c2ceccb05f90  Jordan Kim
--   #2 2e28a8c5-20fc-4099-aae9-1942fad9232d  Jordan Kim
--   #3 db52a027-5d04-4abb-b127-29ce615a20fe  Feiya Wang
--   #4 41458b97-a7c4-4774-82ea-6c17464a17e2  Tom Tang
--   #5 32a49537-3c8e-4adf-96ec-d64daa59f264  Nathan Su
--   #6 b1cd8d61-bc53-439a-8095-f1b8e0639d29  Louis Diamond
--   #7 cd6bfd57-5b9f-4226-95bb-e831c2dd8861  Calvin Kim
-- If anything differs -- including a NEW eligible NYC user who signed up
-- before this is applied -- the migration raises and rolls back entirely.
-- That is intended: re-check the list with Micky and update
-- V_EXPECTED_AWARDS / v_expected below before re-applying.
do $$
declare
  V_EXPECTED_AWARDS constant integer := 7;  -- <== expected backfill count
  v_expected constant uuid[] := array[
    '1101110c-3d0d-4823-ae85-c2ceccb05f90',
    '2e28a8c5-20fc-4099-aae9-1942fad9232d',
    'db52a027-5d04-4abb-b127-29ce615a20fe',
    '41458b97-a7c4-4774-82ea-6c17464a17e2',
    '32a49537-3c8e-4adf-96ec-d64daa59f264',
    'b1cd8d61-bc53-439a-8095-f1b8e0639d29',
    'cd6bfd57-5b9f-4226-95bb-e831c2dd8861'
  ]::uuid[];
  v_actual uuid[];
  r record;
begin
  for r in
    select u.id
    from auth.users u
    join public.profiles p on p.id = u.id
    where p.has_onboarded
      and p.founding_member_number is null
    order by u.created_at, u.id
  loop
    perform private.award_founding_golfer(r.id);
  end loop;

  select coalesce(array_agg(a.user_id order by a.member_number), '{}')
    into v_actual
  from public.founding_golfer_awards a;

  if cardinality(v_actual) <> V_EXPECTED_AWARDS or v_actual <> v_expected then
    raise exception 'Founding Golfer backfill mismatch: expected % awards %, got % %',
      V_EXPECTED_AWARDS, v_expected, cardinality(v_actual), v_actual;
  end if;
end;
$$;
