import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const migration = readFileSync(process.argv[2], "utf8");
const db = new PGlite();
const results = [];
async function check(name, fn) {
  try { const r = await fn(); results.push(["PASS", name, r ?? ""]); }
  catch (e) { results.push(["FAIL", name, e.message]); }
}
async function expectError(sql, re) {
  try { await db.exec(sql); } catch (e) { if (re.test(e.message)) return e.message; throw new Error("wrong error: " + e.message); }
  throw new Error("expected error, none");
}
async function q(sql, params) { return (await db.query(sql, params)).rows; }
async function asUser(role, sub, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
}
// --- Supabase-like scaffold (stubs only) ---
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema private; create schema extensions;
grant usage on schema public, private to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.profiles (id uuid primary key references auth.users(id), name text, area_label text,
  has_onboarded boolean default false, playing_area_lat double precision, playing_area_lng double precision, founding_member_number int);
alter table public.profiles enable row level security;
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_select_authenticated on public.profiles for select to authenticated using (true);
grant select, update on public.profiles to authenticated;
create table private.award_calls (n serial, user_id uuid);
create function public.stub_award() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into private.award_calls(user_id) values (new.id); return null; end $$;
create trigger profiles_award_founding_golfer after insert or update of has_onboarded, playing_area_lat, playing_area_lng on public.profiles
  for each row when (new.has_onboarded and new.founding_member_number is null and new.playing_area_lat is not null and new.playing_area_lng is not null)
  execute function public.stub_award();
alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant all on functions to anon, authenticated, service_role; alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a', now()), ('00000000-0000-0000-0000-00000000000b', now());
insert into public.profiles (id, name, area_label, has_onboarded, playing_area_lat, playing_area_lng) values
  ('00000000-0000-0000-0000-00000000000a', 'A', 'New York, NY', true, 40.71, -74.01),
  ('00000000-0000-0000-0000-00000000000b', 'B', 'Brooklyn', true, null, null);
truncate private.award_calls;
`);
const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
await check("migration applies cleanly in one transaction", async () => { await db.exec("begin;" + migration + "commit;"); });
await check("existing rows untouched; new columns null", async () => {
  const r = await q("select area_label, playing_area_place_id, playing_area_country_code, playing_area_timezone, distance_unit from public.profiles order by id");
  if (r.some((x) => x.playing_area_place_id || x.playing_area_country_code || x.playing_area_timezone || x.distance_unit)) throw new Error(JSON.stringify(r));
  return JSON.stringify(r.map((x) => x.area_label));
});
await check("anon cannot call consume_geocode_quota", async () => {
  try { await asUser("anon", "", "select public.consume_geocode_quota()"); } catch (e) { return e.message; }
  throw new Error("anon could call it");
});
await check("authenticated without sub -> unauthenticated", async () => {
  const r = await asUser("authenticated", "", "select public.consume_geocode_quota() as v"); if (r[0].v !== "unauthenticated") throw new Error(r[0].v); return r[0].v;
});
await check("per-user 60 credits/hour: 60 ok then user_limit; denied not counted", async () => {
  let last; for (let i = 0; i < 61; i++) last = (await asUser("authenticated", A, "select public.consume_geocode_quota() as v"))[0].v;
  const total = (await q(`select sum(request_count)::int s from private.geocode_rate_buckets where user_id = '${A}'`))[0].s;
  if (last !== "user_limit" || total !== 60) throw new Error(last + " " + total); return `61st=${last}, counted=${total}`;
});
await check("cost 2 counts double; cost 0/6 rejected", async () => {
  const r = (await asUser("authenticated", B, "select public.consume_geocode_quota(2) as v"))[0].v;
  const total = (await q(`select sum(request_count)::int s from private.geocode_rate_buckets where user_id = '${B}'`))[0].s;
  if (r !== "ok" || total !== 2) throw new Error(r + total);
  for (const c of [0, 6]) { try { await asUser("authenticated", B, `select public.consume_geocode_quota(${c})`); throw new Error("accepted " + c); } catch (e) { if (!/Invalid cost/.test(e.message)) throw e; } }
  return "ok";
});
await check("per-user 200/day across hours", async () => {
  await q(`insert into private.geocode_rate_buckets values ('${B}', date_trunc('hour', now()) - interval '3 hours', 198)`);
  const r = (await asUser("authenticated", B, "select public.consume_geocode_quota() as v"))[0].v;
  if (r !== "user_limit") throw new Error(r); return r;
});
await check("global 2000/day", async () => {
  await q(`insert into auth.users values ('00000000-0000-0000-0000-00000000000c', now())`);
  await q(`insert into private.geocode_rate_buckets values ('00000000-0000-0000-0000-00000000000c', date_trunc('hour', now()) - interval '5 hours', 1999)`);
  await q(`delete from private.geocode_rate_buckets where user_id = '${A}'`);
  // total now 1999 + B's 200 = 2199
  const r = (await asUser("authenticated", A, "select public.consume_geocode_quota() as v"))[0].v;
  if (r !== "global_limit") throw new Error(r); return r;
});
await check("authenticated cannot read private tables or call cache fns", async () => {
  const msgs = [];
  for (const sql of ["select * from private.geocode_cache", "select * from private.geocode_rate_buckets", "select public.geocode_cache_get(repeat('a',64))", "select public.geocode_cache_put(repeat('a',64), '[]')"]) {
    try { await asUser("authenticated", A, sql); throw new Error("allowed: " + sql); } catch (e) { if (/allowed/.test(e.message)) throw e; msgs.push("denied"); }
  }
  return msgs.join(",");
});
await check("service_role can use the cache fns", async () => {
  await asUser("service_role", "", `select public.geocode_cache_put(repeat('a',64), '[{"x":1}]')`);
  const r = await asUser("service_role", "", `select public.geocode_cache_get(repeat('a',64)) v`);
  if (!r[0].v) throw new Error("no hit"); return "hit";
});
await check("geo_places: service_role writes, authenticated reads only, anon nothing", async () => {
  await asUser("service_role", "", `insert into public.geo_places (place_id, names, country_code, region_code) values ('geoapify:51synthTYO0001', '{"en":"Tokyo","ja":"東京都"}', 'jp', null)`);
  const r = await asUser("authenticated", A, "select names->>'ja' as ja from public.geo_places");
  if (r[0]?.ja !== "東京都") throw new Error(JSON.stringify(r));
  try { await asUser("authenticated", A, `insert into public.geo_places (place_id, names) values ('geoapify:evil', '{"en":"x"}')`); throw new Error("auth insert allowed"); } catch (e) { if (/allowed/.test(e.message)) throw e; }
  try { await asUser("authenticated", A, `update public.geo_places set names = '{"en":"Evil"}'`); const c = await q("select names->>'en' e from public.geo_places"); if (c[0].e !== "Tokyo") throw new Error("auth update applied"); } catch (e) { if (/applied/.test(e.message)) throw e; }
  try { await asUser("anon", "", "select * from public.geo_places"); throw new Error("anon read allowed"); } catch (e) { if (/allowed/.test(e.message)) throw e; }
  return "ok";
});
await check("geo_places CHECKs: English required, only 6 keys, id shape", async () => {
  for (const [id, names] of [["geoapify:x1", '{"ja":"東京"}'], ["geoapify:x2", '{"en":"a","fr":"b"}'], ["golfme:nyc", '{"en":"a"}'], ["geoapify:x3", '[]']]) {
    try { await q(`insert into public.geo_places (place_id, names) values ('${id}', '${names}')`); throw new Error("accepted " + id + names); } catch (e) { if (/accepted/.test(e.message)) throw e; }
  }
  return "rejected 4/4";
});
await check("profile CHECKs accept valid, reject invalid place values", async () => {
  await asUser("authenticated", A, `update public.profiles set playing_area_place_id='geoapify:51synthTYO0001', playing_area_country_code='jp', playing_area_timezone='Asia/Tokyo', distance_unit='km' where id='${A}'`);
  const bad = ["playing_area_place_id='tokyo'", "playing_area_country_code='JPN'", "playing_area_timezone='Asia/Tokyo; drop'", "distance_unit='yd'"];
  for (const b of bad) { try { await asUser("authenticated", A, `update public.profiles set ${b} where id='${A}'`); throw new Error("accepted " + b); } catch (e) { if (/accepted/.test(e.message)) throw e; } }
  return "4 rejected";
});
await check("user A cannot write user B's place columns (RLS)", async () => {
  await asUser("authenticated", A, `update public.profiles set playing_area_place_id='geoapify:zz' where id='${B}'`);
  const r = await q(`select playing_area_place_id p from public.profiles where id='${B}'`);
  if (r[0].p) throw new Error("cross-user write"); return "0 rows";
});
await check("Founding trigger does NOT fire on place/unit column changes", async () => {
  await q("truncate private.award_calls");
  await asUser("authenticated", A, `update public.profiles set playing_area_place_id='golfme:nyc', playing_area_timezone='America/New_York', distance_unit='mi' where id='${A}'`);
  const n = (await q("select count(*)::int c from private.award_calls"))[0].c;
  if (n !== 0) throw new Error("fired " + n);
  await asUser("authenticated", A, `update public.profiles set playing_area_lat=40.72 where id='${A}'`);
  const n2 = (await q("select count(*)::int c from private.award_calls"))[0].c;
  return `place-only update: 0 calls; lat change: ${n2} call (unchanged behaviour)`;
});
await check("rollback SQL from docs runs cleanly", async () => {
  await db.exec(`begin;
  drop table if exists public.geo_places;
  drop function if exists public.geocode_cache_put(text, jsonb);
  drop function if exists public.geocode_cache_get(text);
  drop function if exists public.consume_geocode_quota(integer);
  drop table if exists private.geocode_rate_buckets;
  drop table if exists private.geocode_cache;
  alter table public.profiles drop column if exists distance_unit, drop column if exists playing_area_timezone, drop column if exists playing_area_country_code, drop column if exists playing_area_place_id;
  commit;`);
  const r = await q("select count(*)::int c from public.profiles"); return `profiles rows kept: ${r[0].c}`;
});
for (const r of results) console.log(r.join(" | "));
process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
