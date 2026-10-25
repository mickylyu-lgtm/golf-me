-- Founding Golfer exclusions + opening + backfill.
-- Depends on 20261006120000_add_founding_golfer_cohort.sql.
--
-- REVISED 2026-10-25 (same version; neither this file nor 20261006120000
-- has ever been applied: on 2026-10-25 the live database had no founding
-- objects and nothing recorded in schema_migrations since 20261006, so the
-- 2026-10-18 SQL-editor attempt must have rolled back). Revising in place
-- keeps the replay order right: 20261022120000 (Founding decision B, branch
-- global-hosting) builds on this file and must sort after it.
--
-- Micky's decision of 2026-10-25 (replaces the 2026-10-12 one that #1-#7
-- were the original seven): the award rule stays automatic and
-- signup-based, but every account that was eligible BEFORE Kiyyah's signup
-- (2026-10-25) gets no number, so Kiyyah is Founding Golfer #1 and the
-- next eligible signup gets #2. Those eleven are real golfers from the
-- pre-launch friends/testers list, so they get the 'pre_launch' role
-- (Founding-only meaning, see 20261006120000), not 'test'.
--
-- One transaction, in this order:
--   1. sanity: every listed id exists, lists don't overlap, cohort still
--      closed and untouched, ledger empty,
--   2. grant exclusion roles (before anything can be awarded),
--   3. open the cohort,
--   4. award every eligible, non-excluded account through the SAME
--      private.award_founding_golfer() the live trigger uses, oldest
--      auth.users.created_at first,
--   5. abort the whole thing unless exactly the expected list was awarded.
--      So a NEW eligible signup between the pre-check and the apply aborts
--      the install and changes nothing; re-run the pre-check, decide, edit
--      the lists below, and apply again.
--
-- The founder account (11be6983-7cd6-434d-bb52-6bfaf1d6e309) holds an
-- active 'admin' role (20260818040000 bootstrap), which excludes it.
-- Exclusions are a ONE-OFF backfill judgment, NOT a rule for future signups.

-- ===========================================================================
-- THE ONLY PART TO EDIT.
-- ===========================================================================
create temporary table founding_backfill_exclusions (
  user_id uuid primary key,
  role text not null check (role in ('test', 'app_reviewer', 'seeded', 'bot', 'pre_launch'))
) on commit drop;

insert into founding_backfill_exclusions (user_id, role) values
  -- original exclusions (2026-10-12) that still exist. 5dae1847, 81765aff
  -- and 2d468e5b no longer exist (pre-check 2026-10-25): nothing to exclude.
  ('24c3c140-b336-4af1-90cb-492c1641901f', 'app_reviewer'), -- App Store reviewer
  ('e8ddc755-4754-4af3-a13f-e7ea9ccc5ad6', 'test'),
  ('c1c60b9c-8c4d-491a-990d-166a446d771a', 'test'),
  -- eligible before Kiyyah (pre-check 2026-10-25, signup order), real
  -- pre-launch golfers, no number by Micky's decision of 2026-10-25:
  ('1101110c-3d0d-4823-ae85-c2ceccb05f90', 'pre_launch'),
  ('2e28a8c5-20fc-4099-aae9-1942fad9232d', 'pre_launch'),
  ('db52a027-5d04-4abb-b127-29ce615a20fe', 'pre_launch'),
  ('41458b97-a7c4-4774-82ea-6c17464a17e2', 'pre_launch'),
  ('32a49537-3c8e-4adf-96ec-d64daa59f264', 'pre_launch'),
  ('b1cd8d61-bc53-439a-8095-f1b8e0639d29', 'pre_launch'),
  ('cd6bfd57-5b9f-4226-95bb-e831c2dd8861', 'pre_launch'),
  ('ceca23ec-4602-43ef-8bf7-403ecb9c7ac0', 'pre_launch'),
  ('2b46a6ef-bba7-4682-bc09-3526a56e1d0f', 'pre_launch'),
  ('7e71aefc-df00-4ef5-8129-754bb93e1497', 'pre_launch'),
  ('778ea96a-d77a-4bc4-8de8-d36842e0dc19', 'pre_launch')
;

create temporary table founding_backfill_expected (
  member_number integer primary key,
  user_id uuid not null unique
) on commit drop;

insert into founding_backfill_expected (member_number, user_id) values
  (1, '93c351a5-f3b4-42c1-9956-348e3e12311c')  -- Kiyyah, signed up 2026-10-25
;

do $$
declare
  v_lists_confirmed constant boolean := true;  -- confirmed by Micky 2026-10-25 (decision B)
begin
  if not v_lists_confirmed then
    raise exception 'Founding Golfer backfill: confirm both lists in 20261006120100 before applying.';
  end if;
end;
$$;
-- ===========================================================================

-- 1. Sanity checks on the lists and on the untouched cohort.
do $$
declare
  v_bad text;
begin
  -- At least one expected award, numbered 1..N with no gaps.
  if not exists (select 1 from founding_backfill_expected)
     or exists (select 1 from founding_backfill_expected e
                where e.member_number <> (select count(*) from founding_backfill_expected e2
                                          where e2.member_number <= e.member_number)) then
    raise exception 'Founding Golfer backfill: expected numbers must run 1..N with no gaps.';
  end if;

  -- Nobody both excluded and expected.
  select string_agg(left(x.user_id::text, 8), ', ') into v_bad
  from founding_backfill_exclusions x join founding_backfill_expected e using (user_id);
  if v_bad is not null then
    raise exception 'Founding Golfer backfill: excluded and expected: %', v_bad;
  end if;

  -- Every listed account exists (a typo or a deleted account aborts instead
  -- of silently leaving someone eligible).
  select string_agg(left(v.user_id::text, 8), ', ') into v_bad
  from (select user_id from founding_backfill_exclusions
        union all select user_id from founding_backfill_expected) v
  where not exists (select 1 from auth.users u where u.id = v.user_id);
  if v_bad is not null then
    raise exception 'Founding Golfer backfill: unknown auth.users id(s): %', v_bad;
  end if;

  -- The cohort is exactly as 20261006120000 created it.
  if not exists (select 1 from public.founding_cohort_state
                 where cohort = 'nyc_2026' and not is_open and opened_at is null
                   and closed_at is null and next_number = 1 and cap = 250) then
    raise exception 'Founding Golfer backfill: cohort is not in its freshly created state.';
  end if;
  if exists (select 1 from public.founding_golfer_awards)
     or exists (select 1 from public.profiles where founding_golfer or founding_member_number is not null) then
    raise exception 'Founding Golfer backfill: awards already exist.';
  end if;
end;
$$;

-- 2. Exclusion roles.
insert into public.user_roles (user_id, role, granted_by, granted_at, active)
select x.user_id, x.role, '11be6983-7cd6-434d-bb52-6bfaf1d6e309'::uuid, now(), true
from founding_backfill_exclusions x
on conflict (user_id, role) do update
  set active = true, revoked_at = null, granted_at = now(), granted_by = excluded.granted_by;

-- 3. Open the cohort (it was created closed-but-not-finished).
update public.founding_cohort_state
set is_open = true, opened_at = now()
where cohort = 'nyc_2026' and closed_at is null and not is_open;

-- 4 + 5. Backfill through the live award function, signup order, verify.
do $$
declare
  v_expected uuid[];
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

  select array_agg(user_id order by member_number) into v_expected from founding_backfill_expected;
  select coalesce(array_agg(a.user_id order by a.member_number), '{}') into v_actual
  from public.founding_golfer_awards a;

  if v_actual is distinct from v_expected then
    raise exception 'Founding Golfer backfill mismatch: expected % awards, got %; awarded (id prefixes, in order): %',
      cardinality(v_expected), cardinality(v_actual),
      (select string_agg(left(x::text, 8), ', ' order by o) from unnest(v_actual) with ordinality t(x, o));
  end if;

  -- The profiles mirror matches the ledger, and the counter is next.
  if exists (
       select 1 from public.founding_golfer_awards a
       left join public.profiles p on p.id = a.user_id
       where p.founding_member_number is distinct from a.member_number
          or not p.founding_golfer or p.founding_cohort is distinct from a.cohort
          or p.founding_awarded_at is distinct from a.awarded_at)
     or (select count(*) from public.profiles where founding_golfer) <> cardinality(v_expected)
     or not exists (select 1 from public.founding_cohort_state
                    where cohort = 'nyc_2026' and is_open and closed_at is null
                      and next_number = cardinality(v_expected) + 1) then
    raise exception 'Founding Golfer backfill: ledger / profiles / counter out of step.';
  end if;
end;
$$;
