// Local, throwaway SQL checks for
// supabase/migrations/20261022120000_founding_onboarding_window.sql
// (Founding Golfer decision B: onboarding award + 14-day correction window +
// admin review). Runs, in PGlite (in-process WASM Postgres; no Docker, no
// Supabase project, no network), on a minimal Supabase-like stub:
//   1. the REAL applied Founding migration 20261006120000,
//   2. a stand-in for 20261006120100 (open the cohort, award one legacy
//      golfer through the real award function),
//   3. the REAL Phase 2 migration 20261021120000 (place columns),
//   4. the new migration under test.
// It is NOT a substitute for applying to an isolated Supabase project (see
// docs/GLOBAL_HOSTING_ROLLOUT.md), only an early check. Coordinates are
// 2-dp city centroids, as the coarsening trigger would store them.
//
// Run (PGlite is deliberately not a repo dependency):
//   cd "$(mktemp -d)" && npm init -y >/dev/null && npm i @electric-sql/pglite@0.3.7
//   cp /path/to/GolfMe/scripts/migration-checks/founding-onboarding-window.mjs .
//   node founding-onboarding-window.mjs /path/to/GolfMe/supabase/migrations
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const file = (name) => readFileSync(join(dir, name), "utf8");
const cohortMigration = file("20261006120000_add_founding_golfer_cohort.sql");
const phase2Migration = file("20261021120000_profiles_playing_area_place_and_geocode.sql");
const migration = file("20261022120000_founding_onboarding_window.sql");

const db = new PGlite();
const results = [];
async function check(name, fn) {
  try { const r = await fn(); results.push(["PASS", name, r ?? ""]); }
  catch (e) { results.push(["FAIL", name, e.message]); }
}
// Applies a migration in one transaction; rolls back (and rethrows) on error
// so later checks don't run inside an aborted transaction.
async function apply(sql) {
  try { await db.exec("begin;" + sql + "commit;"); }
  catch (e) { await db.exec("rollback;"); throw e; }
}
async function q(sql, params) { return (await db.query(sql, params)).rows; }
async function asUser(role, sub, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
}
async function denied(role, sub, sql) {
  try { await asUser(role, sub, sql); } catch (e) { return e.message; }
  throw new Error(`allowed: ${sql}`);
}
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = id(1), LEGACY_AWARDED = id(2), LEGACY_OLD = id(3), LEGACY_RECENT = id(4);
const N1 = id(11), N2 = id(12), N3 = id(13), N4 = id(14), N5 = id(15), N6 = id(16), N7 = id(17), N8 = id(18), TESTER = id(19);
const NYC = [40.71, -74.01], BROOKLYN = [40.65, -73.95], JERSEY = [40.73, -74.08], TOKYO = [35.69, 139.69], LONDON = [51.51, -0.13],
  PARIS = [48.86, 2.35], BERLIN = [52.52, 13.4], ROME = [41.9, 12.5], PHILLY = [39.95, -75.17];

const ledger = async () => q("select member_number n, user_id u, revoked_at r from public.founding_golfer_awards order by member_number");
const numberOf = async (u) => (await q(`select founding_member_number n from public.profiles where id='${u}'`))[0].n;
const calls = async () => (await q("select count(*)::int c from private.award_calls"))[0].c;
const reviewsOf = async (u) => q(`select reason, status, flags, counted_moves, member_number, window_anchor_source, previous_distance_mi::float8 pd, distance_mi::float8 d from public.founding_eligibility_reviews where user_id='${u}' order by id`);
async function signup(u, { createdAgo = "0 seconds", confirmed = true } = {}) {
  await q(`insert into auth.users (id, email_confirmed_at, created_at) values ('${u}', ${confirmed ? "now()" : "null"}, now() - interval '${createdAgo}')`);
  await q(`insert into public.profiles (id, name, created_at) values ('${u}', 'G${u.slice(-2)}', now() - interval '${createdAgo}')`);
}
// Client-side save (PostgREST runs as authenticated).
async function save(u, set) { await asUser("authenticated", u, `update public.profiles set ${set} where id='${u}'`); }
async function onboard(u, coords, label = "Somewhere") {
  const c = coords ? `playing_area_lat=${coords[0]}, playing_area_lng=${coords[1]}` : "playing_area_lat=null, playing_area_lng=null";
  await save(u, `has_onboarded=true, area_label='${label}', ${c}`);
}
async function move(u, coords, label = "Elsewhere") {
  const c = coords ? `playing_area_lat=${coords[0]}, playing_area_lng=${coords[1]}` : "playing_area_lat=null, playing_area_lng=null";
  await save(u, `area_label='${label}', ${c}`);
}

// --- Supabase-like scaffold (stubs only) ---
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema private; create schema extensions;
grant usage on schema public, private to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email_confirmed_at timestamptz, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('coach_reviewer', 'admin')),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  active boolean not null default true,
  unique (user_id, role));
alter table public.user_roles enable row level security;
create function private.has_role(p_user_id uuid, p_role text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = p_user_id and role = p_role and active = true) $$;
grant execute on function private.has_role(uuid, text) to authenticated;
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, name text, username text,
  avatar_color text, avatar_initials text, photo_url text, handicap int, area_label text, bio text,
  completed_rounds int default 0, would_play_again_pct int default 0, vibes text[] default '{}',
  has_onboarded boolean not null default false, playing_area_lat double precision, playing_area_lng double precision,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
alter table public.profiles enable row level security;
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_select_authenticated on public.profiles for select to authenticated using (true);
grant select, update on public.profiles to authenticated;
create table public.blocks (blocker_id uuid, blocked_id uuid);
create table public.follows (follower_id uuid, following_id uuid);
-- 20261006120000 drops + recreates these two; stubs so the DROP succeeds.
create function public.search_golfer_profiles(p_query text, p_limit integer default 10) returns setof uuid language sql as $$ select null::uuid $$;
create function public.suggested_golfer_profiles(p_limit integer default 6) returns setof uuid language sql as $$ select null::uuid $$;
`);

await check("applied Founding migration 20261006120000 runs on the stub", async () => {
  await apply(cohortMigration);
});

// Stand-in for 20261006120100 + live history before the new migration:
// admin + legacy golfers, cohort opened, one legacy award (#1).
await signup(ADMIN, { createdAgo: "200 days" });
await q(`insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin')`);
await signup(LEGACY_AWARDED, { createdAgo: "60 days" });
await signup(LEGACY_OLD, { createdAgo: "30 days" });
await signup(LEGACY_RECENT, { createdAgo: "5 days" });
await q("update public.founding_cohort_state set is_open = true, opened_at = now() where cohort = 'nyc_2026'");
await onboard(LEGACY_AWARDED, NYC, "New York, NY");
await onboard(LEGACY_OLD, LONDON, "London");
await onboard(LEGACY_RECENT, PHILLY, "Philadelphia");

await check("applied Phase 2 migration 20261021120000 runs on top", async () => {
  await apply(phase2Migration);
});

const before = {
  ledger: JSON.stringify(await ledger()),
  state: JSON.stringify(await q("select next_number, is_open, closed_at from public.founding_cohort_state")),
  profiles: JSON.stringify(await q("select id, updated_at, founding_member_number, founding_awarded_at from public.profiles order by id")),
};

await check("new migration applies cleanly in one transaction", async () => {
  await apply(migration);
});

// Test-only instrumentation: count calls into the award primitive without
// changing it (the decision function resolves the name at run time).
await db.exec(`
create table private.award_calls (n serial, user_id uuid);
alter function private.award_founding_golfer(uuid) rename to award_founding_golfer_impl;
create function private.award_founding_golfer(p_user_id uuid) returns integer language plpgsql security definer set search_path = '' as $$
begin insert into private.award_calls (user_id) values (p_user_id); return private.award_founding_golfer_impl(p_user_id); end $$;
`);

await check("applying it changes no existing award, counter or profile row", async () => {
  const after = {
    ledger: JSON.stringify(await ledger()),
    state: JSON.stringify(await q("select next_number, is_open, closed_at from public.founding_cohort_state")),
    profiles: JSON.stringify(await q("select id, updated_at, founding_member_number, founding_awarded_at from public.profiles order by id")),
  };
  for (const k of Object.keys(before)) if (before[k] !== after[k]) throw new Error(`${k} changed`);
  const nulls = (await q("select count(*)::int c from public.profiles where onboarded_at is not null"))[0].c;
  if (nulls !== 0) throw new Error(`${nulls} rows got onboarded_at`);
  if ((await numberOf(LEGACY_AWARDED)) !== 1) throw new Error("legacy #1 lost");
  return "ledger, counter, updated_at identical; onboarded_at NULL on legacy rows; #1 kept";
});

await check("onboarding inside the zone awards the next number (unchanged rule)", async () => {
  await signup(N1);
  await onboard(N1, NYC, "New York, NY");
  const n = await numberOf(N1);
  const stamped = (await q(`select onboarded_at is not null s from public.profiles where id='${N1}'`))[0].s;
  if (n !== 2 || !stamped) throw new Error(`n=${n} stamped=${stamped}`);
  if ((await reviewsOf(N1)).length) throw new Error("onboarding award should not create a review row");
  return "#2, onboarded_at stamped, no review row";
});

await check("onboarding outside the zone: no award; wrong-city correction within 14 days auto-awards", async () => {
  await signup(N2);
  await onboard(N2, TOKYO, "Tokyo");
  if ((await numberOf(N2)) !== null) throw new Error("Tokyo awarded");
  await move(N2, NYC, "New York, NY");
  const n = await numberOf(N2);
  const r = await reviewsOf(N2);
  if (n !== 3 || r.length !== 1 || r[0].status !== "auto_awarded" || r[0].member_number !== 3 || !r[0].flags.includes("far_jump"))
    throw new Error(JSON.stringify({ n, r }));
  return `#3, recorded auto_awarded flags=${r[0].flags} prev=${r[0].pd}mi new=${r[0].d}mi`;
});

await check("free-text onboarding (no coordinates) corrected to an in-zone city within 14 days auto-awards", async () => {
  await signup(N3);
  await onboard(N3, null, "Brooklyn");
  await move(N3, BROOKLYN, "Brooklyn, NY");
  const r = await reviewsOf(N3);
  if ((await numberOf(N3)) !== 4 || r[0]?.flags.join() !== "no_previous_coordinates") throw new Error(JSON.stringify(r));
  return "#4, flag no_previous_coordinates";
});

await check("correction after 14 days: no award, one pending review", async () => {
  await signup(N4);
  await onboard(N4, LONDON, "London");
  await q(`update public.profiles set onboarded_at = now() - interval '15 days' where id='${N4}'`);
  const l0 = (await ledger()).length;
  await move(N4, NYC, "New York, NY");
  const r = await reviewsOf(N4);
  if ((await numberOf(N4)) !== null || (await ledger()).length !== l0) throw new Error("awarded");
  if (r.length !== 1 || r[0].status !== "pending" || r[0].reason !== "outside_window" || r[0].window_anchor_source !== "onboarded_at") throw new Error(JSON.stringify(r));
  return "no award, pending outside_window";
});

await check("a client cannot write onboarded_at to reopen its window", async () => {
  await save(N4, "onboarded_at = now()");
  const age = (await q(`select (now() - onboarded_at) > interval '14 days' old from public.profiles where id='${N4}'`))[0].old;
  if (!age) throw new Error("client reset onboarded_at");
  await move(N4, LONDON, "London");
  await move(N4, JERSEY, "Jersey City, NJ");
  const r = await reviewsOf(N4);
  if ((await numberOf(N4)) !== null || r.length !== 1 || r[0].status !== "pending") throw new Error(JSON.stringify(r));
  return "write ignored; repeat moves refresh the single pending review";
});

await check("transition: pre-migration account signed up 30 days ago -> review, no award", async () => {
  await move(LEGACY_OLD, NYC, "New York, NY");
  const r = await reviewsOf(LEGACY_OLD);
  if ((await numberOf(LEGACY_OLD)) !== null || r[0]?.status !== "pending" || r[0].window_anchor_source !== "created_at") throw new Error(JSON.stringify(r));
  return "pending, anchored on created_at";
});

await check("transition: pre-migration account signed up 5 days ago keeps the rest of its window", async () => {
  await move(LEGACY_RECENT, JERSEY, "Jersey City, NJ");
  const r = await reviewsOf(LEGACY_RECENT);
  if ((await numberOf(LEGACY_RECENT)) !== 5 || r[0]?.status !== "auto_awarded" || r[0].flags.length !== 0) throw new Error(JSON.stringify(r));
  return "#5 auto_awarded (Philadelphia -> Jersey City, no flags)";
});

await check("move cap: a 4th coordinate change inside the window goes to review, flagged", async () => {
  await signup(N5);
  await onboard(N5, LONDON, "London");
  await move(N5, PARIS, "Paris");
  await move(N5, BERLIN, "Berlin");
  await move(N5, ROME, "Rome");
  await move(N5, NYC, "New York, NY");
  const r = await reviewsOf(N5);
  if ((await numberOf(N5)) !== null || r[0]?.reason !== "correction_over_cap" || r[0].status !== "pending"
    || !["move_cap_exceeded", "rapid_moves", "far_jump"].every((f) => r[0].flags.includes(f)) || r[0].counted_moves !== 4)
    throw new Error(JSON.stringify(r));
  return `pending, flags=${r[0].flags}, counted_moves=4`;
});

await check("third change still auto-awards (cap boundary) and is flagged rapid_moves", async () => {
  await signup(N6);
  await onboard(N6, LONDON, "London");
  await move(N6, PARIS, "Paris");
  await move(N6, BERLIN, "Berlin");
  await move(N6, NYC, "New York, NY");
  const r = await reviewsOf(N6);
  if ((await numberOf(N6)) !== 6 || r[0]?.status !== "auto_awarded" || !r[0].flags.includes("rapid_moves")) throw new Error(JSON.stringify(r));
  return `#6, flags=${r[0].flags}`;
});

await check("place-only / label / bio / same-coordinate saves: 0 award calls, 0 reviews", async () => {
  await q("truncate private.award_calls");
  const r0 = (await q("select count(*)::int c from public.founding_eligibility_reviews"))[0].c;
  await signup(N7);
  await onboard(N7, LONDON, "London");
  await q("truncate private.award_calls");
  // City search never writes the profile; these are the writes that can happen.
  await save(N7, "playing_area_place_id='golfme:nyc', playing_area_country_code='us', playing_area_timezone='America/New_York'");
  await save(N7, "area_label='New York, NY'");
  await save(N7, "bio='hi', distance_unit='mi'");
  await save(N7, `playing_area_lat=${LONDON[0]}, playing_area_lng=${LONDON[1]}, playing_area_place_id='geoapify:51synthNYC01'`);
  await save(N4, `has_onboarded=true, playing_area_lat=${JERSEY[0]}, playing_area_lng=${JERSEY[1]}`);
  const c = await calls();
  const r1 = (await q("select count(*)::int c from public.founding_eligibility_reviews"))[0].c;
  if (c !== 0 || r1 !== r0 || (await numberOf(N7)) !== null) throw new Error(`calls=${c} reviews ${r0}->${r1}`);
  return "0 calls, 0 new reviews, label 'New York, NY' with London coordinates not awarded";
});

await check("excluded / unconfirmed / closed-cohort cases create no review", async () => {
  await signup(TESTER);
  await q(`insert into public.user_roles (user_id, role) values ('${TESTER}', 'test')`);
  await onboard(TESTER, LONDON, "London");
  await move(TESTER, NYC, "New York, NY");
  await signup(N8, { confirmed: false });
  await onboard(N8, LONDON, "London");
  await move(N8, NYC, "New York, NY");
  const r = await q(`select count(*)::int c from public.founding_eligibility_reviews where user_id in ('${TESTER}', '${N8}')`);
  if (r[0].c !== 0 || (await numberOf(TESTER)) !== null || (await numberOf(N8)) !== null) throw new Error(JSON.stringify(r));
  return "test role and unconfirmed email: no award, no review";
});

await check("revoked number is never reused or re-awarded", async () => {
  await asUser("authenticated", ADMIN, "select public.admin_revoke_founding_award(2, 'check')");
  await move(N1, LONDON, "London");
  await move(N1, NYC, "New York, NY");
  if ((await numberOf(N1)) !== null) throw new Error("re-awarded");
  if ((await reviewsOf(N1)).length) throw new Error("revoked account got a review");
  const nums = (await ledger()).map((x) => x.n);
  if (new Set(nums).size !== nums.length) throw new Error("duplicate");
  return `ledger ${nums.join(",")}; #2 revoked stays consumed`;
});

await check("non-admins cannot read or write reviews or call admin RPCs; nobody reads the move log", async () => {
  const seen = await asUser("authenticated", N4, "select count(*)::int c from public.founding_eligibility_reviews");
  if (seen[0].c !== 0) throw new Error("non-admin saw rows");
  const msgs = [];
  msgs.push(await denied("authenticated", N4, `insert into public.founding_eligibility_reviews (user_id, reason, status, window_anchor_at, window_anchor_source, window_ends_at) values ('${N4}', 'outside_window', 'pending', now(), 'created_at', now())`));
  msgs.push(await denied("authenticated", N4, "update public.founding_eligibility_reviews set status = 'dismissed'"));
  msgs.push(await denied("authenticated", N4, "delete from public.founding_eligibility_reviews"));
  msgs.push(await denied("anon", "", "select * from public.founding_eligibility_reviews"));
  msgs.push(await denied("authenticated", N4, "select * from private.founding_location_moves"));
  for (const fn of ["admin_list_founding_reviews()", "admin_approve_founding_review(1)", "admin_dismiss_founding_review(1)"]) {
    msgs.push(await denied("authenticated", N4, `select public.${fn}`));
    msgs.push(await denied("anon", "", `select public.${fn}`));
  }
  const adminSees = await asUser("authenticated", ADMIN, "select count(*)::int c from public.founding_eligibility_reviews");
  if (adminSees[0].c === 0) throw new Error("admin sees nothing");
  return `${msgs.length} denials; admin reads ${adminSees[0].c} rows`;
});

await check("admin approve awards the next number atomically; second approve fails", async () => {
  const pending = await asUser("authenticated", ADMIN, "select id, user_id, current_in_zone from public.admin_list_founding_reviews('pending')");
  const row = pending.find((x) => x.user_id === LEGACY_OLD);
  if (!row?.current_in_zone) throw new Error(JSON.stringify(pending));
  const n = (await asUser("authenticated", ADMIN, `select public.admin_approve_founding_review(${row.id}, 'moved in Sept') v`))[0].v;
  const r = await reviewsOf(LEGACY_OLD);
  if (n !== 7 || (await numberOf(LEGACY_OLD)) !== 7 || r[0].status !== "approved" || r[0].member_number !== 7) throw new Error(JSON.stringify({ n, r }));
  const again = await denied("authenticated", ADMIN, `select public.admin_approve_founding_review(${row.id})`);
  return `#7; repeat -> ${again}`;
});

await check("approve refuses (and changes nothing) when the golfer left the zone; dismiss works; a new move reopens", async () => {
  // N4's saved area is Jersey City; move out first.
  await move(N4, LONDON, "London");
  const id4 = (await q(`select id from public.founding_eligibility_reviews where user_id='${N4}' and status='pending'`))[0].id;
  const msg = await denied("authenticated", ADMIN, `select public.admin_approve_founding_review(${id4})`);
  if ((await numberOf(N4)) !== null || (await reviewsOf(N4))[0].status !== "pending") throw new Error("changed");
  await asUser("authenticated", ADMIN, `select public.admin_dismiss_founding_review(${id4}, 'not local')`);
  await move(N4, NYC, "New York, NY");
  const r = await reviewsOf(N4);
  if (r.map((x) => x.status).join() !== "dismissed,pending") throw new Error(JSON.stringify(r));
  return `refused: ${msg.slice(0, 40)}...; dismissed; new pending after next move`;
});

await check("cap 250 respected: #250 closes the cohort; afterwards no award and no review", async () => {
  await q("update public.founding_cohort_state set next_number = 250 where cohort='nyc_2026'");
  const pendingN5 = (await q(`select id from public.founding_eligibility_reviews where user_id='${N5}' and status='pending'`))[0].id;
  const n = (await asUser("authenticated", ADMIN, `select public.admin_approve_founding_review(${pendingN5}) v`))[0].v;
  const st = (await q("select next_number, is_open, closed_at is not null closed from public.founding_cohort_state"))[0];
  if (n !== 250 || st.is_open || !st.closed) throw new Error(JSON.stringify({ n, st }));
  const msg = await denied("authenticated", ADMIN, `select public.admin_approve_founding_review((select id from public.founding_eligibility_reviews where user_id='${N4}' and status='pending'))`);
  const r0 = (await q("select count(*)::int c from public.founding_eligibility_reviews"))[0].c;
  await signup(id(30));
  await onboard(id(30), NYC, "New York, NY");
  await signup(id(31));
  await onboard(id(31), LONDON, "London");
  await move(id(31), NYC, "New York, NY");
  const r1 = (await q("select count(*)::int c from public.founding_eligibility_reviews"))[0].c;
  const max = (await q("select max(member_number) m, count(*)::int c from public.founding_golfer_awards"))[0];
  if ((await numberOf(id(30))) !== null || (await numberOf(id(31))) !== null || r1 !== r0 || max.m !== 250) throw new Error(JSON.stringify({ r0, r1, max }));
  return `#250 awarded, cohort closed; approve after close refused (${msg.slice(0, 30)}...); max number 250`;
});

await check("a failing Founding check never breaks a profile save", async () => {
  await db.exec(`alter function private.founding_on_location_change(uuid, boolean, boolean, double precision, double precision, text) rename to founding_on_location_change_off`);
  try {
    await move(N7, TOKYO, "Tokyo");
    const r = (await q(`select area_label from public.profiles where id='${N7}'`))[0].area_label;
    if (r !== "Tokyo") throw new Error("save lost");
  } finally {
    await db.exec(`alter function private.founding_on_location_change_off(uuid, boolean, boolean, double precision, double precision, text) rename to founding_on_location_change`);
  }
  return "save kept (WARNING only)";
});

await check("rollback SQL from docs runs cleanly and keeps every award", async () => {
  const kept = JSON.stringify(await ledger());
  await db.exec(`begin;
  create or replace function public.award_founding_golfer_on_profile_change()
  returns trigger language plpgsql security definer set search_path = '' as $$
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
  drop function if exists public.admin_dismiss_founding_review(bigint, text);
  drop function if exists public.admin_approve_founding_review(bigint, text);
  drop function if exists public.admin_list_founding_reviews(text, integer);
  drop function if exists private.founding_on_location_change(uuid, boolean, boolean, double precision, double precision, text);
  drop function if exists private.founding_zone_distance_mi(double precision, double precision);
  drop table if exists public.founding_eligibility_reviews;
  drop table if exists private.founding_location_moves;
  drop trigger if exists profiles_stamp_onboarded_at on public.profiles;
  drop function if exists public.profiles_stamp_onboarded_at();
  alter table public.profiles drop column if exists onboarded_at;
  commit;`);
  if (JSON.stringify(await ledger()) !== kept) throw new Error("ledger changed by rollback");
  return "ledger identical after rollback";
});

for (const r of results) console.log(r.join(" | "));
process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
